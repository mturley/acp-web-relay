export const initializeRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: 1,
    clientInfo: { name: "test-editor", version: "1.0.0" },
    capabilities: {},
  },
});

export const initializeResponse = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  result: {
    protocolVersion: 1,
    agentInfo: { name: "test-agent", version: "1.0.0" },
    capabilities: {},
  },
});

export const sessionNewRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  method: "session/new",
  params: {
    cwd: "/Users/dev/project",
    name: "test-session",
  },
});

export const sessionNewResponse = JSON.stringify({
  jsonrpc: "2.0",
  id: 2,
  result: {
    sessionId: "sess_abc123",
  },
});

export const sessionPromptRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 3,
  method: "session/prompt",
  params: {
    sessionId: "sess_abc123",
    prompt: [{ type: "text", text: "Fix the pagination bug" }],
  },
});

export const sessionUpdateNotification = JSON.stringify({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "sess_abc123",
    type: "agent_message_chunk",
    chunk: { text: "I'll look at the pagination..." },
  },
});

export const sessionUpdateEndTurn = JSON.stringify({
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    sessionId: "sess_abc123",
    type: "agent_message_end",
    stopReason: "end_turn",
  },
});

export const sessionCancelNotification = JSON.stringify({
  jsonrpc: "2.0",
  method: "session/cancel",
  params: {
    sessionId: "sess_abc123",
  },
});

export const pingNotification = JSON.stringify({
  jsonrpc: "2.0",
  method: "$/ping",
});

export const invalidJson = "not valid json{{{";

export const invalidJsonRpc = JSON.stringify({
  version: "1.0",
  method: "test",
});

export const multiLineChunk = [
  initializeRequest,
  sessionNewRequest,
  pingNotification,
].join("\n");

export const sessionListRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 4,
  method: "session/list",
  params: {},
});

export const sessionLoadRequest = JSON.stringify({
  jsonrpc: "2.0",
  id: 5,
  method: "session/load",
  params: {
    sessionId: "sess_abc123",
  },
});
