#!/usr/bin/env node

import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { Command } from "commander";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");

function isLocalhost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

async function confirmNetworkBind(host: string): Promise<boolean> {
  if (!process.stdin.isTTY) return true;

  console.error(
    "\n⚠️  SECURITY WARNING: Network-accessible relay\n" +
      `\n   Binding to ${host} will make session data (source code, credentials,\n` +
      "   conversation history) accessible to other devices on your network.\n" +
      "\n   To restrict access to this machine only, use:\n" +
      "     --host 127.0.0.1\n",
  );

  const rl = createInterface({ input: process.stdin, output: process.stderr });
  const answer = await new Promise<string>((resolve) => {
    rl.question("   Continue with network binding? [y/N] ", resolve);
  });
  rl.close();

  return answer.trim().toLowerCase() === "y";
}

export interface CliOptions {
  agent?: string;
  port: number;
  host: string;
  daemon: boolean;
}

export async function main(): Promise<void> {
  const options = await parseArgs(process.argv);
  if (!options) {
    process.exit(1);
  }

  const { startRelay } = await import("./relay.js");
  await startRelay(options);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

export async function parseArgs(argv: string[]): Promise<CliOptions | null> {
  const program = new Command();

  program
    .name("acp-mobile-relay")
    .description(
      "Transparent ACP relay proxy with mobile web UI",
    )
    .version(pkg.version)
    .option("--agent <cmd>", "Command to spawn the downstream ACP agent")
    .option("--port <port>", "HTTP/WebSocket server port", "8765")
    .option("--host <addr>", "Bind address for the server", "0.0.0.0")
    .option("--daemon", "Run in daemon mode (persistent, no agent spawn)", false);

  program.parse(argv);
  const opts = program.opts();

  const options: CliOptions = {
    agent: opts.agent,
    port: parseInt(opts.port, 10),
    host: opts.host,
    daemon: opts.daemon,
  };

  if (!options.daemon && !options.agent) {
    console.error(
      "Error: --agent <cmd> is required in subprocess mode.\n" +
        "Use --daemon for daemon mode, or specify an agent command.\n" +
        "Example: acp-mobile-relay --agent 'npx @agentclientprotocol/claude-agent-acp'",
    );
    return null;
  }

  if (!isLocalhost(options.host)) {
    const confirmed = await confirmNetworkBind(options.host);
    if (!confirmed) {
      console.error("Aborted.");
      return null;
    }
  }

  return options;
}
