// Shared constants and URL matching for DriftReel.

export const PLATFORMS = {
  youtube: {
    name: "YouTube Shorts",
    match: /^https:\/\/(www\.|m\.)?youtube\.com\/shorts\//i
  },
  instagram: {
    name: "Instagram Reels",
    match: /^https:\/\/(www\.|m\.)?instagram\.com\/(reels|reel)\//i
  },
  facebook: {
    name: "Facebook Reels",
    match: /^https:\/\/(www\.|m\.)?facebook\.com\/reel\//i
  },
  tiktok: {
    name: "TikTok",
    match: /^https:\/\/(www\.|m\.)?tiktok\.com\//i
  }
};

export function detectPlatform(url) {
  if (!url) return null;
  for (const [key, p] of Object.entries(PLATFORMS)) {
    if (p.match.test(url)) return key;
  }
  return null;
}

export const MESSAGES = {
  SHOW_WIDGET: "driftreel:show-widget",
  HIDE_WIDGET: "driftreel:hide-widget",
  WIDGET_READY: "driftreel:widget-ready",
  WIDGET_STATUS: "driftreel:widget-status",
  REQUEST_ENABLE_MEDIA: "driftreel:request-enable-media",
  START_CAPTURE: "driftreel:start-capture",
  STOP_CAPTURE: "driftreel:stop-capture",
  CAPTURE_STATUS: "driftreel:capture-status",
  CAPTURE_FRAME_RESULT: "driftreel:capture-frame-result",
  POPUP_INIT: "driftreel:popup-init",
  POPUP_STATE: "driftreel:popup-state",
  POPUP_ENABLE_CAMERA: "driftreel:popup-enable-camera",
  POPUP_ENABLE_MIC: "driftreel:popup-enable-mic",
  POPUP_DISABLE_CAMERA: "driftreel:popup-disable-camera",
  POPUP_DISABLE_MIC: "driftreel:popup-disable-mic",
  POPUP_UPDATE_SETTINGS: "driftreel:popup-update-settings",
  POPUP_START_PREVIEW: "driftreel:popup-start-preview",
  POPUP_STOP_PREVIEW: "driftreel:popup-stop-preview",
  MEDIA_PERMISSION_CHANGED: "driftreel:media-permission-changed",
  PERFORM_ACTION: "driftreel:perform-action",
  PERFORM_ACTION_RESULT: "driftreel:perform-action-result",
  CAPTURE_STATUS_FORWARD: "driftreel:capture-status-forward",
  URL_CHANGED: "driftreel:url-changed"
};

export const DEFAULT_SETTINGS = {
  headTiltSensitivity: 0.5,
  eyeGazeSensitivity: 0.5,
  cameraEnabled: false,
  micEnabled: false,
  autoStart: true
};

// Map a detected trigger (head tilt / eye gaze / gesture / voice) to a reel action.
export function triggerToReelAction(trigger) {
  const map = {
    tiltLeft: "prev", tiltRight: "next",
    gazeLeft: "prev", gazeRight: "next", gazeUp: "play", gazeDown: "pause",
    openPalm: "pause", closedPalm: "play", thumbUp: "like", thumbDown: "mute", pointUp: "next",
    finger1: "play", finger2: "pause", finger3: "next",
    voicePlay: "play", voicePause: "pause", voiceNext: "next", voicePrev: "prev",
    voiceLike: "like", voiceMute: "mute", voiceUnmute: "mute"
  };
  return map[trigger] || null;
}
