import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import type { RelaySession } from "./types.js";

const DAEMON_DIR = join(homedir(), ".acp-web-relay");
const SESSIONS_FILE = join(DAEMON_DIR, "sessions.json");
const SESSIONS_TMP = join(DAEMON_DIR, "sessions.json.tmp");

interface PersistedData {
  version: number;
  sessions: RelaySession[];
}

let writeChain: Promise<void> = Promise.resolve();

export async function loadPersistedSessions(): Promise<RelaySession[]> {
  try {
    const raw = await readFile(SESSIONS_FILE, "utf-8");
    const data: PersistedData = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.sessions)) return [];
    return data.sessions;
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    console.error(`Warning: failed to load persisted sessions: ${err.message}`);
    return [];
  }
}

export function persistSessions(sessions: RelaySession[]): Promise<void> {
  const work = async () => {
    await mkdir(DAEMON_DIR, { recursive: true });
    const data: PersistedData = { version: 1, sessions };
    await writeFile(SESSIONS_TMP, JSON.stringify(data, null, 2), "utf-8");
    await rename(SESSIONS_TMP, SESSIONS_FILE);
  };
  writeChain = writeChain.then(work, work);
  return writeChain;
}

export async function deletePersistedSession(sessionId: string): Promise<void> {
  const sessions = await loadPersistedSessions();
  const filtered = sessions.filter((s) => s.sessionId !== sessionId);
  await persistSessions(filtered);
}
