import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { connect } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, mkdir } from "node:fs/promises";

describe("daemon IPC", () => {
  let tempDir: string;
  let socketPath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "daemon-test-"));
    socketPath = join(tempDir, "daemon.sock");
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("daemon accepts socket connections from subprocesses", async () => {
    const server = createServer();
    const connections: any[] = [];

    server.on("connection", (socket) => {
      connections.push(socket);
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const client = connect(socketPath);
    await new Promise<void>((resolve) => client.on("connect", resolve));

    expect(connections).toHaveLength(1);

    client.end();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("subprocess pipes data through socket", async () => {
    const received: string[] = [];
    const server = createServer((socket) => {
      socket.on("data", (data) => {
        received.push(data.toString());
      });
      socket.write('{"jsonrpc":"2.0","id":1,"result":{"status":"ok"}}\n');
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const client = connect(socketPath);
    await new Promise<void>((resolve) => client.on("connect", resolve));

    const clientReceived: string[] = [];
    client.on("data", (data) => clientReceived.push(data.toString()));

    client.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');

    await new Promise((r) => setTimeout(r, 50));

    expect(received).toHaveLength(1);
    expect(received[0]).toContain("initialize");
    expect(clientReceived).toHaveLength(1);
    expect(clientReceived[0]).toContain("ok");

    client.end();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("daemon cleans up on client disconnect", async () => {
    const connections: any[] = [];
    const disconnected: boolean[] = [];

    const server = createServer((socket) => {
      connections.push(socket);
      socket.on("close", () => disconnected.push(true));
    });

    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    const client = connect(socketPath);
    await new Promise<void>((resolve) => client.on("connect", resolve));
    expect(connections).toHaveLength(1);

    client.destroy();
    await new Promise((r) => setTimeout(r, 50));
    expect(disconnected).toHaveLength(1);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("detects no daemon running (ENOENT)", async () => {
    const nonExistentSocket = join(tempDir, "nonexistent.sock");
    const result = await new Promise<string>((resolve) => {
      const client = connect(nonExistentSocket);
      client.on("error", (err: NodeJS.ErrnoException) => {
        resolve(err.code ?? "UNKNOWN");
      });
    });
    expect(result).toBe("ENOENT");
  });
});
