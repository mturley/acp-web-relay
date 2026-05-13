import {
  parseMessage,
  extractMethod,
  extractSessionId,
  isRequest,
  isResponse,
  createRequest,
  createNotification,
  createErrorResponse,
  ErrorCodes,
} from "./json-rpc.js";
import { SessionManager } from "./session-manager.js";
import { extractGitMeta } from "./git-meta.js";
import { createHttpServer, type HttpServerHandle } from "./http-server.js";
import { createWsServer, type WsServerHandle } from "./ws-server.js";
import type { WebSocket } from "ws";
import { startDaemonServer, log, type DaemonServer } from "./daemon.js";
import {
  loadActiveSessions,
  persistSession,
  persistAllSessions,
  deletePersistedSession,
  archiveOldSessions,
  tryRestoreFromArchive,
} from "./session-persistence.js";
import { ensureCert } from "./tls.js";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { AuthConfig } from "./auth.js";

export interface RelayOptions {
  port: number;
  host: string;
  authConfig: AuthConfig;
}

export interface RelayHandle {
  sessionManager: SessionManager;
  httpHandle: HttpServerHandle;
  wsHandle: WsServerHandle;
  daemonServer: DaemonServer;
  shutdown(): Promise<void>;
}

export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const sessionManager = new SessionManager();
  const pendingAgentRequests = new Map<number | string, string>();
  let relayRequestId = 900000;
  let sessionsChangedTimer: ReturnType<typeof setTimeout> | null = null;

  function broadcastSessionsChanged() {
    if (sessionsChangedTimer) return;
    sessionsChangedTimer = setTimeout(() => {
      sessionsChangedTimer = null;
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    }, 50);
  }

  if (options.host !== "127.0.0.1" && options.host !== "::1" && options.host !== "localhost") {
    console.error(
      `\n  Warning: Binding to ${options.host} — session data (source code, credentials,` +
        "\n  conversation history) will be accessible to other devices on your network." +
        "\n  Use --host 127.0.0.1 to restrict access to this machine only.\n",
    );
  }

  const require = createRequire(import.meta.url);
  const version: string = require("../package.json").version;

  const tls = await ensureCert(join(homedir(), ".acp-web-relay"));
  const httpHandle = await createHttpServer(options.host, options.port, tls, version, options.authConfig);

  const baseDir = join(homedir(), ".acp-web-relay");
  try {
    await access(join(baseDir, "sessions.json"));
    console.error(
      `\n  Warning: Legacy sessions.json found in ${baseDir}.` +
        "\n  This format is no longer supported — sessions are now stored as individual files" +
        "\n  in the sessions/ subdirectory. Your old sessions will not be loaded." +
        `\n  To remove this warning, delete ${join(baseDir, "sessions.json")}\n`,
    );
  } catch {
    /* no legacy file, expected */
  }

  const maxAgeDays = parseInt(process.env.ACP_RELAY_ARCHIVE_AFTER_DAYS ?? "7", 10);
  const hiddenMaxAgeDays = parseInt(process.env.ACP_RELAY_ARCHIVE_HIDDEN_AFTER_DAYS ?? "1", 10);
  const archiveResult = await archiveOldSessions(undefined, maxAgeDays, hiddenMaxAgeDays);
  if (archiveResult.archived.length > 0) {
    log(`Archived ${archiveResult.archived.length} old session(s)`);
  }

  const persisted = await loadActiveSessions();
  for (const session of persisted) {
    sessionManager.addSession(session);
  }
  if (persisted.length > 0) {
    log(`Loaded ${persisted.length} persisted session(s)`);
  }

  // eslint-disable-next-line prefer-const
  let daemonServer: DaemonServer;

  function persistOne(sessionId: string) {
    const session = sessionManager.getSession(sessionId);
    if (!session) return;
    persistSession(session).catch((err: any) => {
      console.error(`Failed to persist session ${sessionId}: ${err.message}`);
    });
  }

  const pipeQueues = new Map<string, Promise<void>>();

  const observer = (pipeId: string, line: string, direction: "editor→agent" | "agent→editor") => {
    const work = async () => {
      const parsed = parseMessage(line);
      if (!parsed) return;

      const sessionId = extractSessionId(parsed);

      if (sessionId && !sessionManager.getSession(sessionId)) {
        const restored = await tryRestoreFromArchive(sessionId);
        if (restored) {
          sessionManager.addSession(restored);
          log(`[${pipeId}] Restored session from archive: ${sessionId}`);
        }
      }

      const method = extractMethod(parsed);
      const hadSession = sessionId ? !!sessionManager.getSession(sessionId) : false;

      sessionManager.processMessage(line, direction, parsed, pipeId);

      if (direction === "agent→editor" && isRequest(parsed) && (parsed as any).id !== undefined) {
        pendingAgentRequests.set((parsed as any).id, pipeId);
      }

      if (direction === "editor→agent" && isResponse(parsed)) {
        const id = (parsed as any).id;
        if (pendingAgentRequests.has(id)) {
          pendingAgentRequests.delete(id);
          wsHandle.broadcast(line + "\n", undefined, sessionId ?? undefined);
        }
      }

      if (sessionId && !hadSession && sessionManager.getSession(sessionId)) {
        const session = sessionManager.getSession(sessionId)!;
        log(`[${pipeId}] Session created: ${sessionId} (cwd: ${session.cwd || "unknown"})`);
        persistOne(sessionId);
        broadcastSessionsChanged();
      }

      if (sessionId && hadSession && sessionManager.resumeSession(sessionId, pipeId)) {
        log(`[${pipeId}] Session resumed: ${sessionId}`);
        persistOne(sessionId);
        broadcastSessionsChanged();
      }

      if (direction === "editor→agent" && method === "session/close" && sessionId) {
        log(`[${pipeId}] Editor closed session ${sessionId}`);
        sessionManager.hideSession(sessionId);
        persistOne(sessionId);
        broadcastSessionsChanged();
      }

      if (direction === "editor→agent" && method === "session/prompt" && sessionId) {
        const params = (parsed as any).params;
        const prompt = params?.prompt;
        if (Array.isArray(prompt)) {
          for (const part of prompt) {
            if (part?.type === "text" && typeof part.text === "string") {
              wsHandle.broadcast(
                createNotification("session/update", {
                  sessionId,
                  update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: part.text } },
                }),
                undefined,
                sessionId,
              );
            }
          }
        }
        broadcastSessionsChanged();
      }

      if (isResponse(parsed)) {
        if (sessionId) {
          const session = sessionManager.getSession(sessionId);
          if (session && !session.gitMeta && session.cwd) {
            extractGitMeta(session.cwd)
              .then((meta) => {
                if (meta) sessionManager.setGitMeta(sessionId, meta);
              })
              .catch(() => {});
          }
        }
        broadcastSessionsChanged();
      }

      if (direction === "editor→agent" && isResponse(parsed)) {
        return;
      }

      wsHandle.broadcast(line + "\n", undefined, sessionId ?? undefined);
    };
    const queue = (pipeQueues.get(pipeId) ?? Promise.resolve()).then(work, work);
    pipeQueues.set(pipeId, queue);
  };

  const wsHandle = createWsServer({
    httpServer: httpHandle.server,
    sessionManager,
    authConfig: options.authConfig,
    getLivePipeIds: () => new Set(daemonServer?.pipes.keys() ?? []),
    onPrompt: (sessionId, prompt, requestId, senderWs: WebSocket) => {
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        wsHandle.broadcast(createErrorResponse(requestId, ErrorCodes.SESSION_NOT_FOUND, "Session not found"));
        return;
      }

      const pipe = findPipeForSession(sessionId);
      if (!pipe) return;

      log(`[${pipe.id}] Web prompt → session ${sessionId}`);

      const promptReq = createRequest(requestId, "session/prompt", {
        sessionId,
        prompt,
      });
      if (pipe.agentProc?.stdin) {
        pipe.agentProc.stdin.write(promptReq);
      }
      pipe.socket.write(promptReq);

      const promptText = extractPromptText(prompt);
      if (promptText) {
        const echoText = `\n\n---\n[Web prompt: ${promptText}]\n\n`;
        const echoNotif = createNotification("session/update", {
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: echoText } },
        });
        pipe.socket.write(echoNotif);
        wsHandle.broadcast(echoNotif, senderWs, sessionId);
      }

      sessionManager.processMessage(promptReq.trim(), "web→agent", parseMessage(promptReq.trim())!, pipe.id);
      broadcastSessionsChanged();
    },
    onCancel: (sessionId) => {
      const pipe = findPipeForSession(sessionId);
      if (!pipe) return;

      log(`[${pipe.id}] Web cancel → session ${sessionId}`);
      const cancelNotif = createNotification("session/cancel", { sessionId });
      if (pipe.agentProc?.stdin) {
        pipe.agentProc.stdin.write(cancelNotif);
      }
      pipe.socket.write(cancelNotif);
      sessionManager.processMessage(cancelNotif.trim(), "web→agent", parseMessage(cancelNotif.trim())!, pipe.id);
    },
    onClose: (sessionId) => {
      const pipe = findPipeForSession(sessionId);
      if (pipe) {
        log(`[${pipe.id}] Web close → session ${sessionId}`);
        const closeNotif = createNotification("session/close", { sessionId });
        pipe.socket.write(closeNotif);
      } else {
        log(`Web close → session ${sessionId} (no pipe)`);
      }
      sessionManager.hideSession(sessionId);
      persistOne(sessionId);
      broadcastSessionsChanged();
    },
    onRestore: (sessionId) => {
      const pipe = findPipeForSession(sessionId);
      if (pipe) {
        log(`[${pipe.id}] Web restore → session ${sessionId}`);
        const session = sessionManager.getSession(sessionId);
        const loadReq = createRequest(relayRequestId++, "session/load", {
          sessionId,
          cwd: session?.cwd || process.cwd(),
          mcpServers: {},
        });
        if (pipe.agentProc?.stdin) {
          pipe.agentProc.stdin.write(loadReq);
        }
        pipe.socket.write(loadReq);
        sessionManager.unhideSession(sessionId);
        persistOne(sessionId);
      } else {
        log(`Web restore → session ${sessionId} (no pipe, cannot restore)`);
      }
      broadcastSessionsChanged();
    },
    onDelete: (sessionId) => {
      log(`Web delete → session ${sessionId}`);
      sessionManager.deleteSession(sessionId);
      deletePersistedSession(sessionId).catch((err) => {
        console.error(`Failed to delete persisted session: ${err.message}`);
      });
      broadcastSessionsChanged();
    },
    tryRestoreFromArchive: async (sessionId) => {
      return tryRestoreFromArchive(sessionId);
    },
    onResponse: (response) => {
      const parsed = parseMessage(response.trim());
      if (!parsed) return;
      const id = (parsed as any).id;
      const pipeId = pendingAgentRequests.get(id);
      if (pipeId) {
        pendingAgentRequests.delete(id);
        const pipe = daemonServer.pipes.get(pipeId);
        if (pipe) {
          log(`[${pipeId}] Web response → agent (id: ${id})`);
          if (pipe.agentProc?.stdin) {
            pipe.agentProc.stdin.write(response);
          }
        }
      }
    },
  });

  daemonServer = await startDaemonServer({
    onMessage: observer,
    onPipeDisconnect: (pipeId) => {
      const affected = sessionManager.hideSessionsBySource(pipeId);
      for (const session of affected) {
        persistSession(session).catch((err: any) => {
          console.error(`Failed to persist session ${session.sessionId}: ${err.message}`);
        });
      }
      broadcastSessionsChanged();
    },
  });

  function extractPromptText(prompt: unknown): string | null {
    if (!Array.isArray(prompt)) return null;
    const textPart = prompt.find((p: any) => typeof p === "object" && p.type === "text" && typeof p.text === "string");
    return textPart ? (textPart as { text: string }).text : null;
  }

  function findPipeForSession(sessionId: string) {
    const session = sessionManager.getSession(sessionId);
    if (!session) return null;
    return daemonServer.pipes.get(session.sourceId) ?? null;
  }

  async function shutdown(): Promise<void> {
    if (sessionsChangedTimer) clearTimeout(sessionsChangedTimer);
    await persistAllSessions(sessionManager.getAllSessions());
    wsHandle.stop();
    await daemonServer.stop();
    await httpHandle.stop();
  }

  process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));

  return { sessionManager, httpHandle, wsHandle, daemonServer, shutdown };
}
