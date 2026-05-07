#!/usr/bin/env node

import { createRequire } from "node:module";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

export interface CliOptions {
  agent?: string;
  port: number;
  host: string;
}

export async function main(): Promise<void> {
  const options = parseArgs(process.argv);
  if (!options) {
    process.exit(1);
  }

  if (options.agent) {
    const { connectToDaemon } = await import("./daemon.js");
    await connectToDaemon(options.agent);
  } else {
    const { startRelay } = await import("./relay.js");
    await startRelay(options);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

export function parseArgs(argv: string[]): CliOptions | null {
  const program = new Command();

  program
    .name("acp-mobile-relay")
    .description(
      "Transparent ACP relay proxy with mobile web UI.\n\n" +
        "Run without --agent to start the relay server.\n" +
        "Run with --agent to connect an editor session to a running relay.",
    )
    .version(pkg.version)
    .option("--agent <cmd>", "Connect to running relay and spawn this agent (editor subprocess mode)")
    .option("--port <port>", "HTTP/WebSocket server port", "8765")
    .option("--host <addr>", "Bind address for the server", "0.0.0.0");

  program.parse(argv);
  const opts = program.opts();

  return {
    agent: opts.agent,
    port: parseInt(opts.port, 10),
    host: opts.host,
  };
}
