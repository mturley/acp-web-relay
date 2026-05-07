(function () {
  "use strict";

  let ws = null;
  let requestId = 1;
  let sessions = [];

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
        } catch (e) {
          // skip unparseable
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
        const title = escapeHtml(s.title || s.sessionId);
        const time = formatTime(s.updatedAt);
        html += `<a class="session-card" href="/ui/?session=${encodeURIComponent(s.sessionId)}">`;
        html += `<div class="session-status ${status}"></div>`;
        html += `<div class="session-info">`;
        html += `<div class="session-title">${title}</div>`;
        html += `<div class="session-meta">${status} &middot; ${time}</div>`;
        html += `</div>`;
        if (status === "working") {
          html += `<button class="cancel-btn" data-session="${escapeHtml(s.sessionId)}">Cancel</button>`;
        }
        html += `<div class="session-arrow">&rsaquo;</div>`;
        html += `</a>`;
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
    const btn = e.target.closest(".cancel-btn");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const sessionId = btn.dataset.session;
    if (sessionId) {
      send("session/cancel", { sessionId });
    }
  });

  connect();
})();
