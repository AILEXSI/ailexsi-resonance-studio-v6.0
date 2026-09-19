/**
 * Local AI prefs. Never stored on Project / schema 5.
 * API keys stay in memory only — not written here.
 */

export const AI_PREFS_KEY = "resonance-studio-v6-0-ai-prefs";

export interface DirectorAiPrefs {
  providerId: "mock" | "openai-compatible";
  baseUrl: string;
  model: string;
}

export const DEFAULT_AI_PREFS: DirectorAiPrefs = {
  providerId: "mock",
  baseUrl: "",
  model: "",
};

export function loadAiPrefs(storage: { getItem(key: string): string | null } | null): DirectorAiPrefs {
  if (!storage) return { ...DEFAULT_AI_PREFS };
  try {
    const raw = storage.getItem(AI_PREFS_KEY);
    if (!raw) return { ...DEFAULT_AI_PREFS };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.apiKey != null) {
      throw new Error("AI prefs must not contain apiKey");
    }
    return {
      providerId: parsed.providerId === "openai-compatible" ? "openai-compatible" : "mock",
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
    };
  } catch {
    return { ...DEFAULT_AI_PREFS };
  }
}

export function saveAiPrefs(
  storage: { setItem(key: string, value: string): void } | null,
  prefs: DirectorAiPrefs,
): void {
  if (!storage) return;
  const safe: DirectorAiPrefs = {
    providerId: prefs.providerId,
    baseUrl: prefs.baseUrl,
    model: prefs.model,
  };
  storage.setItem(AI_PREFS_KEY, JSON.stringify(safe));
}

export function prefsContainSecret(json: string): boolean {
  return /apiKey|authorization|Bearer /i.test(json);
}
