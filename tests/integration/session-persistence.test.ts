import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPersistedSessions,
  persistSessions,
  deletePersistedSession,
} from "../../src/session-persistence.js";
import type { RelaySession } from "../../src/types.js";

function makeSession(id: string, cwd = "/tmp/test"): RelaySession {
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
    archived: false,
    sourceId: "pipe_1",
  };
}

describe("Session persistence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "persist-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("round-trips persist and load", async () => {
    const sessions = [makeSession("s1"), makeSession("s2")];
    await persistSessions(sessions, tempDir);
    const loaded = await loadPersistedSessions(tempDir);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].sessionId).toBe("s1");
    expect(loaded[1].sessionId).toBe("s2");
    expect(loaded[0].title).toBe("Session s1");
  });

  it("returns empty array when sessions.json does not exist", async () => {
    const loaded = await loadPersistedSessions(tempDir);
    expect(loaded).toEqual([]);
  });

  it("returns empty array for corrupt sessions.json", async () => {
    await writeFile(join(tempDir, "sessions.json"), "not valid json{{{", "utf-8");
    const loaded = await loadPersistedSessions(tempDir);
    expect(loaded).toEqual([]);
  });

  it("returns empty array for version mismatch", async () => {
    await writeFile(
      join(tempDir, "sessions.json"),
      JSON.stringify({ version: 99, sessions: [makeSession("s1")] }),
      "utf-8",
    );
    const loaded = await loadPersistedSessions(tempDir);
    expect(loaded).toEqual([]);
  });

  it("creates missing directory on persist", async () => {
    const nestedDir = join(tempDir, "nested", "deep");
    await persistSessions([makeSession("s1")], nestedDir);
    const loaded = await loadPersistedSessions(nestedDir);
    expect(loaded).toHaveLength(1);
  });

  it("deletes a session from persisted file", async () => {
    const sessions = [makeSession("s1"), makeSession("s2"), makeSession("s3")];
    await persistSessions(sessions, tempDir);

    await deletePersistedSession("s2", tempDir);

    const loaded = await loadPersistedSessions(tempDir);
    expect(loaded).toHaveLength(2);
    expect(loaded.map((s) => s.sessionId)).toEqual(["s1", "s3"]);
  });

  it("handles deleting a nonexistent session gracefully", async () => {
    const sessions = [makeSession("s1")];
    await persistSessions(sessions, tempDir);

    await deletePersistedSession("nonexistent", tempDir);

    const loaded = await loadPersistedSessions(tempDir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].sessionId).toBe("s1");
  });

  it("does not leave temp file after successful write", async () => {
    await persistSessions([makeSession("s1")], tempDir);

    let tmpExists = true;
    try {
      await access(join(tempDir, "sessions.json.tmp"));
    } catch {
      tmpExists = false;
    }
    expect(tmpExists).toBe(false);
  });

  it("serializes concurrent writes via write chain", async () => {
    const writes = Array.from({ length: 10 }, (_, i) =>
      persistSessions([makeSession(`s${i}`)], tempDir),
    );
    await Promise.all(writes);

    const loaded = await loadPersistedSessions(tempDir);
    expect(loaded).toHaveLength(1);

    const raw = await readFile(join(tempDir, "sessions.json"), "utf-8");
    const data = JSON.parse(raw);
    expect(data.version).toBe(1);
    expect(data.sessions).toHaveLength(1);
  });
});
