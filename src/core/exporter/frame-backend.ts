/**
 * Live export frame-backend id. Kept out of the decoder module so the
 * export dialog can name the engine without loading it.
 */
import type { FrameSourceBackendId } from "../frame-engine";

let frameSourceBackend: FrameSourceBackendId = "ailexsi";

export function getFrameSourceBackend(): FrameSourceBackendId {
  return frameSourceBackend;
}

/** Testing / internal only. Production default is AILEXSI. */
export function setFrameSourceBackend(next: FrameSourceBackendId): void {
  frameSourceBackend = next === "htmlvideo" ? "htmlvideo" : "ailexsi";
}

export function resetFrameSourceBackend(): void {
  frameSourceBackend = "ailexsi";
}

/** User-facing Export label from the live backend id. */
export function exportFrameEngineLabel(): string {
  return getFrameSourceBackend() === "ailexsi" ? "AILEXSI" : getFrameSourceBackend().toUpperCase();
}
