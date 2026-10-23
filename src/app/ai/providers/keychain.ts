import { isTauriRuntime } from "../../../core/tauri-runtime";

export interface OsKeychain {
  available: boolean;
  /** Shown in the panel. Never includes the secret. */
  reason: string;
  read(): Promise<string | null>;
  write(secret: string): Promise<void>;
  remove(): Promise<void>;
}

export const BROWSER_KEYCHAIN_REASON =
  "This page is not the desktop app. The key stays in memory for this session and is not saved.";

const SERVICE = "com.ailexsi.resonance-studio-v6-0";

export function memoryKeychain(reason: string): OsKeychain {
  return {
    available: false,
    reason,
    async read() {
      return null;
    },
    async write() {
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
    reason: `OS keychain (${SERVICE}) is available. Saving is opt-in and is not localStorage.`,
    async read() {
      const value = await invoke("ai_keychain_get");
      return typeof value === "string" && value.length > 0 ? value : null;
    },
    async write(secret: string) {
      await invoke("ai_keychain_set", { secret });
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
