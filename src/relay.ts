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
import { startDaemonServer, type DaemonServer } from "./daemon.js";
import type { CliOptions } from "./cli.js";

export interface RelayHandle {
  sessionManager: SessionManager;
  promptQueue: PromptQueue;
  httpHandle: HttpServerHandle;
  wsHandle: WsServerHandle;
  daemonServer: DaemonServer;
  shutdown(): Promise<void>;
}

export async function startRelay(options: CliOptions): Promise<RelayHandle> {
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

    sessionManager.processMessage(line, direction, parsed, pipeId);

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

      const method = extractMethod(parsed);
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
      pipe.socket.write(promptReq);
      sessionManager.processMessage(
        promptReq.trim(),
        "mobile→agent",
        parseMessage(promptReq.trim())!,
      );
      promptQueue.markBusy(sessionId);
    },
    onCancel: (sessionId) => {
      const pipe = findPipeForSession(sessionId);
      if (!pipe) return;

      const cancelNotif = createNotification("session/cancel", { sessionId });
      pipe.socket.write(cancelNotif);
      sessionManager.processMessage(
        cancelNotif.trim(),
        "mobile→agent",
        parseMessage(cancelNotif.trim())!,
      );
      promptQueue.markIdle(sessionId);
    },
  });

  const daemonServer = await startDaemonServer({
    agentCommand: options.agent,
    onMessage: observer,
    onPipeDisconnect: (pipeId) => {
      sessionManager.removeSessionsBySource(pipeId);
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
