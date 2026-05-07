import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";

export type MessageObserver = (line: string, direction: "editor→agent" | "agent→editor") => void;

export interface StdioProxy {
  start(): void;
  stop(): void;
  writeToAgent(data: string): void;
}

export function createStdioProxy(
  editorIn: Readable,
  editorOut: Writable,
  agentIn: Writable,
  agentOut: Readable,
  observer: MessageObserver,
): StdioProxy {
  let editorRl: ReturnType<typeof createInterface> | null = null;
  let agentRl: ReturnType<typeof createInterface> | null = null;

  return {
    start() {
      editorRl = createInterface({ input: editorIn, crlfDelay: Infinity });
      agentRl = createInterface({ input: agentOut, crlfDelay: Infinity });

      editorRl.on("line", (line) => {
        observer(line, "editor→agent");
        agentIn.write(line + "\n");
      });

      agentRl.on("line", (line) => {
        observer(line, "agent→editor");
        editorOut.write(line + "\n");
      });

      editorRl.on("close", () => {
        agentIn.end();
      });
    },

    stop() {
      editorRl?.close();
      agentRl?.close();
    },

    writeToAgent(data: string) {
      agentIn.write(data);
    },
  };
}
