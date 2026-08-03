// DriftReel background service worker — orchestrates popup, offscreen, and content scripts.

import { detectPlatform, MESSAGES, DEFAULT_SETTINGS, triggerToReelAction } from "../lib/constants.js";

let runtimeState = {
  settings: { ...DEFAULT_SETTINGS },
  cameraPermissionGranted: false,
  micPermissionGranted: false,
  offscreenActive: false,
  captureActive: false,
  activeTabs: {},
  lastCaptureStatus: null
};

// ---- Settings persistence ----
async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get(["settings", "permCamera", "permMic"]);
    if (stored.settings) runtimeState.settings = { ...DEFAULT_SETTINGS, ...stored.settings };
    // Restore permission state across SW restarts — Chrome persists getUserMedia
    // permission for the extension origin, so if we previously recorded it as
    // granted, it's still granted.
    if (stored.permCamera) runtimeState.cameraPermissionGranted = true;
    if (stored.permMic) runtimeState.micPermissionGranted = true;
  } catch (e) { /* storage may be unavailable transiently */ }
}

async function saveSettings(patch) {
  runtimeState.settings = { ...runtimeState.settings, ...patch };
  try { await chrome.storage.local.set({ settings: runtimeState.settings }); } catch (e) {}
  broadcastState();
}

// ---- Tab watching / auto-show widget ----
function handleTabForPlatform(tabId, url) {
  const platform = detectPlatform(url);
  if (platform) {
    runtimeState.activeTabs[tabId] = platform;
    // Try to message content script; if not loaded, inject it then retry
    chrome.tabs.sendMessage(tabId, { type: MESSAGES.SHOW_WIDGET, platform }).catch(() => {
      chrome.scripting.executeScript({
        target: { tabId },
        files: ["content/content.js"]
      }).then(() => {
        chrome.tabs.sendMessage(tabId, { type: MESSAGES.SHOW_WIDGET, platform }).catch(() => {});
      }).catch(() => {});
    });
    maybeAutoStartCapture();
  } else {
    if (runtimeState.activeTabs[tabId]) {
      chrome.tabs.sendMessage(tabId, { type: MESSAGES.HIDE_WIDGET }).catch(() => {});
      delete runtimeState.activeTabs[tabId];
    }
    if (Object.keys(runtimeState.activeTabs).length === 0 && runtimeState.captureActive) {
      stopCapture();
    }
  }
}

async function maybeAutoStartCapture() {
  if (!runtimeState.settings.autoStart) return;
  if (Object.keys(runtimeState.activeTabs).length === 0) return;
  if (!runtimeState.cameraPermissionGranted && !runtimeState.micPermissionGranted) return;
  if (!runtimeState.captureActive) {
    await startCapture();
  }
}

chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.url || change.status === "complete") {
    handleTabForPlatform(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (runtimeState.activeTabs[tabId]) {
    delete runtimeState.activeTabs[tabId];
    if (Object.keys(runtimeState.activeTabs).length === 0 && runtimeState.captureActive) {
      stopCapture();
    }
  }
});

// SPA route changes (reels navigate via history state, not full page load)
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId === 0) {
    chrome.tabs.get(details.tabId, (tab) => {
      if (chrome.runtime.lastError) return;
      handleTabForPlatform(details.tabId, tab.url);
    });
  }
});

chrome.runtime.onStartup?.addListener?.(() => { loadSettings(); initTabs(); });
chrome.runtime.onInstalled?.addListener?.(() => { loadSettings(); initTabs(); });

async function initTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) handleTabForPlatform(tab.id, tab.url);
  } catch (e) {}
}

// ---- Offscreen document management ----
async function hasOffscreenDocument() {
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL("offscreen/offscreen.html")]
    });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreen() {
  if (await hasOffscreenDocument()) { runtimeState.offscreenActive = true; return true; }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen/offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Capture camera/mic for hands-free reel control via MediaPipe and Web Speech API"
    });
    runtimeState.offscreenActive = true;
    return true;
  } catch (e) {
    return false;
  }
}

async function startCapture() {
  const ok = await ensureOffscreen();
  if (!ok) {
    runtimeState.lastCaptureStatus = { ok: false, message: "Could not create offscreen capture context" };
    broadcastState();
    return;
  }
  chrome.runtime.sendMessage({
    type: MESSAGES.START_CAPTURE,
    cameraEnabled: runtimeState.settings.cameraEnabled && runtimeState.cameraPermissionGranted,
    micEnabled: runtimeState.settings.micEnabled && runtimeState.micPermissionGranted
  }).catch(() => {});
  runtimeState.captureActive = true;
  broadcastState();
}

function stopCapture() {
  if (runtimeState.offscreenActive) {
    chrome.runtime.sendMessage({ type: MESSAGES.STOP_CAPTURE }).catch(() => {});
  }
  runtimeState.captureActive = false;
  broadcastState();
}

// ---- Action execution: background -> content ----
function sendActionToTab(action) {
  for (const tabId of Object.keys(runtimeState.activeTabs)) {
    chrome.tabs.sendMessage(Number(tabId), { type: MESSAGES.PERFORM_ACTION, action }).catch(() => {});
  }
}

function forwardCaptureStatusToTabs(status) {
  for (const tabId of Object.keys(runtimeState.activeTabs)) {
    chrome.tabs.sendMessage(Number(tabId), { type: MESSAGES.CAPTURE_STATUS_FORWARD, status }).catch(() => {});
  }
}

// ---- Message router ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  switch (msg.type) {
    case MESSAGES.POPUP_INIT:
      sendResponse(currentStateForPopup());
      return;

    case MESSAGES.POPUP_ENABLE_CAMERA:
      runtimeState.cameraPermissionGranted = true;
      runtimeState.settings.cameraEnabled = true;
      saveSettings({ cameraEnabled: true });
      chrome.storage.local.set({ permCamera: true }).catch(() => {});
      sendResponse({ ok: true });
      maybeAutoStartCapture();
      return;

    case MESSAGES.POPUP_ENABLE_MIC:
      runtimeState.micPermissionGranted = true;
      runtimeState.settings.micEnabled = true;
      saveSettings({ micEnabled: true });
      chrome.storage.local.set({ permMic: true }).catch(() => {});
      sendResponse({ ok: true });
      maybeAutoStartCapture();
      return;

    case MESSAGES.POPUP_DISABLE_CAMERA:
      runtimeState.settings.cameraEnabled = false;
      runtimeState.cameraPermissionGranted = false;
      saveSettings({ cameraEnabled: false });
      chrome.storage.local.set({ permCamera: false }).catch(() => {});
      if (runtimeState.captureActive) {
        chrome.runtime.sendMessage({
          type: MESSAGES.START_CAPTURE,
          cameraEnabled: false,
          micEnabled: runtimeState.settings.micEnabled && runtimeState.micPermissionGranted
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      return;

    case MESSAGES.POPUP_DISABLE_MIC:
      runtimeState.settings.micEnabled = false;
      runtimeState.micPermissionGranted = false;
      saveSettings({ micEnabled: false });
      chrome.storage.local.set({ permMic: false }).catch(() => {});
      if (runtimeState.captureActive) {
        chrome.runtime.sendMessage({
          type: MESSAGES.START_CAPTURE,
          cameraEnabled: runtimeState.settings.cameraEnabled && runtimeState.cameraPermissionGranted,
          micEnabled: false
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      return;

    case MESSAGES.POPUP_UPDATE_SETTINGS:
      saveSettings(msg.settings || {});
      if (runtimeState.captureActive) {
        chrome.runtime.sendMessage({
          type: "driftreel:update-sensitivity",
          headTiltSensitivity: runtimeState.settings.headTiltSensitivity,
          eyeGazeSensitivity: runtimeState.settings.eyeGazeSensitivity
        }).catch(() => {});
      }
      sendResponse({ ok: true });
      return;

    case MESSAGES.POPUP_START_PREVIEW:
      ensureOffscreen().then(() => {
        chrome.runtime.sendMessage({
          type: MESSAGES.START_CAPTURE,
          cameraEnabled: true,
          micEnabled: runtimeState.settings.micEnabled && runtimeState.micPermissionGranted,
          preview: true
        }).catch(() => {});
        sendResponse({ ok: true });
      });
      return true; // async

    case MESSAGES.POPUP_STOP_PREVIEW:
      chrome.runtime.sendMessage({ type: "driftreel:stop-preview" }).catch(() => {});
      sendResponse({ ok: true });
      return;

    case MESSAGES.CAPTURE_STATUS:
      runtimeState.lastCaptureStatus = msg.status;
      if (msg.status) {
        if (msg.status.action) {
          const reelAction = triggerToReelAction(msg.status.action);
          if (reelAction) sendActionToTab(reelAction);
        }
        const needsPerm = (!runtimeState.cameraPermissionGranted && !runtimeState.micPermissionGranted);
        forwardCaptureStatusToTabs({ ...msg.status, needsPermission: needsPerm });
      }
      broadcastState();
      return;

    case MESSAGES.WIDGET_STATUS:
      broadcastState({ widgetStatus: msg.status });
      return;

    case MESSAGES.REQUEST_ENABLE_MEDIA:
      try {
        chrome.action.setBadgeText({ text: "ON" });
        chrome.action.setBadgeBackgroundColor({ color: "#fb7185" });
      } catch (e) {}
      sendResponse({ ok: true, message: "Click the DriftReel icon to enable camera/mic" });
      return;

    case MESSAGES.PERFORM_ACTION_RESULT:
      broadcastState({ lastAction: msg.result });
      return;

    case MESSAGES.URL_CHANGED:
      if (sender.tab) handleTabForPlatform(sender.tab.id, msg.url);
      return;

    case MESSAGES.MEDIA_PERMISSION_CHANGED:
      if (msg.camera === true) runtimeState.cameraPermissionGranted = true;
      if (msg.mic === true) runtimeState.micPermissionGranted = true;
      if (msg.camera === false) runtimeState.cameraPermissionGranted = false;
      if (msg.mic === false) runtimeState.micPermissionGranted = false;
      return;

    default:
      return;
  }
});

function currentStateForPopup() {
  return {
    settings: runtimeState.settings,
    cameraPermissionGranted: runtimeState.cameraPermissionGranted,
    micPermissionGranted: runtimeState.micPermissionGranted,
    captureActive: runtimeState.captureActive,
    offscreenActive: runtimeState.offscreenActive,
    activeTabs: runtimeState.activeTabs,
    lastCaptureStatus: runtimeState.lastCaptureStatus
  };
}

function broadcastState(extra = {}) {
  chrome.runtime.sendMessage({ type: MESSAGES.POPUP_STATE, state: { ...currentStateForPopup(), ...extra } })
    .catch(() => {});
}

loadSettings().then(() => { initTabs(); });
