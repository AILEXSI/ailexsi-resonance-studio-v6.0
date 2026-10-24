/**
 * Automatic export / Speichern-unter filename versioning.
 *
 * Rules (locked by tests):
 * - Suggested names are always `Stem.vN.ext`. Never unversioned, never Windows `(N)`.
 * - Empty folder / no siblings → `.v1`.
 * - Unversioned `Stem.ext` occupies v1 → next is `.v2`.
 * - Next number is one past the highest `.vN` / `_vN` (or implicit 1). Gaps are not filled.
 * - If the stem already ends with `.vN` / `_vN` and that name is free, keep N; else increment.
 * - `.short` / `.temp` / `(1)` are not versions.
 * - Compound project suffix `.resonance.json` stays intact (`Stem.v1.resonance.json`).
 * - Matching is case-insensitive; output keeps the proposed stem/ext casing.
 * - Folders are the caller's job: pass only names from the chosen directory.
 */

const VERSION_SUFFIX = /[._]v(\d+)$/i;
const EXT_OK = /^[A-Za-z0-9]{1,8}$/;
const VERSION_AS_EXT = /^v\d+$/i;
const COMPOUND_EXTS = ["resonance.json"] as const;

export interface ParsedExportFileName {
  /** Stem with `.vN` / `_vN` stripped. */
  baseStem: string;
  /** Explicit `.vN` / `_vN`. Null when the file is unversioned. */
  version: number | null;
  /** Extension without the leading dot. May be compound (`resonance.json`). */
  ext: string;
}

export function wavFileName(name: string): string {
  const base = name.replace(/\.(mp4|wav)$/i, "") || "resonance";
  return `${base}.wav`;
}

export function sanitizeMediaExportStem(name: string): string {
  const safe = (name || "resonance").replace(/[^\w\-]+/g, "_");
  return safe || "untitled";
}

/** Same sanitizing as `jobFromProject` (dots in the project title become `_`). */
export function mediaExportFileName(projectName: string, ext = "mp4"): string {
  const suffix = ext.startsWith(".") ? ext.slice(1) : ext;
  const safe = sanitizeMediaExportStem(projectName);
  if (safe.toLowerCase().endsWith(`.${suffix.toLowerCase()}`)) return safe;
  return `${safe}.${suffix}`;
}

export function splitNameAndExt(fileName: string): { stem: string; ext: string } {
  const trimmed = fileName.trim();
  const lower = trimmed.toLowerCase();
  for (const compound of COMPOUND_EXTS) {
    const token = `.${compound}`;
    if (lower.endsWith(token)) {
      return { stem: trimmed.slice(0, trimmed.length - token.length), ext: compound };
    }
  }
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot <= 0) return { stem: trimmed, ext: "" };
  const ext = trimmed.slice(lastDot + 1);
  if (EXT_OK.test(ext) && !VERSION_AS_EXT.test(ext)) {
    return { stem: trimmed.slice(0, lastDot), ext };
  }
  return { stem: trimmed, ext: "" };
}

export function parseExportFileName(fileName: string): ParsedExportFileName {
  const { stem, ext } = splitNameAndExt(fileName);
  const match = stem.match(VERSION_SUFFIX);
  if (!match) {
    return { baseStem: stem || "untitled", version: null, ext };
  }
  const raw = match[1] ?? "";
  const version = Number(raw);
  if (!Number.isSafeInteger(version) || version < 0) {
    return { baseStem: stem || "untitled", version: null, ext };
  }
  const baseStem = stem.slice(0, stem.length - match[0].length) || "untitled";
  return { baseStem, version, ext };
}

/** `version == null` formats the unversioned sibling name (for occupancy / probe only). */
export function formatExportFileName(baseStem: string, version: number | null, ext: string): string {
  const stem = baseStem || "untitled";
  const suffix = ext ? `.${ext}` : "";
  if (version == null || version < 1) return `${stem}${suffix}`;
  return `${stem}.v${version}${suffix}`;
}

function sameExportFamily(a: ParsedExportFileName, b: ParsedExportFileName): boolean {
  return a.baseStem.toLowerCase() === b.baseStem.toLowerCase() && a.ext.toLowerCase() === b.ext.toLowerCase();
}

function occupiedVersion(parsed: ParsedExportFileName): number {
  return parsed.version ?? 1;
}

/**
 * Next free suggested name. Never returns an unversioned `Stem.ext`.
 * Unversioned sibling = occupies v1; empty folder → `.v1`.
 */
export function nextVersionedFileName(proposed: string, existingNames: readonly string[]): string {
  const trimmed = (proposed ?? "").trim() || "untitled.mp4";
  const parsed = parseExportFileName(trimmed);
  const occupied = new Set<string>();
  let highest = 0;
  let foundSibling = false;

  for (const raw of existingNames) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name) continue;
    occupied.add(name.toLowerCase());
    const sibling = parseExportFileName(name);
    if (!sameExportFamily(parsed, sibling)) continue;
    foundSibling = true;
    const version = occupiedVersion(sibling);
    if (version > highest) highest = version;
  }

  if (!foundSibling) {
    const n = parsed.version != null && parsed.version >= 1 ? parsed.version : 1;
    const keep = formatExportFileName(parsed.baseStem, n, parsed.ext);
    if (!occupied.has(keep.toLowerCase())) return keep;
  }

  let next = highest + 1;
  if (next < 1) next = 1;
  for (;;) {
    const candidate = formatExportFileName(parsed.baseStem, next, parsed.ext);
    if (!occupied.has(candidate.toLowerCase())) return candidate;
    next += 1;
  }
}

export function existingExportNamesFromMemory(memory: {
  lastExportFileName?: string | null;
  lastExportFileNames?: readonly string[] | null;
}): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const name = value.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  push(memory.lastExportFileName);
  if (Array.isArray(memory.lastExportFileNames)) {
    for (const name of memory.lastExportFileNames) push(name);
  }
  return names;
}

export function existingProjectNamesFromMemory(memory: {
  lastFileName?: string | null;
  recents?: ReadonlyArray<{ lastFileName?: string | null }>;
}): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value !== "string") return;
    const name = value.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  push(memory.lastFileName);
  if (Array.isArray(memory.recents)) {
    for (const row of memory.recents) push(row?.lastFileName);
  }
  return names;
}

export function suggestedProjectSaveAsName(
  filename: string,
  memory: {
    lastFileName?: string | null;
    recents?: ReadonlyArray<{ lastFileName?: string | null }>;
  } = {},
  listedNames: readonly string[] = [],
): string {
  return nextVersionedFileName(filename, [...existingProjectNamesFromMemory(memory), ...listedNames]);
}

/** Sync default-name path: project title + remembered export names + optional folder listing. */
export function readyExportNameFromProject(
  projectName: string,
  memory: {
    lastExportFileName?: string | null;
    lastExportFileNames?: readonly string[] | null;
  },
  listedNames: readonly string[] = [],
  ext = "mp4",
): string {
  return nextVersionedFileName(mediaExportFileName(projectName, ext), [
    ...existingExportNamesFromMemory(memory),
    ...listedNames,
  ]);
}
