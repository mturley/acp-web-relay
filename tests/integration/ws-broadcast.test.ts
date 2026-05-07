import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import WebSocket from "ws";
import { createWsServer, type WsServerHandle } from "../../src/ws-server.js";
import { SessionManager } from "../../src/session-manager.js";
import { parseMessage } from "../../src/json-rpc.js";
import * as fixtures from "../fixtures/acp-messages.js";

describe("WebSocket broadcast", () => {
  let httpServer: HttpServer;
  let wsHandle: WsServerHandle;
  let sessionManager: SessionManager;
  let port: number;

  beforeEach(async () => {
    sessionManager = new SessionManager();
    httpServer = createServer();

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (httpServer.address() as any).port;

    wsHandle = createWsServer({
      httpServer,
      sessionManager,
    });
  });

  afterEach(async () => {
    wsHandle.stop();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
  });

  function connectClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      ws.on("open", () => resolve(ws));
      ws.on("error", reject);
    });
  }

  function initializeClient(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      ws.on("message", function handler(data) {
        const msg = JSON.parse(data.toString().trim());
        if (msg.result?.agentInfo) {
          ws.removeListener("message", handler);
          resolve();
        }
      });
      ws.send(fixtures.initializeRequest + "\n");
    });
  }

  function waitForMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString().trim()));
      });
    });
  }

  it("broadcasts agent messages to connected WebSocket clients", async () => {
    const client = await connectClient();
    await initializeClient(client);

    const msgPromise = waitForMessage(client);
    wsHandle.broadcast(fixtures.sessionUpdateNotification + "\n");

    const received = await msgPromise;
    expect(received.method).toBe("session/update");
    expect(received.params.sessionId).toBe("sess_abc123");

    client.close();
  });

  it("broadcasts to multiple clients", async () => {
    const client1 = await connectClient();
    const client2 = await connectClient();
    await initializeClient(client1);
    await initializeClient(client2);

    const p1 = waitForMessage(client1);
    const p2 = waitForMessage(client2);
    wsHandle.broadcast(fixtures.sessionUpdateNotification + "\n");

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.method).toBe("session/update");
    expect(r2.method).toBe("session/update");

    client1.close();
    client2.close();
  });

  it("responds to session/list with current sessions", async () => {
    sessionManager.createSession("sess_test", "/project", "pipe_1");

    const client = await connectClient();
    await initializeClient(client);

    const msgPromise = waitForMessage(client);
    client.send(fixtures.sessionListRequest + "\n");

    const response = await msgPromise;
    expect(response.result.sessions).toHaveLength(1);
    expect(response.result.sessions[0].sessionId).toBe("sess_test");

    client.close();
  });

  it("replays buffered messages on session/load", async () => {
    sessionManager.createSession("sess_abc123", "/project", "pipe_1");
    const parsed = parseMessage(fixtures.sessionUpdateNotification)!;
    sessionManager.bufferMessage("sess_abc123", fixtures.sessionUpdateNotification, "agent→editor", parsed);

    const client = await connectClient();
    await initializeClient(client);

    const messages: any[] = [];
    client.on("message", (data) => {
      const lines = data.toString().split("\n").filter((l: string) => l.trim());
      for (const line of lines) {
        try { messages.push(JSON.parse(line)); } catch {}
      }
    });

    client.send(fixtures.sessionLoadRequest + "\n");

    await new Promise((r) => setTimeout(r, 100));

    const loadResponse = messages.find((m) => m.result?.sessionId === "sess_abc123");
    expect(loadResponse).toBeDefined();

    const replayedUpdate = messages.find((m) => m.method === "session/update");
    expect(replayedUpdate).toBeDefined();

    client.close();
  });

  it("rejects requests before initialize", async () => {
    const client = await connectClient();

    const msgPromise = waitForMessage(client);
    client.send(fixtures.sessionListRequest + "\n");

    const response = await msgPromise;
    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32002);

    client.close();
  });
});
