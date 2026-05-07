import { createServer, connect, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdir, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { spawnAgent } from "./agent-spawner.js";
import type { ChildProcess } from "node:child_process";

export function log(msg: string): void {
  const ts = new Date().toLocaleTimeString();
  console.error(`  ${ts}  ${msg}`);
}

const DAEMON_DIR = join(homedir(), ".acp-web-relay");
const SOCKET_PATH = process.platform === "win32"
  ? "\\\\.\\pipe\\acp-web-relay-daemon"
  : join(DAEMON_DIR, "daemon.sock");

export interface DaemonPipe {
  id: string;
  socket: Socket;
  agentProc: ChildProcess | null;
  sessions: Set<string>;
}

export interface DaemonServer {
  pipes: Map<string, DaemonPipe>;
  server: Server;
  stop(): Promise<void>;
}

export interface DaemonServerOptions {
  onMessage: (pipeId: string, line: string, direction: "editor→agent" | "agent→editor") => void;
  onPipeDisconnect: (pipeId: string) => void;
}

export async function startDaemonServer(options: DaemonServerOptions): Promise<DaemonServer> {
  const pipes = new Map<string, DaemonPipe>();
  let pipeCounter = 0;

  await mkdir(DAEMON_DIR, { recursive: true });

  try {
    await unlink(SOCKET_PATH);
  } catch {}

  const server = createServer((socket) => {
    const pipeId = `pipe_${++pipeCounter}`;
    let agentProc: ChildProcess | null = null;
    let initialized = false;

    const pipe: DaemonPipe = { id: pipeId, socket, agentProc: null, sessions: new Set() };
    pipes.set(pipeId, pipe);
    log(`[${pipeId}] Editor connected`);

    const socketRl = createInterface({ input: socket, crlfDelay: Infinity });
    socketRl.on("line", (line) => {
      if (!initialized) {
        initialized = true;
        const agentCommand = line.trim();
        if (!agentCommand) {
          log(`[${pipeId}] No agent command received, closing`);
          socket.end();
          return;
        }

        log(`[${pipeId}] Spawning agent: ${agentCommand}`);
        const agent = spawnAgent(agentCommand);
        agentProc = agent.proc;
        pipe.agentProc = agentProc;

        const agentRl = createInterface({ input: agent.proc.stdout!, crlfDelay: Infinity });
        agentRl.on("line", (agentLine) => {
          options.onMessage(pipeId, agentLine, "agent→editor");
          socket.write(agentLine + "\n");
        });

        agent.proc.on("exit", (code) => {
          log(`[${pipeId}] Agent exited (code ${code})`);
          socket.end();
        });

        return;
      }

      options.onMessage(pipeId, line, "editor→agent");
      if (agentProc?.stdin) {
        agentProc.stdin.write(line + "\n");
      }
    });

    socket.on("close", () => {
      log(`[${pipeId}] Editor disconnected`);
      pipes.delete(pipeId);
      if (agentProc && !agentProc.killed) {
        agentProc.kill();
      }
      options.onPipeDisconnect(pipeId);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(SOCKET_PATH, () => resolve());
  });

  console.error(`  Daemon socket: ${SOCKET_PATH}`);

  return {
    pipes,
    server,
    async stop() {
      for (const pipe of pipes.values()) {
        pipe.socket.end();
        if (pipe.agentProc && !pipe.agentProc.killed) {
          pipe.agentProc.kill();
        }
      }
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export async function connectToDaemon(agentCommand: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect(SOCKET_PATH);

    socket.on("connect", () => {
      socket.write(agentCommand + "\n");

      process.stdin.pipe(socket);
      socket.pipe(process.stdout);

      socket.on("close", () => {
        process.exit(0);
      });

      resolve();
    });

    socket.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        console.error(
          "Error: No acp-web-relay daemon is running.\n" +
            "\n" +
            "Start the relay first:\n" +
            "  npx acp-web-relay serve --port 8765\n" +
            "\n" +
            "Then configure your editor to use:\n" +
            `  npx acp-web-relay agent '${agentCommand}'`,
        );
        process.exit(1);
      }
      reject(err);
    });
  });
}
