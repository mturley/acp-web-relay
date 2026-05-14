# acp-web-relay

Monitor and control AI agent sessions from any browser.

A relay proxy that sits between your code editor and any [ACP](https://agentclientprotocol.com/)-compatible agent (Claude Code, Gemini CLI, Codex, etc.), exposing a web interface over the network.

> **Warning:** This project is in early development and is not well tested. Use at your own risk. Expect breaking changes, bugs, and rough edges.

## How It Works

![Architecture diagram](docs/architecture.svg)

The relay runs as a daemon server. Your editor launches `acp-web-relay agent <cmd>` as a subprocess, which connects to the daemon and spawns the agent. The daemon:

1. **Proxies all ACP messages** transparently between editor and agent
2. **Serves a web UI** with a session picker sidebar and [ACP UI](https://github.com/mturley/acp-ui) chat interface
3. **Broadcasts all updates** to connected web clients in real time
4. **Accepts prompts and cancellations** from web clients
5. **Aggregates sessions** from multiple editors into one web UI

## Use Case

You're working with an AI coding agent in your editor. You step away from your desk. On your phone, you open the relay's web UI and see all your active sessions grouped by project and branch. You can:

- Watch the agent work in real time (streaming text, tool calls, file edits)
- Send follow-up prompts from your phone
- Cancel a running operation
- Check on multiple sessions across different projects

Everything stays in sync -- the editor sees what you do on the phone and vice versa.

## Screenshots

Starting an agent session in Zed with the relay:

![Initializing an agent session in Zed](docs/screenshot-1-zed-init.png)

![Chat session in Zed](docs/screenshot-2-zed-chat.png)

| Mobile session picker | Mobile chat |
|:-:|:-:|
| ![Session picker on mobile](docs/screenshot-3-mobile-selector.png) | ![Chat session on mobile](docs/screenshot-4-mobile-chat.png) |

## Setup

### 1. Start the relay

```bash
npx acp-web-relay serve --port 8765
```

Or from a local clone:

```bash
node dist/cli.js serve --port 8765
```

On first run, the relay:
1. Generates a self-signed TLS certificate (stored in `~/.acp-web-relay/`)
2. Prompts you to set a password for web access

All web clients must log in with this password before they can view or interact with sessions.

> **First visit:** Your browser will show a certificate warning because the cert is self-signed. Accept it once per device and you won't see it again.

### 2. Configure your editor

Point your editor at the relay instead of the agent directly. In Zed's `settings.json`:

Using npx:

```json
{
  "agent_servers": {
    "Claude (Web Relay)": {
      "type": "custom",
      "command": "npx",
      "args": ["acp-web-relay", "agent", "npx @agentclientprotocol/claude-agent-acp"]
    }
  }
}
```

Using a local clone:

```json
{
  "agent_servers": {
    "Claude (Web Relay)": {
      "type": "custom",
      "command": "node",
      "args": ["/path/to/acp-web-relay/dist/cli.js", "agent", "npx @agentclientprotocol/claude-agent-acp"]
    }
  }
}
```

When you start a session, the editor subprocess connects to the running relay daemon. If the daemon isn't running, it exits with an error.

### 3. Open in a browser

Navigate to the network URL shown when you started the relay. You'll see the session picker sidebar showing active sessions grouped by project and branch. Click a session to view it in the ACP UI chat interface.

## Features

- **Editor-agnostic**: Works with any ACP client (Zed, JetBrains, Neovim, VS Code)
- **Agent-agnostic**: Works with any ACP agent (Claude Code, Gemini CLI, Codex, OpenCode, etc.)
- **Session picker sidebar**: Sessions grouped by git repo and branch, with first prompt as title and latest prompt shown
- **Live updates**: Session list, titles, and status update in real time without page reload
- **Prompt from anywhere**: Send prompts from the browser; the editor sees them echoed as `[Web prompt: ...]`
- **Cancel from browser**: Stop a running agent operation remotely
- **Hide/restore**: Hide sessions from the active list and restore them later (persisted across daemon restarts)
- **Truncated replay**: Opening a session replays only the most recent messages (~200) for fast loading; a "Full replay" button on the session card loads the entire history when needed
- **Automatic archival**: Old sessions are archived to disk on startup (configurable thresholds) and lazily restored when referenced
- **Multi-editor support**: Sessions from all editors appear in one web UI
- **Responsive web UI**: Works on phones, tablets, and desktops
- **Password-protected**: Web clients must log in before accessing sessions; safe to expose over a tunnel
- **HTTPS by default**: Self-signed TLS certificate auto-generated on first run; all browser APIs (like `crypto.randomUUID`) work over the network
- **No account required**: Everything runs locally, no cloud service involved

## Network Access

**Same WiFi** (simplest): The relay binds to all interfaces by default. Devices on the network can reach the relay but must log in with the password.

**Remote access**: Use [Tailscale](https://tailscale.com/), a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or an SSH tunnel to access the relay from anywhere. The password authentication ensures your sessions are protected even over a public tunnel.

## Commands

### `serve`

Start the relay daemon server.

```bash
npx acp-web-relay serve [--port 8765] [--host 0.0.0.0] [--set-password <password>]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--port <port>` | `8765` | HTTPS/WebSocket server port |
| `--host <addr>` | `0.0.0.0` | Bind address |
| `--set-password <password>` | | Set or update the web access password |

#### Authentication

The relay requires a password for web access. On first run (with no existing password), it prompts you interactively.

To change the password later, use `--set-password`. This invalidates all existing browser sessions.

You can also override the password at runtime with the `ACP_RELAY_PASSWORD` environment variable. When set, the relay accepts this password instead of the stored one (the stored password is not modified):

```bash
ACP_RELAY_PASSWORD=mysecret npx acp-web-relay serve
```

Authentication uses JWT tokens stored in secure, HttpOnly cookies with a 7-day expiry. Both HTTP requests and WebSocket connections are protected. The login page and a logout button in the session picker header are provided.

### `agent`

Connect to a running relay and spawn an ACP agent. Used as an editor subprocess.

```bash
npx acp-web-relay agent <command>
```

Exits with an error if no relay daemon is running.

### `cleanup`

Delete the `~/.acp-web-relay/` directory (TLS certificates, session data, daemon socket).

```bash
npx acp-web-relay cleanup
```

Useful for regenerating the TLS certificate or resetting all state.

## Development

```bash
git clone --recurse-submodules https://github.com/mturley/acp-web-relay.git
cd acp-web-relay
npm install
npm run build        # builds relay + ACP UI
npm test
npm run dev          # watch mode (relay only)
```

### Build scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Build everything (relay + ACP UI) |
| `npm run build:relay` | Build relay TypeScript only |
| `npm run build:ui` | Build ACP UI web version only |
| `npm run clean` | Clean all build artifacts |
| `npm test` | Run tests |
| `npm start` | Start the relay server |

### ACP UI Fork

The chat interface is a fork of [ACP UI](https://github.com/formulahendry/acp-ui) at `ui/acp-ui/` ([mturley/acp-ui](https://github.com/mturley/acp-ui)). See `ui/acp-ui/FORK_CHANGES.md` for details on what was modified and why.

## License

[CC0-1.0](LICENSE)
