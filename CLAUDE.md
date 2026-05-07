# acp-mobile-relay

A transparent ACP relay proxy with a mobile web UI. See README.md for the overview.

## Key Resources

- `research/01-acp-protocol.md` — ACP protocol reference (JSON-RPC lifecycle, message formats, how claude-agent-acp works)
- `research/02-relay-architecture.md` — Relay design, comparison with existing tools, implementation phases, open questions
- `research/03-websocket-protocol.md` — ACP-over-WebSocket wire format, connection lifecycle, session multiplexing

## Tech Stack

- TypeScript / Node.js
- npm distribution (`npx acp-mobile-relay`)
- WebSocket server (`ws` library) for mobile/web clients
- ACP UI (github.com/formulahendry/acp-ui) for the chat interface — we only build the session picker

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
