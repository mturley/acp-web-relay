# Web Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add password-based authentication to the web relay so browser clients must log in before accessing sessions or WebSocket connections.

**Architecture:** JWT tokens transported via HttpOnly cookies. Password hashed with bcrypt and stored in `~/.acp-web-relay/auth.json` alongside an auto-generated JWT signing secret. Login page serves a password form; all other routes and WebSocket upgrades require a valid cookie. No ACP UI fork changes needed.

**Tech Stack:** `bcryptjs` (password hashing), `jsonwebtoken` (JWT signing/verification), Node.js `node:crypto` (secret generation), Node.js `node:readline` (interactive password prompt)

---

### Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install bcryptjs and jsonwebtoken with type definitions**

```bash
cd /Users/mturley/git/acp-web-relay
npm install bcryptjs jsonwebtoken
npm install --save-dev @types/bcryptjs @types/jsonwebtoken
```

- [ ] **Step 2: Verify installation**

Run: `node -e "require('bcryptjs'); require('jsonwebtoken'); console.log('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit --signoff -m "chore: add bcryptjs and jsonwebtoken dependencies"
```

---

### Task 2: Create auth module (`src/auth.ts`)

This module handles all auth concerns: password hashing, JWT creation/verification, cookie parsing, and auth file I/O.

**Files:**
- Create: `src/auth.ts`
- Test: `src/auth.test.ts`

- [ ] **Step 1: Write tests for auth module**

Create `src/auth.test.ts`:

```typescript
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
} from "./auth.js";

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
      expect(config.jwtSecret.length).toBe(64); // 256-bit hex

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: All tests FAIL (module does not exist yet)

- [ ] **Step 3: Implement auth module**

Create `src/auth.ts`:

```typescript
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
        // Password changed via --set-password: re-hash and regenerate secret
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

export function setTokenCookie(): string {
  // Returns the Set-Cookie header value (token must be prepended by caller)
  return `${COOKIE_NAME}=__TOKEN__; HttpOnly; Secure; SameSite=Strict; Max-Age=${COOKIE_MAX_AGE}; Path=/`;
}

export function clearTokenCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

export { COOKIE_NAME };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth.ts src/auth.test.ts
git commit --signoff -m "feat: add auth module with password hashing, JWT, and cookie helpers"
```

---

### Task 3: Add password prompt to CLI (`src/cli.ts`)

Add `--set-password` flag to the `serve` command and interactive password prompt on first run.

**Files:**
- Modify: `src/cli.ts:16-24`
- Modify: `src/relay.ts:24-27,37`

- [ ] **Step 1: Update RelayOptions to include auth config**

In `src/relay.ts`, update the `RelayOptions` interface (line 24) and the import section:

```typescript
import { ensureAuth, loadAuthConfig, type AuthConfig } from "./auth.js";
```

Add `authConfig` to `RelayOptions`:

```typescript
export interface RelayOptions {
  port: number;
  host: string;
  authConfig: AuthConfig;
}
```

- [ ] **Step 2: Update CLI to handle password setup**

Replace the `serve` command block in `src/cli.ts` (lines 16-24) with:

```typescript
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";

program
  .command("serve")
  .description("Start the relay daemon server")
  .option("--port <port>", "HTTP/WebSocket server port", "8765")
  .option("--host <addr>", "Bind address for the server", "0.0.0.0")
  .option("--set-password <password>", "Set or update the web access password")
  .action(async (opts) => {
    const { ensureAuth, loadAuthConfig } = await import("./auth.js");
    const dir = join(homedir(), ".acp-web-relay");

    let authConfig;
    const envPassword = process.env.ACP_RELAY_PASSWORD;

    if (opts.setPassword) {
      // --set-password flag: set/update the persisted password
      authConfig = await ensureAuth(dir, opts.setPassword);
      console.error("  Password updated.");
    } else if (envPassword) {
      // Env var override: hash into memory, ensure auth.json has a JWT secret
      const bcrypt = await import("bcryptjs");
      const existing = await loadAuthConfig(dir);
      const passwordHash = await bcrypt.default.hash(envPassword, 10);
      if (existing) {
        authConfig = { passwordHash, jwtSecret: existing.jwtSecret };
      } else {
        // No auth.json yet — create one with just a JWT secret
        const { randomBytes } = await import("node:crypto");
        const jwtSecret = randomBytes(32).toString("hex");
        authConfig = { passwordHash, jwtSecret };
        const { writeFile, mkdir } = await import("node:fs/promises");
        await mkdir(dir, { recursive: true });
        await writeFile(
          join(dir, "auth.json"),
          JSON.stringify({ passwordHash: "", jwtSecret }, null, 2),
          "utf-8",
        );
      }
      console.error("  Using password from ACP_RELAY_PASSWORD environment variable.");
    } else {
      // No flag, no env var: check for existing auth or prompt
      const existing = await loadAuthConfig(dir);
      if (existing) {
        authConfig = existing;
      } else {
        // Interactive password prompt
        const password = await promptPassword("Enter a password for web access: ");
        if (!password) {
          console.error("Error: Password is required.");
          process.exit(1);
        }
        authConfig = await ensureAuth(dir, password);
        console.error("  Password saved.");
      }
    }

    const { startRelay } = await import("./relay.js");
    await startRelay({
      port: parseInt(opts.port, 10),
      host: opts.host,
      authConfig,
    });
  });

function promptPassword(query: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stderr });
    // Mask input by writing to stderr directly
    process.stderr.write(query);
    let password = "";
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      const char = chunk.toString();
      if (char === "\n" || char === "\r" || char === "") {
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stderr.write("\n");
        rl.close();
        resolve(password);
      } else if (char === "") {
        // Ctrl+C
        process.exit(1);
      } else if (char === "" || char === "\b") {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stderr.write("\b \b");
        }
      } else {
        password += char;
        process.stderr.write("*");
      }
    });
  });
}
```

Move the existing imports at the top of `cli.ts` (line 3-4) and add the new ones. The final import block should be:

```typescript
import { createRequire } from "node:module";
import { Command } from "commander";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
```

- [ ] **Step 3: Build to verify no TypeScript errors**

Run: `npm run build:relay`
Expected: Build succeeds (the `startRelay` signature change will cause an error until we update relay.ts in Task 4, so this step may fail — that's expected, verify the cli.ts changes compile in isolation by checking for syntax errors only)

- [ ] **Step 4: Commit**

```bash
git add src/cli.ts
git commit --signoff -m "feat: add password prompt and --set-password flag to CLI"
```

---

### Task 4: Add auth middleware to HTTP server (`src/http-server.ts`)

Add login/logout API endpoints, serve the login page, and protect all other routes with cookie validation.

**Files:**
- Modify: `src/http-server.ts`

- [ ] **Step 1: Update HttpServerHandle and createHttpServer signature**

Add auth-related imports and update the function signature in `src/http-server.ts`:

```typescript
import { createServer, type Server as HttpsServer } from "node:https";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TlsFiles } from "./tls.js";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";
import {
  verifyPassword,
  createToken,
  verifyToken,
  parseCookieToken,
  clearTokenCookie,
  type AuthConfig,
} from "./auth.js";
```

Update the function signature (line 42):

```typescript
export async function createHttpServer(
  host: string,
  port: number,
  tls: TlsFiles,
  version: string,
  authConfig: AuthConfig,
): Promise<HttpServerHandle> {
```

- [ ] **Step 2: Add login/logout endpoints and auth middleware**

Replace the request handler body inside `createServer(tls, async (req, res) => { ... })` with:

```typescript
  const server = createServer(tls, async (req, res) => {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];

    // --- Auth API endpoints (no auth required) ---

    if (pathname === "/api/login" && req.method === "POST") {
      return handleLogin(req, res, authConfig);
    }

    if (pathname === "/api/check" && req.method === "GET") {
      const cookieToken = parseCookieToken(req.headers.cookie);
      if (cookieToken && verifyToken(cookieToken, authConfig.jwtSecret)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ authenticated: true }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ authenticated: false }));
      }
      return;
    }

    if (pathname === "/api/logout" && req.method === "POST") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": clearTokenCookie(),
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // --- Login page (no auth required) ---

    if (pathname === "/login" || pathname === "/login/") {
      return serveFile(res, join(uiRoot, "login", "index.html"));
    }

    if (pathname.startsWith("/login/")) {
      return serveFile(res, join(uiRoot, "login", pathname.slice(7)));
    }

    // --- Favicon (no auth required) ---

    if (pathname === "/favicon.ico" || pathname === "/favicon.svg") {
      return serveFile(res, join(uiRoot, "favicon.svg"));
    }

    // --- Auth check for all other routes ---

    const cookieToken = parseCookieToken(req.headers.cookie);
    if (!cookieToken || !verifyToken(cookieToken, authConfig.jwtSecret)) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }

    // (Authenticated users hitting /login are handled by the login
    // page itself — it checks /api/check and redirects to / if valid)

    // --- Protected routes (existing) ---

    if (pathname === "/" || pathname === "/index.html") {
      return serveFile(res, join(uiRoot, "session-picker", "index.html"));
    }

    if (pathname.startsWith("/session-picker/")) {
      const filePath = join(uiRoot, pathname);
      return serveFile(res, filePath);
    }

    if (url.startsWith("/ui/") || url === "/ui") {
      const pathPart = url.slice(4).split("?")[0];
      const filePath = pathPart && pathPart !== "/"
        ? join(uiRoot, "acp-ui-dist", pathPart)
        : join(uiRoot, "acp-ui-dist", "index.html");
      return serveFile(res, filePath);
    }

    if (url.startsWith("/assets/")) {
      return serveFile(res, join(uiRoot, "acp-ui-dist", url));
    }

    if (url === "/vite.svg" || url === "/tauri.svg") {
      return serveFile(res, join(uiRoot, "acp-ui-dist", url));
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });
```

- [ ] **Step 3: Add the handleLogin helper function**

Add after the `serveFile` function at the bottom of `src/http-server.ts`:

```typescript
async function handleLogin(
  req: IncomingMessage,
  res: ServerResponse,
  authConfig: AuthConfig,
): Promise<void> {
  const body = await readBody(req);
  let parsed: { password?: string };
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON" }));
    return;
  }

  if (!parsed.password || typeof parsed.password !== "string") {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Password required" }));
    return;
  }

  const valid = await verifyPassword(parsed.password, authConfig.passwordHash);
  if (!valid) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid password" }));
    return;
  }

  const token = createToken(authConfig.jwtSecret);
  const cookieValue = `acp_relay_token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/`;
  res.writeHead(200, {
    "Content-Type": "application/json",
    "Set-Cookie": cookieValue,
  });
  res.end(JSON.stringify({ ok: true }));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/http-server.ts
git commit --signoff -m "feat: add auth middleware, login/logout endpoints to HTTP server"
```

---

### Task 5: Add cookie validation to WebSocket upgrades (`src/ws-server.ts`)

Reject unauthenticated WebSocket connections.

**Files:**
- Modify: `src/ws-server.ts:17-27,40-47`

- [ ] **Step 1: Update WsServerOptions to include auth config**

Add auth import and update the options interface in `src/ws-server.ts`:

```typescript
import { verifyToken, parseCookieToken, type AuthConfig } from "./auth.js";
```

Add `authConfig` to `WsServerOptions` (after line 19):

```typescript
export interface WsServerOptions {
  httpServer: HttpServer;
  sessionManager: SessionManager;
  authConfig: AuthConfig;
  getLivePipeIds?: () => Set<string>;
  // ... rest unchanged
}
```

- [ ] **Step 2: Add auth validation in WebSocket server setup**

Update the `createWsServer` function to extract `authConfig` and add a `verifyClient` callback. Replace the `WebSocketServer` constructor (lines 40-47):

```typescript
  const { httpServer, sessionManager, authConfig, getLivePipeIds, onPrompt, onCancel, onClose, onRestore, onDelete, onResponse } = options;
```

```typescript
  const wss = new WebSocketServer({
    server: httpServer,
    path: "/ws",
    handleProtocols: (protocols) => {
      if (protocols.has("acp.v1")) return "acp.v1";
      return false;
    },
    verifyClient: (info, callback) => {
      const cookieToken = parseCookieToken(info.req.headers.cookie);
      if (!cookieToken || !verifyToken(cookieToken, authConfig.jwtSecret)) {
        callback(false, 401, "Unauthorized");
        return;
      }
      callback(true);
    },
  });
```

- [ ] **Step 3: Commit**

```bash
git add src/ws-server.ts
git commit --signoff -m "feat: add cookie-based auth validation to WebSocket upgrades"
```

---

### Task 6: Wire auth config through relay (`src/relay.ts`)

Pass the auth config from CLI through to HTTP and WebSocket servers.

**Files:**
- Modify: `src/relay.ts:37,63,158`

- [ ] **Step 1: Update startRelay to use authConfig**

In `src/relay.ts`, update the `startRelay` function to pass `authConfig` through.

Update the `createHttpServer` call (line 63):

```typescript
  const httpHandle = await createHttpServer(options.host, options.port, tls, version, options.authConfig);
```

Update the `createWsServer` call (line 158) to include `authConfig`:

```typescript
  const wsHandle = createWsServer({
    httpServer: httpHandle.server,
    sessionManager,
    authConfig: options.authConfig,
    getLivePipeIds: () => new Set(daemonServer?.pipes.keys() ?? []),
    // ... rest unchanged
  });
```

- [ ] **Step 2: Build to verify everything compiles**

Run: `npm run build:relay`
Expected: Build succeeds with no errors

- [ ] **Step 3: Commit**

```bash
git add src/relay.ts
git commit --signoff -m "feat: wire auth config through relay to HTTP and WebSocket servers"
```

---

### Task 7: Create login page UI

**Files:**
- Create: `ui/login/index.html`
- Create: `ui/login/style.css`
- Create: `ui/login/script.js`

- [ ] **Step 1: Create login page HTML**

Create `ui/login/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ACP Web Relay — Login</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="stylesheet" href="/login/style.css">
</head>
<body>
  <div class="login-container">
    <div class="login-card">
      <h1>ACP Web Relay</h1>
      <form id="login-form">
        <input type="password" id="password" placeholder="Password" autocomplete="current-password" autofocus required>
        <button type="submit" id="submit-btn">Log in</button>
        <div id="error" class="error" style="display: none;"></div>
      </form>
    </div>
  </div>
  <script src="/login/script.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create login page styles**

Create `ui/login/style.css`:

```css
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

:root {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --accent: #58a6ff;
  --error: #f85149;
}

html, body {
  height: 100%;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  -webkit-font-smoothing: antialiased;
}

.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 16px;
}

.login-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 32px;
  width: 100%;
  max-width: 360px;
}

.login-card h1 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 24px;
  text-align: center;
}

#login-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

#password {
  background: var(--bg);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
  transition: border-color 0.15s;
}

#password:focus {
  border-color: var(--accent);
}

#submit-btn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.15s;
}

#submit-btn:hover {
  opacity: 0.9;
}

#submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error {
  color: var(--error);
  font-size: 13px;
  text-align: center;
}
```

- [ ] **Step 3: Create login page script**

Create `ui/login/script.js`:

```javascript
(function () {
  "use strict";

  // If already authenticated, redirect to main page
  fetch("/api/check").then(function (res) {
    if (res.ok) window.location.href = "/";
  }).catch(function () {});

  var form = document.getElementById("login-form");
  var passwordInput = document.getElementById("password");
  var submitBtn = document.getElementById("submit-btn");
  var errorEl = document.getElementById("error");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    errorEl.style.display = "none";
    submitBtn.disabled = true;
    submitBtn.textContent = "Logging in...";

    try {
      var res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: passwordInput.value }),
      });

      if (res.ok) {
        window.location.href = "/";
        return;
      }

      var data = await res.json();
      errorEl.textContent = data.error || "Login failed";
      errorEl.style.display = "block";
    } catch {
      errorEl.textContent = "Connection error";
      errorEl.style.display = "block";
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Log in";
    passwordInput.focus();
  });
})();
```

- [ ] **Step 4: Commit**

```bash
git add ui/login/index.html ui/login/style.css ui/login/script.js
git commit --signoff -m "feat: add login page UI"
```

---

### Task 8: Add logout button to session picker

**Files:**
- Modify: `ui/session-picker/index.html:17-18`
- Modify: `ui/session-picker/script.js:354-355`
- Modify: `ui/session-picker/style.css`

- [ ] **Step 1: Add logout button to HTML header**

In `ui/session-picker/index.html`, replace line 18 (the connection status dot) with:

```html
      <div class="header-right">
        <div id="connection-status" class="status-dot disconnected" title="Disconnected"></div>
        <button id="logout-btn" class="logout-btn" title="Log out">Log out</button>
      </div>
```

- [ ] **Step 2: Add logout handler to script**

In `ui/session-picker/script.js`, add after the sidebar toggle event listener (line 354), before `connect();`:

```javascript
  document.getElementById("logout-btn").addEventListener("click", async function () {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch (e) {}
    window.location.href = "/login";
  });
```

- [ ] **Step 3: Add logout button styles**

In `ui/session-picker/style.css`, add after the `.status-dot.disconnected` rule (after line 102):

```css
.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logout-btn {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--text-muted);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.logout-btn:hover {
  border-color: var(--error);
  color: var(--error);
}
```

- [ ] **Step 4: Commit**

```bash
git add ui/session-picker/index.html ui/session-picker/script.js ui/session-picker/style.css
git commit --signoff -m "feat: add logout button to session picker header"
```

---

### Task 9: Add login page to package.json files list

The login page UI needs to be included in the npm package.

**Files:**
- Modify: `package.json:6-10`

- [ ] **Step 1: Add ui/login/ to the files array**

In `package.json`, update the `files` array:

```json
  "files": [
    "dist/",
    "ui/session-picker/",
    "ui/login/",
    "ui/acp-ui-dist/"
  ],
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit --signoff -m "chore: include login page in npm package files"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Run unit tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Build the project**

Run: `npm run build:relay`
Expected: Build succeeds

- [ ] **Step 3: Clean test — delete existing auth.json if present**

```bash
rm -f ~/.acp-web-relay/auth.json
```

- [ ] **Step 4: Start the relay and verify password prompt**

Run: `node dist/cli.js serve --port 8765`
Expected: Prompted with "Enter a password for web access:" — enter a test password, see "Password saved."

- [ ] **Step 5: Test login flow in browser**

1. Open `https://localhost:8765` — should redirect to `/login`
2. Enter wrong password — should show "Invalid password" error
3. Enter correct password — should redirect to session picker
4. Refresh page — should stay authenticated (cookie persists)

- [ ] **Step 6: Test WebSocket auth**

1. With valid login, click a session if available — ACP UI iframe should load and WebSocket should connect
2. Open browser dev tools → Network tab → verify the WebSocket upgrade includes the `acp_relay_token` cookie

- [ ] **Step 7: Test logout**

1. Click "Log out" button in session picker header
2. Should redirect to `/login`
3. Try accessing `/` directly — should redirect to `/login`

- [ ] **Step 8: Test --set-password**

1. Stop the relay
2. Run: `node dist/cli.js serve --port 8765 --set-password newpassword`
3. Open browser — should be redirected to `/login` (old cookie invalidated)
4. Log in with new password — should work

- [ ] **Step 9: Test ACP_RELAY_PASSWORD env var**

1. Stop the relay
2. Run: `ACP_RELAY_PASSWORD=envpass node dist/cli.js serve --port 8765`
3. Log in with `envpass` — should work
4. Log in with the `--set-password` password — should NOT work (env var overrides)

- [ ] **Step 10: Final commit if any fixes were needed**

```bash
git add -p  # Review any fixes
git commit --signoff -m "fix: address issues found during e2e verification"
```
