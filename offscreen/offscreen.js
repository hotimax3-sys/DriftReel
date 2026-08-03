// DriftReel offscreen document.
// Runs camera/mic capture, MediaPipe FaceLandmarker + GestureRecognizer, and Web Speech API.
// No visible UI. Receives commands from background; reports status + actions back.

import { MESSAGES } from "../lib/constants.js";
import { describeMediaError } from "../lib/errors.js";

// Lazy-load MediaPipe — don't block the entire document on a top-level await
// that can fail (CSP, missing wasm, etc). Load on first camera start.
let visionBundle = null;
async function loadVisionBundle() {
  if (visionBundle) return visionBundle;
  try {
    visionBundle = await import("../lib/vision_bundle.mjs");
    return visionBundle;
  } catch (e) {
    sendStatus({ ok: false, message: "Failed to load MediaPipe vision library: " + (e.message || e) });
    throw e;
  }
}

const video = document.getElementById("cam");

let cameraStream = null;
let micStream = null;
let faceLandmarker = null;
let gestureRecognizer = null;
let recognition = null;
let rafId = null;
let running = false;
let modelsLoading = false;

let config = {
  cameraEnabled: false,
  micEnabled: false,
  preview: false,
  headTiltSensitivity: 0.5,
  eyeGazeSensitivity: 0.5
};

let lastAction = { name: null, time: 0 };
const ACTION_COOLDOWN = 1200;

let tiltBaseline = null;
let tiltActive = null;
let tiltActionFired = false;

let gazeBaseline = null;
let gazeActive = null;
let gazeActionFired = false;

let lastFaceResult = null;
let lastGestureResult = null;
let previewTimer = 0;

async function loadModels() {
  if (faceLandmarker && gestureRecognizer) return;
  if (modelsLoading) return;
  modelsLoading = true;
  try {
    const { FaceLandmarker, FilesetResolver, GestureRecognizer } = await loadVisionBundle();
    const fileset = await FilesetResolver.forVisionTasks(
      chrome.runtime.getURL("wasm")
    );
    // Offscreen documents don't support GPU/WebGL reliably — use CPU delegate
    faceLandmarker = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL("lib/face_landmarker.task"),
        delegate: "CPU"
      },
      outputFaceBlendshapes: true,
      runningMode: "VIDEO",
      numFaces: 1
    });
    gestureRecognizer = await GestureRecognizer.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: chrome.runtime.getURL("lib/gesture_recognizer.task"),
        delegate: "CPU"
      },
      runningMode: "VIDEO",
      numHands: 1
    });
    sendStatus({ ok: true, message: "Models loaded" });
  } catch (e) {
    sendStatus({ ok: false, message: "Failed to load AI models: " + (e.message || e) });
    throw e;
  } finally {
    modelsLoading = false;
  }
}

function sendStatus(status) {
  chrome.runtime.sendMessage({ type: MESSAGES.CAPTURE_STATUS, status }).catch(() => {});
}

function sendPreviewFrame() {
  try {
    const c = document.createElement("canvas");
    c.width = 160; c.height = 120;
    const cx = c.getContext("2d");
    cx.drawImage(video, 0, 0, 160, 120);
    if (lastFaceResult && lastFaceResult.faceLandmarks && lastFaceResult.faceLandmarks[0]) {
      cx.fillStyle = "#22d3ee";
      for (const lm of lastFaceResult.faceLandmarks[0]) {
        cx.fillRect(lm.x * 160 - 1, lm.y * 120 - 1, 2, 2);
      }
    }
    const dataUrl = c.toDataURL("image/jpeg", 0.5);
    chrome.runtime.sendMessage({ type: MESSAGES.CAPTURE_FRAME_RESULT, frame: dataUrl }).catch(() => {});
  } catch (e) {}
}

async function loop() {
  if (!running) return;
  const now = performance.now();
  try {
    if (video.readyState >= 2 && video.videoWidth > 0) {
      if (faceLandmarker) {
        lastFaceResult = faceLandmarker.detectForVideo(video, now);
        if (config.preview && now - previewTimer > 200) {
          sendPreviewFrame();
          previewTimer = now;
        }
      }
      if (gestureRecognizer) {
        lastGestureResult = gestureRecognizer.recognizeForVideo(video, now);
      }
      processFace(lastFaceResult);
      processGesture(lastGestureResult);
    }
  } catch (e) {
    sendStatus({ ok: false, message: "Vision error: " + (e.message || e) });
  }
  rafId = requestAnimationFrame(loop);
}

function maybeFireAction(name) {
  const now = performance.now();
  if (lastAction.name === name && now - lastAction.time < ACTION_COOLDOWN) return;
  lastAction = { name, time: now };
  sendStatus({ ok: true, action: name });
}

function processFace(result) {
  if (!result || !result.faceLandmarks || !result.faceLandmarks[0]) {
    tiltBaseline = null; tiltActive = null; tiltActionFired = false;
    gazeBaseline = null; gazeActive = null; gazeActionFired = false;
    return;
  }
  const lm = result.faceLandmarks[0];
  const leftEye = lm[33];
  const rightEye = lm[263];
  const dx = rightEye.x - leftEye.x;
  const dy = rightEye.y - leftEye.y;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;

  if (tiltBaseline === null) tiltBaseline = angle;
  const rel = angle - tiltBaseline;
  const tiltThresh = 12 + (1 - config.headTiltSensitivity) * 18;
  if (Math.abs(rel) > tiltThresh) {
    const dir = rel > 0 ? "tiltRight" : "tiltLeft";
    if (tiltActive !== dir) { tiltActive = dir; tiltActionFired = false; }
    if (!tiltActionFired) { maybeFireAction(dir); tiltActionFired = true; }
  } else {
    tiltActive = null; tiltActionFired = false;
  }

  const nose = lm[1];
  const le = lm[159], re = lm[386];
  const eyeMidX = (le.x + re.x) / 2;
  const eyeMidY = (le.y + re.y) / 2;
  const gazeX = nose.x - eyeMidX;
  const gazeY = nose.y - eyeMidY;
  if (gazeBaseline === null) gazeBaseline = { x: gazeX, y: gazeY };
  const relGx = gazeX - gazeBaseline.x;
  const relGy = gazeY - gazeBaseline.y;
  const gazeThresh = 0.015 + (1 - config.eyeGazeSensitivity) * 0.03;
  if (Math.abs(relGx) > gazeThresh) {
    const dir = relGx > 0 ? "gazeRight" : "gazeLeft";
    if (gazeActive !== dir) { gazeActive = dir; gazeActionFired = false; }
    if (!gazeActionFired) { maybeFireAction(dir); gazeActionFired = true; }
  } else if (Math.abs(relGy) > gazeThresh * 1.2) {
    const dir = relGy > 0 ? "gazeDown" : "gazeUp";
    if (gazeActive !== dir) { gazeActive = dir; gazeActionFired = false; }
    if (!gazeActionFired) { maybeFireAction(dir); gazeActionFired = true; }
  } else {
    gazeActive = null; gazeActionFired = false;
  }
}

function processGesture(result) {
  if (!result || !result.gestures || !result.gestures[0] || result.gestures[0].length === 0) return;
  const gesture = result.gestures[0][0].categoryName;
  switch (gesture) {
    case "Open_Palm": maybeFireAction("openPalm"); break;
    case "Closed_Palm": maybeFireAction("closedPalm"); break;
    case "Thumb_Up": maybeFireAction("thumbUp"); break;
    case "Thumb_Down": maybeFireAction("thumbDown"); break;
    case "Pointing_Up": maybeFireAction("pointUp"); break;
    default: break;
  }
  if (result.landmarks && result.landmarks[0]) {
    const count = countFingers(result.landmarks[0]);
    if (count >= 1 && count <= 3) maybeFireAction("finger" + count);
  }
}

function countFingers(hand) {
  let count = 0;
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  for (let i = 0; i < tips.length; i++) {
    if (hand[tips[i]].y < hand[pips[i]].y) count++;
  }
  if (Math.abs(hand[4].x - hand[3].x) > 0.04) count++;
  return count;
}

function startVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    sendStatus({ ok: false, message: "Voice not supported in this browser" });
    return;
  }
  if (recognition) { try { recognition.stop(); } catch (e) {} }
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    const last = event.results[event.results.length - 1];
    if (!last) return;
    const transcript = last[0].transcript.trim().toLowerCase();
    const cmd = mapVoiceCommand(transcript);
    if (cmd) sendStatus({ ok: true, action: cmd, voice: transcript });
  };
  recognition.onerror = (event) => {
    const msg = describeMediaError({ name: event.error, message: event.error });
    sendStatus({ ok: false, message: "Voice: " + msg });
  };
  recognition.onend = () => {
    if (running && config.micEnabled) {
      try { recognition.start(); } catch (e) {}
    }
  };
  try { recognition.start(); } catch (e) {}
}

function mapVoiceCommand(t) {
  if (/\b(play|resume|start|go)\b/.test(t)) return "voicePlay";
  if (/\b(pause|stop|hold|freeze)\b/.test(t)) return "voicePause";
  if (/\b(next|forward|skip|swipe)\b/.test(t)) return "voiceNext";
  if (/\b(prev|previous|back|last)\b/.test(t)) return "voicePrev";
  if (/\b(like|love|heart)\b/.test(t)) return "voiceLike";
  if (/\b(mute|silence|quiet)\b/.test(t)) return "voiceMute";
  if (/\b(unmute|sound|loud)\b/.test(t)) return "voiceUnmute";
  return null;
}

function stopVoice() {
  if (recognition) { try { recognition.stop(); } catch (e) {} recognition = null; }
}

async function startCamera() {
  if (cameraStream) return true;
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: "user" },
      audio: false
    });
    video.srcObject = cameraStream;
    // Must explicitly play — offscreen video won't autoplay reliably
    await video.play().catch(() => {});
    cameraStream.getVideoTracks().forEach((track) => {
      track.addEventListener("ended", () => sendStatus({ ok: false, message: "Camera disconnected" }));
      track.addEventListener("mute", () => sendStatus({ ok: false, message: "Camera temporarily unavailable" }));
    });
    chrome.runtime.sendMessage({ type: MESSAGES.MEDIA_PERMISSION_CHANGED, camera: true }).catch(() => {});
    return true;
  } catch (e) {
    sendStatus({ ok: false, message: describeMediaError(e) });
    return false;
  }
}

async function startMic() {
  if (micStream) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ video: false, audio: true });
    micStream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => sendStatus({ ok: false, message: "Microphone disconnected" }));
      track.addEventListener("mute", () => sendStatus({ ok: false, message: "Microphone temporarily unavailable" }));
    });
    chrome.runtime.sendMessage({ type: MESSAGES.MEDIA_PERMISSION_CHANGED, mic: true }).catch(() => {});
    startVoice();
    return true;
  } catch (e) {
    sendStatus({ ok: false, message: describeMediaError(e) });
    return false;
  }
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
    video.srcObject = null;
  }
}

function stopMic() {
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  stopVoice();
}

async function start(msg) {
  config = {
    cameraEnabled: !!msg.cameraEnabled,
    micEnabled: !!msg.micEnabled,
    preview: !!msg.preview,
    headTiltSensitivity: msg.headTiltSensitivity ?? config.headTiltSensitivity,
    eyeGazeSensitivity: msg.eyeGazeSensitivity ?? config.eyeGazeSensitivity
  };
  running = true;
  let camOk = true, micOk = true;
  if (config.cameraEnabled) {
    camOk = await startCamera();
    if (camOk) {
      try {
        await loadModels();
        if (!rafId) loop();
      } catch (e) {
        // models failed to load — camera still works but no AI detection
      }
    }
  } else {
    stopCamera();
  }
  if (config.micEnabled) {
    micOk = await startMic();
  } else {
    stopMic();
  }
  sendStatus({ ok: camOk && micOk, camera: camOk, mic: micOk, message: camOk && micOk ? "Capture started" : "Some devices unavailable" });
}

function stop() {
  running = false;
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  stopCamera();
  stopMic();
  sendStatus({ ok: true, message: "Capture stopped" });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;
  switch (msg.type) {
    case MESSAGES.START_CAPTURE:
      start(msg).then(() => sendResponse?.({ ok: true }));
      return true;
    case MESSAGES.STOP_CAPTURE:
      stop();
      sendResponse?.({ ok: true });
      return;
    case "driftreel:update-sensitivity":
      config.headTiltSensitivity = msg.headTiltSensitivity ?? config.headTiltSensitivity;
      config.eyeGazeSensitivity = msg.eyeGazeSensitivity ?? config.eyeGazeSensitivity;
      return;
    case "driftreel:stop-preview":
      config.preview = false;
      return;
    default:
      return;
  }
});

sendStatus({ ok: true, message: "Offscreen ready" });
