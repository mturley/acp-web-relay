import type { RelaySession, Message, MessageDirection, SessionStatus, GitMeta, JsonRpcMessage } from "./types.js";
import { isRequest, isResponse, extractMethod, extractSessionId } from "./json-rpc.js";

const MAX_MESSAGES = parseInt(process.env.ACP_RELAY_MAX_MESSAGES ?? "2000", 10);

export class SessionManager {
  private sessions = new Map<string, RelaySession>();
  private messageCounter = new Map<string, number>();
  private pendingNewRequests = new Map<number | string, string>();
  private pendingPromptRequests = new Map<number | string, string>();

  createSession(sessionId: string, cwd: string, sourceId: string, gitMeta: GitMeta | null = null): RelaySession {
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
      hidden: false,
      sourceId,
    };
    this.sessions.set(sessionId, session);
    this.messageCounter.set(sessionId, 0);
    return session;
  }

  addSession(session: RelaySession): void {
    this.sessions.set(session.sessionId, session);
    const maxId = session.messages.reduce((max, m) => Math.max(max, m.id), 0);
    this.messageCounter.set(session.sessionId, maxId);
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

  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.messageCounter.delete(sessionId);
  }

  hideSessionsBySource(sourceId: string): RelaySession[] {
    const affected: RelaySession[] = [];
    for (const session of this.sessions.values()) {
      if (session.sourceId === sourceId) {
        session.hidden = true;
        affected.push(session);
      }
    }
    return affected;
  }

  bufferMessage(sessionId: string, raw: string, direction: MessageDirection, parsed: JsonRpcMessage): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const method = extractMethod(parsed);
    const now = new Date().toISOString();

    if (method === "session/request_permission") return;

    if (method === "session/prompt" && isRequest(parsed)) {
      const promptText = this.extractPromptText(parsed);
      if (promptText) {
        const userChunk = JSON.stringify({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: { sessionUpdate: "user_message_chunk", content: { type: "text", text: promptText } },
          },
        });
        const counter = (this.messageCounter.get(sessionId) ?? 0) + 1;
        this.messageCounter.set(sessionId, counter);
        session.messages.push({
          id: counter,
          direction,
          timestamp: now,
          raw: userChunk,
          method: "session/update",
          sessionId,
        });
        session.updatedAt = now;
      }
      return;
    }

    const counter = (this.messageCounter.get(sessionId) ?? 0) + 1;
    this.messageCounter.set(sessionId, counter);

    session.messages.push({
      id: counter,
      direction,
      timestamp: now,
      raw,
      method,
      sessionId: extractSessionId(parsed),
    });
    if (session.messages.length > MAX_MESSAGES) {
      session.messages = session.messages.slice(-Math.floor(MAX_MESSAGES * 0.8));
    }
    session.updatedAt = now;
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

    if (method === "session/prompt" && isRequest(parsed)) {
      const req = parsed as { id?: number | string; params?: Record<string, unknown> };
      if (req.id !== undefined && sessionId) {
        this.pendingPromptRequests.set(req.id, sessionId);
      }
    }

    if (isResponse(parsed)) {
      const resp = parsed as { id: number | string };

      if (this.pendingNewRequests.has(resp.id) && sessionId) {
        const cwd = this.pendingNewRequests.get(resp.id) ?? "";
        this.pendingNewRequests.delete(resp.id);
        this.createSession(sessionId, cwd, sourceId);
      }

      const promptSessionId = this.pendingPromptRequests.get(resp.id);
      if (promptSessionId) {
        this.pendingPromptRequests.delete(resp.id);
        const session = this.sessions.get(promptSessionId);
        if (session) {
          session.status = "idle";
          session.promptPending = false;
        }
      }
    }

    if (sessionId) {
      if (!this.sessions.has(sessionId)) {
        const params = (parsed as { params?: Record<string, unknown> }).params;
        const cwd = (params?.cwd as string) || "";
        this.createSession(sessionId, cwd, sourceId);
      }
      this.bufferMessage(sessionId, raw, direction, parsed);
      this.updateStatus(sessionId, method, parsed);
    }
  }

  private updateStatus(sessionId: string, method: string | null, parsed: JsonRpcMessage): void {
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
    } else if (method === "session/cancel") {
      session.status = "idle";
      session.promptPending = false;
    } else if (method === "session/update" && !session.title) {
      const params = (parsed as { params?: Record<string, unknown> }).params;
      const update = params?.update as Record<string, unknown> | undefined;
      if (update?.sessionUpdate === "user_message_chunk") {
        const content = update.content as { type?: string; text?: string } | undefined;
        if (content?.type === "text" && content.text) {
          session.title = content.text.length > 60 ? content.text.slice(0, 60) + "…" : content.text;
        }
      }
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

  hideSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.hidden = true;
    }
  }

  unhideSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.hidden = false;
    }
  }

  resumeSession(sessionId: string, sourceId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session && (session.hidden || session.sourceId !== sourceId)) {
      session.hidden = false;
      session.sourceId = sourceId;
      return true;
    }
    return false;
  }

  setGitMeta(sessionId: string, gitMeta: GitMeta): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.gitMeta = gitMeta;
    }
  }

  getSessionList(livePipeIds?: Set<string>): Array<{
    sessionId: string;
    cwd: string;
    title: string | null;
    lastPrompt: string | null;
    updatedAt: string;
    hidden: boolean;
    pipeAlive: boolean;
    _meta: { relay: { status: SessionStatus; git: GitMeta | null } };
  }> {
    return this.getAllSessions().map((s) => ({
      sessionId: s.sessionId,
      cwd: s.cwd,
      title: s.title,
      lastPrompt: s.lastPrompt,
      updatedAt: s.updatedAt,
      hidden: s.hidden,
      pipeAlive: livePipeIds ? livePipeIds.has(s.sourceId) : true,
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
