export const AI_PREFS_KEY = "resonance-studio-v6-0-ai-prefs";

export type AiProviderKind = "mock" | "local" | "cloud";

export interface AiPrefs {
  provider: AiProviderKind;
  baseUrl: string;
  model: string;
  /** Opt in to the OS keychain. This flag is not the key. */
  rememberKey: boolean;
}

export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_AI_PREFS: AiPrefs = {
  provider: "mock",
  baseUrl: "",
  model: "",
  rememberKey: false,
};

function kindOf(value: unknown): AiProviderKind {
  return value === "local" || value === "cloud" ? value : "mock";
}

/** Drops any stored key. Prefs are base URL and model only. */
export function readAiPrefs(storage?: PrefsStorage | null): AiPrefs {
  try {
    const raw = storage?.getItem(AI_PREFS_KEY);
    if (!raw) return { ...DEFAULT_AI_PREFS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      provider: kindOf(parsed.provider),
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      rememberKey: parsed.rememberKey === true,
    };
  } catch {
    return { ...DEFAULT_AI_PREFS };
  }
}

export function writeAiPrefs(prefs: AiPrefs, storage?: PrefsStorage | null): void {
  try {
    storage?.setItem(
      AI_PREFS_KEY,
      JSON.stringify({
        provider: kindOf(prefs.provider),
        baseUrl: prefs.baseUrl,
        model: prefs.model,
        rememberKey: prefs.rememberKey === true,
      }),
    );
  } catch {
    /* ignore denied storage */
  }
}
