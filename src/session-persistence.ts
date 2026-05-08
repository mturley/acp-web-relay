import { join } from "node:path";
import { homedir } from "node:os";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import type { RelaySession } from "./types.js";

const DEFAULT_DIR = join(homedir(), ".acp-web-relay");

interface PersistedData {
  version: number;
  sessions: RelaySession[];
}

const writeChains = new Map<string, Promise<void>>();

export async function loadPersistedSessions(dir?: string): Promise<RelaySession[]> {
  const d = dir ?? DEFAULT_DIR;
  try {
    const raw = await readFile(join(d, "sessions.json"), "utf-8");
    const data: PersistedData = JSON.parse(raw);
    if (data.version !== 1 || !Array.isArray(data.sessions)) return [];
    return data.sessions;
  } catch (err: any) {
    if (err.code === "ENOENT") return [];
    console.error(`Warning: failed to load persisted sessions: ${err.message}`);
    return [];
  }
}

export function persistSessions(sessions: RelaySession[], dir?: string): Promise<void> {
  const d = dir ?? DEFAULT_DIR;
  const key = d;
  const work = async () => {
    await mkdir(d, { recursive: true });
    const data: PersistedData = { version: 1, sessions };
    await writeFile(join(d, "sessions.json.tmp"), JSON.stringify(data, null, 2), "utf-8");
    await rename(join(d, "sessions.json.tmp"), join(d, "sessions.json"));
  };
  const chain = (writeChains.get(key) ?? Promise.resolve()).then(work, work);
  writeChains.set(key, chain);
  return chain;
}

export async function deletePersistedSession(sessionId: string, dir?: string): Promise<void> {
  const sessions = await loadPersistedSessions(dir);
  const filtered = sessions.filter((s) => s.sessionId !== sessionId);
  await persistSessions(filtered, dir);
}
