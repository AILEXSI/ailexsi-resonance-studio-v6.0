/**
 * Pass-0 song-analysis report.
 * One shared timeline in milliseconds. Statements are the only claims.
 * Unknowns stay null or "UNKNOWN". Nothing in this module is HUMAN-PROVEN.
 */

export const SONG_ANALYSIS_PASS = 0 as const;

export const STATEMENT_LEVELS = ["OBSERVATION", "INTERPRETATION", "EFFECT_HYPOTHESIS"] as const;
export type StatementLevel = (typeof STATEMENT_LEVELS)[number];

/** Explicit unknown. Numeric unknowns use null, never a guessed number. */
export const UNKNOWN = "UNKNOWN" as const;

export const SIGNAL_SOURCES = [
  "pcm.offline_extractor",
  "lyrics.manual",
  "lyrics.lrc",
] as const;
export type SignalSource = (typeof SIGNAL_SOURCES)[number];

export const PCM_SIGNAL_SOURCE = "pcm.offline_extractor" as const;

export const AUDIO_OBSERVATION_KINDS = [
  "onset",
  "kick",
  "energy",
  "tempo",
  "segment",
  "segment_boundary",
  "energy_dip",
] as const;

export const LYRIC_OBSERVATION_KINDS = ["lyric_line", "lyric_word"] as const;

export const OBSERVATION_KINDS = [...AUDIO_OBSERVATION_KINDS, ...LYRIC_OBSERVATION_KINDS] as const;
export type ObservationKind = (typeof OBSERVATION_KINDS)[number];
export type AudioObservationKind = (typeof AUDIO_OBSERVATION_KINDS)[number];

export const SEGMENT_LABELS = ["intro", "build", "drop", "break", UNKNOWN] as const;
export type SegmentLabel = (typeof SEGMENT_LABELS)[number];

export const LYRIC_ALIGN_STATUSES = ["UNALIGNED", "MANUAL", "LRC"] as const;
export type LyricAlignStatus = (typeof LYRIC_ALIGN_STATUSES)[number];

/** Pass 0 interpretations may only describe co-occurrence. Alignment is not meaning. */
export const INTERPRETATION_BASES = ["co_occurrence"] as const;
export type InterpretationBasis = (typeof INTERPRETATION_BASES)[number];

export const HYPOTHESIS_STATED_AS = "HYPOTHESIS" as const;

/**
 * Reject prose that would turn timing or co-occurrence into a semantic-fit claim.
 * Alignment proves a timestamp only.
 */
export const SEMANTIC_FIT_RE =
  /\b(semantic[\s-]?fit|fits the (music|drop|beat|lyric|track)|means that|expresses|emotional match|the words match|story beat)\b/i;

export interface TimeRangeMs {
  startMs: number;
  endMs: number;
}

interface StatementCommon {
  id: string;
  confidence: number | null;
  evidenceRefs: readonly string[];
  text: string;
}

export interface ObservationStatement extends StatementCommon {
  level: "OBSERVATION";
  signalSource: SignalSource;
  /** Instant on the shared timeline. Required together with a measured value. */
  timeMs: number;
  /** Set for spans (segments, dips). Null for a point event. */
  range: TimeRangeMs | null;
  value: number | string | boolean;
  unit: string | null;
  kind: ObservationKind;
}

export interface InterpretationStatement extends StatementCommon {
  level: "INTERPRETATION";
  basis: InterpretationBasis;
  /** Ids of OBSERVATION statements. Context is not a substitute for those ids. */
  observationIds: readonly string[];
  context: string;
}

export interface EffectHypothesisStatement extends StatementCommon {
  level: "EFFECT_HYPOTHESIS";
  /** Always true. A hypothesis is never stated as a fact. */
  hypothesis: true;
  statedAs: typeof HYPOTHESIS_STATED_AS;
  observationIds: readonly string[];
}

export type Statement = ObservationStatement | InterpretationStatement | EffectHypothesisStatement;

export interface LyricWord {
  id: string;
  text: string;
  timeMs: number | null;
  endMs: number | null;
  status: LyricAlignStatus;
  confidence: number | null;
}

export interface LyricLine {
  id: string;
  index: number;
  text: string;
  timeMs: number | null;
  endMs: number | null;
  status: LyricAlignStatus;
  confidence: number | null;
  words: LyricWord[];
}

export interface SegmentObservation {
  id: string;
  label: SegmentLabel;
  startMs: number;
  endMs: number;
  confidence: number | null;
}

export interface JointLink {
  lineId: string;
  timeMs: number;
  windowMs: number;
  observationIds: readonly string[];
  interpretationId: string | null;
}

export interface SongAnalysisReport {
  pass: typeof SONG_ANALYSIS_PASS;
  timeline: "ms";
  timelineOriginMs: number;
  /** Half-width used when attaching audio observations to a timed lyric line. */
  windowMs: number;
  audio: {
    status: "OK" | "UNAVAILABLE";
    reason: "NO_PCM" | null;
    sampleRate: number | null;
    channels: number | null;
    durationMs: number | null;
    hopMs: number | null;
    extractor: "createOfflineFeatureExtractor" | null;
  };
  tempo: {
    bpm: number | null;
    confidence: number | null;
    onsetCount: number;
  };
  segments: SegmentObservation[];
  lyrics: {
    status: "ABSENT" | "TEXT" | "TIMED";
    alignerId: string;
    lines: LyricLine[];
  };
  joint: JointLink[];
  statements: Statement[];
  /** Work this pass does not do. Not measurements. */
  notDone: {
    forcedAlignment: "NOT_IN_PASS_0";
    vocalSeparation: "NOT_IN_PASS_0";
    crossCheck: "NOT_IN_PASS_0";
    textStory: "NOT_IN_PASS_0";
    effectHypothesis: "NOT_EMITTED";
  };
}
