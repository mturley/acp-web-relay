import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import WebSocket from "ws";
import { createWsServer, type WsServerHandle } from "../../src/ws-server.js";
import { SessionManager } from "../../src/session-manager.js";
import { parseMessage } from "../../src/json-rpc.js";
import { persistSession, loadActiveSessions } from "../../src/session-persistence.js";
import { createToken, type AuthConfig } from "../../src/auth.js";
import type { RelaySession } from "../../src/types.js";

const TEST_JWT_SECRET = "test-secret-for-lifecycle-tests";
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
    title: null,
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

describe("Session lifecycle integrity", () => {
  let httpServer: HttpServer;
  let wsHandle: WsServerHandle;
  let sessionManager: SessionManager;
  let port: number;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lifecycle-test-"));
    sessionManager = new SessionManager();
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
        const lines = data
          .toString()
          .split("\n")
          .filter((l: string) => l.trim());
        for (const line of lines) {
          try {
            messages.push(JSON.parse(line));
          } catch {
            /* ignore parse errors */
          }
        }
      };
      ws.on("message", handler);
      setTimeout(() => {
        ws.removeListener("message", handler);
        resolve(messages);
      }, durationMs);
    });
  }

  it("sessions survive persist-and-reload cycle", async () => {
    const session = makeSession("sess_survive", tempDir);
    sessionManager.addSession(session);

    const updateMsg = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_survive",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Persisted message" } },
      },
    });
    const parsed = parseMessage(updateMsg)!;
    sessionManager.bufferMessage("sess_survive", updateMsg, "agent→editor", parsed);

    for (const s of sessionManager.getAllSessions()) {
      await persistSession(s, tempDir);
    }

    const newManager = new SessionManager();
    const loaded = await loadActiveSessions(tempDir);
    for (const s of loaded) {
      newManager.addSession(s);
    }

    const restoredSession = newManager.getSession("sess_survive");
    expect(restoredSession).toBeDefined();
    expect(restoredSession!.sessionId).toBe("sess_survive");

    const buffered = newManager.getBufferedMessages("sess_survive");
    expect(buffered).toHaveLength(1);
    expect(buffered[0].method).toBe("session/update");

    const rawParsed = JSON.parse(buffered[0].raw);
    expect(rawParsed.params.update.content.text).toBe("Persisted message");
  });

  it("hidden session appears in list with hidden flag", async () => {
    sessionManager.createSession("sess_hidden", tempDir, "pipe_1");
    sessionManager.hideSession("sess_hidden");

    const client = await connectClient();
    await initializeClient(client);

    const msgPromise = waitForMessage(client);
    client.send(JSON.stringify({ jsonrpc: "2.0", id: 20, method: "session/list", params: {} }) + "\n");
    const response = await msgPromise;
    const sessions = response.result.sessions;

    expect(sessions).toHaveLength(1);
    expect(sessions[0].hidden).toBe(true);
    expect(sessions[0].sessionId).toBe("sess_hidden");

    client.close();
  });

  it("multiple clients can load the same session and receive buffered messages", async () => {
    const session = makeSession("sess_multi", tempDir);
    sessionManager.addSession(session);

    const updateMsg = JSON.stringify({
      jsonrpc: "2.0",
      method: "session/update",
      params: {
        sessionId: "sess_multi",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Shared message" } },
      },
    });
    const parsed = parseMessage(updateMsg)!;
    sessionManager.bufferMessage("sess_multi", updateMsg, "agent→editor", parsed);

    const client1 = await connectClient();
    const client2 = await connectClient();
    await initializeClient(client1);
    await initializeClient(client2);

    const loadReq =
      JSON.stringify({ jsonrpc: "2.0", id: 21, method: "session/load", params: { sessionId: "sess_multi" } }) + "\n";

    const p1 = collectMessages(client1);
    const p2 = collectMessages(client2);

    client1.send(loadReq);
    client2.send(loadReq);

    const [msgs1, msgs2] = await Promise.all([p1, p2]);

    const replay1 = msgs1.find((m) => m.method === "session/update");
    const replay2 = msgs2.find((m) => m.method === "session/update");

    expect(replay1).toBeDefined();
    expect(replay2).toBeDefined();
    expect(replay1.params.update.content.text).toBe("Shared message");
    expect(replay2.params.update.content.text).toBe("Shared message");

    client1.close();
    client2.close();
  });

  it("session title is extracted from user_message_chunk during processing", async () => {
    sessionManager.createSession("sess_title", tempDir, "pipe_1");

    const promptMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "session/prompt",
      params: {
        sessionId: "sess_title",
        prompt: [{ type: "text", text: "Fix the login form validation" }],
      },
    });
    const parsed = parseMessage(promptMsg)!;
    sessionManager.processMessage(promptMsg, "editor→agent", parsed, "pipe_1");

    const session = sessionManager.getSession("sess_title");
    expect(session).toBeDefined();
    expect(session!.title).toBe("Fix the login form validation");
  });
});
