# Zed Remote Android

An Android app that acts as a client for [Zed](https://zed.dev/)'s remote development server, focused on exposing AI agent thread views from a mobile device.

## Goal

Zed supports [remote development](https://zed.dev/docs/remote-development) where a local Zed editor connects to a remote server over SSH. The remote server (installed at `~/.zed_server`) handles source code, language servers, tasks, and terminal sessions, while the local client handles UI, syntax highlighting, and unsaved change persistence.

Currently, the only client for Zed's remote development server is the Zed desktop editor itself. This project aims to reverse-engineer the protocol between the Zed client and its remote server and build an alternative Android client.

The initial focus is on **agent thread views** rather than a full file editor. The goal is to monitor, interact with, and manage AI agent threads running in a remote Zed instance from an Android device -- making it possible to supervise and steer agent work on the go without needing the full desktop editor.

## Architecture

Zed's remote development architecture:

- **Transport**: SSH with ControlMaster connection multiplexing
- **Remote server**: Runs in "proxy mode" -- starts a daemon if not running, reconnects if it is
- **Server binary**: Located at `~/.zed_server` on the remote host
- **Client responsibilities**: UI rendering, Tree-sitter parsing, syntax highlighting, local persistence of unsaved changes
- **Server responsibilities**: Source code access, language servers, task execution, terminal sessions

This project will need to:

1. Understand the wire protocol between the Zed client and `~/.zed_server`
2. Implement an SSH transport layer on Android
3. Build a mobile UI focused on agent thread interaction (file editing may come later)
4. Handle reconnection and local persistence of unsaved state

## Status

Early exploration -- currently researching the Zed remote development protocol.

## License

TBD
