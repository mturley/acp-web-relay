import type { JsonRpcMessage, JsonRpcRequest, JsonRpcResponse, JsonRpcError } from "./types.js";

export function parseMessages(chunk: string): JsonRpcMessage[] {
  const lines = chunk.split("\n").filter((line) => line.trim().length > 0);
  const messages: JsonRpcMessage[] = [];

  for (const line of lines) {
    const parsed = parseMessage(line.trim());
    if (parsed) {
      messages.push(parsed);
    }
  }

  return messages;
}

export function parseMessage(line: string): JsonRpcMessage | null {
  try {
    const obj = JSON.parse(line);
    if (typeof obj !== "object" || obj === null) return null;
    if (obj.jsonrpc !== "2.0") return null;
    return obj as JsonRpcMessage;
  } catch {
    return null;
  }
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "method" in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "result" in msg || "error" in msg;
}

export function extractMethod(msg: JsonRpcMessage): string | null {
  if (isRequest(msg)) return msg.method;
  return null;
}

export function extractSessionId(msg: JsonRpcMessage): string | null {
  if (isRequest(msg) && msg.params && typeof msg.params === "object") {
    const params = msg.params;
    if (typeof params.sessionId === "string") return params.sessionId;
  }
  if (isResponse(msg) && msg.result && typeof msg.result === "object" && msg.result !== null) {
    const result = msg.result as Record<string, unknown>;
    if (typeof result.sessionId === "string") return result.sessionId;
  }
  return null;
}

export function createResponse(id: number | string, result: unknown): string {
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, result };
  return JSON.stringify(response) + "\n";
}

export function createErrorResponse(id: number | string, code: number, message: string, data?: unknown): string {
  const error: JsonRpcError = { code, message };
  if (data !== undefined) error.data = data;
  const response: JsonRpcResponse = { jsonrpc: "2.0", id, error };
  return JSON.stringify(response) + "\n";
}

export function createNotification(method: string, params?: Record<string, unknown>): string {
  const request: JsonRpcRequest = { jsonrpc: "2.0", method };
  if (params) request.params = params;
  return JSON.stringify(request) + "\n";
}

export function createRequest(id: number | string, method: string, params?: Record<string, unknown>): string {
  const request: JsonRpcRequest = { jsonrpc: "2.0", id, method };
  if (params) request.params = params;
  return JSON.stringify(request) + "\n";
}

export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  SESSION_BUSY: -32000,
  SESSION_NOT_FOUND: -32001,
  NOT_INITIALIZED: -32002,
} as const;
