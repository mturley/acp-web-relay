import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureAuth,
  verifyPassword,
  createToken,
  verifyToken,
  parseCookieToken,
  type AuthConfig,
} from "../../src/auth.js";

describe("auth", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `acp-relay-test-${Date.now()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("ensureAuth", () => {
    it("creates auth.json with password hash and jwt secret", async () => {
      const config = await ensureAuth(testDir, "testpass123");
      expect(config.passwordHash).toBeTruthy();
      expect(config.jwtSecret).toBeTruthy();
      expect(config.jwtSecret.length).toBe(64);

      const raw = JSON.parse(await readFile(join(testDir, "auth.json"), "utf-8"));
      expect(raw.passwordHash).toBe(config.passwordHash);
      expect(raw.jwtSecret).toBe(config.jwtSecret);
    });

    it("loads existing auth.json on subsequent calls", async () => {
      const first = await ensureAuth(testDir, "testpass123");
      const second = await ensureAuth(testDir, "testpass123");
      expect(second.passwordHash).toBe(first.passwordHash);
      expect(second.jwtSecret).toBe(first.jwtSecret);
    });

    it("regenerates jwt secret when password changes via --set-password", async () => {
      const first = await ensureAuth(testDir, "oldpass");
      const second = await ensureAuth(testDir, "newpass");
      expect(second.jwtSecret).not.toBe(first.jwtSecret);
      expect(second.passwordHash).not.toBe(first.passwordHash);
    });
  });

  describe("verifyPassword", () => {
    it("returns true for correct password", async () => {
      const config = await ensureAuth(testDir, "mypassword");
      expect(await verifyPassword("mypassword", config.passwordHash)).toBe(true);
    });

    it("returns false for incorrect password", async () => {
      const config = await ensureAuth(testDir, "mypassword");
      expect(await verifyPassword("wrongpassword", config.passwordHash)).toBe(false);
    });
  });

  describe("createToken / verifyToken", () => {
    it("creates a verifiable JWT", () => {
      const token = createToken("test-secret");
      const payload = verifyToken(token, "test-secret");
      expect(payload).toBeTruthy();
      expect(payload!.iat).toBeDefined();
      expect(payload!.exp).toBeDefined();
    });

    it("returns null for invalid token", () => {
      expect(verifyToken("garbage", "test-secret")).toBeNull();
    });

    it("returns null for wrong secret", () => {
      const token = createToken("secret-a");
      expect(verifyToken(token, "secret-b")).toBeNull();
    });
  });

  describe("parseCookieToken", () => {
    it("extracts acp_relay_token from cookie header", () => {
      const token = parseCookieToken("foo=bar; acp_relay_token=mytoken; baz=qux");
      expect(token).toBe("mytoken");
    });

    it("returns null when cookie is missing", () => {
      expect(parseCookieToken("foo=bar")).toBeNull();
      expect(parseCookieToken(undefined)).toBeNull();
    });
  });
});
