import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractGitMeta } from "../../src/git-meta.js";

describe("Git metadata edge cases", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "git-meta-edge-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns null for a nonexistent directory", async () => {
    const result = await extractGitMeta("/nonexistent/path/that/does/not/exist");
    expect(result).toBeNull();
  });

  it("returns null for a directory that is not a git repo", async () => {
    const result = await extractGitMeta(tempDir);
    expect(result).toBeNull();
  });
});
