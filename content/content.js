// DriftReel content script — on-page floating widget (Shadow DOM).
// Draggable, resizable, collapsible pill. Glanceable state only. Never blocks page layout.

(function () {
  if (window.__driftreelInjected) return;
  window.__driftreelInjected = true;

  const M = {
    SHOW_WIDGET: "driftreel:show-widget",
    HIDE_WIDGET: "driftreel:hide-widget",
    WIDGET_STATUS: "driftreel:widget-status",
    REQUEST_ENABLE_MEDIA: "driftreel:request-enable-media",
    CAPTURE_STATUS: "driftreel:capture-status",
    CAPTURE_STATUS_FORWARD: "driftreel:capture-status-forward",
    PERFORM_ACTION: "driftreel:perform-action",
    PERFORM_ACTION_RESULT: "driftreel:perform-action-result",
    MEDIA_PERMISSION_CHANGED: "driftreel:media-permission-changed",
    URL_CHANGED: "driftreel:url-changed"
  };

  let currentPlatform = null;
  let widgetRoot = null;
  let shadow = null;
  let dragState = null;
  let resizeState = null;

  function createWidget() {
    if (widgetRoot) return;
    widgetRoot = document.createElement("div");
    widgetRoot.id = "driftreel-widget-host";
    widgetRoot.style.cssText =
      "all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;";
    shadow = widgetRoot.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host, * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        .pill {
          position: relative;
          width: 260px;
          background: rgba(15, 23, 42, 0.92);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(20, 184, 166, 0.35);
          border-radius: 14px;
          color: #f1f5f9;
          font-size: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
          overflow: hidden;
          transition: height 0.2s ease;
          resize: horizontal;
          min-width: 200px;
          max-width: 380px;
        }
        .pill.collapsed { height: 38px; }
        .header {
          display: flex; align-items: center; gap: 8px;
          padding: 8px 12px; cursor: move; user-select: none;
        }
        .dot {
          width: 9px; height: 9px; border-radius: 50%;
          background: #14b8a6; box-shadow: 0 0 6px rgba(20,184,166,0.7);
          flex-shrink: 0;
        }
        .dot.error { background: #ef4444; box-shadow: 0 0 6px rgba(239,68,68,0.7); }
        .dot.warn { background: #f59e0b; box-shadow: 0 0 6px rgba(245,158,11,0.7); }
        .title { font-weight: 600; font-size: 12px; flex: 1; }
        .platform { font-size: 10px; color: #94a3b8; }
        .collapse-btn {
          background: transparent; border: none; color: #94a3b8;
          cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px;
        }
        .collapse-btn:hover { color: #f1f5f9; }
        .body { padding: 0 12px 10px; }
        .pill.collapsed .body { display: none; }
        .status {
          padding: 7px 10px;
          background: rgba(30, 41, 59, 0.8);
          border-radius: 8px;
          margin-bottom: 8px;
          font-size: 11px;
          min-height: 18px;
          color: #cbd5e1;
          word-break: break-word;
        }
        .status.error { color: #fca5a5; }
        .status.success { color: #4ade80; }
        .metrics {
          display: grid; grid-template-columns: 1fr 1fr; gap: 5px; margin-bottom: 8px;
        }
        .metric {
          background: rgba(15,23,42,0.6); border-radius: 6px; padding: 4px 6px;
          display: flex; flex-direction: column;
        }
        .metric span { font-size: 9px; color: #94a3b8; }
        .metric b { font-size: 11px; font-weight: 600; word-break: break-word; }
        .enable-prompt {
          display: none;
          padding: 8px 10px;
          background: rgba(245, 158, 11, 0.15);
          border: 1px solid rgba(245, 158, 11, 0.4);
          border-radius: 8px;
          margin-bottom: 8px;
          font-size: 11px;
          color: #fcd34d;
        }
        .enable-prompt.show { display: block; }
        .enable-prompt button {
          margin-top: 5px; background: #f59e0b; color: #1e1300; border: none;
          border-radius: 6px; padding: 4px 10px; font-size: 11px;
          font-weight: 600; cursor: pointer; width: 100%;
        }
        .last-action { font-size: 10px; color: #94a3b8; text-align: center; padding-top: 2px; }
        .resize-handle {
          position: absolute; right: 0; bottom: 0; width: 14px; height: 14px;
          cursor: nwse-resize;
          background: linear-gradient(135deg, transparent 50%, rgba(20,184,166,0.5) 50%);
          border-bottom-right-radius: 14px;
        }
      </style>
      <div class="pill" id="pill">
        <div class="header" id="header">
          <span class="dot" id="dot"></span>
          <span class="title">DriftReel</span>
          <span class="platform" id="platform"></span>
          <button class="collapse-btn" id="collapseBtn" title="Collapse">−</button>
        </div>
        <div class="body">
          <div class="enable-prompt" id="enablePrompt">
            Camera/mic not enabled. Click below, then press Enable in the popup.
            <button id="enableBtn">Open DriftReel popup</button>
          </div>
          <div class="status" id="status">Starting...</div>
          <div class="metrics">
            <div class="metric"><span>Tilt</span><b id="mTilt">—</b></div>
            <div class="metric"><span>Gaze</span><b id="mGaze">—</b></div>
            <div class="metric"><span>Gesture</span><b id="mGesture">—</b></div>
            <div class="metric"><span>Voice</span><b id="mVoice">—</b></div>
          </div>
          <div class="last-action" id="lastAction">No actions yet</div>
        </div>
        <div class="resize-handle" id="resizeHandle"></div>
      </div>
    `;
    document.documentElement.appendChild(widgetRoot);

    const pill = shadow.getElementById("pill");
    const header = shadow.getElementById("header");
    const collapseBtn = shadow.getElementById("collapseBtn");
    const resizeHandle = shadow.getElementById("resizeHandle");
    const enableBtn = shadow.getElementById("enableBtn");

    collapseBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      pill.classList.toggle("collapsed");
      collapseBtn.textContent = pill.classList.contains("collapsed") ? "+" : "−";
    });

    enableBtn.addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: M.REQUEST_ENABLE_MEDIA }, (resp) => {
        if (resp && resp.message) setStatus(resp.message, "warn");
      });
    });

    // dragging
    header.addEventListener("pointerdown", (e) => {
      if (e.target === collapseBtn) return;
      e.preventDefault();
      const rect = widgetRoot.getBoundingClientRect();
      dragState = { offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top };
      header.setPointerCapture(e.pointerId);
    });
    header.addEventListener("pointermove", (e) => {
      if (!dragState) return;
      let x = e.clientX - dragState.offsetX;
      let y = e.clientY - dragState.offsetY;
      x = Math.max(0, Math.min(window.innerWidth - 40, x));
      y = Math.max(0, Math.min(window.innerHeight - 40, y));
      widgetRoot.style.left = x + "px";
      widgetRoot.style.top = y + "px";
      widgetRoot.style.right = "auto";
    });
    header.addEventListener("pointerup", (e) => {
      dragState = null;
      try { header.releasePointerCapture(e.pointerId); } catch (err) {}
    });

    // resizing
    resizeHandle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = pill.getBoundingClientRect();
      resizeState = { startX: e.clientX, startW: rect.width };
      resizeHandle.setPointerCapture(e.pointerId);
    });
    resizeHandle.addEventListener("pointermove", (e) => {
      if (!resizeState) return;
      const dw = e.clientX - resizeState.startX;
      const newW = Math.max(200, Math.min(380, resizeState.startW + dw));
      pill.style.width = newW + "px";
    });
    resizeHandle.addEventListener("pointerup", (e) => {
      resizeState = null;
      try { resizeHandle.releasePointerCapture(e.pointerId); } catch (err) {}
    });
  }

  function platformLabel(p) {
    return { youtube: "YouTube", instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" }[p] || p;
  }

  function showWidget(platform) {
    currentPlatform = platform;
    createWidget();
    widgetRoot.style.display = "block";
    shadow.getElementById("platform").textContent = platformLabel(platform);
    setStatus("Listening for gestures...");
    chrome.runtime.sendMessage({ type: M.WIDGET_STATUS, status: { ok: true, message: "Widget shown on " + platform } });
  }

  function hideWidget() {
    if (widgetRoot) widgetRoot.style.display = "none";
    currentPlatform = null;
  }

  function setStatus(text, kind) {
    if (!shadow) return;
    const el = shadow.getElementById("status");
    el.textContent = text;
    el.className = "status" + (kind ? " " + kind : "");
    const dot = shadow.getElementById("dot");
    dot.className = "dot" + (kind === "error" ? " error" : kind === "warn" ? " warn" : "");
  }

  function setEnablePromptVisible(visible) {
    if (!shadow) return;
    shadow.getElementById("enablePrompt").classList.toggle("show", visible);
  }

  function updateMetric(id, value) {
    if (!shadow) return;
    const el = shadow.getElementById(id);
    if (el) el.textContent = value;
  }

  function setLastAction(text) {
    if (!shadow) return;
    shadow.getElementById("lastAction").textContent = text;
  }

  // ---- Defensive per-platform DOM actions ----
  function findByAria(root, labels) {
    for (const label of labels) {
      const el = root.querySelector(
        `[aria-label="${label}"], [aria-label*="${label}" i], [title="${label}"], [title*="${label}" i]`
      );
      if (el) return el;
    }
    return null;
  }
  function clickEl(el) {
    if (!el) return false;
    el.scrollIntoView({ block: "center", inline: "center" });
    el.click();
    return true;
  }
  function dispatchKey(key, keyCode) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, keyCode, bubbles: true }));
  }

  function performAction(action) {
    if (!currentPlatform || !action) return;
    const result = runPlatformAction(currentPlatform, action);
    chrome.runtime.sendMessage({ type: M.PERFORM_ACTION_RESULT, result });
    setLastAction(action + ": " + (result.ok ? "done" : result.message));
    setStatus(result.ok ? "Action: " + action : result.message, result.ok ? "success" : "error");
  }

  function runPlatformAction(platform, action) {
    const video = document.querySelector("video");
    try {
      switch (platform) {
        case "youtube":
          if (action === "play" || action === "pause") {
            const p = document.querySelector("#movie_player") || video;
            if (p) { p.click?.(); return { ok: true }; }
            return { ok: false, message: "YouTube player not found" };
          }
          if (action === "next") { dispatchKey("ArrowDown", 40); return { ok: true }; }
          if (action === "prev") { dispatchKey("ArrowUp", 38); return { ok: true }; }
          if (action === "like") {
            const b = findByAria(document, ["Like", "like this video"]);
            return b && clickEl(b) ? { ok: true } : { ok: false, message: "Like button not found" };
          }
          if (action === "mute") {
            const b = findByAria(document, ["Mute", "Unmute"]);
            return b && clickEl(b) ? { ok: true } : { ok: false, message: "Mute button not found" };
          }
          break;
        case "instagram":
        case "facebook":
        case "tiktok":
          if (action === "play") {
            if (video && video.paused) { video.play().catch(() => {}); return { ok: true }; }
            const b = findByAria(document, ["Play", "Play video"]);
            return b && clickEl(b) ? { ok: true } : { ok: false, message: "Play button not found" };
          }
          if (action === "pause") {
            if (video && !video.paused) { video.pause(); return { ok: true }; }
            const b = findByAria(document, ["Pause", "Pause video"]);
            return b && clickEl(b) ? { ok: true } : { ok: false, message: "Pause button not found" };
          }
          if (action === "next") {
            dispatchKey("ArrowDown", 40);
            const b = findByAria(document, ["Next", "Next reel", "Next video"]);
            if (b) clickEl(b);
            return { ok: true };
          }
          if (action === "prev") {
            dispatchKey("ArrowUp", 38);
            const b = findByAria(document, ["Previous", "Previous reel", "Previous video"]);
            if (b) clickEl(b);
            return { ok: true };
          }
          if (action === "like") {
            const b = findByAria(document, ["Like", "like", "Heart"]);
            return b && clickEl(b) ? { ok: true } : { ok: false, message: "Like button not found" };
          }
          if (action === "mute") {
            const b = findByAria(document, ["Mute", "Unmute", "Volume", "Audio"]);
            if (b && clickEl(b)) return { ok: true };
            if (video) { video.muted = !video.muted; return { ok: true }; }
            return { ok: false, message: "Mute control not found" };
          }
          break;
      }
      return { ok: false, message: "Unknown action: " + action };
    } catch (e) {
      return { ok: false, message: (e && e.message) ? e.message : "Action failed" };
    }
  }

  // ---- Message listener ----
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case M.SHOW_WIDGET:
        showWidget(msg.platform);
        sendResponse?.({ ok: true });
        return;
      case M.HIDE_WIDGET:
        hideWidget();
        sendResponse?.({ ok: true });
        return;
      case M.PERFORM_ACTION:
        performAction(msg.action);
        sendResponse?.({ ok: true });
        return;
      case M.CAPTURE_STATUS_FORWARD:
        if (msg.status) {
          if (msg.status.message) setStatus(msg.status.message, msg.status.ok === false ? "error" : "success");
          if (msg.status.action) {
            const a = msg.status.action;
            if (a.startsWith("tilt")) updateMetric("mTilt", a);
            else if (a.startsWith("gaze")) updateMetric("mGaze", a);
            else if (a.startsWith("finger") || a.endsWith("Palm") || a.startsWith("thumb") || a === "pointUp") updateMetric("mGesture", a);
            else if (a.startsWith("voice")) updateMetric("mVoice", a);
            setLastAction(a);
          }
          if (msg.status.needsPermission) setEnablePromptVisible(true);
        }
        return;
      case M.MEDIA_PERMISSION_CHANGED:
        if (msg.camera || msg.mic) setEnablePromptVisible(false);
        return;
      default:
        return;
    }
  });

  // re-detect on SPA navigation within the page
  let lastUrl = location.href;
  const navObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      chrome.runtime.sendMessage({ type: M.URL_CHANGED, url: location.href });
    }
  });
  navObserver.observe(document.documentElement, { childList: true, subtree: true });
})();
