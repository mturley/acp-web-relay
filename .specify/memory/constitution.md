<!--
  Sync Impact Report
  Version change: 1.0.0 → 1.1.0
  Modified principles:
    - I. Transparent Proxy — added explicit exception for synthetic URL prompt (FR-015)
    - V. Security by Default — changed from "localhost default" to "0.0.0.0 default
      with informed consent prompt at startup"; added user warning requirement
  Templates requiring updates:
    - .specify/templates/plan-template.md ✅ no changes needed (generic)
    - .specify/templates/spec-template.md ✅ no changes needed (generic)
    - .specify/templates/tasks-template.md ✅ no changes needed (generic)
  Follow-up TODOs: none
-->

# acp-mobile-relay Constitution

## Core Principles

### I. Transparent Proxy

The relay MUST be invisible to both the editor and the ACP agent.
All ACP messages between editor and agent pass through unmodified.
Neither side may detect the relay's presence through protocol
behavior. The relay is an observer and broadcaster, not a
participant in the ACP conversation.

**Exception**: The relay sends a synthetic prompt on each new
session to inform the user of the mobile URL (FR-015). This is
the sole permitted modification to the ACP message stream. It
is phrased as the user's own statement so it reads naturally in
the conversation.

**Rationale**: Transparency is the fundamental value proposition.
If the relay alters behavior, it becomes a liability rather than
a tool. Editors and agents evolve independently; the relay MUST
NOT couple to their internal assumptions.

### II. Protocol Fidelity

The relay MUST implement ACP JSON-RPC 2.0 exactly as specified.
WebSocket clients MUST receive the same message formats as the
stdio client. No proprietary extensions to ACP messages are
permitted; relay-specific metadata (git repo, branch, session
state) MUST use the `_meta` field or out-of-band channels.

**Rationale**: ACP UI and other third-party clients expect
standard ACP. Deviating from the protocol breaks compatibility
and forces us to maintain forks of upstream tools.

### III. Simplicity & Scope Discipline

The relay is a proxy and session picker, not a full IDE. We MUST
NOT rebuild functionality that ACP UI or other clients already
provide (chat rendering, markdown, tool call visualization). New
features MUST justify their complexity against the alternative of
deferring to an upstream project. When in doubt, leave it out.

**Rationale**: The relay's value is in bridging stdio to
WebSocket and adding session awareness. Scope creep into UI
features would duplicate ACP UI and create an unsustainable
maintenance burden for a single-developer project.

### IV. Test-First

All non-trivial relay logic MUST have tests written before
implementation. The proxy message forwarding path, WebSocket
broadcast, and prompt injection logic are critical paths that
MUST have integration tests verifying end-to-end behavior.
Unit tests are appropriate for utilities and parsers.

**Rationale**: The relay sits in the critical path between an
editor and an AI agent. Silent message corruption or dropped
messages would be difficult to diagnose. Tests catch regressions
before users encounter them.

### V. Security by Default

The relay MUST NOT expose session data to the network without
the user's informed consent. The default bind address is
`0.0.0.0` (all interfaces) because the primary use case
requires phone access over the local network. However, on
first startup, the relay MUST display a clear warning
explaining that session data (which may include source code,
credentials, and other sensitive content) will be accessible
to any device on the network, and MUST prompt the user to
confirm before proceeding. The warning MUST include
instructions for restricting access via `--host 127.0.0.1`.
WebSocket connections SHOULD require an auth token in a
future release. No user data may be sent to external services.

**Rationale**: The relay handles AI agent sessions containing
sensitive data. Binding to all interfaces is necessary for
the core use case, but the user must understand the exposure.
Informed consent replaces forced restriction.

## Deployment & Distribution

The relay MUST be installable and runnable via `npx acp-mobile-relay`
with zero configuration beyond specifying the downstream agent
command. TypeScript compiled to JavaScript, distributed as an npm
package. No native dependencies that would prevent cross-platform
use on macOS, Linux, or Windows.

## Development Workflow

- TypeScript with strict mode enabled
- `ws` library for WebSocket server
- Node.js child_process for spawning the downstream ACP agent
- JSON-RPC message parsing with validation
- Commit messages follow conventional commits format
- PRs require passing CI before merge

## Governance

This constitution governs all design and implementation decisions
for acp-mobile-relay. Amendments require:

1. A documented rationale for the change
2. Review of impact on existing implementation
3. Version bump following semver (MAJOR for principle removals
   or redefinitions, MINOR for additions, PATCH for
   clarifications)
4. Update to the Sync Impact Report at the top of this file

All PRs and code reviews MUST verify compliance with these
principles. Complexity that violates a principle MUST be justified
in the PR description with a specific rationale for why the
principle does not apply.

**Version**: 1.1.0 | **Ratified**: 2026-05-06 | **Last Amended**: 2026-05-07
