# Feature Specification: ACP Relay Proxy

**Feature Branch**: `001-acp-relay-proxy`
**Created**: 2026-05-06
**Status**: Draft
**Input**: User description: "Transparent ACP relay proxy with mobile web UI for monitoring and controlling AI agent sessions from a phone"

## Clarifications

### Session 2026-05-06

- Q: How should session history be handled when a phone connects mid-session or after relay restart? → A: In-memory buffer only during relay lifetime. The downstream agent handles long-term session persistence. On relay restart, re-discover sessions via `session/list`.
- Q: How should the relay deliver the chat UI to mobile clients? → A: Bundle ACP UI's web build into the relay's own HTTP server. Self-contained, no external hosting dependency.
- Q: What should the default network binding behavior be? → A: Bind to all interfaces (`0.0.0.0`) by default. Expose a `--host` flag to override (e.g., `--host 127.0.0.1` to restrict to localhost). Print the local network URL on startup.
- Q: Should prompts from the phone be attributed differently than prompts from the editor? → A: No attribution. Prompts are transparent regardless of origin.
- Q: Does one relay instance handle one session or many? → A: One relay per editor launch, handling all sessions. Zed spawns one agent subprocess and multiplexes sessions via `session/new`. The relay sees all sessions and exposes them to the mobile UI.
- Q: How does the user discover the relay URL? → A: On each new session, the relay sends a synthetic prompt to the agent (phrased as the user's own statement, e.g., "This session is using acp-mobile-relay and I can access it from another device at http://192.168.1.x:8765. Repeat that URL to me."). The agent naturally confirms the URL in its first response. The relay queues the user's real first prompt until the synthetic prompt completes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Monitor Agent Session from Phone (Priority: P1)

A developer is working with an AI coding agent in their editor. They step away from their desk. On their phone, they open the relay's web UI and see their active agent session. They can watch the agent work in real time — streaming text output, tool calls being made, files being edited — exactly as it would appear in the editor.

**Why this priority**: This is the core value proposition. Without real-time monitoring, the relay has no purpose. Every other feature builds on this foundation.

**Independent Test**: Start an agent session from the editor, open the relay's web UI on a phone, and verify that all agent activity (text streaming, tool calls, plan updates) appears on the phone in real time with no noticeable delay.

**Acceptance Scenarios**:

1. **Given** an active agent session in the editor, **When** the user opens the relay web UI on their phone, **Then** they see the current session with its full conversation history and live updates
2. **Given** an agent is streaming a response, **When** the user views the session on their phone, **Then** text chunks appear in real time as the agent produces them
3. **Given** an agent makes a tool call (file read, file edit, command execution), **When** the user views the session on their phone, **Then** they see the tool call name, status (pending/completed), and output
4. **Given** no agent sessions are active, **When** the user opens the relay web UI, **Then** they see an empty state indicating no active sessions
5. **Given** a new agent session is created, **When** the session starts, **Then** the agent's first message includes the relay's mobile URL so the user knows where to connect from their phone

---

### User Story 2 - Send Prompts from Phone (Priority: P2)

The developer is away from their desk and sees that the agent has finished its current task. From their phone, they type a follow-up prompt and send it. The agent processes the prompt normally, and both the phone and the editor see the streaming response. The editor shows the conversation as if the prompt had been typed there.

**Why this priority**: Monitoring alone is passive. The ability to send prompts transforms the relay from a viewer into a remote control, enabling productive work from anywhere.

**Independent Test**: With an active agent session visible on the phone, type and send a prompt. Verify the agent processes it and both the phone and editor display the response.

**Acceptance Scenarios**:

1. **Given** an active agent session that is idle (not mid-turn), **When** the user types a prompt on their phone and sends it, **Then** the agent receives the prompt, begins processing, and streams updates to both the phone and the editor
2. **Given** an agent is currently processing a prompt (mid-turn), **When** the user tries to send a prompt from the phone, **Then** the system prevents the prompt from being sent and informs the user that the agent is busy
3. **Given** a prompt was sent from the phone, **When** the editor user looks at the agent panel, **Then** the conversation includes the phone-originated prompt and the agent's response

---

### User Story 3 - Browse and Select Sessions (Priority: P3)

The developer has multiple agent sessions running across different projects and branches. On their phone, they open the relay web UI and see a session picker — a list of all active sessions grouped by git repository and branch. They tap a session to view it and interact with it.

**Why this priority**: Multi-session support is important for real-world usage where developers run agents across multiple projects, but a single-session experience is viable for an MVP.

**Independent Test**: Start agent sessions in two different project directories. Open the relay web UI and verify both sessions appear, grouped by their git repository and branch. Tap one to view it.

**Acceptance Scenarios**:

1. **Given** multiple agent sessions running in different project directories, **When** the user opens the relay web UI, **Then** they see a session list grouped by git repository name and branch
2. **Given** a session list is displayed, **When** the user taps a session, **Then** they are taken to the chat view for that session with its full history and live updates
3. **Given** a session has a title (from the agent's conversation), **When** the session list is displayed, **Then** each session shows its title, last activity time, and current status (idle, working, waiting for input)

---

### User Story 4 - Cancel Agent Operation from Phone (Priority: P4)

The developer sees the agent doing something unexpected or taking too long. From their phone, they cancel the current operation. The agent stops, and both the phone and editor reflect the cancelled state.

**Why this priority**: Cancellation is a safety valve. Without it, the user must physically return to their desk to stop a runaway agent. Important but less frequently used than monitoring or prompting.

**Independent Test**: With an agent actively processing a prompt, tap the cancel button on the phone. Verify the agent stops and both phone and editor show the cancelled state.

**Acceptance Scenarios**:

1. **Given** an agent is actively processing a prompt, **When** the user taps the cancel button on their phone, **Then** the agent stops processing and both the phone and editor show that the operation was cancelled
2. **Given** an agent is idle (not processing), **When** the user views the session, **Then** the cancel button is not available or is disabled

---

### User Story 5 - Daemon Mode for Multi-Editor Aggregation (Priority: P5)

The developer wants their relay running persistently, independent of any single editor. They start the relay daemon in a terminal before opening their editor. When they open Zed (or multiple editors), each editor's agent sessions automatically appear in the relay's mobile UI. If they close one editor, the other editors' sessions remain visible. The relay outlives any individual editor session.

**Why this priority**: Subprocess mode (where the editor spawns the relay) is sufficient for single-editor use. Daemon mode solves the multi-editor problem (Zed + JetBrains, multiple Zed windows) and avoids port conflicts from multiple relay instances. It also gives the user a clear place to see the relay URL (the terminal where they started it). However, it requires a registration mechanism for editor subprocesses to connect to the running daemon, adding architectural complexity.

**Independent Test**: Start the relay daemon in a terminal. Open two different editors configured to use the relay. Create agent sessions in each. Open the mobile UI and verify sessions from both editors appear in the session picker. Close one editor and verify the other editor's sessions remain.

**Acceptance Scenarios**:

1. **Given** the relay daemon is running, **When** an editor launches an agent subprocess configured to use the relay, **Then** the subprocess detects the running daemon and registers its stdio pipe with it instead of starting a new server
2. **Given** multiple editors have registered with the daemon, **When** the user opens the mobile UI, **Then** they see sessions from all connected editors in the session picker
3. **Given** an editor closes while the daemon is running, **When** the user views the mobile UI, **Then** that editor's sessions are removed but sessions from other editors remain
4. **Given** no daemon is running, **When** an editor launches the relay as a subprocess, **Then** the relay starts in subprocess mode as normal (backward compatible)

---

### Edge Cases

- What happens when the phone connects mid-session? The relay replays the in-memory message buffer so the phone receives the full conversation history accumulated since the relay started.
- What happens when the phone disconnects and reconnects? The phone MUST resynchronize with the current session state without duplicating messages.
- What happens when the editor closes while the phone is connected? The phone MUST be informed that the session has ended.
- What happens when multiple phones connect to the same relay? All connected phones MUST see the same session state and updates.
- What happens when the phone and editor send prompts simultaneously? The relay MUST prevent concurrent prompts to the same session (the agent supports only one prompt at a time).
- What happens if the user types a prompt before the synthetic URL prompt finishes? The relay queues it and sends it after the synthetic prompt completes.
- What happens when the relay restarts? The relay re-discovers sessions via `session/list` from the agent. In-memory message history from before the restart is lost; the phone sees sessions but not prior conversation content until the agent provides it.
- What happens when two editors try to start the relay on the same port without daemon mode? The second subprocess MUST detect the port conflict and either register with the existing relay (if it supports it) or fail with a clear error message suggesting daemon mode.
- What happens when the daemon is stopped while editors are still connected? The editor subprocesses MUST continue functioning as direct agent proxies (degraded mode — mobile UI unavailable but editor↔agent communication uninterrupted).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The relay MUST forward all messages between the editor and agent without modification (transparent proxy)
- **FR-002**: The relay MUST broadcast all agent-to-editor messages to connected mobile clients in real time
- **FR-003**: The relay MUST bundle and serve a mobile-friendly web interface (ACP UI web build + session picker) from its own HTTP server
- **FR-004**: The relay MUST accept prompts from mobile clients and forward them to the agent without source attribution
- **FR-005**: The relay MUST prevent concurrent prompts to the same session (queue or reject when the agent is mid-turn)
- **FR-006**: The relay MUST support cancelling an active agent operation from a mobile client
- **FR-007**: The relay MUST track session state (idle, working, waiting for input) and expose it to mobile clients
- **FR-008**: The relay MUST maintain an in-memory buffer of session messages and replay them to mobile clients that connect mid-session
- **FR-009**: The relay MUST enrich session metadata with git repository name, branch, and working directory
- **FR-010**: The relay MUST group sessions by git repository and branch in the session picker
- **FR-011**: The relay MUST be launchable as a single command with zero mandatory configuration beyond specifying the downstream agent command
- **FR-012**: The relay MUST bind to all network interfaces (`0.0.0.0`) by default and expose a `--host` flag to override the bind address. On first startup with a non-localhost bind address, the relay MUST display a warning explaining that session data will be accessible to other devices on the network (which may include source code and credentials), and MUST prompt the user to confirm before proceeding. The warning MUST include instructions for using `--host 127.0.0.1` to restrict access to localhost only
- **FR-013**: The relay MUST handle all sessions multiplexed by the downstream agent within a single process (one relay per editor launch)
- **FR-014**: The relay MUST print the local network URL on startup so users can find it easily
- **FR-015**: On each new session, the relay MUST send a synthetic prompt to the agent that includes the relay's mobile URL, phrased as the user's own statement (e.g., "This session is using acp-mobile-relay and I can access it from another device at http://192.168.1.x:8765. Repeat that URL to me."), so the agent confirms the URL in its first response
- **FR-016**: The relay MUST queue the user's real first prompt until the synthetic URL prompt completes (receives `stopReason: "end_turn"`)
- **FR-017**: The relay MUST support a daemon mode (`--daemon`) where it starts as a persistent server independent of any editor
- **FR-018**: When launched as an editor subprocess, the relay MUST detect if a daemon is already running on the configured port and register its stdio pipe with the daemon instead of starting a new server
- **FR-019**: When running in daemon mode, the relay MUST aggregate sessions from all connected editor subprocesses into a single mobile UI
- **FR-020**: When an editor disconnects from the daemon, the relay MUST remove that editor's sessions from the mobile UI while keeping other editors' sessions available

### Key Entities

- **Session**: An active agent conversation. Has a session ID, working directory, title, git metadata (repo name, branch), status (idle, working, waiting), and accumulated message history (in-memory buffer).
- **Message**: A single unit in the session conversation. Can be a user prompt, agent text chunk, tool call, tool call update, plan update, or other session update type.
- **Mobile Client**: A phone or tablet browser connected to the relay via the web interface. Multiple clients may be connected simultaneously.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can view real-time agent activity on their phone within 2 seconds of it occurring in the editor
- **SC-002**: Users can send a prompt from their phone and see the agent begin responding within 3 seconds
- **SC-003**: The relay adds less than 100 milliseconds of latency to message delivery between editor and agent
- **SC-004**: Users can install and start the relay with a single command, with the first mobile session viewable within 60 seconds of setup
- **SC-005**: The session picker correctly groups 5+ concurrent sessions by repository and branch
- **SC-006**: A phone connecting mid-session receives the full conversation history and can immediately follow along
- **SC-007**: The relay handles at least 3 concurrent mobile client connections without degradation

## Assumptions

- The user has a code editor that supports configuring custom ACP agents (Zed, JetBrains, VS Code, Neovim, etc.)
- The user's phone and development machine are on the same network (or connected via VPN/tunnel for remote access)
- In subprocess mode, the editor spawns one relay subprocess per agent type; the relay manages all sessions multiplexed by that agent process
- In daemon mode, the relay runs independently and multiple editor subprocesses register with it; the daemon aggregates all sessions
- The downstream ACP agent (Claude Code, Gemini CLI, etc.) handles session persistence — the relay maintains only an in-memory buffer for mid-session replay, not long-term storage
- The mobile chat interface is provided by a bundled build of ACP UI served from the relay's HTTP server
- The session picker (landing page) is the only custom UI the relay builds; the chat interface is ACP UI
- Authentication for mobile connections is out of scope for the initial release; the relay assumes trusted network access
- Prompts from mobile clients are not attributed — they appear identical to prompts from the editor
