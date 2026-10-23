/** AI Director feature gate. Default OFF. Never stored in the project document. */

export const AI_DIRECTOR_FLAG_KEY = "resonance-studio-v6-0-ai-director";

export interface FlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Missing key and any value other than `"1"` stay off. */
export function readAiDirectorEnabled(storage?: FlagStorage | null): boolean {
  try {
    return storage?.getItem(AI_DIRECTOR_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeAiDirectorEnabled(enabled: boolean, storage?: FlagStorage | null): void {
  try {
    storage?.setItem(AI_DIRECTOR_FLAG_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / denied storage — the in-memory toggle still works */
  }
}
