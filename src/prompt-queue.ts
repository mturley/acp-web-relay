interface QueuedPrompt {
  prompt: unknown;
  requestId: number | string;
}

interface SessionPromptState {
  busy: boolean;
  queued: QueuedPrompt | null;
}

export class PromptQueue {
  private states = new Map<string, SessionPromptState>();

  private getState(sessionId: string): SessionPromptState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = { busy: false, queued: null };
      this.states.set(sessionId, state);
    }
    return state;
  }

  canPrompt(sessionId: string): boolean {
    return !this.getState(sessionId).busy;
  }

  markBusy(sessionId: string): void {
    this.getState(sessionId).busy = true;
  }

  markIdle(sessionId: string): QueuedPrompt | null {
    const state = this.getState(sessionId);
    state.busy = false;
    const queued = state.queued;
    state.queued = null;
    return queued;
  }

  enqueue(sessionId: string, prompt: unknown, requestId: number | string): boolean {
    const state = this.getState(sessionId);
    if (state.queued) return false;
    state.queued = { prompt, requestId };
    return true;
  }
}
