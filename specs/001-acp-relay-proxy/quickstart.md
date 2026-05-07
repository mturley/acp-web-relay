# Quickstart: acp-mobile-relay

## Prerequisites

- Node.js 18+ installed
- An ACP-compatible editor (Zed, JetBrains, VS Code, Neovim)
- An ACP agent installed (e.g., `npx @agentclientprotocol/claude-agent-acp`)
- Phone on the same WiFi network as your development machine

## Setup (2 minutes)

### 1. Start the relay

```bash
npx acp-mobile-relay serve --port 8765
```

The relay prints URLs for local and network access. Keep this running.

### 2. Configure your editor

Add the relay as a custom agent. In Zed's `settings.json`:

```json
{
  "agent_servers": {
    "Claude (Mobile)": {
      "type": "custom",
      "command": "npx",
      "args": [
        "acp-mobile-relay",
        "agent", "npx @agentclientprotocol/claude-agent-acp"
      ]
    }
  }
}
```

### 3. Start an agent session

Open the agent panel in your editor and start a new conversation.

### 4. Open on your phone

Navigate to the network URL (shown when you started the relay)
on your phone's browser. You'll see the session picker showing
your active sessions grouped by project and branch. Tap a
session to view it.

## Verification

- [ ] Relay starts and prints URLs
- [ ] Agent session starts normally in the editor
- [ ] Phone can open the URL and see the session picker
- [ ] Session shows with first prompt as title
- [ ] Tapping a session shows the live conversation
- [ ] Typing a prompt on the phone sends it to the agent
- [ ] Both phone and editor see the agent's response
- [ ] Cancelling from the phone stops the agent

## Troubleshooting

**"No acp-mobile-relay daemon is running"?**
- Start the relay first: `npx acp-mobile-relay serve --port 8765`

**Can't reach the URL from phone?**
- Verify phone and computer are on the same WiFi network
- Check firewall isn't blocking the port
- Try `--host 0.0.0.0` explicitly (though this is the default)

**Agent doesn't start?**
- Verify the agent command works directly: `npx @agentclientprotocol/claude-agent-acp`
- Check stderr output in the editor's agent logs

**Port already in use?**
- Another relay instance may be running
- Use a different port: `--port 8766`
