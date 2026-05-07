# Research: ACP Relay Proxy

## ACP-over-WebSocket Protocol

**Decision**: Use raw JSON-RPC text frames with newline termination, matching the stdio-to-ws and ACP UI convention.

**Rationale**: All three sources (ACP draft spec, stdio-to-ws, ACP UI) agree on the same format: one JSON-RPC object per WebSocket text frame, `\n`-terminated. No envelope protocol. Clients split incoming frames on `\n` to handle multi-line chunks from stdio bridges. Binary frames are rejected.

**Alternatives considered**:
- Custom envelope protocol → rejected (incompatible with ACP UI)
- Raw stdio byte forwarding without framing → rejected (need to parse messages for session routing and mirroring)

## WebSocket Connection Lifecycle

**Decision**: ACP UI connects with a standard WebSocket upgrade, then sends `initialize` followed by `session/new`. No additional handshake. The `acp.v1` subprotocol is advertised but not required.

**Rationale**: This matches how ACP UI works today. The relay's WebSocket server should accept connections, wait for `initialize`, respond with capabilities, then handle session operations.

**Key details**:
- ACP UI sends `$/ping` heartbeats every 25 seconds to keep connections alive
- Reconnection requires a full `initialize` + `session/load` cycle (not just socket reopen)
- The relay can keep the agent connection alive while mobile clients are disconnected, making reconnect instant

## Session Multiplexing over WebSocket

**Decision**: One WebSocket connection per mobile client, sessions multiplexed by `sessionId` in JSON-RPC params.

**Rationale**: The ACP protocol uses `sessionId` fields in request params and notifications for multiplexing. This matches the draft spec and ACP UI's internal model. One mobile client can view and switch between multiple sessions over a single connection.

**Alternatives considered**:
- One WebSocket per session (stdio-to-ws model) → rejected (forces reconnect on session switch, doesn't match our multi-session picker UX)

## Daemon IPC Mechanism

**Decision**: Use Unix domain sockets (macOS/Linux) and Windows named pipes via Node's built-in `net` module. Socket path: `~/.acp-web-relay/daemon.sock`.

**Rationale**: Attempting `net.createConnection()` to the socket simultaneously detects whether a daemon is running and establishes the communication channel. Zero dependencies (built-in `net` module). The protocol is newline-delimited JSON-RPC, same as ACP stdio — the subprocess just pipes `process.stdin` to the socket and the socket to `process.stdout`.

**Alternatives considered**:
- TCP port for IPC → rejected (uses real network port, firewall issues, allows remote connections)
- PID file + TCP → rejected (two mechanisms, PID files go stale on crashes)
- HTTP/REST → rejected (overhead for a bidirectional byte stream)
- `node-ipc` library → rejected (supply chain concerns, `net` module does everything needed)

## ACP UI Integration

**Decision**: Bundle ACP UI's web build into the relay's npm package and serve it from the relay's HTTP server.

**Rationale**: ACP UI is a Vue 3 app with a web build that connects to remote agents via WebSocket. By serving it locally, we avoid mixed-content issues (https→ws) and external hosting dependencies. The relay just needs to serve the static files and point ACP UI at the relay's own WebSocket endpoint.

**Key details from ACP UI source**:
- `AcpTransport` interface: `send(json)`, `onMessage(cb)`, `onClose(cb)`, `close()`
- `WebSocketTransport.connect(opts)` opens socket, waits for `open` event, 15s timeout
- `AcpClientBridge` handles all JSON-RPC correlation — transport-agnostic
- Session store manages `initialize` → `session/new` or `session/load` flow

## Authentication

**Decision**: No authentication for v1. Defer to v2 with bearer token support.

**Rationale**: Auth is explicitly out of scope per spec assumptions. When added later, ACP UI already supports bearer tokens via WebSocket subprotocol (`bearer.<token>`), so the relay just needs to validate the token on connection.

## Agent Process Model

**Decision**: The editor spawns one relay process, which spawns one agent process. Zed multiplexes sessions via `session/new` over a single agent subprocess.

**Rationale**: Confirmed by Zed source code — `AcpConnection` holds one `child: Option<Child>` and a `sessions: HashMap<SessionId, AcpSession>`. The relay sees all sessions on a single stdio pipe.

**Source**: Zed's `crates/agent_servers/src/acp.rs`
