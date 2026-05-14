(function () {
  "use strict";

  let ws = null;
  let requestId = 1;
  let sessions = [];
  let activeSessionId = null;
  let sidebarOpen = true;

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${protocol}//${location.host}/ws`, ["acp.v1"]);

    ws.addEventListener("open", () => {
      updateConnectionStatus(true);
      send("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "session-picker", version: "1.0.0" },
        capabilities: {},
      });
    });

    ws.addEventListener("message", (event) => {
      const lines = event.data.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          handleMessage(JSON.parse(line));
        } catch {
          /* ignore parse errors */
        }
      }
    });

    ws.addEventListener("close", () => {
      updateConnectionStatus(false);
      setTimeout(connect, 3000);
    });

    ws.addEventListener("error", () => {
      ws.close();
    });
  }

  function send(method, params) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const msg = { jsonrpc: "2.0", id: requestId++, method, params };
    ws.send(JSON.stringify(msg) + "\n");
  }

  function handleMessage(msg) {
    if (msg.result && msg.result.agentInfo) {
      send("session/list", {});
      return;
    }

    if (msg.result && msg.result.sessions) {
      sessions = msg.result.sessions;
      render();
      updateBadge();
      restoreSessionFromHash();
      return;
    }

    if (msg.method === "relay/sessions_changed") {
      send("session/list", {});
      return;
    }
  }

  function updateConnectionStatus(connected) {
    const dot = document.getElementById("connection-status");
    dot.className = "status-dot " + (connected ? "connected" : "disconnected");
    dot.title = connected ? "Connected" : "Disconnected";
  }

  function updateBadge() {
    const badge = document.getElementById("session-badge");
    const count = sessions.filter((s) => !s.hidden).length;
    if (count > 0 && !sidebarOpen) {
      badge.textContent = count;
      badge.style.display = "inline-block";
    } else {
      badge.style.display = "none";
    }
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebar-toggle");
    sidebar.classList.toggle("collapsed", !sidebarOpen);
    toggle.classList.toggle("active", sidebarOpen);
    updateBadge();
  }

  function formatTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    return d.toLocaleDateString();
  }

  function groupSessions(sessions) {
    const groups = {};
    for (const s of sessions) {
      const git = s._meta?.relay?.git;
      const key = git ? `${git.repoName} / ${git.branch}` : s.cwd || "Unknown";
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }
    return groups;
  }

  const REPLAY_LIMIT = 200;

  function configureAcpUi(session, options = {}) {
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    let wsUrl = `${wsProtocol}//${location.host}/ws`;
    if (options.fullReplay) {
      wsUrl += "?fullReplay=1";
    }

    const agentConfig = {
      agents: {
        Relay: {
          transport: "websocket",
          url: wsUrl,
        },
      },
    };
    localStorage.setItem("acp-ui:agents", JSON.stringify(agentConfig));

    const savedSessions = [
      {
        id: crypto.randomUUID(),
        agentName: "Relay",
        sessionId: session.sessionId,
        title: session.title || session.sessionId,
        lastUpdated: Date.now(),
        cwd: session.cwd || "/",
        supportsLoadSession: true,
      },
    ];
    localStorage.setItem("acp-ui:sessions.json", JSON.stringify({ sessions: savedSessions }));
  }

  function updateUrl() {
    const params = new URLSearchParams();
    if (hiddenOpen) params.set("hidden", "1");
    const query = params.toString();
    const hash = activeSessionId ? `#${encodeURIComponent(activeSessionId)}` : "";
    const url = location.pathname + (query ? `?${query}` : "") + hash;
    history.replaceState(null, "", url);
  }

  let hiddenOpen = new URLSearchParams(location.search).get("hidden") === "1";

  function restoreSessionFromHash() {
    if (activeSessionId) return;
    const hash = decodeURIComponent(location.hash.slice(1));
    if (hash && sessions.some((s) => s.sessionId === hash && !s.hidden)) {
      openSession(hash);
    }
  }

  function openSession(sessionId, options = {}) {
    const session = sessions.find((s) => s.sessionId === sessionId);
    if (!session) return;

    activeSessionId = sessionId;
    configureAcpUi(session, options);
    updateUrl();

    const frame = document.getElementById("session-frame");
    const welcome = document.getElementById("welcome");

    welcome.style.display = "none";
    frame.style.display = "block";
    frame.src = `/ui/?agent=Relay&session=${encodeURIComponent(sessionId)}&hideSidebar=true`;

    if (sidebarOpen && window.matchMedia("(max-width: 700px)").matches) {
      toggleSidebar();
    }

    render();
  }

  function closeSession(sessionId) {
    if (!confirm("Close this session? You can restore it later if the agent is still running.")) return;
    send("session/close", { sessionId });

    if (activeSessionId === sessionId) {
      activeSessionId = null;
      updateUrl();
      const frame = document.getElementById("session-frame");
      const welcome = document.getElementById("welcome");
      frame.src = "about:blank";
      frame.style.display = "none";
      welcome.style.display = "flex";
    }
  }

  function restoreSession(sessionId) {
    send("session/restore", { sessionId });
  }

  function deleteSession(sessionId) {
    if (!confirm("Delete this session permanently? This cannot be undone.")) return;
    send("session/delete", { sessionId });

    if (activeSessionId === sessionId) {
      activeSessionId = null;
      updateUrl();
      const frame = document.getElementById("session-frame");
      const welcome = document.getElementById("welcome");
      frame.src = "about:blank";
      frame.style.display = "none";
      welcome.style.display = "flex";
    }
  }

  function renderSessionCard(s) {
    const status = s._meta?.relay?.status || "idle";
    const isActive = s.sessionId === activeSessionId;
    const isHidden = s.hidden;
    const pipeAlive = s.pipeAlive;
    const displayStatus = isHidden && !pipeAlive ? "disconnected" : status;
    const title = escapeHtml(s.title || s.sessionId);
    const lastPrompt = s.lastPrompt && s.lastPrompt !== s.title ? escapeHtml(s.lastPrompt) : null;
    const time = formatTime(s.updatedAt);
    let html = `<div class="session-card${isActive ? " active" : ""}${isHidden ? " hidden" : ""}" data-session="${escapeHtml(s.sessionId)}">`;
    html += `<div class="session-status ${displayStatus}"></div>`;
    html += `<div class="session-info">`;
    html += `<div class="session-title">${title}</div>`;
    if (lastPrompt) {
      html += `<div class="session-last-prompt">${lastPrompt}</div>`;
    }
    html += `<div class="session-meta">${displayStatus} &middot; ${time}</div>`;
    html += `</div>`;
    html += `<div class="session-actions">`;
    if (isHidden) {
      if (pipeAlive) {
        html += `<button class="restore-btn" data-restore="${escapeHtml(s.sessionId)}" title="Restore session">&#x21A9;</button>`;
      }
      html += `<button class="delete-btn" data-delete="${escapeHtml(s.sessionId)}" title="Delete session">&times;</button>`;
    } else {
      if ((s.messageCount || 0) > REPLAY_LIMIT) {
        html += `<button class="full-replay-btn" data-full-replay="${escapeHtml(s.sessionId)}" title="Load full session history">&#x23EE;</button>`;
      }
      if (status === "working") {
        html += `<button class="cancel-btn" data-session="${escapeHtml(s.sessionId)}" title="Cancel">&#x23F9;</button>`;
      }
      html += `<button class="close-btn" data-close="${escapeHtml(s.sessionId)}" title="Close session">&times;</button>`;
    }
    html += `</div>`;
    html += `</div>`;
    return html;
  }

  function render() {
    const container = document.getElementById("sessions-container");

    const activeSessions = sessions.filter((s) => !s.hidden);
    const hiddenSessions = sessions.filter((s) => s.hidden);

    if (activeSessions.length === 0 && hiddenSessions.length === 0) {
      container.innerHTML =
        '<div class="empty-state"><p>No active sessions</p><p class="hint">Start an agent session in your editor to see it here.</p></div>';
      return;
    }

    let html = "";

    if (activeSessions.length > 0) {
      const groups = groupSessions(activeSessions);
      for (const [groupName, groupSessions] of Object.entries(groups)) {
        html += `<div class="group">`;
        html += `<div class="group-header">${escapeHtml(groupName)}</div>`;
        for (const s of groupSessions) {
          html += renderSessionCard(s);
        }
        html += `</div>`;
      }
    } else {
      html += `<div class="empty-state"><p>No active sessions</p></div>`;
    }

    if (hiddenSessions.length > 0) {
      html += `<details class="hidden-section"${hiddenOpen ? " open" : ""}>`;
      html += `<summary class="hidden-header">Hidden (${hiddenSessions.length})</summary>`;
      const groups = groupSessions(hiddenSessions);
      for (const [groupName, groupSessions] of Object.entries(groups)) {
        html += `<div class="group">`;
        html += `<div class="group-header">${escapeHtml(groupName)}</div>`;
        for (const s of groupSessions) {
          html += renderSessionCard(s);
        }
        html += `</div>`;
      }
      html += `</details>`;
    }

    container.innerHTML = html;

    const details = container.querySelector(".hidden-section");
    if (details) {
      details.addEventListener("toggle", () => {
        hiddenOpen = details.open;
        updateUrl();
      });
    }
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  document.addEventListener("click", (e) => {
    const fullReplayBtn = e.target.closest(".full-replay-btn");
    if (fullReplayBtn) {
      e.stopPropagation();
      const sessionId = fullReplayBtn.dataset.fullReplay;
      if (sessionId) openSession(sessionId, { fullReplay: true });
      return;
    }

    const cancelBtn = e.target.closest(".cancel-btn");
    if (cancelBtn) {
      e.stopPropagation();
      const sessionId = cancelBtn.dataset.session;
      if (sessionId) send("session/cancel", { sessionId });
      return;
    }

    const closeBtn = e.target.closest(".close-btn");
    if (closeBtn) {
      e.stopPropagation();
      const sessionId = closeBtn.dataset.close;
      if (sessionId) closeSession(sessionId);
      return;
    }

    const restoreBtn = e.target.closest(".restore-btn");
    if (restoreBtn) {
      e.stopPropagation();
      const sessionId = restoreBtn.dataset.restore;
      if (sessionId) restoreSession(sessionId);
      return;
    }

    const deleteBtn = e.target.closest(".delete-btn");
    if (deleteBtn) {
      e.stopPropagation();
      const sessionId = deleteBtn.dataset.delete;
      if (sessionId) deleteSession(sessionId);
      return;
    }

    const card = e.target.closest(".session-card");
    if (card) {
      const sessionId = card.dataset.session;
      if (sessionId) openSession(sessionId);
    }
  });

  document.getElementById("sidebar-toggle").addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-toggle").classList.add("active");

  document.getElementById("logout-btn").addEventListener("click", async function () {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      /* ignore logout errors */
    }
    window.location.href = "/login";
  });

  connect();
})();
