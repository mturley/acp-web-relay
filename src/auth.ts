import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const AUTH_FILE = "auth.json";
const SALT_ROUNDS = 10;
const TOKEN_EXPIRY = "7d";
const COOKIE_NAME = "acp_relay_token";
const COOKIE_MAX_AGE = 604800; // 7 days in seconds

export interface AuthConfig {
  passwordHash: string;
  jwtSecret: string;
}

export async function ensureAuth(dir: string, password: string): Promise<AuthConfig> {
  const authPath = join(dir, AUTH_FILE);

  if (existsSync(authPath)) {
    try {
      const raw = JSON.parse(await readFile(authPath, "utf-8"));
      if (raw.passwordHash && raw.jwtSecret) {
        const matches = await bcrypt.compare(password, raw.passwordHash);
        if (matches) {
          return { passwordHash: raw.passwordHash, jwtSecret: raw.jwtSecret };
        }
      }
    } catch {
      // Corrupted file — fall through to create new
    }
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const jwtSecret = randomBytes(32).toString("hex");
  const config: AuthConfig = { passwordHash, jwtSecret };

  await writeFile(authPath, JSON.stringify(config, null, 2), "utf-8");
  return config;
}

export async function loadAuthConfig(dir: string): Promise<AuthConfig | null> {
  const authPath = join(dir, AUTH_FILE);
  if (!existsSync(authPath)) return null;
  try {
    const raw = JSON.parse(await readFile(authPath, "utf-8"));
    if (raw.passwordHash && raw.jwtSecret) {
      return { passwordHash: raw.passwordHash, jwtSecret: raw.jwtSecret };
    }
  } catch {
    // Corrupted
  }
  return null;
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createToken(secret: string): string {
  return jwt.sign({}, secret, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string, secret: string): jwt.JwtPayload | null {
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === "object") return payload as jwt.JwtPayload;
    return null;
  } catch {
    return null;
  }
}

export function parseCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.split(";").map((c) => c.trim()).find((c) => c.startsWith(`${COOKIE_NAME}=`));
  return match ? match.slice(COOKIE_NAME.length + 1) : null;
}

export function clearTokenCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

export { COOKIE_NAME };
