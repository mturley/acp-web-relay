import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { WebClient } from "./types.js";
import { log } from "./daemon.js";
import {
  parseMessages,
  isRequest,
  isResponse,
  extractMethod,
  createResponse,
  createErrorResponse,
  createNotification,
  ErrorCodes,
} from "./json-rpc.js";
import { type SessionManager, REPLAY_LIMIT } from "./session-manager.js";
import { verifyToken, parseCookieToken, type AuthConfig } from "./auth.js";

export interface WsServerOptions {
  httpServer: HttpServer;
  sessionManager: SessionManager;
  authConfig: AuthConfig;
  getLivePipeIds?: () => Set<string>;
  onPrompt?: (sessionId: string, prompt: unknown, requestId: number | string, senderWs: WebSocket) => void;
  onCancel?: (sessionId: string) => void;
  onClose?: (sessionId: string) => void;
  onRestore?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
  onResponse?: (response: string) => void;
  tryRestoreFromArchive?: (sessionId: string) => Promise<import("./types.js").RelaySession | null>;
}

export interface WsServerHandle {
  broadcast(data: string, exclude?: WebSocket, sessionId?: string): void;
  stop(): void;
}

export function createWsServer(options: WsServerOptions): WsServerHandle {
  const {
    httpServer,
    sessionManager,
    authConfig,
    getLivePipeIds,
    onPrompt,
    onCancel,
    onClose,
    onRestore,
    onDelete,
    onResponse,
    tryRestoreFromArchive: tryRestore,
  } = options;
  const clients = new Map<string, WebClient>();
  let clientCounter = 0;
  let pingInterval: ReturnType<typeof setInterval> | null = null;

  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    handleProtocols: (protocols) => {
      if (protocols.has("acp.v1")) return "acp.v1";
      return false;
    },
    verifyClient: (info, callback) => {
      const cookieToken = parseCookieToken(info.req.headers.cookie);
      if (!cookieToken || !verifyToken(cookieToken, authConfig.jwtSecret)) {
        callback(false, 401, "Unauthorized");
        return;
      }
      callback(true);
    },
  });

  wss.on("connection", (ws, req) => {
    const clientId = `client_${++clientCounter}`;
    let initialized = false;

    const upgradeUrl = new URL(req.url || "", "http://localhost");
    const fullReplay = upgradeUrl.searchParams.get("fullReplay") === "1";

    const client: WebClient = {
      id: clientId,
      ws,
      connectedAt: new Date().toISOString(),
      sessionId: null,
      fullReplay,
    };
    clients.set(clientId, client);
    log(`[${clientId}] Web client connected`);

    ws.on("message", (data) => {
      if (typeof data !== "string" && !(data instanceof Buffer)) return;
      const raw = data.toString();
      const messages = parseMessages(raw);

      for (const msg of messages) {
        if (!isRequest(msg)) {
          if (isResponse(msg) && onResponse) {
            onResponse(JSON.stringify(msg) + "\n");
          }
          continue;
        }
        const req = msg;
        const method = extractMethod(req);

        if (method === "$/ping") continue;

        if (!initialized && method !== "initialize") {
          if (req.id !== undefined) {
            ws.send(createErrorResponse(req.id, ErrorCodes.NOT_INITIALIZED, "Must call initialize first"));
          }
          continue;
        }

        if (method === "initialize") {
          initialized = true;
          if (req.id !== undefined) {
            ws.send(
              createResponse(req.id, {
                protocolVersion: 1,
                agentInfo: { name: "acp-web-relay", version: "1.0.0" },
                capabilities: {
                  loadSession: true,
                  sessionCapabilities: { list: true, resume: true, close: true },
                },
              }),
            );
          }
          continue;
        }

        if (method === "session/list") {
          if (req.id !== undefined) {
            const livePipeIds = getLivePipeIds ? getLivePipeIds() : undefined;
            ws.send(
              createResponse(req.id, {
                sessions: sessionManager.getSessionList(livePipeIds),
              }),
            );
          }
          continue;
        }

        if (method === "session/load") {
          const sessionId = (req.params as Record<string, unknown>)?.sessionId as string;
          if (!sessionId) {
            if (req.id !== undefined) {
              ws.send(createErrorResponse(req.id, ErrorCodes.INVALID_REQUEST, "Missing sessionId"));
            }
            continue;
          }
          const reqId = req.id;
          (async () => {
            let session = sessionManager.getSession(sessionId);
            if (!session && tryRestore) {
              const restored = await tryRestore(sessionId);
              if (restored) {
                sessionManager.addSession(restored);
                session = restored;
              }
            }
            if (!session) {
              if (reqId !== undefined) {
                ws.send(createErrorResponse(reqId, ErrorCodes.SESSION_NOT_FOUND, "Session not found"));
              }
              return;
            }
            client.sessionId = sessionId;
            if (reqId !== undefined) {
              ws.send(createResponse(reqId, { sessionId }));
            }
            if (client.fullReplay) {
              const buffered = sessionManager.getBufferedMessages(sessionId);
              for (const msg of buffered) {
                ws.send(msg.raw + "\n");
              }
            } else {
              const { messages: recent, truncated } =
                sessionManager.getBufferedMessagesSlice(sessionId, REPLAY_LIMIT);
              if (truncated) {
                ws.send(JSON.stringify({
                  jsonrpc: "2.0",
                  method: "session/update",
                  params: {
                    sessionId,
                    update: {
                      sessionUpdate: "agent_message_chunk",
                      content: {
                        type: "text",
                        text: "⏩ Showing recent messages only. Older session history was truncated.",
                      },
                    },
                  },
                }) + "\n");
              }
              for (const msg of recent) {
                ws.send(msg.raw + "\n");
              }
            }
          })().catch((err) => {
            log(`Error loading session ${sessionId}: ${err.message}`);
            if (reqId !== undefined) {
              ws.send(createErrorResponse(reqId, ErrorCodes.SESSION_NOT_FOUND, "Session not found"));
            }
          });
          continue;
        }

        if (method === "session/prompt") {
          const params = req.params as Record<string, unknown>;
          const sessionId = params?.sessionId as string;
          if (req.id !== undefined && onPrompt) {
            onPrompt(sessionId, params?.prompt, req.id, ws);
          }
          continue;
        }

        if (method === "session/cancel") {
          const sessionId = (req.params as Record<string, unknown>)?.sessionId as string;
          if (sessionId && onCancel) {
            onCancel(sessionId);
          }
          continue;
        }

        if (method === "session/close") {
          const sessionId = (req.params as Record<string, unknown>)?.sessionId as string;
          if (sessionId && onClose) {
            onClose(sessionId);
          }
          continue;
        }

        if (method === "session/restore") {
          const sessionId = (req.params as Record<string, unknown>)?.sessionId as string;
          if (sessionId && onRestore) {
            onRestore(sessionId);
          }
          continue;
        }

        if (method === "session/delete") {
          const sessionId = (req.params as Record<string, unknown>)?.sessionId as string;
          if (sessionId && onDelete) {
            onDelete(sessionId);
          }
          continue;
        }

        if (req.id !== undefined) {
          ws.send(createErrorResponse(req.id, ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${method}`));
        }
      }
    });

    ws.on("close", () => {
      clients.delete(clientId);
      log(`[${clientId}] Web client disconnected`);
    });
  });

  pingInterval = setInterval(() => {
    const ping = createNotification("$/ping");
    for (const client of clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(ping);
      }
    }
  }, 25_000);

  return {
    broadcast(data: string, exclude?: WebSocket, sessionId?: string) {
      for (const client of clients.values()) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        if (client.ws === exclude) continue;
        if (sessionId && client.sessionId && client.sessionId !== sessionId) continue;
        client.ws.send(data);
      }
    },

    stop() {
      if (pingInterval) clearInterval(pingInterval);
      wss.close();
    },
  };
}
