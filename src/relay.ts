import {
  parseMessage,
  extractMethod,
  extractSessionId,
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
import { startDaemonServer, log, type DaemonServer } from "./daemon.js";

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

  if (options.host !== "127.0.0.1" && options.host !== "::1" && options.host !== "localhost") {
    console.error(
      `\n  Warning: Binding to ${options.host} — session data (source code, credentials,` +
        "\n  conversation history) will be accessible to other devices on your network." +
        "\n  Use --host 127.0.0.1 to restrict access to this machine only.\n",
    );
  }

  const httpHandle = await createHttpServer(options.host, options.port);

  const observer = (pipeId: string, line: string, direction: "editor→agent" | "agent→editor") => {
    const parsed = parseMessage(line);
    if (!parsed) return;

    const sessionId = extractSessionId(parsed);
    const method = extractMethod(parsed);
    const hadSession = sessionId ? !!sessionManager.getSession(sessionId) : false;

    sessionManager.processMessage(line, direction, parsed, pipeId);

    if (sessionId && !hadSession && sessionManager.getSession(sessionId)) {
      const session = sessionManager.getSession(sessionId)!;
      log(`[${pipeId}] Session created: ${sessionId} (cwd: ${session.cwd || "unknown"})`);
      wsHandle.broadcast(createNotification("session/update", { type: "session_created" }));
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
    }

    if (isResponse(parsed) && sessionId) {
      const session = sessionManager.getSession(sessionId);
      if (session && !session.gitMeta && session.cwd) {
        extractGitMeta(session.cwd).then((meta) => {
          if (meta) sessionManager.setGitMeta(sessionId, meta);
        }).catch(() => {});
      }
    }

    wsHandle.broadcast(line + "\n");
  };

  const wsHandle = createWsServer({
    httpServer: httpHandle.server,
    sessionManager,
    onPrompt: (sessionId, prompt, requestId) => {
      const session = sessionManager.getSession(sessionId);
      if (!session) {
        wsHandle.broadcast(
          createErrorResponse(requestId as number, ErrorCodes.SESSION_NOT_FOUND, "Session not found"),
        );
        return;
      }

      const pipe = findPipeForSession(sessionId);
      if (!pipe) return;

      const promptReq = createRequest(requestId as number, "session/prompt", {
        sessionId,
        prompt,
      });
      log(`[${pipe.id}] Web prompt → session ${sessionId}`);
      if (pipe.agentProc?.stdin) {
        pipe.agentProc.stdin.write(promptReq);
      }
      pipe.socket.write(promptReq);
      sessionManager.processMessage(
        promptReq.trim(),
        "web→agent",
        parseMessage(promptReq.trim())!,
        pipe.id,
      );
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
      log(`Web archive → session ${sessionId}`);
      sessionManager.archiveSession(sessionId);
      wsHandle.broadcast(createNotification("session/update", { type: "session_archived" }));
    },
    onRestore: (sessionId) => {
      log(`Web restore → session ${sessionId}`);
      sessionManager.unarchiveSession(sessionId);
      wsHandle.broadcast(createNotification("session/update", { type: "session_restored" }));
    },
  });

  const daemonServer = await startDaemonServer({
    onMessage: observer,
    onPipeDisconnect: (pipeId) => {
      sessionManager.removeSessionsBySource(pipeId);
      wsHandle.broadcast(createNotification("session/update", { type: "session_removed" }));
    },
  });

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
