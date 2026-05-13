import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPersistedSessions,
  persistSessions,
  loadActiveSessions,
  persistSession,
  persistAllSessions,
  deletePersistedSession,
  migrateFromLegacyFile,
  archiveOldSessions,
  tryRestoreFromArchive,
  getSessionsDir,
  getArchiveDir,
} from "../../src/session-persistence.js";
import type { RelaySession } from "../../src/types.js";

function makeSession(id: string, cwd = "/tmp/test", overrides: Partial<RelaySession> = {}): RelaySession {
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
    sourceId: "pipe_1",
    ...overrides,
  };
}

describe("Legacy session persistence (sessions.json)", () => {
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

  it("maps archived to hidden on load", async () => {
    const legacySession = { ...makeSession("s1"), archived: true };
    delete (legacySession as any).hidden;
    await writeFile(
      join(tempDir, "sessions.json"),
      JSON.stringify({ version: 1, sessions: [legacySession] }),
      "utf-8",
    );
    const loaded = await loadPersistedSessions(tempDir);
    expect(loaded[0].hidden).toBe(true);
    expect((loaded[0] as any).archived).toBeUndefined();
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

describe("Per-session file persistence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "persist-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists and loads individual session files", async () => {
    await persistSession(makeSession("s1"), tempDir);
    await persistSession(makeSession("s2"), tempDir);

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(2);
    const ids = loaded.map((s) => s.sessionId).sort();
    expect(ids).toEqual(["s1", "s2"]);
  });

  it("returns empty array when sessions directory does not exist", async () => {
    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toEqual([]);
  });

  it("creates missing directory on persist", async () => {
    const nestedDir = join(tempDir, "nested", "deep");
    await persistSession(makeSession("s1"), nestedDir);
    const loaded = await loadActiveSessions(nestedDir);
    expect(loaded).toHaveLength(1);
  });

  it("deletes a session file", async () => {
    await persistSession(makeSession("s1"), tempDir);
    await persistSession(makeSession("s2"), tempDir);
    await persistSession(makeSession("s3"), tempDir);

    await deletePersistedSession("s2", tempDir);

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(2);
    const ids = loaded.map((s) => s.sessionId).sort();
    expect(ids).toEqual(["s1", "s3"]);
  });

  it("handles deleting a nonexistent session gracefully", async () => {
    await persistSession(makeSession("s1"), tempDir);
    await deletePersistedSession("nonexistent", tempDir);
    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(1);
  });

  it("does not leave temp file after successful write", async () => {
    await persistSession(makeSession("s1"), tempDir);

    const sessionsDir = getSessionsDir(tempDir);
    let tmpExists = true;
    try {
      await access(join(sessionsDir, "s1.json.tmp"));
    } catch {
      tmpExists = false;
    }
    expect(tmpExists).toBe(false);
  });

  it("serializes concurrent writes to the same session", async () => {
    const writes = Array.from({ length: 10 }, (_, i) =>
      persistSession(makeSession("s1", `/tmp/test-${i}`), tempDir),
    );
    await Promise.all(writes);

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(1);
  });

  it("allows concurrent writes to different sessions", async () => {
    const writes = Array.from({ length: 5 }, (_, i) =>
      persistSession(makeSession(`s${i}`), tempDir),
    );
    await Promise.all(writes);

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(5);
  });

  it("persists all sessions at once", async () => {
    const sessions = [makeSession("s1"), makeSession("s2"), makeSession("s3")];
    await persistAllSessions(sessions, tempDir);

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(3);
  });

  it("skips non-json files in sessions directory", async () => {
    await persistSession(makeSession("s1"), tempDir);
    const sessionsDir = getSessionsDir(tempDir);
    await writeFile(join(sessionsDir, "README.txt"), "not a session", "utf-8");

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(1);
  });

  it("skips corrupt session files", async () => {
    await persistSession(makeSession("s1"), tempDir);
    const sessionsDir = getSessionsDir(tempDir);
    await writeFile(join(sessionsDir, "corrupt.json"), "not valid json{{{", "utf-8");

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(1);
  });
});

describe("Migration from legacy sessions.json", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "migrate-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("migrates legacy file to per-session files", async () => {
    const sessions = [makeSession("s1"), makeSession("s2")];
    await persistSessions(sessions, tempDir);

    const count = await migrateFromLegacyFile(tempDir);
    expect(count).toBe(2);

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded).toHaveLength(2);

    let legacyExists = true;
    try {
      await access(join(tempDir, "sessions.json"));
    } catch {
      legacyExists = false;
    }
    expect(legacyExists).toBe(false);

    const migratedPath = join(tempDir, "sessions.json.migrated");
    const migratedRaw = await readFile(migratedPath, "utf-8");
    expect(JSON.parse(migratedRaw).version).toBe(1);
  });

  it("is idempotent (no-op if legacy file does not exist)", async () => {
    const count = await migrateFromLegacyFile(tempDir);
    expect(count).toBe(0);
  });

  it("converts archived to hidden during migration", async () => {
    const legacySession = { ...makeSession("s1"), archived: true };
    delete (legacySession as any).hidden;
    await writeFile(
      join(tempDir, "sessions.json"),
      JSON.stringify({ version: 1, sessions: [legacySession] }),
      "utf-8",
    );

    await migrateFromLegacyFile(tempDir);

    const loaded = await loadActiveSessions(tempDir);
    expect(loaded[0].hidden).toBe(true);
    expect((loaded[0] as any).archived).toBeUndefined();
  });
});

describe("Automatic archival", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "archive-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("archives old sessions based on updatedAt", async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();

    await persistSession(makeSession("old", "/tmp", { updatedAt: oldDate }), tempDir);
    await persistSession(makeSession("recent", "/tmp", { updatedAt: recentDate }), tempDir);

    const result = await archiveOldSessions(tempDir, 7, 1);
    expect(result.archived).toEqual(["old"]);

    const active = await loadActiveSessions(tempDir);
    expect(active).toHaveLength(1);
    expect(active[0].sessionId).toBe("recent");

    const archiveDir = getArchiveDir(tempDir);
    const archivedFiles = await readdir(archiveDir);
    expect(archivedFiles).toEqual(["old.json"]);
  });

  it("archives hidden sessions more aggressively", async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

    await persistSession(
      makeSession("hidden_old", "/tmp", { updatedAt: twoDaysAgo, hidden: true }),
      tempDir,
    );
    await persistSession(
      makeSession("active_same_age", "/tmp", { updatedAt: twoDaysAgo }),
      tempDir,
    );

    const result = await archiveOldSessions(tempDir, 7, 1);
    expect(result.archived).toEqual(["hidden_old"]);

    const active = await loadActiveSessions(tempDir);
    expect(active).toHaveLength(1);
    expect(active[0].sessionId).toBe("active_same_age");
  });

  it("no-ops when sessions directory does not exist", async () => {
    const result = await archiveOldSessions(tempDir, 7, 1);
    expect(result.archived).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});

describe("Lazy restore from archive", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "restore-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("restores a session from archive directory", async () => {
    const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await persistSession(makeSession("archived_sess", "/tmp", { updatedAt: oldDate }), tempDir);

    await archiveOldSessions(tempDir, 7, 1);
    let active = await loadActiveSessions(tempDir);
    expect(active).toHaveLength(0);

    const restored = await tryRestoreFromArchive("archived_sess", tempDir);
    expect(restored).not.toBeNull();
    expect(restored!.sessionId).toBe("archived_sess");

    active = await loadActiveSessions(tempDir);
    expect(active).toHaveLength(1);
  });

  it("returns null for nonexistent session", async () => {
    const result = await tryRestoreFromArchive("nonexistent", tempDir);
    expect(result).toBeNull();
  });
});
