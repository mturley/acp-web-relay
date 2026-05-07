# WebSocket API Contract: acp-web-relay

## Connection

```
ws://<host>:<port>/ws
```

Subprotocols: `acp.v1` (optional), `bearer.<token>` (future, for auth)

## Message Format

All messages are WebSocket text frames containing one or more
newline-delimited JSON-RPC 2.0 objects. Binary frames are rejected.

```
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}\n
```

## Client → Relay Messages

### initialize

Required as the first message after WebSocket connection.

```jsonc
{
  "jsonrpc": "2.0", "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": { "name": "acp-ui", "version": "1.0.0" },
    "capabilities": {}
  }
}
```

Response includes relay capabilities:

```jsonc
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentInfo": { "name": "acp-web-relay", "version": "1.0.0" },
    "capabilities": {
      "loadSession": true,
      "sessionCapabilities": { "list": true, "resume": true, "close": true }
    }
  }
}
```

### session/list

Returns all active sessions with git metadata.

```jsonc
// Request
{ "jsonrpc": "2.0", "id": 2, "method": "session/list", "params": {} }

// Response
{
  "jsonrpc": "2.0", "id": 2,
  "result": {
    "sessions": [
      {
        "sessionId": "sess_abc123",
        "cwd": "/Users/dev/project",
        "title": "Fix pagination bug",
        "updatedAt": "2026-05-06T14:30:00Z",
        "_meta": {
          "relay": {
            "status": "idle",
            "git": {
              "repoName": "project",
              "branch": "main",
              "remoteUrl": "git@github.com:user/project.git"
            }
          }
        }
      }
    ]
  }
}
```

### session/load

Resume viewing a session. The relay replays buffered messages as
`session/update` notifications.

```jsonc
{
  "jsonrpc": "2.0", "id": 3,
  "method": "session/load",
  "params": { "sessionId": "sess_abc123" }
}
```

### session/prompt

Send a prompt to the agent. Rejected if the session is mid-turn.

```jsonc
{
  "jsonrpc": "2.0", "id": 4,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123",
    "prompt": [{ "type": "text", "text": "Fix the bug" }]
  }
}
```

Error if session is busy:

```jsonc
{
  "jsonrpc": "2.0", "id": 4,
  "error": {
    "code": -32000,
    "message": "Session is currently processing a prompt"
  }
}
```

### session/cancel

Cancel the active prompt in a session.

```jsonc
{
  "jsonrpc": "2.0",
  "method": "session/cancel",
  "params": { "sessionId": "sess_abc123" }
}
```

### $/ping

Heartbeat notification (no response expected).

```jsonc
{ "jsonrpc": "2.0", "method": "$/ping" }
```

## Relay → Client Messages

### session/update

Streamed notifications mirroring agent activity. Same format as
ACP `session/update` — the relay forwards these unmodified from
the agent.

```jsonc
{
  "jsonrpc": "2.0",
  "method": "session/update",
  "params": {
    "sessionId": "sess_abc123",
    "type": "agent_message_chunk",
    "chunk": { "text": "I'll fix the pagination..." }
  }
}
```

Update types forwarded: `plan`, `agent_message_chunk`,
`tool_call`, `tool_call_update`, `agent_message_end`, and any
other types the agent produces.

## Error Codes

| Code    | Meaning                                     |
|---------|---------------------------------------------|
| -32700  | Parse error (invalid JSON)                  |
| -32600  | Invalid request                             |
| -32601  | Method not found                            |
| -32000  | Session busy (prompt rejected)              |
| -32001  | Session not found                           |
| -32002  | Not initialized (must call initialize first)|
