import { isTauriRuntime } from "../../../core/tauri-runtime";

export interface OsKeychain {
  available: boolean;
  /** Shown in the panel. Never includes the secret. */
  reason: string;
  /** Whether a key is stored. Never the key itself. */
  exists(): Promise<boolean>;
  write(secret: string, baseUrl: string): Promise<void>;
  remove(): Promise<void>;
}

export const BROWSER_KEYCHAIN_REASON =
  "This page is not the desktop app. The key stays in memory for this session and is not saved.";

const SERVICE = "com.ailexsi.resonance-studio-v6-0";

export function memoryKeychain(reason: string): OsKeychain {
  return {
    available: false,
    reason,
    async exists() {
      return false;
    },
    async write(_secret: string, _baseUrl: string) {
      throw new Error("OS keychain is not available");
    },
    async remove() {
      /* nothing stored */
    },
  };
}

type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** Desktop adapter. The secret is an argument to the Tauri command, never a prefs field. */
export function tauriKeychain(invoke: Invoke): OsKeychain {
  return {
    available: true,
    reason: `OS keychain (${SERVICE}) is available. Saving is opt-in and is not localStorage. A saved key is not copied into this field.`,
    async exists() {
      const value = await invoke("ai_keychain_exists");
      return value === true;
    },
    async write(secret: string, baseUrl: string) {
      await invoke("ai_keychain_set", { secret, baseUrl });
    },
    async remove() {
      await invoke("ai_keychain_delete");
    },
  };
}

export async function detectOsKeychain(): Promise<OsKeychain> {
  if (!isTauriRuntime()) {
    return memoryKeychain(BROWSER_KEYCHAIN_REASON);
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("ai_keychain_status");
    return tauriKeychain(invoke);
  } catch (error) {
    const message = error instanceof Error ? error.message : "OS keychain is not available";
    return memoryKeychain(message);
  }
}
