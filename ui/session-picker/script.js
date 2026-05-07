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
        } catch (e) {}
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
      return;
    }

    if (msg.method === "session/update") {
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
    const count = sessions.length;
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
      const key = git ? `${git.repoName} / ${git.branch}` : (s.cwd || "Unknown");
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }
    return groups;
  }

  function configureAcpUi(session) {
    const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${location.host}/ws`;

    const agentConfig = {
      agents: {
        "Relay": {
          transport: "websocket",
          url: wsUrl,
        },
      },
    };
    localStorage.setItem("acp-ui:agents", JSON.stringify(agentConfig));

    const savedSessions = [{
      id: crypto.randomUUID(),
      agentName: "Relay",
      sessionId: session.sessionId,
      title: session.title || session.sessionId,
      lastUpdated: Date.now(),
      cwd: session.cwd || "/",
      supportsLoadSession: true,
    }];
    localStorage.setItem("acp-ui:sessions", JSON.stringify(savedSessions));
  }

  function openSession(sessionId) {
    const session = sessions.find((s) => s.sessionId === sessionId);
    if (!session) return;

    activeSessionId = sessionId;
    configureAcpUi(session);

    const frame = document.getElementById("session-frame");
    const welcome = document.getElementById("welcome");

    welcome.style.display = "none";
    frame.style.display = "block";
    frame.src = `/ui/?agent=Relay&session=${encodeURIComponent(sessionId)}&hideSidebar=true`;

    render();
  }

  function closeSession(sessionId) {
    if (!confirm("Close this session? This will kill the agent process.")) return;
    send("session/close", { sessionId });

    if (activeSessionId === sessionId) {
      activeSessionId = null;
      const frame = document.getElementById("session-frame");
      const welcome = document.getElementById("welcome");
      frame.src = "about:blank";
      frame.style.display = "none";
      welcome.style.display = "flex";
    }
  }

  function render() {
    const container = document.getElementById("sessions-container");
    const emptyState = document.getElementById("empty-state");

    if (sessions.length === 0) {
      container.innerHTML = "";
      container.appendChild(emptyState);
      emptyState.style.display = "block";
      return;
    }

    emptyState.style.display = "none";
    const groups = groupSessions(sessions);
    let html = "";

    for (const [groupName, groupSessions] of Object.entries(groups)) {
      html += `<div class="group">`;
      html += `<div class="group-header">${escapeHtml(groupName)}</div>`;
      for (const s of groupSessions) {
        const status = s._meta?.relay?.status || "idle";
        const isActive = s.sessionId === activeSessionId;
        const title = escapeHtml(s.title || s.sessionId);
        const lastPrompt = s.lastPrompt && s.lastPrompt !== s.title ? escapeHtml(s.lastPrompt) : null;
        const time = formatTime(s.updatedAt);
        html += `<div class="session-card${isActive ? " active" : ""}" data-session="${escapeHtml(s.sessionId)}">`;
        html += `<div class="session-status ${status}"></div>`;
        html += `<div class="session-info">`;
        html += `<div class="session-title">${title}</div>`;
        if (lastPrompt) {
          html += `<div class="session-last-prompt">${lastPrompt}</div>`;
        }
        html += `<div class="session-meta">${status} &middot; ${time}</div>`;
        html += `</div>`;
        html += `<div class="session-actions">`;
        if (status === "working") {
          html += `<button class="cancel-btn" data-session="${escapeHtml(s.sessionId)}" title="Cancel">&#x23F9;</button>`;
        }
        html += `<button class="close-btn" data-close="${escapeHtml(s.sessionId)}" title="Close session">&#x1F5D1;</button>`;
        html += `</div>`;
        html += `</div>`;
      }
      html += `</div>`;
    }

    container.innerHTML = html;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  document.addEventListener("click", (e) => {
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

    const card = e.target.closest(".session-card");
    if (card) {
      const sessionId = card.dataset.session;
      if (sessionId) openSession(sessionId);
    }
  });

  document.getElementById("sidebar-toggle").addEventListener("click", toggleSidebar);
  document.getElementById("sidebar-toggle").classList.add("active");

  connect();
})();
