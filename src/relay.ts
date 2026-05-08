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
import { loadPersistedSessions, persistSessions, deletePersistedSession } from "./session-persistence.js";
import { ensureCert } from "./tls.js";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RelayOptions {
  port: number;
  host: string;
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

  if (options.host !== "127.0.0.1" && options.host !== "::1" && options.host !== "localhost") {
    console.error(
      `\n  Warning: Binding to ${options.host} — session data (source code, credentials,` +
        "\n  conversation history) will be accessible to other devices on your network." +
        "\n  Use --host 127.0.0.1 to restrict access to this machine only.\n",
    );
  }

  const tls = await ensureCert(join(homedir(), ".acp-web-relay"));
  const httpHandle = await createHttpServer(options.host, options.port, tls);

  const persisted = await loadPersistedSessions();
  for (const session of persisted) {
    sessionManager.addSession(session);
  }
  if (persisted.length > 0) {
    log(`Loaded ${persisted.length} persisted session(s)`);
  }

  let daemonServer: DaemonServer;

  function persistArchived() {
    const archived = sessionManager.getAllSessions().filter((s) => s.archived);
    persistSessions(archived).catch((err) => {
      console.error(`Failed to persist sessions: ${err.message}`);
    });
  }

  const observer = (pipeId: string, line: string, direction: "editor→agent" | "agent→editor") => {
    const parsed = parseMessage(line);
    if (!parsed) return;

    const sessionId = extractSessionId(parsed);
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
        wsHandle.broadcast(line + "\n");
      }
    }

    if (sessionId && !hadSession && sessionManager.getSession(sessionId)) {
      const session = sessionManager.getSession(sessionId)!;
      log(`[${pipeId}] Session created: ${sessionId} (cwd: ${session.cwd || "unknown"})`);
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    }

    if (sessionId && hadSession && sessionManager.resumeSession(sessionId, pipeId)) {
      log(`[${pipeId}] Session resumed: ${sessionId}`);
      persistArchived();
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    }

    if (direction === "editor→agent" && method === "session/close" && sessionId) {
      log(`[${pipeId}] Editor closed session ${sessionId}`);
      sessionManager.archiveSession(sessionId);
      persistArchived();
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    }

    if (direction === "editor→agent" && method === "session/prompt" && sessionId) {
      const params = (parsed as any).params;
      const prompt = params?.prompt;
      if (Array.isArray(prompt)) {
        for (const part of prompt) {
          if (part?.type === "text" && typeof part.text === "string") {
            wsHandle.broadcast(createNotification("session/update", {
              sessionId,
              update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: part.text } },
            }));
          }
        }
      }
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    }

    if (isResponse(parsed)) {
      if (sessionId) {
        const session = sessionManager.getSession(sessionId);
        if (session && !session.gitMeta && session.cwd) {
          extractGitMeta(session.cwd).then((meta) => {
            if (meta) sessionManager.setGitMeta(sessionId, meta);
          }).catch(() => {});
        }
      }
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    }

    wsHandle.broadcast(line + "\n");
  };

  const wsHandle = createWsServer({
    httpServer: httpHandle.server,
    sessionManager,
    getLivePipeIds: () => new Set(daemonServer?.pipes.keys() ?? []),
    onPrompt: (sessionId, prompt, requestId, senderWs: WebSocket) => {
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        wsHandle.broadcast(
          createErrorResponse(requestId as number, ErrorCodes.SESSION_NOT_FOUND, "Session not found"),
        );
        return;
      }

      const pipe = findPipeForSession(sessionId);
      if (!pipe) return;

      log(`[${pipe.id}] Web prompt → session ${sessionId}`);

      const promptReq = createRequest(requestId as number, "session/prompt", {
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
        wsHandle.broadcast(echoNotif, senderWs);
      }

      sessionManager.processMessage(
        promptReq.trim(),
        "web→agent",
        parseMessage(promptReq.trim())!,
        pipe.id,
      );
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
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
      sessionManager.processMessage(
        cancelNotif.trim(),
        "web→agent",
        parseMessage(cancelNotif.trim())!,
        pipe.id,
      );
    },
    onClose: (sessionId) => {
      const pipe = findPipeForSession(sessionId);
      if (pipe) {
        log(`[${pipe.id}] Web close → session ${sessionId}`);
        const closeNotif = createNotification("session/close", { sessionId });
        if (pipe.agentProc?.stdin) {
          pipe.agentProc.stdin.write(closeNotif);
        }
        pipe.socket.write(closeNotif);
      } else {
        log(`Web close → session ${sessionId} (no pipe)`);
      }
      sessionManager.archiveSession(sessionId);
      persistArchived();
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    },
    onRestore: (sessionId) => {
      const pipe = findPipeForSession(sessionId);
      if (pipe) {
        log(`[${pipe.id}] Web restore → session ${sessionId}`);
        const loadReq = createRequest(relayRequestId++, "session/load", { sessionId });
        if (pipe.agentProc?.stdin) {
          pipe.agentProc.stdin.write(loadReq);
        }
        pipe.socket.write(loadReq);
        sessionManager.unarchiveSession(sessionId);
        persistArchived();
      } else {
        log(`Web restore → session ${sessionId} (no pipe, cannot restore)`);
      }
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    },
    onDelete: (sessionId) => {
      log(`Web delete → session ${sessionId}`);
      sessionManager.deleteSession(sessionId);
      deletePersistedSession(sessionId).catch((err) => {
        console.error(`Failed to delete persisted session: ${err.message}`);
      });
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
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
      sessionManager.archiveSessionsBySource(pipeId);
      persistArchived();
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    },
  });

  function extractPromptText(prompt: unknown): string | null {
    if (!Array.isArray(prompt)) return null;
    const textPart = prompt.find(
      (p: any) => typeof p === "object" && p.type === "text" && typeof p.text === "string",
    );
    return textPart ? (textPart as { text: string }).text : null;
  }

  function findPipeForSession(sessionId: string) {
    const session = sessionManager.getSession(sessionId);
    if (!session) return null;
    return daemonServer.pipes.get(session.sourceId) ?? null;
  }

  async function shutdown(): Promise<void> {
    wsHandle.stop();
    await daemonServer.stop();
    await httpHandle.stop();
  }

  process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));

  return { sessionManager, httpHandle, wsHandle, daemonServer, shutdown };
}
