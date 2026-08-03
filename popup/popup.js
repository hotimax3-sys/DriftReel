// DriftReel popup — the ONLY place first-time camera/mic permission is requested.
// getUserMedia is called directly inside button onclick handlers (genuine user gesture).

import { MESSAGES } from "../lib/constants.js";
import { describeMediaError, isPermissionDenied } from "../lib/errors.js";

const $ = (id) => document.getElementById(id);

const els = {
  platformStatus: $("platformStatus"),
  enableCamera: $("enableCamera"),
  enableMic: $("enableMic"),
  cameraState: $("cameraState"),
  micState: $("micState"),
  previewImg: $("previewImg"),
  previewEmpty: $("previewEmpty"),
  rTilt: $("rTilt"),
  rGaze: $("rGaze"),
  rGesture: $("rGesture"),
  rVoice: $("rVoice"),
  rAction: $("rAction"),
  headSens: $("headSens"),
  eyeSens: $("eyeSens"),
  headSensVal: $("headSensVal"),
  eyeSensVal: $("eyeSensVal"),
  statusLine: $("statusLine")
};

let state = {
  settings: null,
  cameraPermissionGranted: false,
  micPermissionGranted: false,
  captureActive: false,
  activeTabs: {}
};

let previewStream = null;

function setStatus(text, kind) {
  els.statusLine.textContent = text;
  els.statusLine.className = "status-line" + (kind ? " " + kind : "");
}

function renderState() {
  const platforms = Object.values(state.activeTabs || {});
  if (platforms.length > 0) {
    els.platformStatus.textContent = platforms[0];
    els.platformStatus.className = "badge active";
  } else {
    els.platformStatus.textContent = "Idle";
    els.platformStatus.className = "badge";
  }

  if (state.cameraPermissionGranted) {
    els.cameraState.textContent = "Granted";
    els.cameraState.className = "perm-state granted";
    els.enableCamera.textContent = "Camera On";
    els.enableCamera.className = "btn btn-secondary";
  } else {
    els.cameraState.textContent = "Not enabled";
    els.cameraState.className = "perm-state";
    els.enableCamera.textContent = "Enable Camera";
    els.enableCamera.className = "btn btn-primary";
  }

  if (state.micPermissionGranted) {
    els.micState.textContent = "Granted";
    els.micState.className = "perm-state granted";
    els.enableMic.textContent = "Mic On";
    els.enableMic.className = "btn btn-secondary";
  } else {
    els.micState.textContent = "Not enabled";
    els.micState.className = "perm-state";
    els.enableMic.textContent = "Enable Microphone";
    els.enableMic.className = "btn btn-primary";
  }

  if (state.settings) {
    els.headSens.value = state.settings.headTiltSensitivity;
    els.eyeSens.value = state.settings.eyeGazeSensitivity;
    els.headSensVal.textContent = Number(state.settings.headTiltSensitivity).toFixed(2);
    els.eyeSensVal.textContent = Number(state.settings.eyeGazeSensitivity).toFixed(2);
  }
}

// ---- Enable Camera (first-time permission from genuine click) ----
els.enableCamera.addEventListener("click", async () => {
  if (state.cameraPermissionGranted) {
    stopLocalPreview();
    chrome.runtime.sendMessage({ type: MESSAGES.POPUP_DISABLE_CAMERA });
    state.cameraPermissionGranted = false;
    state.settings.cameraEnabled = false;
    renderState();
    setStatus("Camera turned off", "success");
    return;
  }
  setStatus("Requesting camera permission...");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((t) => t.stop());
    state.cameraPermissionGranted = true;
    chrome.runtime.sendMessage({ type: MESSAGES.POPUP_ENABLE_CAMERA }, () => {
      startLocalPreview();
    });
    setStatus("Camera permission granted", "success");
    renderState();
  } catch (e) {
    const msg = describeMediaError(e);
    setStatus(msg, "error");
    els.cameraState.textContent = isPermissionDenied(e) ? "Permission denied" : "Error";
    els.cameraState.className = "perm-state denied";
  }
});

// ---- Enable Mic (first-time permission from genuine click) ----
els.enableMic.addEventListener("click", async () => {
  if (state.micPermissionGranted) {
    chrome.runtime.sendMessage({ type: MESSAGES.POPUP_DISABLE_MIC });
    state.micPermissionGranted = false;
    state.settings.micEnabled = false;
    renderState();
    setStatus("Microphone turned off", "success");
    return;
  }
  setStatus("Requesting microphone permission...");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    stream.getTracks().forEach((t) => t.stop());
    state.micPermissionGranted = true;
    chrome.runtime.sendMessage({ type: MESSAGES.POPUP_ENABLE_MIC });
    setStatus("Microphone permission granted", "success");
    renderState();
  } catch (e) {
    const msg = describeMediaError(e);
    setStatus(msg, "error");
    els.micState.textContent = isPermissionDenied(e) ? "Permission denied" : "Error";
    els.micState.className = "perm-state denied";
  }
});

// ---- Local popup preview ----
async function startLocalPreview() {
  try {
    previewStream = await navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 120 }, audio: false });
    els.previewImg.srcObject = previewStream;
    els.previewImg.classList.remove("hidden");
    els.previewEmpty.classList.add("hidden");
    chrome.runtime.sendMessage({ type: MESSAGES.POPUP_START_PREVIEW }, () => {});
  } catch (e) {
    setStatus(describeMediaError(e), "error");
  }
}

function stopLocalPreview() {
  if (previewStream) {
    previewStream.getTracks().forEach((t) => t.stop());
    previewStream = null;
  }
  els.previewImg.srcObject = null;
  els.previewImg.classList.add("hidden");
  els.previewEmpty.classList.remove("hidden");
  chrome.runtime.sendMessage({ type: MESSAGES.POPUP_STOP_PREVIEW });
}

// ---- Sliders ----
els.headSens.addEventListener("input", () => {
  els.headSensVal.textContent = Number(els.headSens.value).toFixed(2);
});
els.headSens.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: MESSAGES.POPUP_UPDATE_SETTINGS,
    settings: { headTiltSensitivity: Number(els.headSens.value) }
  });
});
els.eyeSens.addEventListener("input", () => {
  els.eyeSensVal.textContent = Number(els.eyeSens.value).toFixed(2);
});
els.eyeSens.addEventListener("change", () => {
  chrome.runtime.sendMessage({
    type: MESSAGES.POPUP_UPDATE_SETTINGS,
    settings: { eyeGazeSensitivity: Number(els.eyeSens.value) }
  });
});

// ---- Single message listener for all message types ----
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.type === MESSAGES.CAPTURE_FRAME_RESULT && msg.frame) {
    if (els.previewImg.srcObject) els.previewImg.srcObject = null;
    els.previewImg.src = msg.frame;
    els.previewImg.classList.remove("hidden");
    els.previewEmpty.classList.add("hidden");
  } else if (msg.type === MESSAGES.POPUP_STATE) {
    state = { ...state, ...msg.state };
    renderState();
  } else if (msg.type === MESSAGES.CAPTURE_STATUS) {
    const s = msg.status;
    if (s && s.message) setStatus(s.message, s.ok === false ? "error" : "success");
    if (s && s.action) {
      els.rAction.textContent = s.action;
      if (s.action.startsWith("tilt")) els.rTilt.textContent = s.action;
      else if (s.action.startsWith("gaze")) els.rGaze.textContent = s.action;
      else if (s.action.startsWith("finger") || s.action.endsWith("Palm") || s.action.startsWith("thumb") || s.action === "pointUp") els.rGesture.textContent = s.action;
      else if (s.action.startsWith("voice")) els.rVoice.textContent = s.action;
    }
  } else if (msg.type === MESSAGES.WIDGET_STATUS) {
    if (msg.status && msg.status.message) setStatus(msg.status.message, msg.status.ok === false ? "error" : null);
  }
});

// ---- Init ----
chrome.runtime.sendMessage({ type: MESSAGES.POPUP_INIT }, (resp) => {
  if (resp) {
    state = { ...state, ...resp };
    renderState();
    if (state.cameraPermissionGranted) startLocalPreview();
  }
});

window.addEventListener("beforeunload", () => {
  if (previewStream) previewStream.getTracks().forEach((t) => t.stop());
  chrome.runtime.sendMessage({ type: MESSAGES.POPUP_STOP_PREVIEW });
});
