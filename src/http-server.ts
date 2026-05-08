import { createServer, type Server as HttpsServer } from "node:https";
import type { TlsFiles } from "./tls.js";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

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
): Promise<HttpServerHandle> {
  const uiRoot = join(__dirname, "..", "ui");

  const server = createServer(tls, async (req, res) => {
    const url = req.url ?? "/";
    const pathname = url.split("?")[0];

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

  console.error(`\n  acp-web-relay running:`);
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
