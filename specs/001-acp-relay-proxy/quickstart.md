# Quickstart: acp-web-relay

## Prerequisites

- Node.js 18+ installed
- An ACP-compatible editor (Zed, JetBrains, VS Code, Neovim)
- An ACP agent installed (e.g., `npx @agentclientprotocol/claude-agent-acp`)
- A browser on the same network as your development machine

## Setup (2 minutes)

### 1. Start the relay

```bash
npx acp-web-relay serve --port 8765
```

The relay prints URLs for local and network access. Keep this running.

### 2. Configure your editor

Add the relay as a custom agent. In Zed's `settings.json`:

```json
{
  "agent_servers": {
    "Claude (Web Relay)": {
      "type": "custom",
      "command": "npx",
      "args": [
        "acp-web-relay",
        "agent", "npx @agentclientprotocol/claude-agent-acp"
      ]
    }
  }
}
```

### 3. Start an agent session

Open the agent panel in your editor and start a new conversation.

### 4. Open in a browser

Navigate to the network URL (shown when you started the relay)
in any browser. You'll see the session picker showing your
active sessions grouped by project and branch. Tap a session
to view it.

## Verification

- [ ] Relay starts and prints URLs
- [ ] Agent session starts normally in the editor
- [ ] Browser can open the URL and see the session picker
- [ ] Session shows with first prompt as title
- [ ] Tapping a session shows the live conversation
- [ ] Typing a prompt in the browser sends it to the agent
- [ ] Both browser and editor see the agent's response
- [ ] Cancelling from the browser stops the agent

## Troubleshooting

**"No acp-web-relay daemon is running"?**
- Start the relay first: `npx acp-web-relay serve --port 8765`

**Can't reach the URL?**
- Verify the browser device and computer are on the same network
- Check firewall isn't blocking the port
- Try `--host 0.0.0.0` explicitly (though this is the default)

**Agent doesn't start?**
- Verify the agent command works directly: `npx @agentclientprotocol/claude-agent-acp`
- Check stderr output in the editor's agent logs

**Port already in use?**
- Another relay instance may be running
- Use a different port: `--port 8766`
