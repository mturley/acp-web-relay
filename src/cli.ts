#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

const program = new Command();

program
  .name("acp-web-relay")
  .description("Transparent ACP relay proxy with web UI")
  .version(pkg.version);

program
  .command("serve")
  .description("Start the relay daemon server")
  .option("--port <port>", "HTTP/WebSocket server port", "8765")
  .option("--host <addr>", "Bind address for the server", "0.0.0.0")
  .action(async (opts) => {
    const { startRelay } = await import("./relay.js");
    await startRelay({ port: parseInt(opts.port, 10), host: opts.host });
  });

program
  .command("agent <cmd>")
  .description("Connect to a running relay and spawn an ACP agent (used by editors)")
  .action(async (cmd: string) => {
    const { connectToDaemon } = await import("./daemon.js");
    await connectToDaemon(cmd);
  });

program
  .command("cleanup")
  .description("Delete the ~/.acp-web-relay directory (TLS certs, sessions, socket)")
  .action(async () => {
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const { rm } = await import("node:fs/promises");
    const dir = join(homedir(), ".acp-web-relay");
    await rm(dir, { recursive: true, force: true });
    console.error(`Deleted ${dir}`);
  });

program.parse(process.argv);

if (!program.args.length) {
  program.help();
}
