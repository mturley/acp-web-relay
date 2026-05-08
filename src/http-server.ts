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

const __dirname = fileURLToPath(new URL(".", import.meta.url));

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function getLocalNetworkUrl(host: string, port: number): string {
  if (host === "0.0.0.0" || host === "::") {
    const interfaces = networkInterfaces();
    for (const addrs of Object.values(interfaces)) {
      if (!addrs) continue;
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal) {
          return `https://${addr.address}:${port}`;
        }
      }
    }
  }
  return `https://${host}:${port}`;
}

export interface HttpServerHandle {
  server: HttpsServer;
  url: string;
  localUrl: string;
  stop(): Promise<void>;
}

export async function createHttpServer(
  host: string,
  port: number,
  tls: TlsFiles,
  version: string,
  authConfig: AuthConfig,
): Promise<HttpServerHandle> {
  const uiRoot = join(__dirname, "..", "ui");

  const server = createServer(tls, async (req, res) => {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];

    // Public routes (no auth required)
    if (req.method === "POST" && pathname === "/api/login") {
      return handleLogin(req, res, authConfig);
    }

    if (req.method === "GET" && pathname === "/api/check") {
      const cookieToken = parseCookieToken(req.headers.cookie);
      if (cookieToken && verifyToken(cookieToken, authConfig.jwtSecret)) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
      }
      return;
    }

    if (req.method === "POST" && pathname === "/api/logout") {
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Set-Cookie": clearTokenCookie(),
      });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    if (pathname === "/login" || pathname === "/login/") {
      return serveFile(res, join(uiRoot, "login", "index.html"));
    }

    if (pathname.startsWith("/login/")) {
      return serveFile(res, join(uiRoot, "login", pathname.slice(7)));
    }

    if (pathname === "/favicon.ico" || pathname === "/favicon.svg") {
      return serveFile(res, join(uiRoot, "favicon.svg"));
    }

    // Auth required routes
    const cookieToken = parseCookieToken(req.headers.cookie);
    if (!cookieToken || !verifyToken(cookieToken, authConfig.jwtSecret)) {
      res.writeHead(302, { Location: "/login" });
      res.end();
      return;
    }

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

  const localUrl = `https://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
  const networkUrl = getLocalNetworkUrl(host, port);

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => resolve());
  });

  console.error(`\n  acp-web-relay v${version} running:`);
  console.error(`    Local:   ${localUrl}`);
  if (networkUrl !== localUrl) {
    console.error(`    Network: ${networkUrl}`);
  }
  console.error("");

  return {
    server,
    url: networkUrl,
    localUrl,
    async stop() {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

async function serveFile(res: import("node:http").ServerResponse, filePath: string): Promise<void> {
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
}

async function handleLogin(req: IncomingMessage, res: ServerResponse, authConfig: AuthConfig): Promise<void> {
  try {
    const body = await readBody(req);
    const parsed = JSON.parse(body);

    if (!parsed.password || typeof parsed.password !== "string") {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Password required" }));
      return;
    }

    const isValid = await verifyPassword(parsed.password, authConfig.passwordHash);
    if (!isValid) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid password" }));
      return;
    }

    const token = createToken(authConfig.jwtSecret);
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": `acp_relay_token=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=604800; Path=/`,
    });
    res.end(JSON.stringify({ ok: true }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Server error" }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}
