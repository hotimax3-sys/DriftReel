// Plain-language mapping of media-device and capture errors.
// Never surfaces a raw Event/Exception object to the user.

export function describeMediaError(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  const name = err.name || err.type || "";
  const msg = err.message || "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera/mic permission denied — click the DriftReel icon and press Enable Camera/Microphone";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera/microphone detected on this device";
    case "NotReadableError":
    case "TrackStartError":
      return "Camera/mic is in use by another app — close it and try again";
    case "AbortError":
      return "Camera/mic could not start — try again";
    case "ended":
      return "Camera disconnected";
    case "mute":
      return "Camera/mic temporarily unavailable";
    default:
      if (msg) return msg;
      return "Camera/mic error (" + name + ")";
  }
}

export function isPermissionDenied(err) {
  const name = err && (err.name || err.type);
  return name === "NotAllowedError" || name === "SecurityError";
}
