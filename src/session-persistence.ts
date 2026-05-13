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

const writeChains = new Map<string, Promise<void>>();

function parseSessionFile(data: any): RelaySession {
  const { version: _v, ...rest } = data;
  return rest as RelaySession;
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
      sessions.push(parseSessionFile(data));
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
      const isHidden = data.hidden ?? false;
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
    return parseSessionFile(data);
  } catch {
    return null;
  }
}
