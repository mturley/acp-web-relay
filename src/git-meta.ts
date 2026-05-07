import { execFile } from "node:child_process";
import { basename } from "node:path";
import type { GitMeta } from "./types.js";

function exec(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim());
    });
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
