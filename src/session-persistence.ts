import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, rename, mkdir, readdir, unlink } from "node:fs/promises";
import type { RelaySession } from "./types.js";

const DEFAULT_BASE_DIR = join(homedir(), ".acp-web-relay");
const SESSIONS_SUBDIR = "sessions";
const ARCHIVE_SUBDIR = "archive";

export function getSessionsDir(baseDir?: string): string {
  return join(baseDir ?? DEFAULT_BASE_DIR, SESSIONS_SUBDIR);
}

export function getArchiveDir(baseDir?: string): string {
  return join(getSessionsDir(baseDir), ARCHIVE_SUBDIR);
}

interface PersistedSessionData extends RelaySession {
  version: number;
}

interface LegacyPersistedData {
  version: number;
  sessions: any[];
}

const writeChains = new Map<string, Promise<void>>();

function normalizeSession(data: any): RelaySession {
  if ("archived" in data && !("hidden" in data)) {
    const { archived, version: _v, ...rest } = data;
    return { ...rest, hidden: archived };
  }
  const { version: _v, ...rest } = data;
  return rest as RelaySession;
}

export async function migrateFromLegacyFile(baseDir?: string): Promise<number> {
  const base = baseDir ?? DEFAULT_BASE_DIR;
  const legacyPath = join(base, "sessions.json");
  let raw: string;
  try {
    raw = await readFile(legacyPath, "utf-8");
  } catch (err: any) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }

  const data: LegacyPersistedData = JSON.parse(raw);
  if (data.version !== 1 || !Array.isArray(data.sessions)) return 0;

  const sessionsDir = getSessionsDir(baseDir);
  await mkdir(sessionsDir, { recursive: true });

  for (const session of data.sessions) {
    const normalized = normalizeSession(session);
    const fileData: PersistedSessionData = { version: 2, ...normalized };
    const filePath = join(sessionsDir, `${normalized.sessionId}.json`);
    await writeFile(filePath, JSON.stringify(fileData, null, 2), "utf-8");
  }

  await rename(legacyPath, join(base, "sessions.json.migrated"));
  return data.sessions.length;
}

export async function loadActiveSessions(baseDir?: string): Promise<RelaySession[]> {
  const sessionsDir = getSessionsDir(baseDir);
  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    throw err;
  }

  const sessions: RelaySession[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await readFile(join(sessionsDir, entry), "utf-8");
      const data = JSON.parse(raw);
      if (data.version !== 2) continue;
      sessions.push(normalizeSession(data));
    } catch {
      console.error(`Warning: failed to load session file ${entry}, skipping`);
    }
  }
  return sessions;
}

export function persistSession(session: RelaySession, baseDir?: string): Promise<void> {
  const sessionsDir = getSessionsDir(baseDir);
  const key = session.sessionId;
  const work = async () => {
    await mkdir(sessionsDir, { recursive: true });
    const filePath = join(sessionsDir, `${session.sessionId}.json`);
    const tmpPath = filePath + ".tmp";
    const data: PersistedSessionData = { version: 2, ...session };
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
    await rename(tmpPath, filePath);
  };
  const chain = (writeChains.get(key) ?? Promise.resolve()).then(work, work);
  writeChains.set(key, chain);
  return chain;
}

export function persistAllSessions(sessions: RelaySession[], baseDir?: string): Promise<void[]> {
  return Promise.all(sessions.map((s) => persistSession(s, baseDir)));
}

export async function deletePersistedSession(sessionId: string, baseDir?: string): Promise<void> {
  const filePath = join(getSessionsDir(baseDir), `${sessionId}.json`);
  await unlink(filePath).catch(() => {});
}

export async function archiveOldSessions(
  baseDir?: string,
  maxAgeDays = 7,
  hiddenMaxAgeDays = 1,
): Promise<{ archived: string[]; errors: string[] }> {
  const sessionsDir = getSessionsDir(baseDir);
  const archiveDir = getArchiveDir(baseDir);
  await mkdir(archiveDir, { recursive: true });

  let entries: string[];
  try {
    entries = await readdir(sessionsDir);
  } catch (err: any) {
    if (err.code === "ENOENT") return { archived: [], errors: [] };
    throw err;
  }

  const now = Date.now();
  const archived: string[] = [];
  const errors: string[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const filePath = join(sessionsDir, entry);
    try {
      const raw = await readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      const updatedAt = new Date(data.updatedAt).getTime();
      const ageDays = (now - updatedAt) / (1000 * 60 * 60 * 24);
      const isHidden = data.hidden ?? data.archived ?? false;
      const threshold = isHidden ? hiddenMaxAgeDays : maxAgeDays;
      if (ageDays > threshold) {
        await rename(filePath, join(archiveDir, entry));
        archived.push(data.sessionId ?? entry);
      }
    } catch (err: any) {
      errors.push(`${entry}: ${err.message}`);
    }
  }
  return { archived, errors };
}

export async function tryRestoreFromArchive(sessionId: string, baseDir?: string): Promise<RelaySession | null> {
  const sessionsDir = getSessionsDir(baseDir);
  const archiveDir = getArchiveDir(baseDir);
  const filename = `${sessionId}.json`;
  const archivePath = join(archiveDir, filename);
  const activePath = join(sessionsDir, filename);

  try {
    await rename(archivePath, activePath);
  } catch (err: any) {
    if (err.code === "ENOENT") return null;
    throw err;
  }

  try {
    const raw = await readFile(activePath, "utf-8");
    const data = JSON.parse(raw);
    return normalizeSession(data);
  } catch {
    return null;
  }
}

// Legacy compat: kept for tests that still use the old API
export async function loadPersistedSessions(dir?: string): Promise<RelaySession[]> {
  const d = dir ?? DEFAULT_BASE_DIR;
  try {
    const raw = await readFile(join(d, "sessions.json"), "utf-8");
    const data: LegacyPersistedData = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.sessions)) return [];
    return data.sessions.map(normalizeSession);
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    console.error(`Warning: failed to load persisted sessions: ${err.message}`);
    return [];
  }
}

export function persistSessions(sessions: RelaySession[], dir?: string): Promise<void> {
  const d = dir ?? DEFAULT_BASE_DIR;
  const key = `legacy:${d}`;
  const work = async () => {
    await mkdir(d, { recursive: true });
    const data: LegacyPersistedData = { version: 1, sessions };
    await writeFile(join(d, "sessions.json.tmp"), JSON.stringify(data, null, 2), "utf-8");
    await rename(join(d, "sessions.json.tmp"), join(d, "sessions.json"));
  };
  const chain = (writeChains.get(key) ?? Promise.resolve()).then(work, work);
  writeChains.set(key, chain);
  return chain;
}
