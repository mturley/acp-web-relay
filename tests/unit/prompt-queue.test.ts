import { describe, it, expect, beforeEach } from "vitest";
import { PromptQueue } from "../../src/prompt-queue.js";

describe("PromptQueue", () => {
  let queue: PromptQueue;

  beforeEach(() => {
    queue = new PromptQueue();
  });

  describe("canPrompt", () => {
    it("allows prompt when session is idle", () => {
      expect(queue.canPrompt("sess_1")).toBe(true);
    });

    it("rejects prompt when session is busy", () => {
      queue.markBusy("sess_1");
      expect(queue.canPrompt("sess_1")).toBe(false);
    });

    it("allows prompt after session becomes idle again", () => {
      queue.markBusy("sess_1");
      queue.markIdle("sess_1");
      expect(queue.canPrompt("sess_1")).toBe(true);
    });
  });

  describe("synthetic prompt queuing", () => {
    it("queues a real prompt behind a synthetic prompt", () => {
      queue.markBusy("sess_1");
      const queued = queue.enqueue("sess_1", { type: "text", text: "Fix the bug" }, 42);
      expect(queued).toBe(true);
    });

    it("rejects queuing when there's already a queued prompt", () => {
      queue.markBusy("sess_1");
      queue.enqueue("sess_1", { type: "text", text: "First" }, 1);
      const queued = queue.enqueue("sess_1", { type: "text", text: "Second" }, 2);
      expect(queued).toBe(false);
    });

    it("releases queued prompt when marked idle", () => {
      queue.markBusy("sess_1");
      queue.enqueue("sess_1", { type: "text", text: "Fix the bug" }, 42);

      const released = queue.markIdle("sess_1");
      expect(released).not.toBeNull();
      expect(released!.prompt).toEqual({ type: "text", text: "Fix the bug" });
      expect(released!.requestId).toBe(42);
    });

    it("returns null on markIdle when no queued prompt", () => {
      queue.markBusy("sess_1");
      const released = queue.markIdle("sess_1");
      expect(released).toBeNull();
    });
  });
});
