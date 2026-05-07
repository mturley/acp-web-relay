# CLI Contract: acp-web-relay

## Installation

```bash
npm install -g acp-web-relay
# or
npx acp-web-relay [options]
```

## Usage

### Subprocess Mode (default)

```bash
acp-web-relay --agent <command> [--port <port>] [--host <address>]
```

The editor launches this as a subprocess. The relay:
1. Spawns `<command>` as the downstream ACP agent
2. Proxies stdio between the editor and agent
3. Starts an HTTP/WebSocket server for mobile clients

### Daemon Mode

```bash
acp-web-relay --daemon [--port <port>] [--host <address>]
```

Starts a persistent relay server. Editor subprocesses detect the daemon
and register their stdio pipes with it.

## Options

| Flag             | Default       | Description                                    |
|------------------|---------------|------------------------------------------------|
| `--agent <cmd>`  | (required in subprocess mode) | Command to spawn the downstream ACP agent |
| `--port <port>`  | `8765`        | HTTP/WebSocket server port                     |
| `--host <addr>`  | `0.0.0.0`    | Bind address for the HTTP/WebSocket server     |
| `--daemon`       | `false`       | Run in daemon mode (persistent, no agent spawn)|
| `--version`      | —             | Print version and exit                         |
| `--help`         | —             | Print help and exit                            |

## Stdio Interface (ACP)

When used as an editor subprocess, the relay speaks ACP JSON-RPC 2.0
over stdin/stdout:

- **stdin**: Receives newline-delimited JSON-RPC messages from the editor
- **stdout**: Sends newline-delimited JSON-RPC messages to the editor
- **stderr**: Relay diagnostic logging (not part of ACP)

The relay forwards all messages transparently between the editor and
the downstream agent.

## HTTP Endpoints

| Method | Path        | Description                           |
|--------|-------------|---------------------------------------|
| GET    | `/`         | Session picker (HTML page)            |
| GET    | `/ui/*`     | ACP UI static files (bundled)         |
| GET    | `/ws`       | WebSocket upgrade endpoint            |

## WebSocket Protocol

The `/ws` endpoint speaks ACP-over-WebSocket:

- Text frames containing newline-delimited JSON-RPC 2.0 messages
- `acp.v1` subprotocol (optional, accepted if offered)
- `$/ping` heartbeat notifications every 25 seconds
- Standard ACP lifecycle: `initialize` → `session/new` or `session/load` → `session/prompt`

## Exit Codes

| Code | Meaning                                                |
|------|--------------------------------------------------------|
| 0    | Clean shutdown (editor closed stdin)                   |
| 1    | Fatal error (agent failed to spawn, port in use, etc.) |
