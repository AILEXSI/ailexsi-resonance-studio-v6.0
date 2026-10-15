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

/** Fail closed. 256 KB of UTF-8 text, and 5000 lines. Over-limit input is rejected, not truncated. */
export const MAX_LYRICS_BYTES = 256 * 1024;
export const MAX_LYRICS_LINES = 5_000;
/** Shared lyric clock. Stamps and the LRC offset stay inside one day. */
export const MAX_LYRIC_TIME_MS = 24 * 60 * 60 * 1000;

export class SongInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SongInputError";
  }
}

function pad(n: number): string {
  return String(n).padStart(4, "0");
}

function utf8BytesExceeds(text: string, max: number): boolean {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
    if (bytes > max) return true;
  }
  return false;
}

function lyricLineCount(text: string): number {
  if (text.length === 0) return 0;
  let count = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  if (text.charCodeAt(text.length - 1) === 10) count -= 1;
  return count;
}

export function assertLyricTextLimits(text: string, label: "lyrics" | "lrc"): void {
  if (utf8BytesExceeds(text, MAX_LYRICS_BYTES)) {
    throw new SongInputError(`${label} exceeds ${MAX_LYRICS_BYTES} bytes`);
  }
  if (lyricLineCount(text) > MAX_LYRICS_LINES) {
    throw new SongInputError(`${label} exceeds ${MAX_LYRICS_LINES} lines`);
  }
}

export function assertLyricTimeMs(timeMs: number): void {
  if (!Number.isFinite(timeMs) || timeMs < 0 || timeMs > MAX_LYRIC_TIME_MS) {
    throw new SongInputError(`LRC time must be from 0 through ${MAX_LYRIC_TIME_MS} ms`);
  }
}

function finiteOrNull(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

/** Supplied times are kept only when they are finite and inside one day. */
function optionalTime(value: number | null | undefined): number | null {
  if (value == null) return null;
  assertLyricTimeMs(value);
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
  assertLyricTextLimits(text, "lyrics");
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

/** LRC stamp: mm:ss, mm:ss.xx (centiseconds), or mm:ss.xxx (milliseconds). Minutes are at most 4 digits. */
export function lrcStampToMs(minutes: string, seconds: string, fraction: string | undefined): number {
  if (!/^\d{1,4}$/.test(minutes) || !/^\d{2}$/.test(seconds)) {
    throw new SongInputError("LRC timestamp is invalid");
  }
  if (fraction != null && !/^\d{1,3}$/.test(fraction)) {
    throw new SongInputError("LRC timestamp is invalid");
  }
  const mm = Number(minutes);
  const ss = Number(seconds);
  if (!Number.isFinite(mm) || !Number.isFinite(ss) || !Number.isInteger(ss) || ss > 59) {
    throw new SongInputError("LRC timestamp is invalid");
  }
  let frac = 0;
  if (fraction) {
    const parsed = Number(fraction);
    if (!Number.isFinite(parsed)) throw new SongInputError("LRC timestamp is invalid");
    if (fraction.length === 1) frac = parsed * 100;
    else if (fraction.length === 2) frac = parsed * 10;
    else frac = parsed;
  }
  const timeMs = Math.round(mm * 60_000 + ss * 1000 + frac);
  assertLyricTimeMs(timeMs);
  return timeMs;
}

interface TimedToken {
  text: string;
  timeMs: number | null;
}

const STAMP = String.raw`(\d{1,4}):(\d{2})(?:[.:](\d{1,3}))?`;
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
    if (minutes != null && seconds != null) {
      pending = applyLrcOffset(lrcStampToMs(minutes, seconds, fraction), offsetMs);
    }
    cursor = match.index + match[0].length;
  }
  for (const text of tokens(payload.slice(cursor))) {
    tokensOut.push({ text, timeMs: pending });
    pending = null;
  }
  return tokensOut;
}

function parseOffsetTag(line: string): number {
  const match = /^\[offset:\s*([+-]?\d{1,8})\s*\]$/i.exec(line);
  if (!match) throw new SongInputError("LRC offset is invalid");
  const offset = Number(match[1]);
  if (!Number.isFinite(offset) || !Number.isInteger(offset) || offset < -MAX_LYRIC_TIME_MS || offset > MAX_LYRIC_TIME_MS) {
    throw new SongInputError("LRC offset is invalid");
  }
  return offset;
}

/**
 * LRC offset is one value for the whole file, wherever the tag sits.
 * Positive offset means earlier: timeMs = stamp - offset.
 */
function fileOffsetMs(lines: readonly string[]): number {
  let offsetMs = 0;
  for (const line of lines) {
    if (/^\[offset:/i.test(line)) offsetMs = parseOffsetTag(line);
  }
  return offsetMs;
}

function applyLrcOffset(stampMs: number, offsetMs: number): number {
  const timeMs = stampMs - offsetMs;
  assertLyricTimeMs(timeMs);
  return timeMs;
}

export function parseLrc(lrc: string): LyricLine[] {
  assertLyricTextLimits(lrc, "lrc");
  const source = lrc.split(/\r?\n/).map((raw) => raw.trim()).filter((line) => line.length > 0);
  const offsetMs = fileOffsetMs(source);
  const rows: Array<{ timeMs: number; text: string }> = [];
  for (const line of source) {
    if (/^\[offset:/i.test(line)) continue;
    if (/^\[[a-z]+:/i.test(line)) continue;
    if (/[<[]\d{5,}:/.test(line)) throw new SongInputError("LRC timestamp is invalid");
    if (!/^\[\d+:/.test(line)) continue;
    if (!LEADING_STAMP.test(line)) throw new SongInputError("LRC timestamp is invalid");
    const times: number[] = [];
    let rest = line;
    let lead: RegExpExecArray | null;
    while ((lead = LEADING_STAMP.exec(rest))) {
      times.push(applyLrcOffset(lrcStampToMs(lead[1]!, lead[2]!, lead[3]), offsetMs));
      rest = rest.slice(lead[0].length);
    }
    if (times.length === 0) throw new SongInputError("LRC timestamp is invalid");
    const text = stripStampTags(rest);
    if (!text) continue;
    if (/[<[]\d{5,}:/.test(rest)) throw new SongInputError("LRC timestamp is invalid");
    for (const timeMs of times) rows.push({ timeMs, text: rest.trim() });
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
  const lineTime = optionalTime(timeMs);
  const lineStatus: LyricAlignStatus = lineTime == null ? "UNALIGNED" : status;
  const words = wordTokens.filter((token) => token.text.trim().length > 0);
  return {
    id,
    index,
    text: text.trim(),
    timeMs: lineTime,
    endMs: lineTime == null ? null : optionalTime(endMs),
    status: lineStatus,
    confidence: lineTime == null ? null : confidenceOrNull(confidence),
    words: words.map((token, wordIndex) => {
      const wordTime = optionalTime(token.timeMs);
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
        optionalTime(row.timeMs),
        optionalTime(row.endMs),
        "MANUAL",
        confidenceOrNull(row.confidence),
        provided.map((item) => ({
          text: item.text.trim(),
          timeMs: "timeMs" in item ? optionalTime(item.timeMs) : null,
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
