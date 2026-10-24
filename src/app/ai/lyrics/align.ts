import { assetById, kindOfTrack, type Clip } from "../../../core/models";
import { isTauriRuntime } from "../../../core/tauri-runtime";
import { selectionOf, type Session } from "../../session";
import type { LyricAlignment, LyricLine } from "./sidecar";

export interface WhisperSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface WhisperRunInput {
  audioPath: string;
}

const NOT_CONFIGURED =
  "whisper.cpp is not configured. Choose the executable and model in the desktop app. Nothing was sent.";
const NO_AUDIO =
  "No local audio file is available for alignment. A blob preview is not a file whisper.cpp can read. Nothing was sent.";
const DESKTOP_ONLY =
  "whisper.cpp alignment runs in the desktop app when the executable and model are configured. Nothing was sent.";

export function localAudioPath(session: Session): { path: string; note: string } | { error: string } {
  const selected = selectionOf(session)
    .map((id) => session.project.clips.find((clip) => clip.id === id))
    .filter((clip): clip is Clip => !!clip);
  const direct = selected
    .map((clip) => filePathOf(session, clip))
    .find((item): item is { path: string; note: string } => item !== null && "path" in item);
  if (direct) return direct;
  const videoSelected = selected.some((clip) => kindOfTrack(clip.trackId) === "video");
  const audioClips = session.project.clips.filter((clip) => {
    const asset = assetById(session.project, clip.assetId);
    return asset?.kind === "audio" && !asset.missing;
  });
  const pool = videoSelected ? audioClips.filter((clip) => clip.trackId === "A1") : audioClips;
  const found = pool.map((clip) => filePathOf(session, clip)).find((item) => item && "path" in item);
  if (found && "path" in found) {
    return { path: found.path, note: videoSelected ? "Using the audio file on A1." : found.note };
  }
  return { error: NO_AUDIO };
}

function filePathOf(session: Session, clip: Clip): { path: string; note: string } | null {
  const asset = assetById(session.project, clip.assetId);
  const path = asset?.sourcePath?.trim() ?? "";
  if (!path || path.startsWith("blob:") || path.startsWith("data:")) return null;
  return { path, note: "" };
}

/** whisper.cpp JSON (`-oj`). Offsets are milliseconds. User spelling is not taken from this text. */
export function segmentsFromWhisperJson(raw: string): WhisperSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  const record = parsed && typeof parsed === "object" ? (parsed as { transcription?: unknown; segments?: unknown }) : null;
  const rows = Array.isArray(record?.transcription)
    ? record.transcription
    : Array.isArray(record?.segments)
      ? record.segments
      : Array.isArray(parsed)
        ? parsed
        : [];
  const segments: WhisperSegment[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as {
      text?: unknown;
      offsets?: { from?: unknown; to?: unknown };
      timestamps?: { from?: unknown; to?: unknown };
      start?: unknown;
      end?: unknown;
    };
    const text = typeof item.text === "string" ? item.text.trim() : "";
    const from = millisOf(item.offsets?.from) ?? stampOf(item.timestamps?.from) ?? secondsOf(item.start);
    const to = millisOf(item.offsets?.to) ?? stampOf(item.timestamps?.to) ?? secondsOf(item.end);
    if (from === null || to === null || to < from) continue;
    segments.push({ startMs: from, endMs: to, text });
  }
  return segments;
}

function millisOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
}

function secondsOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value * 1000) : null;
}

/** whisper.cpp prints `00:00:01,160` or `00:00:01.160`. */
export function stampOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(?:(\d+):)?(\d+):(\d+)[,.](\d+)$/);
  if (!match) return null;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4] ?? "0";
  const millis = Number(fraction.padEnd(3, "0").slice(0, 3));
  if (![hours, minutes, seconds, millis].every(Number.isFinite)) return null;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

/**
 * Place measured times on the lines the user wrote.
 * Does not replace spelling, drop a line, or invent a line.
 */
export function applyWhisperTimes(lines: readonly LyricLine[], segments: readonly WhisperSegment[]): {
  lines: LyricLine[];
  alignment: LyricAlignment;
} {
  const next = lines.map((line, index) => {
    const segment = segments[index];
    if (!segment) return { ...line, startMs: null, endMs: null };
    return { ...line, text: line.text, startMs: segment.startMs, endMs: segment.endMs };
  });
  const missing = next.flatMap((line, index) => (line.startMs === null ? [index + 1] : []));
  if (segments.length === 0) {
    return {
      lines: next,
      alignment: {
        engine: "whisper.cpp",
        status: "unavailable",
        message: "whisper.cpp returned no timed lines. Your lyrics were kept. Nothing was invented.",
      },
    };
  }
  if (missing.length === 0) {
    return {
      lines: next,
      alignment: {
        engine: "whisper.cpp",
        status: "aligned",
        message: `whisper.cpp placed times on ${next.length} line${next.length === 1 ? "" : "s"}. The words were not rewritten.`,
      },
    };
  }
  return {
    lines: next,
    alignment: {
      engine: "whisper.cpp",
      status: "partial",
      message: `Lines ${missing.join(", ")} have no time. whisper.cpp returned fewer segments than lines. Those lines were kept.`,
    },
  };
}

export async function alignLyrics(opts: {
  lines: readonly LyricLine[];
  audioPath: string | null;
  /** False when the desktop app has not stored an executable and a model. */
  configured?: boolean;
  /** Shown when the desktop app already knows the choice is missing or unsealed. */
  unavailableMessage?: string;
  run?: (input: WhisperRunInput) => Promise<string>;
  invoke?: (command: string, args: WhisperRunInput) => Promise<string>;
  tauri?: boolean;
}): Promise<{ lines: LyricLine[]; alignment: LyricAlignment }> {
  if (opts.configured === false) {
    return {
      lines: opts.lines.map((line) => ({ ...line })),
      alignment: { engine: "none", status: "unavailable", message: opts.unavailableMessage || NOT_CONFIGURED },
    };
  }
  if (!opts.audioPath) {
    return { lines: opts.lines.map((line) => ({ ...line })), alignment: { engine: "none", status: "unavailable", message: NO_AUDIO } };
  }
  const input = { audioPath: opts.audioPath };
  try {
    let raw: string;
    if (opts.run) raw = await opts.run(input);
    else if (opts.invoke) raw = await opts.invoke("lyrics_whisper_align", input);
    else if (opts.tauri ?? isTauriRuntime()) {
      const { invoke } = await import("@tauri-apps/api/core");
      raw = await invoke<string>("lyrics_whisper_align", input);
    } else {
      return { lines: opts.lines.map((line) => ({ ...line })), alignment: { engine: "none", status: "unavailable", message: DESKTOP_ONLY } };
    }
    return applyWhisperTimes(opts.lines, segmentsFromWhisperJson(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      lines: opts.lines.map((line) => ({ ...line })),
      alignment: { engine: "whisper.cpp", status: "unavailable", message: message || "whisper.cpp failed. Nothing was changed." },
    };
  }
}
