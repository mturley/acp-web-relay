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
      log(`Web archive → session ${sessionId}`);
      sessionManager.archiveSession(sessionId);
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    },
    onRestore: (sessionId) => {
      log(`Web restore → session ${sessionId}`);
      sessionManager.unarchiveSession(sessionId);
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

  const daemonServer = await startDaemonServer({
    onMessage: observer,
    onPipeDisconnect: (pipeId) => {
      sessionManager.removeSessionsBySource(pipeId);
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
