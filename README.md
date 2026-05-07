# acp-mobile-relay

Monitor and control AI agent sessions from your phone.

A relay proxy that sits between your code editor and any [ACP](https://agentclientprotocol.com/)-compatible agent (Claude Code, Gemini CLI, Codex, etc.), exposing a mobile-friendly web interface over the network.

## How It Works

```
┌──────────┐  stdio  ┌───────────────┐  stdio  ┌──────────────────┐
│  Editor  │◄───────►│ acp-mobile-   │◄───────►│   ACP Agent      │
│ (Zed,    │         │    relay      │         │ (Claude Code,    │
│  IDEA,   │         │               │         │  Gemini CLI,     │
│  etc.)   │         │  ┌─────────┐  │         │  Codex, etc.)    │
└──────────┘         │  │ Mobile  │  │         └──────────────────┘
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

Your editor launches `acp-mobile-relay` as a subprocess instead of the agent directly. The relay:

1. **Proxies all ACP messages** transparently between editor and agent -- neither knows the relay is there
2. **Serves a mobile web UI** on a local port with a chat interface for viewing and interacting with agent sessions
3. **Broadcasts all updates** to both the editor and any connected mobile clients in real time
4. **Accepts prompts from mobile** and injects them into the agent session -- they appear in both the editor and the phone

## Use Case

You're working with an AI coding agent in your editor. You step away from your desk. On your phone, you open the relay's web UI and see all your active sessions grouped by project and branch. You can:

- Watch the agent work in real time (streaming text, tool calls, file edits)
- Send follow-up prompts from your phone
- Cancel a running operation
- Check on multiple sessions across different projects

Everything stays in sync -- the editor sees what you do on the phone and vice versa.

## Setup

Configure the relay as a custom agent in your editor. For example, in Zed's `settings.json`:

```json
{
  "agent_servers": {
    "Claude (Mobile)": {
      "type": "custom",
      "command": "npx",
      "args": ["acp-mobile-relay", "--port", "8765", "--agent", "npx @agentclientprotocol/claude-agent-acp"]
    }
  }
}
```

Then open `http://your-machine:8765` on your phone.

## Features

- **Editor-agnostic**: Works with any ACP client (Zed, JetBrains, Neovim, VS Code)
- **Agent-agnostic**: Works with any ACP agent (Claude Code, Gemini CLI, Codex, OpenCode, etc.)
- **Session grouping**: Sessions are grouped by git repository and branch, like in your editor's agent sidebar
- **Real-time mirroring**: Both the editor and the phone see the same session state
- **Mobile-first web UI**: Optimized for phone screens with markdown rendering, tool call visualization, and streaming support
- **Prompt from anywhere**: Send prompts from the phone; they appear in the editor too
- **No account required**: Everything runs locally on your machine, no cloud service involved

## Network Access

**Same WiFi** (simplest): The relay binds to your local network and your phone connects directly.

**Remote access**: Use [Tailscale](https://tailscale.com/), a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), or an SSH tunnel to access the relay from anywhere.

## Quick Start

See [quickstart.md](specs/001-acp-relay-proxy/quickstart.md) for detailed setup instructions including:

- Editor configuration examples (Zed, JetBrains, VS Code)
- Daemon mode for persistent multi-editor relay
- Verification checklist
- Troubleshooting tips

### Editor Configuration Examples

**JetBrains (IntelliJ, WebStorm, etc.)**:
Configure in Settings > Tools > AI Agent:
```
Command: npx acp-mobile-relay --port 8765 --agent "npx @agentclientprotocol/claude-agent-acp"
```

**VS Code**:
Add to `settings.json`:
```json
{
  "acp.agentCommand": "npx acp-mobile-relay --port 8765 --agent 'npx @agentclientprotocol/claude-agent-acp'"
}
```

### Daemon Mode

For a persistent relay across multiple editors:

```bash
npx acp-mobile-relay --daemon --port 8765
```

Then configure each editor as above. Sessions from all editors appear in the same mobile UI.

## CLI Options

| Flag | Default | Description |
|------|---------|-------------|
| `--agent <cmd>` | (required) | Command to spawn the downstream ACP agent |
| `--port <port>` | `8765` | HTTP/WebSocket server port |
| `--host <addr>` | `0.0.0.0` | Bind address |
| `--daemon` | `false` | Run in daemon mode |
| `--version` | | Print version |
| `--help` | | Print help |

## Development

```bash
npm install
npm run build
npm test
npm run dev    # watch mode
```

## License

MIT
