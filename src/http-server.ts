import { createServer, type Server as HttpServer } from "node:http";
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
          return `http://${addr.address}:${port}`;
        }
      }
    }
  }
  return `http://${host}:${port}`;
}

export interface HttpServerHandle {
  server: HttpServer;
  url: string;
  localUrl: string;
  stop(): Promise<void>;
}

export async function createHttpServer(
  host: string,
  port: number,
): Promise<HttpServerHandle> {
  const uiRoot = join(__dirname, "..", "ui");

  const server = createServer(async (req, res) => {
    const url = req.url ?? "/";

    if (url === "/" || url === "/index.html") {
      return serveFile(res, join(uiRoot, "session-picker", "index.html"));
    }

    if (url.startsWith("/session-picker/")) {
      const filePath = join(uiRoot, url);
      return serveFile(res, filePath);
    }

    if (url.startsWith("/ui/")) {
      const filePath = join(uiRoot, "acp-ui", url.slice(4));
      return serveFile(res, filePath);
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  const localUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
  const networkUrl = getLocalNetworkUrl(host, port);

  await new Promise<void>((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, host, () => resolve());
  });

  console.error(`\n  acp-mobile-relay running:`);
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
