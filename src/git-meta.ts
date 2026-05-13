import { execFile } from "node:child_process";
import { basename } from "node:path";
import { access } from "node:fs/promises";
import type { GitMeta } from "./types.js";

const GIT_TIMEOUT_MS = 5000;

function exec(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = execFile(command, args, { cwd, timeout: GIT_TIMEOUT_MS }, (error, stdout) => {
      if (error) {
        const rejection: Error = error;
        return reject(rejection);
      }
      resolve(stdout.trim());
    });
    proc.stderr?.on("data", () => {});
  });
}

export function parseRepoName(remoteUrl: string | null, fallbackDir: string): string {
  if (remoteUrl) {
    const sshMatch = remoteUrl.match(/[:/]([^/]+?)(?:\.git)?$/);
    if (sshMatch) return sshMatch[1];
  }
  return basename(fallbackDir);
}

export async function extractGitMeta(cwd: string): Promise<GitMeta | null> {
  try {
    await access(cwd);
  } catch {
    return null;
  }
  try {
    const toplevel = await exec("git", ["rev-parse", "--show-toplevel"], cwd);
    const branch = await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd);

    let remoteUrl: string | null = null;
    try {
      remoteUrl = await exec("git", ["config", "--get", "remote.origin.url"], cwd);
    } catch {
      // no remote configured
    }

    return {
      repoName: parseRepoName(remoteUrl, toplevel),
      branch,
      remoteUrl,
    };
  } catch {
    return null;
  }
}
