# Quickstart: acp-mobile-relay

## Prerequisites

- Node.js 18+ installed
- An ACP-compatible editor (Zed, JetBrains, VS Code, Neovim)
- An ACP agent installed (e.g., `npx @zed-industries/claude-code-acp`)
- Phone on the same WiFi network as your development machine

## Setup (2 minutes)

### 1. Configure your editor

Add the relay as a custom agent. In Zed's `settings.json`:

```json
{
  "agent_servers": {
    "Claude (Mobile)": {
      "type": "custom",
      "command": "npx",
      "args": [
        "acp-mobile-relay",
        "--port", "8765",
        "--agent", "npx @zed-industries/claude-code-acp"
      ]
    }
  }
}
```

### 2. Start an agent session

Open the agent panel in your editor and start a new conversation.
The agent's first message will include the relay URL:

> This session is using acp-mobile-relay. You can access it from
> another device at **http://192.168.1.42:8765**.

### 3. Open on your phone

Navigate to the URL on your phone's browser. You'll see the
session picker showing your active sessions grouped by project
and branch. Tap a session to view it.

## Daemon Mode (optional)

For persistent relay across multiple editors:

```bash
# Start the daemon in a terminal
npx acp-mobile-relay --daemon --port 8765
```

Then configure each editor to use the relay as above. Sessions
from all editors appear in the same mobile UI.

## Verification

- [ ] Agent session starts normally in the editor
- [ ] First agent message includes the relay URL
- [ ] Phone can open the URL and see the session picker
- [ ] Tapping a session shows the live conversation
- [ ] Typing a prompt on the phone sends it to the agent
- [ ] Both phone and editor see the agent's response
- [ ] Cancelling from the phone stops the agent

## Troubleshooting

**Can't reach the URL from phone?**
- Verify phone and computer are on the same WiFi network
- Check firewall isn't blocking the port
- Try `--host 0.0.0.0` explicitly (though this is the default)

**Agent doesn't start?**
- Verify the agent command works directly: `npx @zed-industries/claude-code-acp`
- Check stderr output in the editor's agent logs

**Port already in use?**
- Another relay instance may be running
- Use a different port: `--port 8766`
- Or use daemon mode to share one server
