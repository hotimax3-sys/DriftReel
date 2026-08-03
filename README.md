# DriftReel

A Chrome extension for hands-free control of YouTube Shorts, Instagram Reels, Facebook Reels, and TikTok using head tilt, eye gaze, hand gestures, and voice commands.

## Architecture

DriftReel uses three separate components (no side panel):

1. **Hidden offscreen document** (`offscreen/`) — runs camera/mic capture, MediaPipe FaceLandmarker + GestureRecognizer, and Web Speech API. Zero visible UI, zero page footprint. Can only capture after permission is already granted.

2. **Toolbar popup** (`popup/`) — the only place that requests first-time camera/mic permission. Buttons call `getUserMedia` directly inside click handlers (genuine user gesture). Also holds sensitivity sliders and a live debug HUD with self-view + landmark overlay.

3. **On-page floating widget** (`content/`) — Shadow DOM pill, draggable/resizable/collapsible, glanceable status only. Auto-appears on supported reel pages, auto-disappears when you leave.

## How to load

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select this project folder
5. Visit any YouTube Shorts / Instagram Reels / Facebook Reels / TikTok page — the widget appears automatically
6. Click the DriftReel toolbar icon to grant camera/mic permission (one-time step)

## Controls

| Trigger | Action |
|---------|--------|
| Head tilt left / right | Previous / Next reel |
| Eye gaze left / right | Previous / Next reel |
| Eye gaze up / down | Play / Pause |
| Open palm | Pause |
| Closed palm / 1 finger | Play |
| 2 fingers | Pause |
| 3 fingers / Point up | Next |
| Thumb up | Like |
| Thumb down | Mute |
| Voice: "play", "pause", "next", "previous", "like", "mute" | Corresponding action |

## Files

- `manifest.json` — MV3 manifest (offscreen + popup + content script)
- `background/service-worker.js` — orchestrates tab watching, offscreen lifecycle, action routing
- `offscreen/offscreen.html` + `offscreen.js` — hidden capture + AI inference
- `popup/popup.html` + `popup.css` + `popup.js` — permission requests + debug HUD
- `content/content.js` — on-page floating widget (Shadow DOM)
- `lib/constants.js` — shared message types, URL matching, trigger-to-action mapping
- `lib/errors.js` — plain-language error mapping
- `lib/face_landmarker.task` + `lib/gesture_recognizer.task` — MediaPipe model files
- `lib/vision_bundle.mjs` — MediaPipe tasks-vision JS bundle
- `wasm/` — MediaPipe WASM runtime files
- `icons/` — extension icons
