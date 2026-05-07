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
import { PromptQueue } from "./prompt-queue.js";
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
  promptQueue: PromptQueue;
  httpHandle: HttpServerHandle;
  wsHandle: WsServerHandle;
  daemonServer: DaemonServer;
  shutdown(): Promise<void>;
}

export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const sessionManager = new SessionManager();
  const promptQueue = new PromptQueue();

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
    }

    if (isResponse(parsed) && sessionId) {
      const session = sessionManager.getSession(sessionId);
      if (session && !session.gitMeta && session.cwd) {
        extractGitMeta(session.cwd).then((meta) => {
          if (meta) sessionManager.setGitMeta(sessionId, meta);
        }).catch(() => {});
      }
    }

    if (direction === "agent→editor") {
      wsHandle.broadcast(line + "\n");

      if (sessionId && method === "session/update") {
        const params = (parsed as any).params;
        if (params?.stopReason === "end_turn" || params?.type === "agent_message_end") {
          promptQueue.markIdle(sessionId);
        }
      }
    }
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

      if (!promptQueue.canPrompt(sessionId)) {
        wsHandle.broadcast(
          createErrorResponse(requestId as number, ErrorCodes.SESSION_BUSY, "Session is currently processing a prompt"),
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
      promptQueue.markBusy(sessionId);
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
      promptQueue.markIdle(sessionId);
    },
    onClose: (sessionId) => {
      const pipe = findPipeForSession(sessionId);
      if (!pipe) return;

      log(`[${pipe.id}] Web close → session ${sessionId}`);
      if (pipe.agentProc && !pipe.agentProc.killed) {
        pipe.agentProc.kill();
      }
      pipe.socket.end();
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

  return { sessionManager, promptQueue, httpHandle, wsHandle, daemonServer, shutdown };
}
