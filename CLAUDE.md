# acp-web-relay

A transparent ACP relay proxy with a web UI. See README.md for the overview.

## Key Resources

- `research/01-acp-protocol.md` — ACP protocol reference (JSON-RPC lifecycle, message formats, how claude-agent-acp works)
- `research/02-relay-architecture.md` — Relay design, comparison with existing tools, implementation phases, open questions
- `research/03-websocket-protocol.md` — ACP-over-WebSocket wire format, connection lifecycle, session multiplexing

## Design Decisions

- **Do NOT build a custom agent/chat interface.** We use ACP UI (git submodule) for the chat interface. Building our own would be difficult to maintain. If ACP UI lacks a feature we need (like auto-loading a session by ID), contribute upstream or work around it — don't reimplement the chat UI.

## ACP UI Fork

The chat interface is a fork of ACP UI at `ui/acp-ui/` (submodule pointing to [mturley/acp-ui](https://github.com/mturley/acp-ui)). The fork adds URL parameter support for embedding in an iframe.

**When modifying the fork:**
- Update `ui/acp-ui/FORK_CHANGES.md` to document what changed and why
- Commit and push changes in the submodule (`ui/acp-ui/`) before committing in the parent repo
- Update the submodule ref in the parent repo after pushing

## Tech Stack

- TypeScript / Node.js
- npm distribution (`npx acp-web-relay`)
- WebSocket server (`ws` library) for web clients
- ACP UI ([mturley/acp-ui](https://github.com/mturley/acp-ui) fork) for the chat interface — we only build the session picker

## External References

- [ACP Protocol](https://agentclientprotocol.com/protocol/overview)
- [ACP UI](https://github.com/formulahendry/acp-ui) — cross-platform ACP client (Vue 3 + Tauri), has Android APK and web app
- [stdio-to-ws](https://www.npmjs.com/package/@rebornix/stdio-to-ws) — reference implementation for ACP-over-WebSocket bridge
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp) — Claude Code's ACP adapter

## Architecture Notes

### TLS
The relay serves over HTTPS with a self-signed certificate. On first run, `src/tls.ts` generates a cert using the `selfsigned` package and stores `cert.pem` and `key.pem` in `~/.acp-web-relay/`. Subsequent starts reuse the existing cert. This ensures the browser treats the page as a secure context, which is required for APIs like `crypto.randomUUID()` used by both the session picker and ACP UI.

### Daemon Protocol
The daemon listens on a Unix socket (`~/.acp-web-relay/daemon.sock`). When an editor subprocess connects, it sends the agent command as the **first line** over the socket. The daemon spawns the agent and pipes all subsequent data bidirectionally. The daemon owns the agent process.

### Message Broadcasting
- `agent→editor` messages are broadcast to all web clients (raw ACP protocol messages)
- `editor→agent` prompts are NOT broadcast raw (they'd confuse ACP UI). Instead, the relay synthesizes `session/update` notifications with `user_message_chunk` so ACP UI renders them as user messages.
- `relay/sessions_changed` is a relay-specific notification (not ACP protocol) that tells the session picker to re-fetch the session list. It's separate from `session/update` to avoid interfering with ACP UI's message rendering.

### Web Prompt Echo
When a prompt is sent from the web UI, the relay injects a synthetic `agent_message_chunk` containing `\n\n---\n[Web prompt: <text>]\n\n` into the editor's stream so the editor user can see what was asked. This is excluded from the sending web client via `broadcast(data, exclude)`. The agent receives the original unmodified prompt.

### Permission Forwarding
Agent-originated JSON-RPC requests (like `session/request_permission`) are tracked by `id → pipeId`. When a web client sends a response, it's routed to the correct agent. When the editor approves a permission, the response is broadcast to web clients so the ACP UI fork can dismiss its dialog.

### Session Buffering
- `session/prompt` messages are converted to `user_message_chunk` notifications in the buffer so they replay correctly in ACP UI
- `session/request_permission` messages are NOT buffered to avoid replaying stale permission dialogs
- End-of-turn is detected from the JSON-RPC response to `session/prompt` (tracked via `pendingPromptRequests`), not from `session/update` notifications
- **Truncated replay**: By default, `session/load` replays only the last `REPLAY_LIMIT` (200) messages, injecting a synthetic info message at the top when truncated. Full replay is opt-in via `?fullReplay=1` on the WebSocket URL (read from the upgrade request). The session picker passes this param through the localStorage agent config URL when the user clicks "Full replay". Switching sessions resets to truncated replay.

### ACP UI Integration
The session picker pre-populates two localStorage keys before loading ACP UI in the iframe:
- `acp-ui:agents` — `{ agents: { "Relay": { transport: "websocket", url: "wss://..." } } }`
- `acp-ui:sessions.json` — `{ sessions: [{ id, agentName: "Relay", sessionId, title, cwd, supportsLoadSession: true, ... }] }`

The iframe URL includes `?agent=Relay&session=<id>&hideSidebar=true`.

For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at `specs/001-acp-relay-proxy/plan.md`
