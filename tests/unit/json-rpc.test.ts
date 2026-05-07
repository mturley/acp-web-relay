import { describe, it, expect } from "vitest";
import {
  parseMessages,
  parseMessage,
  isRequest,
  isResponse,
  extractMethod,
  extractSessionId,
  createResponse,
  createErrorResponse,
  createNotification,
  createRequest,
  ErrorCodes,
} from "../../src/json-rpc.js";
import * as fixtures from "../fixtures/acp-messages.js";

describe("parseMessage", () => {
  it("parses a valid JSON-RPC request", () => {
    const msg = parseMessage(fixtures.initializeRequest);
    expect(msg).not.toBeNull();
    expect(msg!.jsonrpc).toBe("2.0");
    expect(isRequest(msg!)).toBe(true);
  });

  it("parses a valid JSON-RPC response", () => {
    const msg = parseMessage(fixtures.initializeResponse);
    expect(msg).not.toBeNull();
    expect(isResponse(msg!)).toBe(true);
  });

  it("returns null for invalid JSON", () => {
    expect(parseMessage(fixtures.invalidJson)).toBeNull();
  });

  it("returns null for non-JSON-RPC messages", () => {
    expect(parseMessage(fixtures.invalidJsonRpc)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseMessage("")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseMessage('"just a string"')).toBeNull();
    expect(parseMessage("42")).toBeNull();
    expect(parseMessage("null")).toBeNull();
  });
});

describe("parseMessages", () => {
  it("parses multiple newline-delimited messages", () => {
    const messages = parseMessages(fixtures.multiLineChunk);
    expect(messages).toHaveLength(3);
    expect(extractMethod(messages[0])).toBe("initialize");
    expect(extractMethod(messages[1])).toBe("session/new");
    expect(extractMethod(messages[2])).toBe("$/ping");
  });

  it("skips empty lines", () => {
    const chunk = fixtures.initializeRequest + "\n\n\n" + fixtures.pingNotification;
    const messages = parseMessages(chunk);
    expect(messages).toHaveLength(2);
  });

  it("skips invalid messages in a chunk", () => {
    const chunk = fixtures.initializeRequest + "\n" + fixtures.invalidJson;
    const messages = parseMessages(chunk);
    expect(messages).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    expect(parseMessages("")).toHaveLength(0);
    expect(parseMessages("\n\n")).toHaveLength(0);
  });
});

describe("extractMethod", () => {
  it("extracts method from request", () => {
    const msg = parseMessage(fixtures.sessionPromptRequest)!;
    expect(extractMethod(msg)).toBe("session/prompt");
  });

  it("returns null for response", () => {
    const msg = parseMessage(fixtures.initializeResponse)!;
    expect(extractMethod(msg)).toBeNull();
  });

  it("extracts method from notification", () => {
    const msg = parseMessage(fixtures.pingNotification)!;
    expect(extractMethod(msg)).toBe("$/ping");
  });
});

describe("extractSessionId", () => {
  it("extracts sessionId from request params", () => {
    const msg = parseMessage(fixtures.sessionPromptRequest)!;
    expect(extractSessionId(msg)).toBe("sess_abc123");
  });

  it("extracts sessionId from response result", () => {
    const msg = parseMessage(fixtures.sessionNewResponse)!;
    expect(extractSessionId(msg)).toBe("sess_abc123");
  });

  it("returns null when no sessionId present", () => {
    const msg = parseMessage(fixtures.initializeRequest)!;
    expect(extractSessionId(msg)).toBeNull();
  });

  it("extracts sessionId from notification params", () => {
    const msg = parseMessage(fixtures.sessionUpdateNotification)!;
    expect(extractSessionId(msg)).toBe("sess_abc123");
  });
});

describe("message constructors", () => {
  it("creates a valid response", () => {
    const raw = createResponse(1, { status: "ok" });
    const msg = parseMessage(raw.trim())!;
    expect(isResponse(msg)).toBe(true);
    expect(msg).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: { status: "ok" },
    });
  });

  it("creates a valid error response", () => {
    const raw = createErrorResponse(1, ErrorCodes.SESSION_BUSY, "Session busy");
    const msg = parseMessage(raw.trim())!;
    expect(isResponse(msg)).toBe(true);
    expect((msg as any).error.code).toBe(-32000);
    expect((msg as any).error.message).toBe("Session busy");
  });

  it("creates a valid notification", () => {
    const raw = createNotification("$/ping");
    const msg = parseMessage(raw.trim())!;
    expect(isRequest(msg)).toBe(true);
    expect(extractMethod(msg)).toBe("$/ping");
    expect((msg as any).id).toBeUndefined();
  });

  it("creates a valid request", () => {
    const raw = createRequest(5, "session/list", {});
    const msg = parseMessage(raw.trim())!;
    expect(isRequest(msg)).toBe(true);
    expect((msg as any).id).toBe(5);
    expect(extractMethod(msg)).toBe("session/list");
  });

  it("all constructors produce newline-terminated strings", () => {
    expect(createResponse(1, {})).toMatch(/\n$/);
    expect(createErrorResponse(1, -1, "err")).toMatch(/\n$/);
    expect(createNotification("test")).toMatch(/\n$/);
    expect(createRequest(1, "test")).toMatch(/\n$/);
  });
});
