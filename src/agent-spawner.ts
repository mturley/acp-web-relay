import { spawn, type ChildProcess } from "node:child_process";

export type AgentCrashHandler = (code: number | null, signal: string | null) => void;

export interface AgentProcess {
  proc: ChildProcess;
  command: string;
  onCrash(handler: AgentCrashHandler): void;
}

export function spawnAgent(command: string): AgentProcess {
  const parts = command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [command];
  const cmd = parts[0];
  const args = parts.slice(1).map((a) =>
    a.replace(/^["']|["']$/g, ""),
  );

  const proc = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "inherit"],
    shell: false,
  });

  proc.on("error", (err) => {
    console.error(`Failed to spawn agent: ${err.message}`);
  });

  return {
    proc,
    command,
    onCrash(handler) {
      proc.on("exit", (code, signal) => {
        handler(code, signal ? signal.toString() : null);
      });
    },
  };
}
