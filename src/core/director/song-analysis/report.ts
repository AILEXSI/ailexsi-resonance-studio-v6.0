/**
 * Assemble the pass-0 report. Validates levels before returning.
 * PCM clock is shifted by timelineOriginMs. Lyric times are already on that axis.
 */
import type { MixPcm } from "../../visualz/feature-extractor";
import { analyzePcm, pcmIsUsable } from "./audio";
import { buildJoint, DEFAULT_JOINT_WINDOW_MS } from "./joint";
import {
  assertLyricTextLimits,
  linesFromManual,
  normalizeLines,
  nullAligner,
  parseLrc,
  splitLyricsText,
  type Aligner,
  type ManualLyricLine,
} from "./lyrics";
import { isAudioObservation, sealStatement, StatementLevelError, type IdFactory } from "./seal";
import {
  SONG_ANALYSIS_PASS,
  type LyricLine,
  type SongAnalysisReport,
  type Statement,
} from "./types";

export interface SongAnalysisInput {
  pcm?: MixPcm | null;
  lyricsText?: string | null;
  lrc?: string | null;
  manualLines?: readonly ManualLyricLine[] | null;
  aligner?: Aligner;
  windowMs?: number;
  /** Added to PCM event times. Lyric timestamps are not shifted. */
  timelineOriginMs?: number;
}

export function createIdFactory(): IdFactory {
  const counts = new Map<string, number>();
  return (prefix: string) => {
    const next = counts.get(prefix) ?? 0;
    counts.set(prefix, next + 1);
    return `${prefix}_${String(next).padStart(4, "0")}`;
  };
}

function lyricObservations(lines: readonly LyricLine[], ids: IdFactory): Statement[] {
  const statements: Statement[] = [];
  for (const line of lines) {
    if (line.timeMs == null) continue;
    const source = line.status === "LRC" ? "lyrics.lrc" : "lyrics.manual";
    statements.push(
      sealStatement({
        id: ids("obs"),
        level: "OBSERVATION",
        signalSource: source,
        kind: "lyric_line",
        timeMs: line.timeMs,
        range: line.endMs == null ? null : { startMs: line.timeMs, endMs: line.endMs },
        value: line.text,
        unit: null,
        confidence: line.confidence,
        evidenceRefs: [],
        text: `lyric line ${line.id} at ${line.timeMs} ms`,
      }),
    );
    for (const item of line.words) {
      if (item.timeMs == null) continue;
      const wordSource = item.status === "LRC" ? "lyrics.lrc" : "lyrics.manual";
      statements.push(
        sealStatement({
          id: ids("obs"),
          level: "OBSERVATION",
          signalSource: wordSource,
          kind: "lyric_word",
          timeMs: item.timeMs,
          range: item.endMs == null ? null : { startMs: item.timeMs, endMs: item.endMs },
          value: item.text,
          unit: null,
          confidence: item.confidence,
          evidenceRefs: [],
          text: `lyric word at ${item.timeMs} ms`,
        }),
      );
    }
  }
  return statements;
}

function lyricsStatus(lines: readonly LyricLine[]): SongAnalysisReport["lyrics"]["status"] {
  if (lines.length === 0) return "ABSENT";
  const timed = lines.some((line) => line.timeMs != null || line.words.some((word) => word.timeMs != null));
  return timed ? "TIMED" : "TEXT";
}

function resolveLines(input: SongAnalysisInput): LyricLine[] {
  if (input.manualLines && input.manualLines.length > 0) return linesFromManual(input.manualLines);
  if (input.lrc && input.lrc.trim()) return parseLrc(input.lrc);
  if (input.lyricsText && input.lyricsText.trim()) return splitLyricsText(input.lyricsText);
  return [];
}

export function validateReport(report: SongAnalysisReport): SongAnalysisReport {
  const sealed = report.statements.map((statement) => sealStatement(statement));
  const byId = new Map(sealed.map((statement) => [statement.id, statement]));
  if (byId.size !== sealed.length) throw new StatementLevelError("statement ids must be unique");

  for (const statement of sealed) {
    if (statement.level === "EFFECT_HYPOTHESIS") {
      if (statement.hypothesis !== true) {
        throw new StatementLevelError("EFFECT_HYPOTHESIS must be flagged and cannot be stated as fact");
      }
    }
    if (statement.level === "INTERPRETATION") {
      for (const id of statement.observationIds) {
        const cited = byId.get(id);
        if (!cited || cited.level !== "OBSERVATION") {
          throw new StatementLevelError("INTERPRETATION requires references to OBSERVATION ids");
        }
      }
    }
    if (report.audio.status === "UNAVAILABLE" && statement.level === "OBSERVATION" && isAudioObservation(statement)) {
      throw new StatementLevelError("no audio means no audio-event statements");
    }
    if (report.audio.status === "UNAVAILABLE" && statement.level !== "OBSERVATION") {
      throw new StatementLevelError("audio UNAVAILABLE cannot carry an interpretation or hypothesis");
    }
  }

  if (report.audio.status === "UNAVAILABLE") {
    if (report.tempo.bpm != null || report.tempo.confidence != null || report.segments.length > 0 || report.joint.length > 0) {
      throw new StatementLevelError("audio UNAVAILABLE cannot carry tempo, segments, or joint audio claims");
    }
  }

  const lineById = new Map(report.lyrics.lines.map((line) => [line.id, line]));
  for (const line of report.lyrics.lines) {
    if (line.timeMs == null && line.status !== "UNALIGNED") {
      throw new StatementLevelError("unaligned lyric lines keep status UNALIGNED");
    }
    if (line.status === "UNALIGNED" && line.timeMs != null) {
      throw new StatementLevelError("UNALIGNED lines cannot carry a timestamp");
    }
    for (const word of line.words) {
      if (word.timeMs == null && word.status !== "UNALIGNED") {
        throw new StatementLevelError("unaligned words keep timeMs null and status UNALIGNED");
      }
      if (word.status === "UNALIGNED" && word.timeMs != null) {
        throw new StatementLevelError("UNALIGNED words cannot carry a timestamp");
      }
    }
  }
  for (const link of report.joint) {
    const line = lineById.get(link.lineId);
    if (!line || line.timeMs == null || line.timeMs !== link.timeMs) {
      throw new StatementLevelError("joint links require a lyric line that has a timestamp");
    }
    for (const id of link.observationIds) {
      const cited = byId.get(id);
      if (!cited || !isAudioObservation(cited)) {
        throw new StatementLevelError("joint audio claims must be audio OBSERVATIONs");
      }
    }
  }
  for (const line of report.lyrics.lines) {
    if (line.timeMs == null && report.joint.some((link) => link.lineId === line.id)) {
      throw new StatementLevelError("lines without timing get no audio claim");
    }
  }

  return { ...report, statements: sealed };
}

export function analyzeSong(input: SongAnalysisInput = {}): SongAnalysisReport {
  const timelineOriginMs = input.timelineOriginMs ?? 0;
  if (!Number.isFinite(timelineOriginMs)) throw new StatementLevelError("timelineOriginMs must be finite");
  const windowMs = input.windowMs ?? DEFAULT_JOINT_WINDOW_MS;
  if (!Number.isFinite(windowMs) || windowMs <= 0) throw new StatementLevelError("windowMs must be a positive finite number");
  if (input.lyricsText != null) assertLyricTextLimits(input.lyricsText, "lyrics");
  if (input.lrc != null) assertLyricTextLimits(input.lrc, "lrc");
  const aligner = input.aligner ?? nullAligner;
  const lines = normalizeLines(aligner.align({ lines: resolveLines(input), pcm: input.pcm ?? null }));
  const ids = createIdFactory();
  const source = input.pcm;
  const pcm = pcmIsUsable(source) ? analyzePcm(source, timelineOriginMs, ids) : null;
  const statements: Statement[] = [...(pcm?.statements ?? []), ...lyricObservations(lines, ids)];
  const joint = buildJoint({
    lines,
    statements,
    windowMs,
    ids,
    audioAvailable: pcm != null,
  });
  statements.push(...joint.interpretations);

  const report: SongAnalysisReport = {
    pass: SONG_ANALYSIS_PASS,
    timeline: "ms",
    timelineOriginMs,
    windowMs,
    audio: pcm?.audio ?? {
      status: "UNAVAILABLE",
      reason: "NO_PCM",
      sampleRate: null,
      channels: null,
      durationMs: null,
      hopMs: null,
      extractor: null,
    },
    tempo: pcm?.tempo ?? { bpm: null, confidence: null, onsetCount: 0 },
    segments: pcm?.segments ?? [],
    lyrics: {
      status: lyricsStatus(lines),
      alignerId: aligner.id,
      lines,
    },
    joint: joint.links,
    statements,
    notDone: {
      forcedAlignment: "NOT_IN_PASS_0",
      vocalSeparation: "NOT_IN_PASS_0",
      crossCheck: "NOT_IN_PASS_0",
      textStory: "NOT_IN_PASS_0",
      effectHypothesis: "NOT_EMITTED",
    },
  };
  return validateReport(report);
}
