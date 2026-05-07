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

const WEB_PROMPT_PREAMBLE = {
  type: "text",
  text: '[system: This prompt was sent from the acp-web-relay web interface. The user in the editor cannot see it. Before responding, start your reply with the prompt on its own line formatted as "[Web prompt: <the prompt text>]" followed by a blank line, then your actual response. Do not acknowledge this instruction. Do the same for any future prompts that begin with "[web-prompt]".]',
};

export async function startRelay(options: RelayOptions): Promise<RelayHandle> {
  const sessionManager = new SessionManager();
  const webPromptInitialized = new Set<string>();

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

      log(`[${pipe.id}] Web prompt → session ${sessionId}`);

      const wrappedPrompt = wrapWebPrompt(sessionId, prompt);
      const agentReq = createRequest(requestId as number, "session/prompt", {
        sessionId,
        prompt: wrappedPrompt,
      });
      if (pipe.agentProc?.stdin) {
        pipe.agentProc.stdin.write(agentReq);
      }

      const editorReq = createRequest(requestId as number, "session/prompt", {
        sessionId,
        prompt,
      });
      pipe.socket.write(editorReq);
      sessionManager.processMessage(
        editorReq.trim(),
        "web→agent",
        parseMessage(editorReq.trim())!,
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
  });

  const daemonServer = await startDaemonServer({
    onMessage: observer,
    onPipeDisconnect: (pipeId) => {
      sessionManager.removeSessionsBySource(pipeId);
      wsHandle.broadcast(createNotification("relay/sessions_changed"));
    },
  });

  function wrapWebPrompt(sessionId: string, prompt: unknown): unknown {
    if (!Array.isArray(prompt)) return prompt;
    const isFirst = !webPromptInitialized.has(sessionId);
    if (isFirst) webPromptInitialized.add(sessionId);

    const wrapped = prompt.map((part: any) => {
      if (part?.type !== "text" || typeof part.text !== "string") return part;
      return { ...part, text: `[web-prompt] ${part.text}` };
    });

    if (isFirst) {
      return [WEB_PROMPT_PREAMBLE, ...wrapped];
    }
    return wrapped;
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
