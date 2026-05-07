import { describe, it, expect, beforeEach } from "vitest";
import { SessionManager } from "../../src/session-manager.js";
import { parseMessage } from "../../src/json-rpc.js";
import * as fixtures from "../fixtures/acp-messages.js";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe("createSession", () => {
    it("creates a session with initial state", () => {
      const session = manager.createSession("sess_1", "/project", "pipe_1");
      expect(session.sessionId).toBe("sess_1");
      expect(session.cwd).toBe("/project");
      expect(session.status).toBe("idle");
      expect(session.title).toBeNull();
      expect(session.gitMeta).toBeNull();
      expect(session.messages).toHaveLength(0);
      expect(session.promptPending).toBe(false);
      expect(session.sourceId).toBe("pipe_1");
    });

    it("creates a session with git metadata", () => {
      const git = { repoName: "project", branch: "main", remoteUrl: null };
      const session = manager.createSession("sess_1", "/project", "pipe_1", git);
      expect(session.gitMeta).toEqual(git);
    });
  });

  describe("getSession / getAllSessions", () => {
    it("retrieves a session by ID", () => {
      manager.createSession("sess_1", "/project", "pipe_1");
      expect(manager.getSession("sess_1")).toBeDefined();
      expect(manager.getSession("nonexistent")).toBeUndefined();
    });

    it("returns all sessions", () => {
      manager.createSession("sess_1", "/project", "pipe_1");
      manager.createSession("sess_2", "/other", "pipe_1");
      expect(manager.getAllSessions()).toHaveLength(2);
    });
  });

  describe("bufferMessage", () => {
    it("adds messages to session buffer", () => {
      manager.createSession("sess_abc123", "/project", "pipe_1");
      const parsed = parseMessage(fixtures.sessionPromptRequest)!;
      manager.bufferMessage("sess_abc123", fixtures.sessionPromptRequest, "editor→agent", parsed);

      const messages = manager.getBufferedMessages("sess_abc123");
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe(1);
      expect(messages[0].direction).toBe("editor→agent");
      expect(messages[0].method).toBe("session/prompt");
    });

    it("increments message IDs sequentially", () => {
      manager.createSession("sess_abc123", "/project", "pipe_1");
      const parsed = parseMessage(fixtures.sessionPromptRequest)!;
      manager.bufferMessage("sess_abc123", fixtures.sessionPromptRequest, "editor→agent", parsed);
      manager.bufferMessage("sess_abc123", fixtures.sessionUpdateNotification, "agent→editor", parseMessage(fixtures.sessionUpdateNotification)!);

      const messages = manager.getBufferedMessages("sess_abc123");
      expect(messages[0].id).toBe(1);
      expect(messages[1].id).toBe(2);
    });

    it("ignores messages for unknown sessions", () => {
      const parsed = parseMessage(fixtures.sessionPromptRequest)!;
      manager.bufferMessage("nonexistent", fixtures.sessionPromptRequest, "editor→agent", parsed);
      expect(manager.getBufferedMessages("nonexistent")).toHaveLength(0);
    });
  });

  describe("status transitions", () => {
    it("transitions to working on session/prompt", () => {
      manager.createSession("sess_abc123", "/project", "pipe_1");
      const parsed = parseMessage(fixtures.sessionPromptRequest)!;
      manager.processMessage(fixtures.sessionPromptRequest, "editor→agent", parsed);

      expect(manager.getSession("sess_abc123")!.status).toBe("working");
      expect(manager.getSession("sess_abc123")!.promptPending).toBe(true);
    });

    it("transitions to idle on prompt response", () => {
      manager.createSession("sess_abc123", "/project", "pipe_1");
      const prompt = parseMessage(fixtures.sessionPromptRequest)!;
      manager.processMessage(fixtures.sessionPromptRequest, "editor→agent", prompt);

      const response = parseMessage(fixtures.sessionPromptResponse)!;
      manager.processMessage(fixtures.sessionPromptResponse, "agent→editor", response);

      expect(manager.getSession("sess_abc123")!.status).toBe("idle");
      expect(manager.getSession("sess_abc123")!.promptPending).toBe(false);
    });

    it("transitions to idle on cancel", () => {
      manager.createSession("sess_abc123", "/project", "pipe_1");
      const prompt = parseMessage(fixtures.sessionPromptRequest)!;
      manager.processMessage(fixtures.sessionPromptRequest, "editor→agent", prompt);

      const cancel = parseMessage(fixtures.sessionCancelNotification)!;
      manager.processMessage(fixtures.sessionCancelNotification, "web→agent", cancel);

      expect(manager.getSession("sess_abc123")!.status).toBe("idle");
    });
  });

  describe("getSessionList", () => {
    it("returns sessions with relay metadata", () => {
      const git = { repoName: "project", branch: "main", remoteUrl: "git@github.com:user/project.git" };
      manager.createSession("sess_1", "/project", "pipe_1", git);

      const list = manager.getSessionList();
      expect(list).toHaveLength(1);
      expect(list[0].sessionId).toBe("sess_1");
      expect(list[0]._meta.relay.status).toBe("idle");
      expect(list[0]._meta.relay.git).toEqual(git);
    });
  });

  describe("removeSessionsBySource", () => {
    it("removes all sessions from a source", () => {
      manager.createSession("sess_1", "/project", "pipe_1");
      manager.createSession("sess_2", "/other", "pipe_1");
      manager.createSession("sess_3", "/third", "pipe_2");

      manager.removeSessionsBySource("pipe_1");
      expect(manager.getAllSessions()).toHaveLength(1);
      expect(manager.getSession("sess_3")).toBeDefined();
    });
  });

  describe("replay", () => {
    it("returns all buffered messages for replay", () => {
      manager.createSession("sess_abc123", "/project", "pipe_1");

      const prompt = parseMessage(fixtures.sessionPromptRequest)!;
      manager.bufferMessage("sess_abc123", fixtures.sessionPromptRequest, "editor→agent", prompt);

      const update = parseMessage(fixtures.sessionUpdateNotification)!;
      manager.bufferMessage("sess_abc123", fixtures.sessionUpdateNotification, "agent→editor", update);

      const endTurn = parseMessage(fixtures.sessionUpdateEndTurn)!;
      manager.bufferMessage("sess_abc123", fixtures.sessionUpdateEndTurn, "agent→editor", endTurn);

      const buffered = manager.getBufferedMessages("sess_abc123");
      expect(buffered).toHaveLength(3);
      expect(buffered[0].raw).toBe(fixtures.sessionPromptRequest);
      expect(buffered[1].raw).toBe(fixtures.sessionUpdateNotification);
      expect(buffered[2].raw).toBe(fixtures.sessionUpdateEndTurn);
    });
  });
});
