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
import { spawnAgent } from "./agent-spawner.js";
import { createStdioProxy, type StdioProxy, type MessageObserver } from "./stdio-proxy.js";
import { SessionManager } from "./session-manager.js";
import { PromptQueue } from "./prompt-queue.js";
import { extractGitMeta } from "./git-meta.js";
import { createHttpServer, type HttpServerHandle } from "./http-server.js";
import { createWsServer, type WsServerHandle } from "./ws-server.js";
import { startDaemonServer, tryConnectDaemon, type DaemonServer } from "./daemon.js";
import type { CliOptions } from "./cli.js";

export interface RelayHandle {
  sessionManager: SessionManager;
  promptQueue: PromptQueue;
  httpHandle: HttpServerHandle;
  wsHandle: WsServerHandle;
  shutdown(): Promise<void>;
}

let syntheticRequestId = 900_000;

export async function startRelay(options: CliOptions): Promise<RelayHandle> {
  const sessionManager = new SessionManager();
  const promptQueue = new PromptQueue();
  const httpHandle = await createHttpServer(options.host, options.port);
  let proxy: StdioProxy | null = null;

  const observer: MessageObserver = (line, direction) => {
    const parsed = parseMessage(line);
    if (!parsed) return;

    const method = extractMethod(parsed);
    const sessionId = extractSessionId(parsed);

    sessionManager.processMessage(line, direction, parsed);

    if (isResponse(parsed) && sessionId && extractMethod(parsed) === null) {
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
          const released = promptQueue.markIdle(sessionId);
          if (released && proxy) {
            const promptReq = createRequest(released.requestId as number, "session/prompt", {
              sessionId,
              prompt: released.prompt,
            });
            proxy.writeToAgent(promptReq);
            sessionManager.processMessage(
              promptReq.trim(),
              "mobile→agent",
              parseMessage(promptReq.trim())!,
            );
            promptQueue.markBusy(sessionId);
          }
        }
      }

      if (isResponse(parsed) && sessionId && method === null) {
        const session = sessionManager.getSession(sessionId);
        if (session && session.messages.length === 0) {
          const syntheticPrompt = createRequest(++syntheticRequestId, "session/prompt", {
            sessionId,
            prompt: [
              {
                type: "text",
                text: `This session is using acp-mobile-relay and I can access it from another device at ${httpHandle.url}. Repeat that URL to me.`,
              },
            ],
          });

          if (proxy) {
            promptQueue.markBusy(sessionId);
            setTimeout(() => {
              proxy!.writeToAgent(syntheticPrompt);
              sessionManager.processMessage(
                syntheticPrompt.trim(),
                "relay→agent",
                parseMessage(syntheticPrompt.trim())!,
              );
            }, 100);
          }
        }
      }
    }
  };

  const wsHandle = createWsServer({
    httpServer: httpHandle.server,
    sessionManager,
    onPrompt: (sessionId, prompt, requestId) => {
      if (!proxy) return;

      if (!promptQueue.canPrompt(sessionId)) {
        const queued = promptQueue.enqueue(sessionId, prompt, requestId);
        if (!queued) {
          wsHandle.broadcast(
            createErrorResponse(requestId as number, ErrorCodes.SESSION_BUSY, "Session is currently processing a prompt"),
          );
        }
        return;
      }

      const promptReq = createRequest(requestId as number, "session/prompt", {
        sessionId,
        prompt,
      });
      proxy.writeToAgent(promptReq);
      sessionManager.processMessage(
        promptReq.trim(),
        "mobile→agent",
        parseMessage(promptReq.trim())!,
      );
      promptQueue.markBusy(sessionId);

      // Also forward to editor stdout so the editor sees mobile-originated prompts
      process.stdout.write(promptReq);
    },
    onCancel: (sessionId) => {
      if (!proxy) return;
      const cancelNotif = createNotification("session/cancel", { sessionId });
      proxy.writeToAgent(cancelNotif);
      process.stdout.write(cancelNotif);
      sessionManager.processMessage(
        cancelNotif.trim(),
        "mobile→agent",
        parseMessage(cancelNotif.trim())!,
      );
      promptQueue.markIdle(sessionId);
    },
  });

  let daemonServer: DaemonServer | null = null;

  if (options.daemon) {
    daemonServer = await startDaemonServer({
      agentCommand: options.agent,
      onMessage: (pipeId, line, direction) => {
        observer(line, direction);
      },
      onPipeDisconnect: (pipeId) => {
        sessionManager.removeSessionsBySource(pipeId);
      },
    });
  } else if (options.agent) {
    const daemonResult = await tryConnectDaemon();
    if (daemonResult.connected) {
      console.error("Connected to daemon, running as thin passthrough.");
      return { sessionManager, promptQueue, httpHandle, wsHandle, shutdown };
    }

    const agent = spawnAgent(options.agent);

    proxy = createStdioProxy(
      process.stdin,
      process.stdout,
      agent.proc.stdin!,
      agent.proc.stdout!,
      observer,
    );

    proxy.start();

    agent.proc.on("exit", (code) => {
      console.error(`Agent process exited with code ${code}`);
      shutdown().then(() => process.exit(code ?? 1));
    });
  }

  async function shutdown(): Promise<void> {
    wsHandle.stop();
    if (daemonServer) await daemonServer.stop();
    await httpHandle.stop();
  }

  process.on("SIGINT", () => shutdown().then(() => process.exit(0)));
  process.on("SIGTERM", () => shutdown().then(() => process.exit(0)));

  return { sessionManager, promptQueue, httpHandle, wsHandle, shutdown };
}
