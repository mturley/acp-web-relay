#!/usr/bin/env node

import { createRequire } from "node:module";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { homedir } from "node:os";
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
  .option("--set-password <password>", "Set password for web auth")
  .action(async (opts) => {
    const { startRelay } = await import("./relay.js");
    const { ensureAuth, loadAuthConfig } = await import("./auth.js");
    const bcrypt = await import("bcryptjs");
    const { randomBytes } = await import("node:crypto");

    const dir = join(homedir(), ".acp-web-relay");

    let authConfig;

    if (opts.setPassword) {
      authConfig = await ensureAuth(dir, opts.setPassword);
      console.error("  Password updated.");
    } else if (process.env.ACP_RELAY_PASSWORD) {
      const password = process.env.ACP_RELAY_PASSWORD;
      const passwordHash = await bcrypt.hash(password, 10);
      const existing = await loadAuthConfig(dir);
      if (existing) {
        authConfig = { passwordHash, jwtSecret: existing.jwtSecret };
      } else {
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
      const existing = await loadAuthConfig(dir);
      if (existing) {
        authConfig = existing;
      } else {
        const password = await promptPassword();
        if (!password) {
          console.error("Error: Password is required.");
          process.exit(1);
        }
        authConfig = await ensureAuth(dir, password);
        console.error("  Password saved.");
      }
    }

    await startRelay({ port: parseInt(opts.port, 10), host: opts.host, authConfig });
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

async function promptPassword(): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const stdin = process.stdin;
    const output = process.stderr;

    let password = "";

    if (stdin.isTTY) {
      stdin.setRawMode(true);
    }

    process.stderr.write("Enter a password for web access: ");

    const onData = (char: Buffer) => {
      const key = char.toString("utf-8");

      if (key === "\n" || key === "\r") {
        if (stdin.isTTY) {
          stdin.setRawMode(false);
        }
        output.write("\n");
        stdin.removeListener("data", onData);
        rl.close();
        resolve(password);
      } else if (key === "\x03") {
        if (stdin.isTTY) {
          stdin.setRawMode(false);
        }
        output.write("\n");
        process.exit(1);
      } else if (key === "\x7F" || key === "\b") {
        if (password.length > 0) {
          password = password.slice(0, -1);
          output.write("\b \b");
        }
      } else if (key >= " " && key <= "~") {
        password += key;
        output.write("*");
      }
    };

    stdin.on("data", onData);
  });
}

program.parse(process.argv);

if (!program.args.length) {
  program.help();
}
