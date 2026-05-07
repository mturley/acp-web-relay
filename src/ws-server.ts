import { WebSocketServer, WebSocket } from "ws";
import type { Server as HttpServer } from "node:http";
import type { WebClient, JsonRpcRequest } from "./types.js";
import { log } from "./daemon.js";
import {
  parseMessages,
  isRequest,
  extractMethod,
  createResponse,
  createErrorResponse,
  createNotification,
  ErrorCodes,
} from "./json-rpc.js";
import type { SessionManager } from "./session-manager.js";

export interface WsServerOptions {
  httpServer: HttpServer;
  sessionManager: SessionManager;
  onPrompt?: (sessionId: string, prompt: unknown, requestId: number | string) => void;
  onCancel?: (sessionId: string) => void;
}

export interface WsServerHandle {
  broadcast(data: string): void;
  stop(): void;
}

export function createWsServer(options: WsServerOptions): WsServerHandle {
  const { httpServer, sessionManager, onPrompt, onCancel } = options;
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
  });

  wss.on("connection", (ws) => {
    const clientId = `client_${++clientCounter}`;
    let initialized = false;

    const client: WebClient = {
      id: clientId,
      ws,
      connectedAt: new Date().toISOString(),
    };
    clients.set(clientId, client);
    log(`[${clientId}] Web client connected`);

    ws.on("message", (data) => {
      if (typeof data !== "string" && !(data instanceof Buffer)) return;
      const raw = data.toString();
      const messages = parseMessages(raw);

      for (const msg of messages) {
        if (!isRequest(msg)) continue;
        const req = msg as JsonRpcRequest;
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
            ws.send(createResponse(req.id, {
              protocolVersion: 1,
              agentInfo: { name: "acp-web-relay", version: "1.0.0" },
              capabilities: {
                loadSession: true,
                sessionCapabilities: { list: true, resume: true, close: true },
              },
            }));
          }
          continue;
        }

        if (method === "session/list") {
          if (req.id !== undefined) {
            ws.send(createResponse(req.id, {
              sessions: sessionManager.getSessionList(),
            }));
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
          const session = sessionManager.getSession(sessionId);
          if (!session) {
            if (req.id !== undefined) {
              ws.send(createErrorResponse(req.id, ErrorCodes.SESSION_NOT_FOUND, "Session not found"));
            }
            continue;
          }
          if (req.id !== undefined) {
            ws.send(createResponse(req.id, { sessionId }));
          }
          const buffered = sessionManager.getBufferedMessages(sessionId);
          for (const msg of buffered) {
            ws.send(msg.raw + "\n");
          }
          continue;
        }

        if (method === "session/prompt") {
          const params = req.params as Record<string, unknown>;
          const sessionId = params?.sessionId as string;
          if (req.id !== undefined && onPrompt) {
            onPrompt(sessionId, params?.prompt, req.id);
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
    broadcast(data: string) {
      for (const client of clients.values()) {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(data);
        }
      }
    },

    stop() {
      if (pingInterval) clearInterval(pingInterval);
      wss.close();
    },
  };
}
