# Implementation Plan: ACP Relay Proxy

**Branch**: `001-acp-relay-proxy` | **Date**: 2026-05-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-acp-relay-proxy/spec.md`

## Summary

Build a transparent ACP relay proxy that sits between a code editor and an ACP agent, forwarding all messages bidirectionally while simultaneously serving a mobile web UI over WebSocket. The relay bundles ACP UI for the chat interface and adds a custom session picker. It supports both subprocess mode (editor-launched) and daemon mode (persistent, multi-editor).

## Technical Context

**Language/Version**: TypeScript 5.x, targeting Node.js 18+
**Primary Dependencies**: `ws` (WebSocket server), `commander` (CLI parsing), `node:net` (IPC for daemon mode), `node:child_process` (agent spawning), `node:readline` (NDJSON parsing)
**Storage**: In-memory only (no database, no disk persistence)
**Testing**: Vitest (unit + integration), with mock stdio streams for ACP message testing
**Target Platform**: macOS, Linux, Windows (cross-platform Node.js)
**Project Type**: CLI tool + WebSocket server, distributed as npm package
**Performance Goals**: <100ms added latency on message relay, support 3+ concurrent mobile clients
**Constraints**: Zero native dependencies, single `npx` command to run, no external services
**Scale/Scope**: Single-user tool, 1-10 concurrent sessions, 1-5 mobile clients

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Transparent Proxy | ✅ Pass | All editor↔agent messages forwarded unmodified. Synthetic URL prompt is a documented exception (FR-015) with explicit carve-out in constitution v1.1.0. |
| II. Protocol Fidelity | ✅ Pass | WebSocket API uses standard ACP JSON-RPC 2.0. Relay metadata uses `_meta` field. |
| III. Simplicity & Scope | ✅ Pass | Session picker is the only custom UI. Chat interface delegates to bundled ACP UI. |
| IV. Test-First | ✅ Pass | Plan includes test tasks before implementation for critical paths. |
| V. Security by Default | ✅ Pass | Default bind is `0.0.0.0` for the primary use case (phone access). Relay displays a security warning on first startup with non-localhost bind and prompts user to confirm before proceeding. Warning includes `--host 127.0.0.1` instructions. Auth deferred to v2. Constitution v1.1.0 aligned. |

**Gate result**: PASS (all principles aligned with constitution v1.1.0).

## Project Structure

### Documentation (this feature)

```text
specs/001-acp-relay-proxy/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   ├── cli.md           # CLI interface contract
│   └── websocket-api.md # WebSocket API contract
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

### Source Code (repository root)

```text
src/
├── cli.ts               # CLI entry point, argument parsing
├── relay.ts             # Core relay orchestrator
├── stdio-proxy.ts       # Stdin/stdout ACP message forwarding
├── agent-spawner.ts     # Child process management for downstream agent
├── session-manager.ts   # Session state tracking, message buffering
├── git-meta.ts          # Git metadata extraction (repo, branch, remote)
├── ws-server.ts         # WebSocket server for mobile clients
├── http-server.ts       # HTTP server (session picker + ACP UI static files)
├── daemon.ts            # Daemon mode IPC server/client
├── prompt-queue.ts      # Prompt conflict resolution and synthetic prompt logic
├── json-rpc.ts          # JSON-RPC 2.0 parsing and validation utilities
└── types.ts             # Shared TypeScript types

ui/
├── session-picker/      # Custom session picker page (HTML/CSS/JS)
│   ├── index.html
│   ├── style.css
│   └── script.js
└── acp-ui/              # Bundled ACP UI web build (vendored or npm dep)

tests/
├── unit/
│   ├── json-rpc.test.ts
│   ├── session-manager.test.ts
│   ├── git-meta.test.ts
│   └── prompt-queue.test.ts
├── integration/
│   ├── stdio-proxy.test.ts
│   ├── ws-broadcast.test.ts
│   ├── session-lifecycle.test.ts
│   └── daemon-ipc.test.ts
└── fixtures/
    └── acp-messages.ts  # Sample ACP JSON-RPC messages for testing
```

**Structure Decision**: Single project layout. The relay is one npm package with a `bin` entry point. The `ui/` directory contains the session picker (custom) and ACP UI (vendored build). Tests live alongside source in a parallel `tests/` tree.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Daemon mode IPC | Multi-editor session aggregation, port conflict avoidance | Single subprocess mode doesn't support multiple Zed windows or mixed editors |
| Synthetic URL prompt | Users need to discover the relay URL naturally | Stderr-only URL output is buried in editor logs and not visible to users |
