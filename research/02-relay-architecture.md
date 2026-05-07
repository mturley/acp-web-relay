# Claude Relay Agent — Architecture

## Overview

A transparent ACP proxy that sits between Zed and claude-agent-acp, mirroring
agent sessions to a mobile/web client over WebSocket.

```
┌──────────┐  stdio  ┌───────────────┐  stdio  ┌──────────────────┐
│   Zed    │◄───────►│ Claude Relay  │◄───────►│ claude-agent-acp │
│  Editor  │         │    Agent      │         │  (Claude Code)   │
└──────────┘         └───────┬───────┘         └──────────────────┘
                             │
                     ACP-over-WebSocket
                             │
                     ┌───────┴───────┐
                     │  Mobile/Web   │
                     │   ACP Client  │
                     │  (e.g. ACP UI)│
                     └───────────────┘
```

## Existing Ecosystem

Before designing from scratch, here's what already exists:

### [ACP UI](https://github.com/formulahendry/acp-ui)

An open-source cross-platform ACP client (Vue 3 + TypeScript + Tauri) that
already runs on desktop, mobile (iOS/Android via WebView), and web. Features:

- Rich chat interface with markdown, syntax highlighting, tool call visualization
- Session management (list, load, resume)
- Permission controls for tool calls
- Slash commands and session modes
- **Web client at [acp-ui.github.io](https://acp-ui.github.io/)** — connects
  to remote ACP agents over WebSocket, no install required

The web build uses the same Vue frontend with Tauri swapped for browser APIs.
It only supports remote agents via WebSocket (no subprocess in a browser).

### [@rebornix/stdio-to-ws](https://www.npmjs.com/package/@rebornix/stdio-to-ws)

An npm package that bridges any stdio-based ACP agent to WebSocket:

```bash
npx @rebornix/stdio-to-ws "npx @agentclientprotocol/claude-agent-acp" --port 8765 --persist --grace-period -1
```

- `--persist`: Keeps the agent process alive across WebSocket disconnects
- `--grace-period -1`: Never kill the agent on disconnect
- Exposes ACP-over-WebSocket on the specified port

### [Agmente](https://github.com/rebornix/Agmente)

An iOS ACP client by the same author as stdio-to-ws. Connects to remote ACP
agents via `wss://`. Production-grade with Cloudflare Tunnel support.

### [OpenACP](https://github.com/Open-ACP/OpenACP)

A self-hosted bridge connecting ACP agents to Telegram, Discord, and Slack.
Includes session transfer, agent switching, and daemon mode.

## The Problem with Existing Tools

**stdio-to-ws** is close to what we need but has a critical limitation: it's a
**standalone bridge**, not a proxy. It replaces the stdio client entirely:

```
stdio-to-ws ←── stdio ──→ claude-agent-acp
     ↕
  WebSocket
     ↕
  ACP UI (mobile/web)
```

In this model, **Zed is not in the picture**. The mobile client IS the only
client. That works for a standalone mobile agent, but doesn't give us the
**mirror** behavior where both Zed and the phone see the same session.

## What We Need: A Relay Proxy

Our relay combines the stdio proxying of stdio-to-ws with transparent
passthrough to Zed:

```
Zed ←── stdio ──→ Relay ←── stdio ──→ claude-agent-acp
                    ↕
               WebSocket
               (ACP-over-WS)
                    ↕
              ACP UI / mobile
```

The relay speaks **two protocols simultaneously**:

1. **stdio ACP** — upstream to Zed (relay is the "agent" from Zed's perspective)
2. **stdio ACP** — downstream to claude-agent-acp (relay is the "client")
3. **ACP-over-WebSocket** — to mobile/web clients (relay is an ACP "server")

### Key Behaviors

**Transparent proxy**: All messages between Zed and the agent pass through
unmodified. Zed doesn't know the relay exists.

**Broadcast**: All `session/update` notifications from the agent are sent to
BOTH Zed (via stdout) and connected WebSocket clients.

**Prompt injection**: When a mobile client sends a `session/prompt`, the relay
injects it into the agent's stdin. The agent processes it normally, and both
Zed and the mobile client see the streaming updates.

**Git metadata enrichment**: On `session/new`, the relay captures the `cwd` and
runs git commands to derive repo name, branch, and remote URL. This metadata is
available to WebSocket clients via an extension to the `session/list` response
(using the `_meta` field).

**Prompt conflict resolution**: If Zed is mid-prompt when mobile sends one (or
vice versa), the relay must either queue or reject the second prompt. ACP is
strictly single-prompt-per-session.

## How Zed Sees It

Configured as a custom agent in `settings.json`:

```json
{
  "agent_servers": {
    "Claude (Mobile)": {
      "type": "custom",
      "command": "claude-relay",
      "args": [],
      "env": {}
    }
  }
}
```

Zed launches `claude-relay` as a subprocess and speaks ACP over stdio, identical
to using claude-agent-acp directly.

## How the Mobile Client Connects

### Approach: Session Picker + ACP UI

The relay serves a lightweight **session picker** web page — a mobile-friendly
landing page that groups active sessions by git repository and branch (mirroring
how the editor's agent sidebar organizes them). When you tap a session, it opens
ACP UI pointed at that session's WebSocket endpoint.

This keeps scope small:

- **Session picker** (we build): Simple HTML/JS page served by the relay. Shows
  sessions grouped by repo/branch with status indicators (idle, working, waiting
  for input). Minimal UI — just enough to find and select a session.

- **Chat interface** (ACP UI): Full-featured agent chat with markdown rendering,
  tool call visualization, permission controls, streaming support. We don't
  rebuild any of this — we just wrap ACP UI.

The relay needs to speak ACP-over-WebSocket in the same format ACP UI expects.
Since ACP UI uses stdio-to-ws as its reference bridge, we should match that
protocol exactly.

## What the Relay Adds Beyond stdio-to-ws

| Feature | stdio-to-ws | Our Relay |
|---------|-------------|-----------|
| stdio → WebSocket bridge | Yes | Yes |
| Transparent Zed proxy | No | Yes |
| Git metadata (repo, branch) | No | Yes |
| Session state tracking | No | Yes |
| Prompt from mobile | Yes (it's the only client) | Yes (injected alongside Zed) |
| Prompt conflict resolution | N/A | Yes |
| Persist state across restarts | Via `--persist` | Yes |

## Implementation Plan

### Phase 1: Relay MVP

A TypeScript/Node.js process that:

1. Reads ACP JSON-RPC from stdin (from Zed)
2. Spawns claude-agent-acp as a child process
3. Forwards all messages bidirectionally (transparent proxy)
4. Starts a WebSocket server on a configurable port
5. Broadcasts all agent→client messages to WebSocket clients
6. Accepts `session/prompt` from WebSocket clients and injects them

Distribute via npm: `npx claude-relay --port 8765 --agent "npx claude-code-acp"`

### Phase 2: Git Metadata + Session List

- On `session/new`, run git commands against `cwd`
- Populate `_meta` in `session/list` responses with `{ repo, branch, remoteUrl }`
- Mobile client groups sessions by repo and shows branch

### Phase 3: Prompt Conflict Handling

- Track per-session prompt state (idle, prompting, waiting)
- Queue or reject mobile prompts when Zed is mid-turn
- Surface prompt source (Zed vs mobile) in the UI

### Phase 4: Polish

- Auth token for WebSocket connections
- mDNS discovery for local network
- Tailscale/Cloudflare Tunnel docs for remote access
- Reconnection handling
- Persist relay state to disk for history across restarts

## Language Choice: TypeScript

- Same ecosystem as claude-agent-acp and stdio-to-ws
- JSON-RPC is trivial in JS/TS
- npm distribution (`npx claude-relay`)
- Mature WebSocket libraries (`ws`)
- Can reference stdio-to-ws source for ACP-over-WebSocket protocol details
- Fastest path to prototype

## Network Access

### Local network (same WiFi)

```bash
# Start relay, bind to all interfaces
claude-relay --port 8765 --bind 0.0.0.0

# Phone connects to ws://192.168.1.x:8765
```

### Remote access

- **Tailscale** (recommended): zero-config VPN, relay binds to Tailscale IP
- **Cloudflare Tunnel**: `cloudflared tunnel --url http://localhost:8765` → wss:// URL
- **SSH tunnel**: `ssh -L 8765:localhost:8765 desktop-machine`

### Browser security

ACP UI at `https://acp-ui.github.io` can't connect to `ws://` (mixed content).
Options:
- Self-host ACP UI on `http://localhost` for LAN use
- Use `wss://` via Cloudflare Tunnel or a reverse proxy with TLS
- Build our own web client served by the relay itself on HTTP

## Open Questions

1. **ACP-over-WebSocket protocol**: What exactly does stdio-to-ws implement?
   We need to match it so ACP UI works. Need to read the stdio-to-ws source
   or reverse-engineer from ACP UI's WebSocket client code.

2. **Zed seeing mobile prompts**: When mobile sends a prompt, Zed sees the
   `session/update` responses but not the prompt itself. Does Zed handle
   "unsolicited" session updates gracefully? Or do we need to synthesize a
   prompt notification back to Zed?

3. **Multiple sessions per relay**: Zed creates one agent subprocess per...
   what? Per project? Per agent panel instance? Need to verify whether one
   relay instance handles multiple sessions or if Zed spawns separate
   processes.

4. **Session history on mobile connect**: When a phone connects mid-session,
   the relay should replay the session's accumulated state. The relay needs
   to buffer messages for this.

5. **Permission requests**: When claude-agent-acp sends
   `session/request_permission` to the client, the relay forwards it to Zed.
   Should it also forward to mobile? Answering from either side would need
   careful coordination.

6. **Mobile-initiated sessions**: Could the phone create a new session (pick a
   directory, start a fresh agent conversation)? The relay could spawn a new
   agent process, but Zed wouldn't know about it — ACP has no mechanism for
   the agent to notify the client that a new session appeared. The client
   drives session creation, not the server. Options considered:
   - Phone-only sessions (relay spawns standalone agent, works on phone but
     invisible to Zed — breaks the mirroring model)
   - Notify Zed somehow (no ACP support for server-initiated session events)
   - Skip for v1 (primary use case is monitoring/interacting with sessions
     Zed already started; session creation is a desk activity)
   Recommendation: defer to v1+. Revisit if ACP adds server-initiated session
   notifications or if a workaround emerges.

Sources:
- [ACP UI — GitHub](https://github.com/formulahendry/acp-ui)
- [ACP UI — Web App](https://acp-ui.github.io/)
- [stdio-to-ws usage](https://github.com/formulahendry/acp-ui#readme)
- [Agmente setup](https://github.com/rebornix/Agmente/blob/main/setup.md)
- [OpenACP](https://github.com/Open-ACP/OpenACP)
- [ACP Streamable HTTP/WS draft](https://agentclientprotocol.com/rfds/streamable-http-websocket-transport)
- [Zed External Agents docs](https://zed.dev/docs/ai/external-agents)
