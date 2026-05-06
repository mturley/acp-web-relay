# Agent Client Protocol (ACP) — Research Notes

## What is ACP?

The [Agent Client Protocol](https://agentclientprotocol.com/protocol/overview) is
an open JSON-RPC 2.0 standard for connecting code editors to AI coding agents.
Think LSP, but for AI agents. It was created by Zed Industries, launched August
2025, and is now co-maintained with JetBrains. Apache-licensed.

ACP solves the M×N problem: any ACP-compatible agent works in any
ACP-compatible editor without custom integration.

## Transport

ACP currently uses **stdio** as its primary transport: the client (editor)
launches the agent as a subprocess and exchanges newline-delimited JSON-RPC
messages over stdin/stdout. stderr is used for logging.

A [Streamable HTTP/WebSocket transport](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport)
is in draft, which would enable network-based communication. This is relevant
to our relay architecture.

## Protocol Lifecycle

### Phase 1: Initialization

Client sends `initialize` with protocol version and capabilities:

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0", "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": { "name": "zed", "version": "1.0.0" },
    "capabilities": {
      "fs": { "readTextFile": true, "writeTextFile": true },
      "terminal": true
    }
  }
}
```

Agent responds with its capabilities:

```jsonc
// Agent → Client
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentInfo": { "name": "claude-acp", "version": "2.0.0" },
    "capabilities": {
      "loadSession": true,
      "image": true,
      "sessionCapabilities": { "list": true, "resume": true, "close": true }
    },
    "authMethods": [...]
  }
}
```

### Phase 2: Session Setup

Create a new session:

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0", "id": 2,
  "method": "session/new",
  "params": {
    "cwd": "/Users/mturley/git/odh-dashboard",
    "mcpServers": [...]
  }
}

// Agent → Client
{
  "jsonrpc": "2.0", "id": 2,
  "result": { "sessionId": "sess_abc123def456" }
}
```

Or list existing sessions:

```jsonc
// Client → Agent
{ "jsonrpc": "2.0", "id": 3, "method": "session/list", "params": {} }

// Agent → Client
{
  "jsonrpc": "2.0", "id": 3,
  "result": {
    "sessions": [
      {
        "sessionId": "sess_abc123",
        "cwd": "/Users/mturley/git/odh-dashboard",
        "title": "Fix pagination bug",
        "updatedAt": "2026-05-06T14:30:00Z"
      }
    ]
  }
}
```

### Phase 3: Prompt Turn

```jsonc
// Client → Agent
{
  "jsonrpc": "2.0", "id": 4,
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_abc123",
    "prompt": [{ "type": "text", "text": "Fix the pagination bug in UserList.tsx" }]
  }
}
```

The agent streams back `session/update` **notifications** (no id, one-way):

```jsonc
// Agent → Client (notification: plan)
{ "jsonrpc": "2.0", "method": "session/update", "params": {
    "sessionId": "sess_abc123",
    "type": "plan",
    "plan": [{ "title": "Read UserList.tsx", "status": "in_progress" }]
}}

// Agent → Client (notification: text chunk)
{ "jsonrpc": "2.0", "method": "session/update", "params": {
    "sessionId": "sess_abc123",
    "type": "agent_message_chunk",
    "chunk": { "text": "I'll fix the pagination..." }
}}

// Agent → Client (notification: tool call)
{ "jsonrpc": "2.0", "method": "session/update", "params": {
    "sessionId": "sess_abc123",
    "type": "tool_call",
    "toolCall": {
      "toolCallId": "tc_001",
      "title": "Read file: UserList.tsx",
      "status": "pending"
    }
}}

// Agent → Client (notification: tool call update)
{ "jsonrpc": "2.0", "method": "session/update", "params": {
    "sessionId": "sess_abc123",
    "type": "tool_call_update",
    "toolCallId": "tc_001",
    "status": "completed",
    "content": [{ "type": "text", "text": "File contents..." }]
}}
```

Eventually the agent responds to the original `session/prompt` request:

```jsonc
// Agent → Client (response to id: 4)
{
  "jsonrpc": "2.0", "id": 4,
  "result": { "stopReason": "end_turn" }
}
```

### Cancellation

```jsonc
// Client → Agent (notification, no id)
{ "jsonrpc": "2.0", "method": "session/cancel",
  "params": { "sessionId": "sess_abc123" } }
```

## How claude-agent-acp Works

[claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) is
a TypeScript adapter that bridges the Claude Code SDK to ACP. It:

1. Receives ACP messages on stdin from the editor
2. Translates them to Claude Code SDK calls
3. Internally spawns `claude -p --output-format stream-json --verbose`
4. Maps Claude's streaming output back to ACP `session/update` notifications
5. Supports session resume via `--resume sessionId`

Sessions are persisted by Claude Code to `~/.claude/projects/` as JSONL files.

## How Zed Configures External Agents

In `settings.json`:

```json
{
  "agent_servers": {
    "Claude Code": {
      "type": "registry"
    },
    "My Custom Agent": {
      "type": "custom",
      "command": "/path/to/binary",
      "args": ["--flag"],
      "env": { "KEY": "value" }
    }
  }
}
```

Registry agents (like `claude-acp`) are discovered automatically from the
[ACP Registry](https://agentclientprotocol.com/get-started/registry). Custom
agents specify a binary path directly.

## Key Observations

1. **Sessions persist to disk** — Claude Code stores full conversation history
   in `~/.claude/projects/`, resumable by session ID.

2. **session/list is supported** — claude-agent-acp exposes all sessions with
   their working directory, title, and last update time.

3. **The protocol is simple** — newline-delimited JSON-RPC over stdio. Easy to
   proxy, intercept, or relay.

4. **session/update is one-way** — notifications stream from agent to client.
   A relay can broadcast these to multiple consumers without protocol changes.

5. **Tool calls are visible** — the relay sees every tool call, its status, and
   its output. Full transparency into what the agent is doing.

Sources:
- [ACP Protocol Overview](https://agentclientprotocol.com/protocol/overview)
- [ACP Transports](https://agentclientprotocol.com/protocol/transports)
- [ACP Session Setup](https://agentclientprotocol.com/protocol/session-setup)
- [ACP Session List](https://agentclientprotocol.com/protocol/session-list)
- [ACP Prompt Turn](https://agentclientprotocol.com/protocol/prompt-turn)
- [ACP Streamable HTTP draft](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport)
- [claude-agent-acp on GitHub](https://github.com/agentclientprotocol/claude-agent-acp)
- [Claude Code via ACP in Zed](https://zed.dev/blog/claude-code-via-acp)
- [Zed External Agents docs](https://zed.dev/docs/ai/external-agents)
