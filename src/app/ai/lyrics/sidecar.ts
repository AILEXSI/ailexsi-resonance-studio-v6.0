/**
 * Lyric timing lives beside the project. It is not a Project field.
 * project schemaVersion stays 5.
 */

export interface LyricLine {
  text: string;
  startMs: number | null;
  endMs: number | null;
  sceneId: string | null;
  imagePrompt: string | null;
  reason: string | null;
}

export interface LyricAlignment {
  engine: "whisper.cpp" | "none";
  status: "unaligned" | "aligned" | "partial" | "unavailable";
  message: string;
}

export interface LyricSidecar {
  kind: "ailexsi-lyric-sidecar";
  sidecarVersion: 1;
  projectSchemaVersion: 5;
  projectId: string;
  lines: LyricLine[];
  alignment: LyricAlignment;
}

export function lyricSidecarKey(projectId: string): string {
  return `resonance-studio-v6-0-lyric-sidecar:${projectId}`;
}

export function splitLyricText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function emptyAlignment(message: string): LyricAlignment {
  return { engine: "none", status: "unaligned", message };
}

export function linesFromText(text: string, previous?: readonly LyricLine[]): LyricLine[] {
  return splitLyricText(text).map((lineText, index) => {
    const prior = previous?.[index];
    if (prior && prior.text === lineText) return { ...prior };
    return {
      text: lineText,
      startMs: null,
      endMs: null,
      sceneId: null,
      imagePrompt: null,
      reason: null,
    };
  });
}

export function createLyricSidecar(projectId: string, text: string, previous?: LyricSidecar | null): LyricSidecar {
  return {
    kind: "ailexsi-lyric-sidecar",
    sidecarVersion: 1,
    projectSchemaVersion: 5,
    projectId,
    lines: linesFromText(text, previous?.lines),
    alignment: previous?.alignment ?? emptyAlignment("Lyrics are stored beside the project. Times are empty until a local aligner runs."),
  };
}

export function lyricTextOf(sidecar: LyricSidecar | null | undefined): string {
  return sidecar?.lines.map((line) => line.text).join("\n") ?? "";
}

export function parseLyricSidecar(raw: string, projectId: string): LyricSidecar | null {
  try {
    const value = JSON.parse(raw) as Partial<LyricSidecar>;
    if (value.kind !== "ailexsi-lyric-sidecar" || value.sidecarVersion !== 1) return null;
    if (value.projectSchemaVersion !== 5) return null;
    if (value.projectId !== projectId || !Array.isArray(value.lines)) return null;
    const lines = value.lines.flatMap((line) => {
      if (!line || typeof line.text !== "string" || line.text.trim().length === 0) return [];
      return [
        {
          text: line.text,
          startMs: finiteOrNull(line.startMs),
          endMs: finiteOrNull(line.endMs),
          sceneId: typeof line.sceneId === "string" ? line.sceneId : null,
          imagePrompt: typeof line.imagePrompt === "string" ? line.imagePrompt : null,
          reason: typeof line.reason === "string" ? line.reason : null,
        },
      ];
    });
    const alignment = value.alignment;
    return {
      kind: "ailexsi-lyric-sidecar",
      sidecarVersion: 1,
      projectSchemaVersion: 5,
      projectId,
      lines,
      alignment:
        alignment && (alignment.status === "aligned" || alignment.status === "partial" || alignment.status === "unavailable" || alignment.status === "unaligned")
          ? {
              engine: alignment.engine === "whisper.cpp" ? "whisper.cpp" : "none",
              status: alignment.status,
              message: typeof alignment.message === "string" ? alignment.message : "",
            }
          : emptyAlignment(""),
    };
  } catch {
    return null;
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export interface LyricStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readLyricSidecar(projectId: string, storage?: LyricStorage | null): LyricSidecar | null {
  try {
    const raw = storage?.getItem(lyricSidecarKey(projectId));
    if (!raw) return null;
    return parseLyricSidecar(raw, projectId);
  } catch {
    return null;
  }
}

export function writeLyricSidecar(sidecar: LyricSidecar, storage?: LyricStorage | null): void {
  try {
    storage?.setItem(lyricSidecarKey(sidecar.projectId), JSON.stringify(sidecar));
  } catch {
    /* private mode */
  }
}
