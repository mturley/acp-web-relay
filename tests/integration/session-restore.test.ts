import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createWsServer, type WsServerHandle } from "../../src/ws-server.js";
import { SessionManager } from "../../src/session-manager.js";
import { parseMessage } from "../../src/json-rpc.js";
import { createToken, type AuthConfig } from "../../src/auth.js";
import type { RelaySession } from "../../src/types.js";

const TEST_JWT_SECRET = "test-secret-for-restore-tests";
const testAuthConfig: AuthConfig = {
  passwordHash: "$2a$10$fakehashfortest",
  jwtSecret: TEST_JWT_SECRET,
};
const testToken = createToken(TEST_JWT_SECRET);

function makeSession(id: string, cwd: string, sourceId = "pipe_1"): RelaySession {
  const now = new Date().toISOString();
  return {
    sessionId: id,
    cwd,
    title: `Session ${id}`,
    status: "idle",
    gitMeta: null,
    messages: [],
    createdAt: now,
    updatedAt: now,
    promptPending: false,
    lastPrompt: null,
    hidden: false,
    sourceId,
  };
}

const sessionUpdateNotification = JSON.stringify({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "sess_restore",
    update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello from agent" } },
  },
});

describe("Session restoration via WebSocket", () => {
  let httpServer: HttpServer;
  let wsHandle: WsServerHandle;
  let sessionManager: SessionManager;
  let port: number;
  let tempDir: string;
  let deletedSessions: string[];

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "restore-test-"));
    sessionManager = new SessionManager();
    deletedSessions = [];
    httpServer = createServer();

    await new Promise<void>((resolve) => {
      httpServer.listen(0, "127.0.0.1", () => resolve());
    });
    port = (httpServer.address() as any).port;

    wsHandle = createWsServer({
      httpServer,
      sessionManager,
      authConfig: testAuthConfig,
      getLivePipeIds: () => new Set(["pipe_1"]),
      onDelete: (sessionId) => {
        sessionManager.deleteSession(sessionId);
        deletedSessions.push(sessionId);
      },
      onRestore: (sessionId) => {
        sessionManager.unhideSession(sessionId);
      },
    });
  });

  afterEach(async () => {
    wsHandle.stop();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    await rm(tempDir, { recursive: true, force: true });
  });

  function connectClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
        headers: { cookie: `acp_relay_token=${testToken}` },
      });
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
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: 1, clientInfo: { name: "test", version: "1.0.0" }, capabilities: {} },
        }) + "\n",
      );
    });
  }

  function waitForMessage(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString().trim()));
      });
    });
  }

  function collectMessages(ws: WebSocket, durationMs = 100): Promise<any[]> {
    return new Promise((resolve) => {
      const messages: any[] = [];
      const handler = (data: WebSocket.Data) => {
        const lines = data.toString().split("\n").filter((l: string) => l.trim());
        for (const line of lines) {
          try {
            messages.push(JSON.parse(line));
          } catch {}
        }
      };
      ws.on("message", handler);
      setTimeout(() => {
        ws.removeListener("message", handler);
        resolve(messages);
      }, durationMs);
    });
  }

  it("replays buffered messages when loading a persisted session", async () => {
    const session = makeSession("sess_restore", tempDir);
    sessionManager.addSession(session);
    const parsed = parseMessage(sessionUpdateNotification)!;
    sessionManager.bufferMessage("sess_restore", sessionUpdateNotification, "agent→editor", parsed);

    const client = await connectClient();
    await initializeClient(client);

    const msgPromise = collectMessages(client);
    client.send(
      JSON.stringify({ jsonrpc: "2.0", id: 10, method: "session/load", params: { sessionId: "sess_restore" } }) + "\n",
    );
    const messages = await msgPromise;

    const loadResponse = messages.find((m) => m.id === 10 && m.result?.sessionId === "sess_restore");
    expect(loadResponse).toBeDefined();

    const replayedUpdate = messages.find((m) => m.method === "session/update");
    expect(replayedUpdate).toBeDefined();
    expect(replayedUpdate.params.update.content.text).toBe("Hello from agent");

    client.close();
  });

  it("loads session with deleted cwd successfully", async () => {
    const deletedDir = join(tempDir, "deleted-project");
    const session = makeSession("sess_deleted_cwd", deletedDir);
    sessionManager.addSession(session);
    const parsed = parseMessage(sessionUpdateNotification.replace("sess_restore", "sess_deleted_cwd"))!;
    sessionManager.bufferMessage("sess_deleted_cwd", sessionUpdateNotification.replace("sess_restore", "sess_deleted_cwd"), "agent→editor", parsed);

    const client = await connectClient();
    await initializeClient(client);

    const msgPromise = collectMessages(client);
    client.send(
      JSON.stringify({ jsonrpc: "2.0", id: 11, method: "session/load", params: { sessionId: "sess_deleted_cwd" } }) + "\n",
    );
    const messages = await msgPromise;

    const loadResponse = messages.find((m) => m.id === 11 && m.result);
    expect(loadResponse).toBeDefined();
    expect(loadResponse.result.sessionId).toBe("sess_deleted_cwd");

    client.close();
  });

  it("returns SESSION_NOT_FOUND for nonexistent session", async () => {
    const client = await connectClient();
    await initializeClient(client);

    const msgPromise = waitForMessage(client);
    client.send(
      JSON.stringify({ jsonrpc: "2.0", id: 12, method: "session/load", params: { sessionId: "sess_nonexistent" } }) + "\n",
    );
    const response = await msgPromise;

    expect(response.error).toBeDefined();
    expect(response.error.code).toBe(-32001);
    expect(response.error.message).toBe("Session not found");

    client.close();
  });

  it("deletes session via session/delete RPC", async () => {
    sessionManager.createSession("sess_to_delete", tempDir, "pipe_1");

    const client = await connectClient();
    await initializeClient(client);

    client.send(
      JSON.stringify({ jsonrpc: "2.0", id: 13, method: "session/delete", params: { sessionId: "sess_to_delete" } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(sessionManager.getSession("sess_to_delete")).toBeUndefined();
    expect(deletedSessions).toContain("sess_to_delete");

    client.close();
  });

  it("handles deleting a nonexistent session without crashing", async () => {
    const client = await connectClient();
    await initializeClient(client);

    client.send(
      JSON.stringify({ jsonrpc: "2.0", id: 14, method: "session/delete", params: { sessionId: "sess_ghost" } }) + "\n",
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(deletedSessions).toContain("sess_ghost");

    const listPromise = waitForMessage(client);
    client.send(
      JSON.stringify({ jsonrpc: "2.0", id: 15, method: "session/list", params: {} }) + "\n",
    );
    const response = await listPromise;
    expect(response.result).toBeDefined();

    client.close();
  });

  it("shows hidden sessions in list after hideSessionsBySource", async () => {
    sessionManager.createSession("sess_arch1", tempDir, "pipe_dead");
    sessionManager.createSession("sess_arch2", tempDir, "pipe_dead");
    sessionManager.createSession("sess_alive", tempDir, "pipe_1");

    sessionManager.hideSessionsBySource("pipe_dead");

    const client = await connectClient();
    await initializeClient(client);

    const msgPromise = waitForMessage(client);
    client.send(
      JSON.stringify({ jsonrpc: "2.0", id: 16, method: "session/list", params: {} }) + "\n",
    );
    const response = await msgPromise;
    const sessions = response.result.sessions;

    const hidden = sessions.filter((s: any) => s.hidden);
    const active = sessions.filter((s: any) => !s.hidden);

    expect(hidden).toHaveLength(2);
    expect(active).toHaveLength(1);
    expect(active[0].sessionId).toBe("sess_alive");

    client.close();
  });

  it("shows correct pipeAlive status in session list", async () => {
    sessionManager.createSession("sess_live", tempDir, "pipe_1");
    sessionManager.createSession("sess_dead", tempDir, "pipe_gone");

    const client = await connectClient();
    await initializeClient(client);

    const msgPromise = waitForMessage(client);
    client.send(
      JSON.stringify({ jsonrpc: "2.0", id: 17, method: "session/list", params: {} }) + "\n",
    );
    const response = await msgPromise;
    const sessions = response.result.sessions;

    const live = sessions.find((s: any) => s.sessionId === "sess_live");
    const dead = sessions.find((s: any) => s.sessionId === "sess_dead");

    expect(live.pipeAlive).toBe(true);
    expect(dead.pipeAlive).toBe(false);

    client.close();
  });
});
