# Data Model: ACP Relay Proxy

## Entities

### RelaySession

Represents a single ACP agent session being proxied by the relay.

| Field          | Type                          | Description                                       |
|----------------|-------------------------------|---------------------------------------------------|
| sessionId      | string                        | ACP session ID (from `session/new` response)      |
| cwd            | string                        | Working directory the session was created with     |
| title          | string \| null                | Session title (derived from conversation, may update over time) |
| status         | `idle` \| `working` \| `waiting` | Current session state                          |
| gitMeta        | GitMeta \| null               | Git repository metadata for this session's cwd    |
| messages       | Message[]                     | In-memory buffer of all messages since session start |
| createdAt      | string (ISO 8601)             | When the session was created                      |
| updatedAt      | string (ISO 8601)             | Last activity timestamp                           |
| promptPending  | boolean                       | Whether a prompt is currently being processed     |
| sourceId       | string                        | ID of the editor pipe that created this session (for daemon mode cleanup) |

### GitMeta

Git repository metadata derived from the session's working directory.

| Field      | Type            | Description                                    |
|------------|-----------------|------------------------------------------------|
| repoName   | string          | Repository name (directory name or from remote URL) |
| branch     | string          | Current branch name                            |
| remoteUrl  | string \| null  | Git remote URL (for display/grouping)          |

### Message

A single ACP message buffered by the relay for mid-session replay.

| Field     | Type                        | Description                                         |
|-----------|-----------------------------|-----------------------------------------------------|
| id        | number                      | Sequential index within the session                 |
| direction | `editor→agent` \| `agent→editor` \| `mobile→agent` \| `relay→agent` | Message origin |
| timestamp | string (ISO 8601)           | When the relay observed this message                |
| raw       | string                      | The raw JSON-RPC message (stored as-is for replay)  |
| method    | string \| null              | JSON-RPC method name (parsed for routing/filtering) |
| sessionId | string \| null              | Extracted sessionId from params (if present)        |

### EditorPipe

Represents a connected editor subprocess's stdio pipe (relevant in daemon mode).

| Field      | Type              | Description                                       |
|------------|-------------------|---------------------------------------------------|
| id         | string            | Unique identifier for this editor connection      |
| socket     | net.Socket        | IPC socket connection (daemon mode) or stdio refs  |
| agentProc  | ChildProcess      | The downstream ACP agent process for this pipe    |
| sessions   | Set\<string\>     | Session IDs owned by this editor pipe             |
| connectedAt| string (ISO 8601) | When this pipe connected                          |

### MobileClient

A connected mobile/web browser client.

| Field      | Type              | Description                                    |
|------------|-------------------|------------------------------------------------|
| id         | string            | Unique identifier for this client              |
| ws         | WebSocket         | WebSocket connection                           |
| connectedAt| string (ISO 8601) | When this client connected                     |

## State Transitions

### Session Status

```
            session/new
                │
                ▼
    ┌──────── idle ◄──────────┐
    │           │              │
    │   session/prompt     stopReason:
    │           │           end_turn
    │           ▼              │
    │       working ──────────┘
    │           │
    │   session/cancel
    │           │
    │           ▼
    └──────── idle
```

### Relay Mode (startup)

```
    startup
       │
       ├── --daemon flag? ──yes──► Start IPC server + HTTP/WS server
       │                           (daemon mode, no agent spawned yet)
       │
       └── no flag ──► Try connect to daemon IPC socket
                          │
                          ├── connected ──► Register pipe with daemon
                          │                 (thin passthrough mode)
                          │
                          └── ENOENT/ECONNREFUSED ──► Start standalone
                                                      (subprocess mode:
                                                       spawn agent,
                                                       start HTTP/WS server)
```

## Relationships

- One **RelaySession** belongs to one **EditorPipe** (tracked via `sourceId`)
- One **EditorPipe** owns zero or more **RelaySessions**
- One **EditorPipe** has exactly one **agent process** (ChildProcess)
- Zero or more **MobileClients** observe any **RelaySession**
- **Messages** are append-only within a session (never modified or deleted)
