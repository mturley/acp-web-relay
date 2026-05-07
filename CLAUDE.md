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

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at `specs/001-acp-relay-proxy/plan.md`
<!-- SPECKIT END -->
