/**
 * AI Director feature gate. Not part of Project / schema 5.
 * Default OFF — existing V6 UI and behavior when disabled.
 */

export const DIRECTOR_FLAG_KEY = "resonance-studio-v6-0-ai-director";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

let testOverride: boolean | null = null;

/** Test-only override. Pass null to restore default resolution. */
export function setDirectorEnabledForTests(value: boolean | null): void {
  testOverride = value;
}

export function directorFlagFromSearch(search: string): boolean {
  if (!search) return false;
  const q = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(q);
  const raw = params.get("ai") ?? params.get("director");
  return raw === "1" || raw === "true";
}

export function directorFlagFromStorage(storage: StorageLike | null | undefined): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(DIRECTOR_FLAG_KEY);
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

/**
 * Resolve whether the Director shell may mount.
 * Order: test override → URL ?ai=1 → localStorage. Default false.
 */
export function isDirectorEnabled(opts?: {
  search?: string;
  storage?: StorageLike | null;
}): boolean {
  if (testOverride !== null) return testOverride;
  const search =
    opts?.search ?? (typeof window !== "undefined" ? window.location.search : "");
  if (directorFlagFromSearch(search)) return true;
  const storage =
    opts?.storage === undefined
      ? typeof localStorage !== "undefined"
        ? localStorage
        : null
      : opts.storage;
  return directorFlagFromStorage(storage);
}
