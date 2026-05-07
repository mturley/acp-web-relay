# Tasks: ACP Relay Proxy

**Input**: Design documents from `specs/001-acp-relay-proxy/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Tests are included for critical paths (proxy forwarding, WebSocket broadcast, prompt injection, daemon IPC) per constitution principle IV (Test-First).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Phase 1: Setup

**Purpose**: Project initialization and basic structure

- [x] T001 Initialize npm project with package.json (`npm init`), set `"type": "module"`, add `"bin": { "acp-mobile-relay": "./dist/cli.js" }`
- [x] T002 Install dev dependencies: typescript, vitest, @types/node, @types/ws
- [x] T003 Install runtime dependencies: ws, commander
- [x] T004 [P] Create tsconfig.json with strict mode, ES2022 target, NodeNext module resolution, outDir: dist/
- [x] T005 [P] Configure Vitest in vitest.config.ts
- [x] T006 [P] Add npm scripts: build, dev, test, start in package.json
- [x] T007 Create project directory structure per plan: src/, ui/session-picker/, tests/unit/, tests/integration/, tests/fixtures/

**Checkpoint**: Project builds and `npm test` runs (no tests yet)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T008 Define shared TypeScript types in src/types.ts (RelaySession, GitMeta, Message, EditorPipe, MobileClient, SessionStatus, MessageDirection per data-model.md)
- [x] T009 [P] Implement JSON-RPC 2.0 parser and validator in src/json-rpc.ts (parse newline-delimited messages, extract method/sessionId/id, construct responses and error objects)
- [x] T010 [P] Create test fixtures with sample ACP messages in tests/fixtures/acp-messages.ts (initialize, session/new, session/prompt, session/update variants, session/cancel, $/ping)
- [x] T011 [P] Write unit tests for JSON-RPC parser in tests/unit/json-rpc.test.ts (parse valid messages, reject invalid JSON, handle multi-line chunks, extract sessionId from params)
- [x] T012 Implement CLI entry point in src/cli.ts using commander: parse --agent, --port, --host, --daemon, --version, --help flags per contracts/cli.md
- [x] T013 Implement startup security warning in src/cli.ts: when bind address is not localhost (127.0.0.1 or ::1), display a warning explaining that session data (source code, credentials) will be accessible to other devices on the network, prompt the user to confirm before proceeding, and include instructions for using `--host 127.0.0.1` to restrict access. Skip the prompt if stdin is not a TTY (e.g., when launched as an editor subprocess).

**Checkpoint**: Foundation ready — JSON-RPC parsing works, types defined, CLI parses arguments with security warning

---

## Phase 3: User Story 1 — Monitor Agent Session from Phone (Priority: P1) 🎯 MVP

**Goal**: Transparent stdio proxy between editor and agent, with real-time WebSocket broadcast to mobile clients

**Independent Test**: Start an agent session from the editor, open the relay web UI on a phone, verify all agent activity appears in real time

### Tests for User Story 1

- [x] T014 [P] [US1] Write integration test for stdio proxy forwarding in tests/integration/stdio-proxy.test.ts (verify all messages pass through unmodified between mock editor stdin/stdout and mock agent process)
- [x] T015 [P] [US1] Write integration test for WebSocket broadcast in tests/integration/ws-broadcast.test.ts (verify agent→editor messages are also sent to connected WebSocket clients)

### Implementation for User Story 1

- [x] T016 [US1] Implement agent spawner in src/agent-spawner.ts (spawn child process from --agent command, pipe stdin/stdout, handle exit/error events, forward stderr to relay stderr)
- [x] T017 [US1] Implement stdio proxy in src/stdio-proxy.ts (read NDJSON from process.stdin, forward to agent stdin; read agent stdout, forward to process.stdout; use readline for line-based parsing; call message observer callback for each message in both directions)
- [x] T018 [US1] Implement session manager in src/session-manager.ts (track sessions by ID, update status on session/new response, session/prompt, session/update, stopReason; maintain in-memory message buffer per session; expose session list with status)
- [x] T019 [US1] Write unit tests for session manager in tests/unit/session-manager.test.ts (create session on session/new, track status transitions idle→working→idle, buffer messages, replay buffered messages)
- [x] T020 [US1] Implement WebSocket server in src/ws-server.ts (create ws.WebSocketServer, accept connections, handle initialize request with relay capabilities response, handle session/list by querying session manager, handle session/load by replaying buffered messages, broadcast session/update notifications to all connected clients, send $/ping heartbeat every 25 seconds)
- [x] T021 [US1] Implement HTTP server in src/http-server.ts (serve session picker page at /, serve ACP UI static files at /ui/*, upgrade /ws requests to WebSocket, bind to --host and --port, print local network URL on startup)
- [x] T022 [US1] Create session picker HTML page in ui/session-picker/index.html (mobile-friendly responsive layout, connect to relay WebSocket, call session/list, display sessions grouped by repo/branch, show session title/status/last activity, link each session to /ui/?session=<sessionId>)
- [x] T023 [US1] Style session picker in ui/session-picker/style.css (mobile-first responsive design, status indicators for idle/working/waiting, group headers for repo/branch)
- [x] T024 [US1] Implement session picker JavaScript in ui/session-picker/script.js (WebSocket connection to relay, initialize handshake, session/list request, DOM rendering, auto-refresh on session/update notifications, empty state when no sessions)
- [x] T025 [US1] Implement relay orchestrator in src/relay.ts (wire together cli args → agent-spawner → stdio-proxy → session-manager → ws-server → http-server; register message observer that feeds session-manager and broadcasts to ws-server; handle graceful shutdown on SIGINT/SIGTERM)
- [x] T026 [US1] Integrate ACP UI web build into ui/acp-ui/ (add @anthropic-ai/acp-ui or vendor the built web assets, configure http-server to serve them at /ui/*)

**Checkpoint**: User Story 1 fully functional — editor↔agent proxy works, phone sees live sessions and streaming updates

---

## Phase 4: User Story 2 — Send Prompts from Phone (Priority: P2)

**Goal**: Mobile clients can send prompts to the agent; both phone and editor see the response

**Independent Test**: With an active session on the phone, send a prompt and verify both phone and editor display the response

### Tests for User Story 2

- [x] T027 [P] [US2] Write unit tests for prompt queue in tests/unit/prompt-queue.test.ts (accept prompt when idle, reject when busy, queue synthetic prompt, release queued prompt after synthetic completes)

### Implementation for User Story 2

- [x] T028 [US2] Implement prompt queue in src/prompt-queue.ts (track per-session prompt state: idle/busy; reject mobile prompts when busy with error code -32000; queue user's first prompt behind synthetic URL prompt; release queue on stopReason end_turn)
- [x] T029 [US2] Add synthetic URL prompt injection to src/relay.ts (on session/new response, send synthetic prompt to agent: "This session is using acp-mobile-relay and I can access it from another device at http://<host>:<port>. Repeat that URL to me."; queue any real prompt until synthetic completes)
- [x] T030 [US2] Add session/prompt handling to src/ws-server.ts (receive prompt from WebSocket client, validate session exists and is idle via prompt-queue, forward to agent via stdio-proxy, broadcast resulting session/update notifications to all clients including the editor)
- [x] T031 [US2] Forward mobile-originated session/update notifications to editor stdout in src/stdio-proxy.ts (when agent responds to a mobile prompt, the editor must see the updates too)

**Checkpoint**: User Stories 1 AND 2 work — phone can send prompts, editor and phone both see responses

---

## Phase 5: User Story 3 — Browse and Select Sessions (Priority: P3)

**Goal**: Session picker groups multiple sessions by git repo and branch

**Independent Test**: Start sessions in different project directories, verify the session picker groups them correctly

### Implementation for User Story 3

- [x] T032 [P] [US3] Implement git metadata extraction in src/git-meta.ts (given a cwd, run `git rev-parse --show-toplevel`, `git rev-parse --abbrev-ref HEAD`, `git config --get remote.origin.url`; parse repo name from remote URL or directory name; return GitMeta object; handle non-git directories gracefully)
- [x] T033 [P] [US3] Write unit tests for git metadata extraction in tests/unit/git-meta.test.ts (extract from valid git repo, handle missing remote, handle non-git directory, parse repo name from various remote URL formats)
- [x] T034 [US3] Integrate git metadata into session manager in src/session-manager.ts (on session/new, extract cwd from params, call git-meta, attach GitMeta to RelaySession; include _meta.relay.git in session/list responses)
- [x] T035 [US3] Update session picker to group by repo/branch in ui/session-picker/script.js (group sessions by gitMeta.repoName, show branch as subgroup, sort by updatedAt within groups)

**Checkpoint**: All sessions grouped by repo and branch in the session picker

---

## Phase 6: User Story 4 — Cancel Agent Operation from Phone (Priority: P4)

**Goal**: Mobile client can cancel an active agent prompt

**Independent Test**: With agent actively processing, tap cancel on phone, verify agent stops and both sides reflect it

### Implementation for User Story 4

- [x] T036 [US4] Add session/cancel handling to src/ws-server.ts (receive cancel from WebSocket client, forward as session/cancel notification to agent via stdio-proxy, update session status to idle)
- [x] T037 [US4] Update session picker to show cancel button in ui/session-picker/script.js (show cancel button when session status is working, disable when idle, send session/cancel on tap)

**Checkpoint**: Cancel works from phone — agent stops, both phone and editor show cancelled state

---

## Phase 7: User Story 5 — Daemon Mode (Priority: P5)

**Goal**: Optional persistent relay that aggregates sessions from multiple editor subprocesses

**Independent Test**: Start daemon, open two editors, verify sessions from both appear in the session picker; close one editor, verify other sessions remain

### Tests for User Story 5

- [x] T038 [P] [US5] Write integration test for daemon IPC in tests/integration/daemon-ipc.test.ts (daemon accepts socket connections, subprocess pipes stdin/stdout through socket, daemon cleans up on disconnect)

### Implementation for User Story 5

- [x] T039 [US5] Implement daemon IPC server in src/daemon.ts (create net.createServer on Unix socket ~/.acp-mobile-relay/daemon.sock or Windows named pipe; accept connections from editor subprocesses; track connected pipes as EditorPipe entities; spawn agent process per connected pipe; clean up sessions when pipe disconnects)
- [x] T040 [US5] Implement daemon IPC client in src/daemon.ts (on subprocess startup without --daemon, try net.createConnection to daemon socket; if connected, pipe process.stdin→socket and socket→process.stdout; if ENOENT/ECONNREFUSED, fall back to standalone subprocess mode)
- [x] T041 [US5] Integrate daemon mode into relay orchestrator in src/relay.ts (if --daemon flag, start daemon server + HTTP/WS server without spawning agent; if no --daemon, try daemon client first, fall back to standalone; wire daemon pipe sessions into session manager)
- [x] T042 [US5] Handle daemon shutdown gracefully in src/daemon.ts (on daemon exit, connected subprocesses continue as direct stdio passthroughs to their agent processes — degraded mode with no mobile UI)

**Checkpoint**: Daemon mode works — multiple editors feed into one relay, sessions aggregate in mobile UI

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T043 [P] Add .gitignore entries for node_modules/, dist/, *.tsbuildinfo
- [x] T044 [P] Write README.md setup instructions pointing to quickstart.md patterns (editor config examples for Zed, JetBrains, VS Code)
- [x] T045 [P] Add error handling for agent process crash in src/agent-spawner.ts (detect unexpected exit, notify connected mobile clients, update session status)
- [x] T046 [P] Add reconnection handling in src/ws-server.ts (mobile client disconnect → clean up; reconnect → re-initialize + session/load with buffered replay)
- [ ] T047 Run quickstart.md verification checklist end-to-end

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Foundational — this is the MVP
- **US2 (Phase 4)**: Depends on US1 (needs stdio proxy and ws-server)
- **US3 (Phase 5)**: Depends on US1 (needs session manager and session picker)
- **US4 (Phase 6)**: Depends on US1 (needs ws-server and stdio proxy)
- **US5 (Phase 7)**: Depends on US1 (needs relay orchestrator); can run in parallel with US2-US4
- **Polish (Phase 8)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational (Phase 2) — No dependencies on other stories
- **US2 (P2)**: Requires US1 complete (needs stdio-proxy and ws-server to forward prompts)
- **US3 (P3)**: Requires US1 complete (needs session-manager and session picker) — Can run in parallel with US2
- **US4 (P4)**: Requires US1 complete (needs ws-server cancel forwarding) — Can run in parallel with US2 and US3
- **US5 (P5)**: Requires US1 complete (needs relay orchestrator as base) — Can run in parallel with US2-US4

### Within Each User Story

- Tests written and FAIL before implementation
- Types/models before services
- Services before servers/UI
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- T004, T005, T006 (Setup config files)
- T009, T010, T011 (Foundational: parser + fixtures + tests)
- T014, T015 (US1 tests)
- T032, T033 (US3: git-meta + tests)
- T043, T044, T045, T046 (Polish tasks)
- US3, US4, US5 can run in parallel after US1 completes

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test US1 independently — editor↔agent proxy works, phone sees live updates
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 → Test independently → MVP! (monitor from phone)
3. US2 → Test independently → Can send prompts from phone
4. US3 → Test independently → Multi-session with git grouping
5. US4 → Test independently → Cancel from phone
6. US5 → Test independently → Daemon mode for multi-editor
7. Polish → Error handling, docs, reconnection

### Parallel Team Strategy

After US1 completes, US2-US5 can proceed in parallel:
- US2 (prompting) is the highest value add after monitoring
- US3 (session grouping) and US4 (cancel) are independent of each other
- US5 (daemon) is independent but adds the most architectural complexity

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
