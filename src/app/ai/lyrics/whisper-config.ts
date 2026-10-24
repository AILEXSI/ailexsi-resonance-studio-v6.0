/**
 * File names reported by the desktop app.
 * The executable and model paths stay in Rust app settings.
 */

export interface WhisperStatus {
  executableName: string;
  modelName: string;
  configured: boolean;
}

export const EMPTY_WHISPER: WhisperStatus = {
  executableName: "",
  modelName: "",
  configured: false,
};

/** Older builds stored full paths in localStorage. Drop them so they are not reused. */
const LEGACY_PATH_KEY = "resonance-studio-v6-0-whisper-cpp";

export function clearLegacyWhisperPaths(storage?: { removeItem(key: string): void } | null): void {
  try {
    storage?.removeItem(LEGACY_PATH_KEY);
  } catch {
    /* private mode */
  }
}

export function whisperStatusFrom(value: unknown): WhisperStatus {
  if (!value || typeof value !== "object") return { ...EMPTY_WHISPER };
  const record = value as { executableName?: unknown; modelName?: unknown; configured?: unknown };
  return {
    executableName: typeof record.executableName === "string" ? record.executableName : "",
    modelName: typeof record.modelName === "string" ? record.modelName : "",
    configured: record.configured === true,
  };
}
