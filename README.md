# acp-mobile-relay

Monitor and control AI agent sessions from your phone.

A relay proxy that sits between your code editor and any [ACP](https://agentclientprotocol.com/)-compatible agent (Claude Code, Gemini CLI, Codex, etc.), exposing a mobile-friendly web interface over the network.

## How It Works

```
                     ┌───────────────┐
                     │ acp-mobile-   │
                     │    relay      │
                     │   (daemon)    │
                     │               │
┌──────────┐  IPC   │  ┌─────────┐  │  stdio  ┌──────────────────┐
│  Editor  │◄──────►│  │ Agent   │◄─┼────────►│   ACP Agent      │
│ (Zed,    │        │  │ Pipe    │  │         │ (Claude Code,    │
│  IDEA,   │        │  └─────────┘  │         │  Gemini CLI,     │
│  etc.)   │        │               │         │  Codex, etc.)    │
└──────────┘        │  ┌─────────┐  │         └──────────────────┘
                    │  │ Mobile  │  │
                    │  │ Web UI  │  │
                    │  └────┬────┘  │
                    └───────┼───────┘
                            │
                       WebSocket
                            │
                    ┌───────┴───────┐
                    │    Phone      │
                    │   Browser     │
                    └───────────────┘
```

The relay runs as a daemon server. Your editor launches `acp-mobile-relay --agent <cmd>` as a subprocess, which connects to the daemon and spawns the agent. The daemon:

1. **Proxies all ACP messages** transparently between editor and agent
2. **Serves a mobile web UI** with a session picker and chat interface
3. **Broadcasts all updates** to connected mobile clients in real time
4. **Accepts prompts and cancellations** from mobile clients
5. **Aggregates sessions** from multiple editors into one mobile UI

## Use Case

You're working with an AI coding agent in your editor. You step away from your desk. On your phone, you open the relay's web UI and see all your active sessions grouped by project and branch. You can:

- Watch the agent work in real time (streaming text, tool calls, file edits)
- Send follow-up prompts from your phone
- Cancel a running operation
- Check on multiple sessions across different projects

Everything stays in sync -- the editor sees what you do on the phone and vice versa.

## Setup

### 1. Start the relay

```bash
npx acp-mobile-relay --port 8765
```

The relay prints the local and network URLs. Open the network URL on your phone.

### 2. Configure your editor

Point your editor at the relay instead of the agent directly. In Zed's `settings.json`:

```json
{
  "agent_servers": {
    "Claude (Mobile)": {
      "type": "custom",
      "command": "npx",
      "args": ["acp-mobile-relay", "--agent", "npx @agentclientprotocol/claude-agent-acp"]
    }
  }
}
```

When you start a session, the editor subprocess connects to the running relay daemon. If the daemon isn't running, it exits with an error.

### 3. Open on your phone

Navigate to the network URL on your phone's browser. You'll see the session picker showing active sessions grouped by project and branch.

## Features

- **Editor-agnostic**: Works with any ACP client (Zed, JetBrains, Neovim, VS Code)
- **Agent-agnostic**: Works with any ACP agent (Claude Code, Gemini CLI, Codex, OpenCode, etc.)
- **Session grouping**: Sessions are grouped by git repository and branch
- **Real-time mirroring**: Both the editor and the phone see the same session state
- **Mobile-first web UI**: Optimized for phone screens
- **Prompt from anywhere**: Send prompts from the phone; they appear in the editor too
- **Multi-editor support**: Sessions from all editors appear in one mobile UI
- **No account required**: Everything runs locally, no cloud service involved

## Network Access

**Same WiFi** (simplest): The relay binds to all interfaces by default and your phone connects directly.

**Remote access**: Use [Tailscale](https://tailscale.com/), a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or an SSH tunnel to access the relay from anywhere.

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--agent <cmd>` | | Connect to relay daemon and spawn this agent (editor subprocess mode) |
| `--port <port>` | `8765` | HTTP/WebSocket server port (server mode) |
| `--host <addr>` | `0.0.0.0` | Bind address (server mode) |
| `--version` | | Print version |
| `--help` | | Print help |

**Server mode** (no `--agent`): Starts the relay daemon with HTTP/WS server.
**Connect mode** (`--agent <cmd>`): Connects to a running daemon, spawns the agent, pipes stdio.

## Development

```bash
npm install
npm run build
npm test
npm run dev    # watch mode
```

## License

MIT
