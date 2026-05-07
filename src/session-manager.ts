import type {
  RelaySession,
  Message,
  MessageDirection,
  SessionStatus,
  GitMeta,
  JsonRpcMessage,
} from "./types.js";
import { isRequest, isResponse, extractMethod, extractSessionId } from "./json-rpc.js";

export class SessionManager {
  private sessions = new Map<string, RelaySession>();
  private messageCounter = new Map<string, number>();
  private pendingNewRequests = new Map<number | string, string>();

  createSession(
    sessionId: string,
    cwd: string,
    sourceId: string,
    gitMeta: GitMeta | null = null,
  ): RelaySession {
    const now = new Date().toISOString();
    const session: RelaySession = {
      sessionId,
      cwd,
      title: null,
      status: "idle",
      gitMeta,
      messages: [],
      createdAt: now,
      updatedAt: now,
      promptPending: false,
      lastPrompt: null,
      archived: false,
      sourceId,
    };
    this.sessions.set(sessionId, session);
    this.messageCounter.set(sessionId, 0);
    return session;
  }

  getSession(sessionId: string): RelaySession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): RelaySession[] {
    return Array.from(this.sessions.values());
  }

  removeSessionsBySource(sourceId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.sourceId === sourceId) {
        this.sessions.delete(id);
        this.messageCounter.delete(id);
      }
    }
  }

  bufferMessage(
    sessionId: string,
    raw: string,
    direction: MessageDirection,
    parsed: JsonRpcMessage,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const counter = (this.messageCounter.get(sessionId) ?? 0) + 1;
    this.messageCounter.set(sessionId, counter);

    const message: Message = {
      id: counter,
      direction,
      timestamp: new Date().toISOString(),
      raw,
      method: extractMethod(parsed),
      sessionId: extractSessionId(parsed),
    };

    session.messages.push(message);
    session.updatedAt = message.timestamp;
  }

  processMessage(raw: string, direction: MessageDirection, parsed: JsonRpcMessage, sourceId: string = "default"): void {
    const method = extractMethod(parsed);
    const sessionId = extractSessionId(parsed);

    if (method === "session/new" && isRequest(parsed)) {
      const req = parsed as { id?: number | string; params?: Record<string, unknown> };
      if (req.id !== undefined && req.params?.cwd) {
        this.pendingNewRequests.set(req.id, req.params.cwd as string);
      }
    }

    if (isResponse(parsed) && sessionId) {
      const resp = parsed as { id: number | string };
      const cwd = this.pendingNewRequests.get(resp.id) ?? "";
      if (this.pendingNewRequests.has(resp.id)) {
        this.pendingNewRequests.delete(resp.id);
        this.createSession(sessionId, cwd, sourceId);
      }
    }

    if (sessionId) {
      this.bufferMessage(sessionId, raw, direction, parsed);
      this.updateStatus(sessionId, method, parsed);
    }
  }

  private updateStatus(
    sessionId: string,
    method: string | null,
    parsed: JsonRpcMessage,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (method === "session/prompt") {
      session.status = "working";
      session.promptPending = true;
      if (isRequest(parsed)) {
        const promptText = this.extractPromptText(parsed);
        if (promptText) {
          if (!session.title) {
            session.title = promptText.length > 60 ? promptText.slice(0, 60) + "…" : promptText;
          }
          session.lastPrompt = promptText.length > 60 ? promptText.slice(0, 60) + "…" : promptText;
        }
      }
    } else if (method === "session/update" && isRequest(parsed)) {
      const params = parsed.params as Record<string, unknown> | undefined;
      if (params?.stopReason === "end_turn" || params?.type === "agent_message_end") {
        session.status = "idle";
        session.promptPending = false;
      }
    } else if (method === "session/cancel") {
      session.status = "idle";
      session.promptPending = false;
    }
  }

  private extractPromptText(parsed: JsonRpcMessage): string | null {
    const params = (parsed as { params?: Record<string, unknown> }).params;
    const prompt = params?.prompt;
    if (Array.isArray(prompt)) {
      const textPart = prompt.find(
        (p: any) => typeof p === "object" && p.type === "text" && typeof p.text === "string",
      );
      if (textPart) return (textPart as { text: string }).text;
    }
    return null;
  }

  archiveSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.archived = true;
    }
  }

  setGitMeta(sessionId: string, gitMeta: GitMeta): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.gitMeta = gitMeta;
    }
  }

  getSessionList(): Array<{
    sessionId: string;
    cwd: string;
    title: string | null;
    lastPrompt: string | null;
    updatedAt: string;
    archived: boolean;
    _meta: { relay: { status: SessionStatus; git: GitMeta | null } };
  }> {
    return this.getAllSessions().map((s) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      title: s.title,
      lastPrompt: s.lastPrompt,
      updatedAt: s.updatedAt,
      archived: s.archived,
      _meta: {
        relay: {
          status: s.status,
          git: s.gitMeta,
        },
      },
    }));
  }

  getBufferedMessages(sessionId: string): Message[] {
    return this.sessions.get(sessionId)?.messages ?? [];
  }
}
