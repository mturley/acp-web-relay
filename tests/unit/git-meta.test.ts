import { describe, it, expect } from "vitest";
import { parseRepoName, extractGitMeta } from "../../src/git-meta.js";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

describe("parseRepoName", () => {
  it("parses SSH remote URL", () => {
    expect(parseRepoName("git@github.com:user/project.git", "/fallback")).toBe("project");
  });

  it("parses HTTPS remote URL", () => {
    expect(parseRepoName("https://github.com/user/my-repo.git", "/fallback")).toBe("my-repo");
  });

  it("parses HTTPS without .git suffix", () => {
    expect(parseRepoName("https://github.com/user/my-repo", "/fallback")).toBe("my-repo");
  });

  it("falls back to directory name when no remote", () => {
    expect(parseRepoName(null, "/home/user/my-project")).toBe("my-project");
  });
});

describe("extractGitMeta", () => {
  it("extracts metadata from a valid git repo", async () => {
    const meta = await extractGitMeta(process.cwd());
    expect(meta).not.toBeNull();
    expect(meta!.repoName).toBe("acp-mobile-relay");
    expect(typeof meta!.branch).toBe("string");
  });

  it("returns null for non-git directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "nogit-"));
    try {
      const meta = await extractGitMeta(tempDir);
      expect(meta).toBeNull();
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });

  it("handles repos without remote", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "gitnoremote-"));
    try {
      execFileSync("git", ["init"], { cwd: tempDir });
      execFileSync("git", ["commit", "--allow-empty", "-m", "init"], { cwd: tempDir });

      const meta = await extractGitMeta(tempDir);
      expect(meta).not.toBeNull();
      expect(meta!.remoteUrl).toBeNull();
      expect(typeof meta!.branch).toBe("string");
    } finally {
      await rm(tempDir, { recursive: true });
    }
  });
});
