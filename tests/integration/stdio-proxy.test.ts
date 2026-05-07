import { describe, it, expect, beforeEach } from "vitest";
import { PassThrough } from "node:stream";
import { createStdioProxy } from "../../src/stdio-proxy.js";

describe("stdio proxy forwarding", () => {
  let editorIn: PassThrough;
  let editorOut: PassThrough;
  let agentIn: PassThrough;
  let agentOut: PassThrough;

  beforeEach(() => {
    editorIn = new PassThrough();
    editorOut = new PassThrough();
    agentIn = new PassThrough();
    agentOut = new PassThrough();
  });

  it("forwards editor messages to agent unmodified", async () => {
    const observed: string[] = [];
    const proxy = createStdioProxy(editorIn, editorOut, agentIn, agentOut, (line, dir) => {
      observed.push(`${dir}: ${line}`);
    });
    proxy.start();

    const msg = '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}';
    editorIn.write(msg + "\n");

    const received = await readLine(agentIn);
    expect(received).toBe(msg);
    expect(observed[0]).toBe(`editor→agent: ${msg}`);

    proxy.stop();
  });

  it("forwards agent messages to editor unmodified", async () => {
    const observed: string[] = [];
    const proxy = createStdioProxy(editorIn, editorOut, agentIn, agentOut, (line, dir) => {
      observed.push(`${dir}: ${line}`);
    });
    proxy.start();

    const msg = '{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1}}';
    agentOut.write(msg + "\n");

    const received = await readLine(editorOut);
    expect(received).toBe(msg);
    expect(observed[0]).toBe(`agent→editor: ${msg}`);

    proxy.stop();
  });

  it("handles multiple messages in sequence", async () => {
    const observed: Array<{ line: string; dir: string }> = [];
    const proxy = createStdioProxy(editorIn, editorOut, agentIn, agentOut, (line, dir) => {
      observed.push({ line, dir });
    });
    proxy.start();

    editorIn.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}\n');
    editorIn.write('{"jsonrpc":"2.0","id":2,"method":"session/new","params":{}}\n');

    await waitFor(() => observed.length >= 2);

    expect(observed).toHaveLength(2);
    expect(observed[0].dir).toBe("editor→agent");
    expect(observed[1].dir).toBe("editor→agent");

    proxy.stop();
  });
});

function readLine(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf("\n");
      if (newlineIdx >= 0) {
        stream.removeListener("data", onData);
        resolve(buffer.slice(0, newlineIdx));
      }
    };
    stream.on("data", onData);
  });
}

function waitFor(condition: () => boolean, timeout = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (condition()) return resolve();
      if (Date.now() - start > timeout) return reject(new Error("waitFor timed out"));
      setTimeout(check, 10);
    };
    check();
  });
}
