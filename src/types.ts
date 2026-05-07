import type { ChildProcess } from "node:child_process";
import type { Socket } from "node:net";
import type { WebSocket } from "ws";

export type SessionStatus = "idle" | "working" | "waiting";
export type MessageDirection =
  | "editor→agent"
  | "agent→editor"
  | "mobile→agent";

export interface GitMeta {
  repoName: string;
  branch: string;
  remoteUrl: string | null;
}

export interface Message {
  id: number;
  direction: MessageDirection;
  timestamp: string;
  raw: string;
  method: string | null;
  sessionId: string | null;
}

export interface RelaySession {
  sessionId: string;
  cwd: string;
  title: string | null;
  status: SessionStatus;
  gitMeta: GitMeta | null;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  promptPending: boolean;
  sourceId: string;
}

export interface EditorPipe {
  id: string;
  socket: Socket;
  agentProc: ChildProcess;
  sessions: Set<string>;
  connectedAt: string;
}

export interface MobileClient {
  id: string;
  ws: WebSocket;
  connectedAt: string;
}

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;
