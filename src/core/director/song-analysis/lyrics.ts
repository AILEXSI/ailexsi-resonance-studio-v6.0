/**
 * Lyrics input for pass 0.
 * Plain text splits into lines and words with no timestamps.
 * LRC and manual timestamps are copied through. NullAligner never invents a time.
 */
import type { LyricAlignStatus, LyricLine, LyricWord } from "./types";

export interface AlignRequest {
  lines: readonly LyricLine[];
  /** Present so a later local aligner can read PCM. Pass 0's NullAligner ignores it. */
  pcm: unknown;
}

export interface Aligner {
  readonly id: string;
  align(request: AlignRequest): LyricLine[];
}

export interface ManualLyricWord {
  text: string;
  timeMs?: number | null;
  endMs?: number | null;
  confidence?: number | null;
}

export interface ManualLyricLine {
  text: string;
  timeMs?: number | null;
  endMs?: number | null;
  confidence?: number | null;
  words?: readonly ManualLyricWord[];
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function confidenceOrNull(value: number | null | undefined): number | null {
  const n = finiteOrNull(value);
  if (n == null || n < 0 || n > 1) return null;
  return n;
}

function stripStampTags(payload: string): string {
  return payload.replace(new RegExp(WORD_STAMP.source, "g"), " ").replace(/\s+/g, " ").trim();
}

function word(id: string, text: string, timeMs: number | null, endMs: number | null, status: LyricAlignStatus, confidence: number | null): LyricWord {
  return {
    id,
    text,
    timeMs: status === "UNALIGNED" ? null : timeMs,
    endMs: status === "UNALIGNED" ? null : endMs,
    status: timeMs == null ? "UNALIGNED" : status,
    confidence: timeMs == null ? null : confidence,
  };
}

function tokens(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

export function splitLyricsText(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  let index = 0;
  for (const raw of text.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const id = `line_${pad(index)}`;
    lines.push({
      id,
      index,
      text: trimmed,
      timeMs: null,
      endMs: null,
      status: "UNALIGNED",
      confidence: null,
      words: tokens(trimmed).map((token, wordIndex) =>
        word(`${id}_w${pad(wordIndex)}`, token, null, null, "UNALIGNED", null),
      ),
    });
    index += 1;
  }
  return lines;
}

/** LRC stamp: mm:ss, mm:ss.xx (centiseconds), or mm:ss.xxx (milliseconds). */
export function lrcStampToMs(minutes: string, seconds: string, fraction: string | undefined): number {
  const mm = Number(minutes);
  const ss = Number(seconds);
  let frac = 0;
  if (fraction) {
    if (fraction.length === 1) frac = Number(fraction) * 100;
    else if (fraction.length === 2) frac = Number(fraction) * 10;
    else frac = Number(fraction.slice(0, 3));
  }
  return Math.round(mm * 60_000 + ss * 1000 + frac);
}

interface TimedToken {
  text: string;
  timeMs: number | null;
}

const STAMP = String.raw`(\d+):(\d{2})(?:[.:](\d{1,3}))?`;
const LEADING_STAMP = new RegExp(`^\\[${STAMP}\\]`);
const WORD_STAMP = new RegExp(`<(?:${STAMP})>|\\[(?:${STAMP})\\]`, "g");

function parseWordPayload(payload: string, offsetMs = 0): TimedToken[] {
  if (!payload.trim()) return [];
  if (!new RegExp(STAMP).test(payload) || !/[<[]/.test(payload)) {
    return tokens(payload).map((text) => ({ text, timeMs: null }));
  }
  const tokensOut: TimedToken[] = [];
  let pending: number | null = null;
  const re = new RegExp(WORD_STAMP.source, "g");
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(payload))) {
    const before = payload.slice(cursor, match.index);
    for (const text of tokens(before)) {
      tokensOut.push({ text, timeMs: pending });
      pending = null;
    }
    const minutes = match[1] ?? match[4];
    const seconds = match[2] ?? match[5];
    const fraction = match[3] ?? match[6];
    if (minutes != null && seconds != null) pending = lrcStampToMs(minutes, seconds, fraction) + offsetMs;
    cursor = match.index + match[0].length;
  }
  for (const text of tokens(payload.slice(cursor))) {
    tokensOut.push({ text, timeMs: pending });
    pending = null;
  }
  return tokensOut;
}

export function parseLrc(lrc: string): LyricLine[] {
  let offsetMs = 0;
  const rows: Array<{ timeMs: number; text: string }> = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const offset = /^\[offset:\s*([+-]?\d+)\s*\]$/i.exec(line);
    if (offset) {
      offsetMs = Number(offset[1]);
      continue;
    }
    if (/^\[[a-z]+:/i.test(line)) continue;
    const times: number[] = [];
    let rest = line;
    let lead: RegExpExecArray | null;
    while ((lead = LEADING_STAMP.exec(rest))) {
      times.push(lrcStampToMs(lead[1]!, lead[2]!, lead[3]));
      rest = rest.slice(lead[0].length);
    }
    if (times.length === 0) continue;
    const text = stripStampTags(rest);
    if (!text) continue;
    for (const timeMs of times) rows.push({ timeMs: timeMs + offsetMs, text: rest.trim() });
  }
  rows.sort((a, b) => a.timeMs - b.timeMs || a.text.localeCompare(b.text));
  return rows.map((row, index) =>
    lineFromParts(index, stripStampTags(row.text), row.timeMs, null, "LRC", null, parseWordPayload(row.text, offsetMs)),
  );
}

function lineFromParts(
  index: number,
  text: string,
  timeMs: number | null,
  endMs: number | null,
  status: LyricAlignStatus,
  confidence: number | null,
  wordTokens: readonly TimedToken[],
): LyricLine {
  const id = `line_${pad(index)}`;
  const lineTime = finiteOrNull(timeMs);
  const lineStatus: LyricAlignStatus = lineTime == null ? "UNALIGNED" : status;
  const words = wordTokens.filter((token) => token.text.trim().length > 0);
  return {
    id,
    index,
    text: text.trim(),
    timeMs: lineTime,
    endMs: lineTime == null ? null : finiteOrNull(endMs),
    status: lineStatus,
    confidence: lineTime == null ? null : confidenceOrNull(confidence),
    words: words.map((token, wordIndex) => {
      const wordTime = finiteOrNull(token.timeMs);
      const wordStatus: LyricAlignStatus = wordTime == null ? "UNALIGNED" : status;
      return word(`${id}_w${pad(wordIndex)}`, token.text.trim(), wordTime, null, wordStatus, null);
    }),
  };
}

export function linesFromManual(manual: readonly ManualLyricLine[]): LyricLine[] {
  const lines: LyricLine[] = [];
  let index = 0;
  for (const row of manual) {
    const text = row.text.trim();
    if (!text) continue;
    const provided = row.words && row.words.length > 0 ? row.words : tokens(text).map((token) => ({ text: token }));
    lines.push(
      lineFromParts(
        index,
        text,
        finiteOrNull(row.timeMs),
        finiteOrNull(row.endMs),
        "MANUAL",
        confidenceOrNull(row.confidence),
        provided.map((item) => ({
          text: item.text.trim(),
          timeMs: "timeMs" in item ? finiteOrNull(item.timeMs) : null,
        })),
      ),
    );
    index += 1;
  }
  return lines.filter((line) => line.text.length > 0);
}

/**
 * Does not read PCM and does not assign timeMs.
 * Timestamps already supplied (manual or LRC) are preserved. Missing times stay null / UNALIGNED.
 */
export const nullAligner: Aligner = {
  id: "null",
  align(request) {
    return request.lines.map((line) => ({
      ...line,
      timeMs: line.timeMs,
      endMs: line.timeMs == null ? null : line.endMs,
      status: line.timeMs == null ? "UNALIGNED" : line.status,
      confidence: line.timeMs == null ? null : line.confidence,
      words: line.words.map((item) => ({
        ...item,
        timeMs: item.timeMs,
        endMs: item.timeMs == null ? null : item.endMs,
        status: item.timeMs == null ? "UNALIGNED" : item.status,
        confidence: item.timeMs == null ? null : item.confidence,
      })),
    }));
  },
};

export function normalizeLines(lines: readonly LyricLine[]): LyricLine[] {
  return nullAligner.align({ lines, pcm: null });
}
