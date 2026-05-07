# ACP over WebSocket — Protocol Details

Research into the exact wire format and connection lifecycle for ACP-over-WebSocket,
based on source code analysis of three implementations and the draft transport spec.

## Sources Examined

1. **stdio-to-ws** (`marimo-team/stdio-to-ws` on GitHub, published as `stdio-to-ws` on npm,
   formerly `@rebornix/stdio-to-ws`) — the server-side bridge that wraps a stdio ACP agent
   as a WebSocket endpoint
2. **ACP UI** (`formulahendry/acp-ui` on GitHub) — the client-side WebSocket transport
   that connects to remote agents
3. **ACP Streamable HTTP/WebSocket Transport RFD** — the draft spec at
   `agentclientprotocol.com/rfds/streamable-http-websocket-transport`

---

## 1. Wire Format: Raw JSON-RPC Lines as WebSocket Text Frames

**There is no envelope or wrapping protocol.** Each WebSocket text frame contains one
(or occasionally multiple newline-delimited) JSON-RPC 2.0 message(s), sent as-is.

### stdio-to-ws (server side)

The bridge operates in two framing modes, controlled by `--framing` (`line` or `raw`):

**Line mode (default, recommended for ACP):** Uses Node's `readline` to split stdout into
lines. Each line becomes one `ws.send(line)`:

```typescript
// From marimo-team/stdio-to-ws src/stdio-to-ws.ts
child.stdout.setEncoding("utf8");
const stdoutLines = createInterface({
  input: child.stdout,
  crlfDelay: Infinity,
});
stdoutLines.on("line", (line) => {
  if (line.length === 0) return;
  webSocket.send(line);
});
```

Inbound WebSocket messages are written to the child's stdin with a trailing newline:

```typescript
webSocket.on("message", (data) => {
  const message = data.toString();
  const line = message.endsWith("\n") || message.endsWith("\r\n")
    ? message
    : `${message}\n`;
  child.stdin.write(line);
});
```

**Key detail:** The bridge is completely protocol-agnostic. It does not parse JSON-RPC,
add session IDs, or do any ACP-specific processing. It is a dumb pipe between WebSocket
frames and stdio lines.

### ACP UI (client side)

The client's `WebSocketTransport.send()` always appends `\n` to outgoing frames:

```typescript
// From formulahendry/acp-ui src/lib/transport/websocket.ts
async send(json: string): Promise<void> {
  // Always terminate frames with '\n'. Native ACP-over-WS servers tolerate
  // trailing whitespace, and stdio-WS bridges forward the WS payload verbatim
  // to the agent's stdin, which expects newline-delimited JSON.
  const frame = json.endsWith('\n') ? json : json + '\n';
  this.ws.send(frame);
}
```

The client's `handleMessage` splits incoming frames on `\n` because a single WebSocket
message may contain multiple NDJSON lines (e.g. when a stdio bridge forwards a chunk
with multiple lines):

```typescript
private handleMessage(ev: MessageEvent): void {
  if (typeof ev.data === 'string') {
    const data = ev.data;
    if (data.indexOf('\n') === -1) {
      const trimmed = data.trim();
      if (trimmed.length > 0) this.messageListeners.emit(trimmed);
      return;
    }
    for (const line of data.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.length > 0) this.messageListeners.emit(trimmed);
    }
  } else {
    // Binary frames are not part of ACP — rejected
    console.error('WebSocketTransport received non-string frame; dropping', ev.data);
  }
}
```

### Draft spec

The ACP WebSocket Transport RFD states:

> "All messages are WebSocket text frames containing JSON-RPC. Binary frames are ignored."

### Summary

The wire format is: **one JSON-RPC object per WebSocket text frame, newline-terminated
for compatibility with stdio bridges.** Clients should be prepared to receive multiple
NDJSON lines in a single frame (split on `\n`). Binary frames are not used.

---

## 2. Connection Lifecycle

### Draft spec flow

1. Client sends HTTP `GET /acp` with `Upgrade: websocket` header
2. Server responds with `HTTP 101 Switching Protocols` and an `Acp-Connection-Id: <uuid>` header
3. Client sends `initialize` as the first JSON-RPC message
4. Server responds with capabilities
5. Client calls `session/new` to create sessions

### How ACP UI actually connects

The `WebSocketTransport.connect()` static method opens a WebSocket and waits for the
`open` event (with a 15-second timeout). There is **no additional handshake** beyond
the standard WebSocket upgrade:

```typescript
static async connect(opts: WebSocketTransportOptions): Promise<WebSocketTransport> {
  const subprotocols = buildSubprotocols(opts.headers);
  const ws = new Ctor(opts.url, subprotocols);
  // ... waits for 'open' event, rejects on 'error'/'close'/timeout
  return new WebSocketTransport(ws, opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS);
}
```

After the WebSocket is open, the higher-level `createSession()` in the session store
sends `initialize` followed by `session/new`:

```typescript
// Step 1: initialize
const initResponse = await acpClient.initialize({
  protocolVersion: 1,
  clientCapabilities: {
    fs: { readTextFile: true, writeTextFile: true },
  },
  clientInfo: { name: 'acp-ui', title: 'ACP UI', version: appVersion },
});

// Step 2: create session
const sessionResponse = await acpClient.newSession({
  cwd,
  mcpServers: [],
});
```

### How stdio-to-ws handles connections

stdio-to-ws spawns a **new child process per WebSocket connection**:

```typescript
wss.on("connection", (webSocket) => {
  handleWebSocketConnection(command, webSocket, framing);
});

function handleWebSocketConnection(command, webSocket, framing) {
  const child = spawn(command[0], command.slice(1));
  // ... pipes stdout→ws and ws→stdin
  webSocket.on("close", () => { child.kill(); });
}
```

This means: **one WebSocket connection = one agent process = one ACP connection.**
The bridge has no concept of multiplexing. When the WebSocket closes, the agent
process is killed.

---

## 3. Authentication

ACP UI negotiates a `acp.v1` WebSocket subprotocol and optionally folds a Bearer token
into the subprotocol list (because browser WebSocket APIs cannot set custom HTTP headers):

```typescript
const ACP_SUBPROTOCOL = 'acp.v1';

function buildSubprotocols(headers?: Record<string, string>): string[] {
  const protocols: string[] = [ACP_SUBPROTOCOL];
  if (!headers) return protocols;
  const auth = pickHeader(headers, 'authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) {
      const tok = m[1].replace(/\s+/g, '');
      protocols.push(`bearer.${tok}`);
    }
  }
  return protocols;
}
```

At the ACP protocol level, agents may also require authentication via `authenticate`
JSON-RPC calls after `initialize` but before `session/new`.

---

## 4. Session Multiplexing

### Draft spec model

The draft spec says sessions are multiplexed over a single WebSocket connection using
a `sessionId` field in JSON-RPC message bodies:

> "Multiple sessions can coexist on a single WebSocket connection, each identified by
> its sessionId JSON-RPC field."

### Actual implementation (ACP UI + stdio-to-ws)

In practice, the current implementations use **one connection per agent** (not per session),
and session multiplexing is done through the `sessionId` parameter in JSON-RPC
request params:

- `session/new` returns a `sessionId`
- `session/prompt`, `session/cancel`, `session/load`, `session/set_mode` all take
  `sessionId` as a parameter
- `session/update` notifications include the `sessionId`

The `AcpClientBridge` in ACP UI is a single bridge per transport instance. It correlates
responses by JSON-RPC `id` field (sequential integers starting at 0), and handles
incoming notifications/requests by method name.

stdio-to-ws does not multiplex at all — it creates one agent process per WebSocket
connection. If the agent itself supports multiple sessions (as Claude Code ACP does),
they all flow over the same stdio pipe.

### Practical implication for the relay

A relay that sits between Zed and a mobile client has two architecture choices:

1. **One WebSocket per session**: Simple, matches stdio-to-ws model. Each mobile client
   connection maps to one agent subprocess.
2. **One WebSocket per agent, sessions multiplexed by sessionId**: Matches the draft spec
   and ACP UI's internal model. More complex but allows one connection to view multiple
   sessions.

---

## 5. Heartbeat / Keep-Alive

ACP UI sends a `$/ping` JSON-RPC notification every 25 seconds to prevent idle
timeouts from NAT routers and reverse proxies:

```typescript
const DEFAULT_HEARTBEAT_MS = 25_000;
const HEARTBEAT_METHOD = '$/ping';

private startHeartbeat(intervalMs: number): void {
  const frame = `{"jsonrpc":"2.0","method":"${HEARTBEAT_METHOD}"}\n`;
  this.heartbeatTimer = setInterval(() => {
    if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.stopHeartbeat();
      return;
    }
    this.ws.send(frame);
  }, intervalMs);
}
```

The `$/` prefix follows LSP/JSON-RPC convention for implementation-defined
notifications. A conforming agent that does not recognize `$/ping` silently ignores
it per JSON-RPC 2.0 notification semantics (no response is sent).

---

## 6. Reconnection

ACP UI **does not auto-reconnect** at the transport level. The `WebSocketTransport`
comment explains why:

> "This transport intentionally does NOT auto-reconnect. Reconnecting silently can
> desync session state on the agent side (sessions are per-connection in most ACP
> implementations). We instead surface the close to the session store, which can
> present a clear 'reconnect' affordance to the user."

When the user returns to the foreground (mobile/web), the session store calls
`tryReconnect()` which creates a fresh `WebSocketTransport`, sends `initialize`
again, and then calls `session/load` to resume the previous session:

```typescript
async function tryReconnect(): Promise<boolean> {
  if (!session.supportsLoadSession) return false;
  await resumeSession(session); // creates new transport, initialize, loadSession
  return true;
}
```

This means the full reconnection flow is:
1. Open a new WebSocket connection
2. Send `initialize`
3. Send `session/load` with the previous `sessionId`
4. Receive replayed messages via `session/update` notifications

---

## 7. Transport Interface

ACP UI defines a clean transport abstraction that both stdio and WebSocket implement:

```typescript
interface AcpTransport {
  send(json: string): Promise<void>;
  onMessage(cb: (json: string) => void): Unsubscribe;
  onClose(cb: (reason?: string) => void): Unsubscribe;
  close(): Promise<void>;
}
```

The `AcpClientBridge` is transport-agnostic and handles all JSON-RPC
request/response correlation, notification routing, and permission flows
identically regardless of transport.

---

## Key Takeaways for the Relay Implementation

1. **Message format is dead simple:** JSON-RPC text frames, newline-terminated.
   No envelope, no headers, no Content-Length. Parse by splitting on `\n` and
   JSON.parse each non-empty line.

2. **No WebSocket-level handshake needed beyond the upgrade.** Just open the
   connection and start sending JSON-RPC. The `acp.v1` subprotocol is optional
   but good practice.

3. **Session IDs are in the JSON-RPC params**, not in a WebSocket-level header
   or envelope. The relay needs to parse JSON-RPC messages to route them.

4. **stdio-to-ws is a reference for the server side:** One connection = one
   agent process. It is a dumb pipe with no protocol awareness.

5. **The relay needs to be smarter than stdio-to-ws:** It must parse messages
   to mirror them to the mobile client, maintain session state, and handle
   reconnection.

6. **Heartbeat at 25s intervals** using `$/ping` notifications keeps the
   connection alive through NAT/proxy idle timeouts. The relay should
   implement this on its mobile-facing WebSocket.

7. **Reconnection requires `session/load`**: Mobile clients that disconnect
   (backgrounding, network drop) need to re-initialize and load the session.
   The relay could maintain the agent connection while the mobile client is
   away, making reconnection instant.

8. **Authentication can happen at two levels:** WebSocket subprotocol
   (`bearer.<token>`) for transport-level auth, and ACP `authenticate`
   JSON-RPC method for agent-level auth. The relay may need to handle both.
