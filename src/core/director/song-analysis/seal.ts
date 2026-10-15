/**
 * Level enforcement for song-analysis statements.
 * OBSERVATION is a measured signal fact.
 * INTERPRETATION may only cite OBSERVATION ids and may not claim semantic fit.
 * EFFECT_HYPOTHESIS is flagged and cannot be stored as either of the other levels.
 */
import {
  AUDIO_OBSERVATION_KINDS,
  HYPOTHESIS_STATED_AS,
  INTERPRETATION_BASES,
  LYRIC_OBSERVATION_KINDS,
  OBSERVATION_KINDS,
  PCM_SIGNAL_SOURCE,
  SEMANTIC_FIT_RE,
  SIGNAL_SOURCES,
  type EffectHypothesisStatement,
  type InterpretationBasis,
  type InterpretationStatement,
  type ObservationKind,
  type ObservationStatement,
  type SignalSource,
  type Statement,
  type TimeRangeMs,
} from "./types";

const AUDIO_KINDS = new Set<string>(AUDIO_OBSERVATION_KINDS);
const LYRIC_KINDS = new Set<string>(LYRIC_OBSERVATION_KINDS);

export type IdFactory = (prefix: string) => string;

export class StatementLevelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatementLevelError";
  }
}

function fail(message: string): never {
  throw new StatementLevelError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function confidenceOf(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    fail("confidence must be null or a finite number in [0, 1]");
  }
  return value;
}

function idOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail("statement id is required");
  return value;
}

function textOf(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) fail("statement text is required");
  return value;
}

function refsOf(value: unknown): readonly string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((ref) => typeof ref !== "string" || !ref)) {
    fail("evidenceRefs must be an array of statement ids");
  }
  return value.slice();
}

function rangeOf(value: unknown): TimeRangeMs | null {
  if (value == null) return null;
  if (!isRecord(value)) fail("range must be a time span or null");
  const startMs = value.startMs;
  const endMs = value.endMs;
  if (typeof startMs !== "number" || typeof endMs !== "number") fail("range needs startMs and endMs");
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    fail("range must be a finite millisecond span");
  }
  return { startMs, endMs };
}

function measuredValue(value: unknown): number | string | boolean {
  if (value == null) fail("OBSERVATION requires a measured value (null is not a measurement)");
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("OBSERVATION value must be finite");
    return value;
  }
  if (typeof value === "string") {
    if (!value.trim()) fail("OBSERVATION value must be a measured string or UNKNOWN");
    return value;
  }
  if (typeof value === "boolean") return value;
  fail("OBSERVATION value must be a number, string, or boolean");
}

function signalSourceOf(value: unknown): SignalSource {
  if (typeof value !== "string" || !SIGNAL_SOURCES.includes(value as SignalSource)) {
    fail("OBSERVATION requires a signal source");
  }
  return value as SignalSource;
}

function kindOf(value: unknown): ObservationKind {
  if (typeof value !== "string" || !OBSERVATION_KINDS.includes(value as ObservationKind)) {
    fail("OBSERVATION kind is not recognized");
  }
  return value as ObservationKind;
}

function assertSourceMatchesKind(source: SignalSource, kind: ObservationKind): void {
  if (source === PCM_SIGNAL_SOURCE && !AUDIO_KINDS.has(kind)) {
    fail(`audio signal source cannot emit kind ${kind}`);
  }
  if (source !== PCM_SIGNAL_SOURCE && !LYRIC_KINDS.has(kind)) {
    fail(`lyric signal source cannot emit kind ${kind}`);
  }
}

export interface ObservationDraft {
  id: string;
  signalSource: SignalSource;
  timeMs: number;
  range?: TimeRangeMs | null;
  value: number | string | boolean;
  unit?: string | null;
  kind: ObservationKind;
  confidence?: number | null;
  evidenceRefs?: readonly string[];
  text: string;
}

export function createObservation(draft: ObservationDraft): ObservationStatement {
  return sealObservation(draft);
}

export interface InterpretationDraft {
  id: string;
  basis?: InterpretationBasis;
  observationIds: readonly string[];
  context: string;
  confidence?: number | null;
  evidenceRefs?: readonly string[];
  text: string;
}

export function createInterpretation(draft: InterpretationDraft): InterpretationStatement {
  return sealInterpretation({
    ...draft,
    level: "INTERPRETATION",
    basis: draft.basis ?? "co_occurrence",
    evidenceRefs: draft.evidenceRefs ?? draft.observationIds,
  });
}

export interface EffectHypothesisDraft {
  id: string;
  observationIds?: readonly string[];
  confidence?: number | null;
  evidenceRefs?: readonly string[];
  text: string;
}

/** Builds a hypothesis. Callers cannot choose OBSERVATION or INTERPRETATION here. */
export function createEffectHypothesis(draft: EffectHypothesisDraft): EffectHypothesisStatement {
  return sealEffectHypothesis({
    id: draft.id,
    level: "EFFECT_HYPOTHESIS",
    hypothesis: true,
    statedAs: HYPOTHESIS_STATED_AS,
    observationIds: draft.observationIds ?? [],
    confidence: draft.confidence ?? null,
    evidenceRefs: draft.evidenceRefs ?? draft.observationIds ?? [],
    text: draft.text,
  });
}

function sealObservation(input: unknown): ObservationStatement {
  if (!isRecord(input)) fail("OBSERVATION must be an object");
  if (input.hypothesis === true || input.level === "EFFECT_HYPOTHESIS") {
    fail("EFFECT_HYPOTHESIS cannot be emitted as OBSERVATION or INTERPRETATION");
  }
  if (input.level != null && input.level !== "OBSERVATION") {
    fail("OBSERVATION cannot be emitted as another level");
  }
  const timeMs = input.timeMs;
  const range = rangeOf(input.range);
  if (typeof timeMs !== "number" || !Number.isFinite(timeMs)) {
    fail("OBSERVATION requires a finite timeMs");
  }
  if (range == null && input.range != null) fail("OBSERVATION range is invalid");
  const signalSource = signalSourceOf(input.signalSource);
  const kind = kindOf(input.kind);
  assertSourceMatchesKind(signalSource, kind);
  const unit = input.unit == null ? null : input.unit;
  if (unit != null && typeof unit !== "string") fail("unit must be a string or null");
  return {
    id: idOf(input.id),
    level: "OBSERVATION",
    signalSource,
    timeMs,
    range,
    value: measuredValue(input.value),
    unit,
    kind,
    confidence: confidenceOf(input.confidence),
    evidenceRefs: refsOf(input.evidenceRefs),
    text: textOf(input.text),
  };
}

function sealInterpretation(input: unknown): InterpretationStatement {
  if (!isRecord(input)) fail("INTERPRETATION must be an object");
  if (input.hypothesis === true || input.level === "EFFECT_HYPOTHESIS") {
    fail("EFFECT_HYPOTHESIS cannot be emitted as OBSERVATION or INTERPRETATION");
  }
  if (input.level != null && input.level !== "INTERPRETATION") {
    fail("INTERPRETATION cannot be emitted as another level");
  }
  const basis = input.basis;
  if (typeof basis !== "string" || !INTERPRETATION_BASES.includes(basis as InterpretationBasis)) {
    fail("alignment-only and pass-0 interpretations cannot use a semantic-fit basis");
  }
  const text = textOf(input.text);
  if (SEMANTIC_FIT_RE.test(text)) {
    fail("INTERPRETATION cannot state a semantic fit; alignment proves timing only");
  }
  const context = input.context;
  if (typeof context !== "string" || !context.trim()) {
    fail("INTERPRETATION requires context");
  }
  if (SEMANTIC_FIT_RE.test(context)) {
    fail("INTERPRETATION context cannot state a semantic fit");
  }
  const observationIds = input.observationIds;
  if (!Array.isArray(observationIds) || observationIds.length === 0 || observationIds.some((id) => typeof id !== "string" || !id)) {
    fail("INTERPRETATION requires references to OBSERVATION ids");
  }
  return {
    id: idOf(input.id),
    level: "INTERPRETATION",
    basis: basis as InterpretationBasis,
    observationIds: observationIds.slice(),
    context,
    confidence: confidenceOf(input.confidence),
    evidenceRefs: refsOf(input.evidenceRefs ?? observationIds),
    text,
  };
}

function sealEffectHypothesis(input: unknown): EffectHypothesisStatement {
  if (!isRecord(input)) fail("EFFECT_HYPOTHESIS must be an object");
  if (input.level !== "EFFECT_HYPOTHESIS") {
    fail("EFFECT_HYPOTHESIS cannot be emitted as OBSERVATION or INTERPRETATION");
  }
  if (input.hypothesis !== true || input.statedAs !== HYPOTHESIS_STATED_AS) {
    fail("EFFECT_HYPOTHESIS must be flagged hypothesis:true and statedAs HYPOTHESIS");
  }
  const text = textOf(input.text);
  const observationIds = input.observationIds == null ? [] : input.observationIds;
  if (!Array.isArray(observationIds) || observationIds.some((id) => typeof id !== "string" || !id)) {
    fail("EFFECT_HYPOTHESIS observationIds must be statement ids");
  }
  return {
    id: idOf(input.id),
    level: "EFFECT_HYPOTHESIS",
    hypothesis: true,
    statedAs: HYPOTHESIS_STATED_AS,
    observationIds: observationIds.slice(),
    confidence: confidenceOf(input.confidence),
    evidenceRefs: refsOf(input.evidenceRefs),
    text,
  };
}

/** Accepts only the three levels. A hypothesis flag on any other level is rejected. */
export function sealStatement(input: unknown): Statement {
  if (!isRecord(input)) fail("statement must be an object");
  if (input.hypothesis === true && input.level !== "EFFECT_HYPOTHESIS") {
    fail("EFFECT_HYPOTHESIS cannot be emitted as OBSERVATION or INTERPRETATION");
  }
  if (input.level === "OBSERVATION") return sealObservation(input);
  if (input.level === "INTERPRETATION") return sealInterpretation(input);
  if (input.level === "EFFECT_HYPOTHESIS") return sealEffectHypothesis(input);
  fail("statement level must be OBSERVATION, INTERPRETATION, or EFFECT_HYPOTHESIS");
}

export function isAudioObservation(statement: Statement): statement is ObservationStatement {
  return statement.level === "OBSERVATION" && statement.signalSource === PCM_SIGNAL_SOURCE;
}
