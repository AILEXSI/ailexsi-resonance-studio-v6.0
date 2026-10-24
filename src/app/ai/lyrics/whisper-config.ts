/** Local whisper.cpp paths. Not a secret and not sent to a provider. */

export const WHISPER_CONFIG_KEY = "resonance-studio-v6-0-whisper-cpp";

export interface WhisperConfig {
  executable: string;
  model: string;
}

export interface WhisperStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const EMPTY_WHISPER: WhisperConfig = { executable: "", model: "" };

export function readWhisperConfig(storage?: WhisperStorage | null): WhisperConfig {
  try {
    const raw = storage?.getItem(WHISPER_CONFIG_KEY);
    if (!raw) return { ...EMPTY_WHISPER };
    const parsed = JSON.parse(raw) as { executable?: unknown; model?: unknown };
    return {
      executable: typeof parsed.executable === "string" ? parsed.executable : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return { ...EMPTY_WHISPER };
  }
}

export function writeWhisperConfig(config: WhisperConfig, storage?: WhisperStorage | null): void {
  try {
    storage?.setItem(
      WHISPER_CONFIG_KEY,
      JSON.stringify({
        executable: config.executable,
        model: config.model,
      }),
    );
  } catch {
    /* private mode */
  }
}
