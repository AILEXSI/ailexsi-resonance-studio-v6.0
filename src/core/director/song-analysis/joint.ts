/**
 * Joint view: timed lyric lines cite audio observations already on the timeline.
 * Lines with timeMs null get no joint row and no audio claim.
 * The optional interpretation is co-occurrence only.
 */
import { createInterpretation, isAudioObservation, type IdFactory } from "./seal";
import type { InterpretationStatement, JointLink, LyricLine, Statement } from "./types";

export const DEFAULT_JOINT_WINDOW_MS = 400;

function overlaps(statementTimeMs: number, range: { startMs: number; endMs: number } | null, centerMs: number, windowMs: number): boolean {
  const from = centerMs - windowMs;
  const to = centerMs + windowMs;
  if (statementTimeMs >= from && statementTimeMs <= to) return true;
  if (!range) return false;
  return range.endMs >= from && range.startMs <= to;
}

export function buildJoint(opts: {
  lines: readonly LyricLine[];
  statements: readonly Statement[];
  windowMs: number;
  ids: IdFactory;
  audioAvailable: boolean;
}): { links: JointLink[]; interpretations: InterpretationStatement[] } {
  if (!opts.audioAvailable) return { links: [], interpretations: [] };
  const links: JointLink[] = [];
  const interpretations: InterpretationStatement[] = [];
  const audio = opts.statements.filter(isAudioObservation);

  for (const line of opts.lines) {
    if (line.timeMs == null) continue;
    const observationIds = audio
      .filter((statement) => overlaps(statement.timeMs, statement.range, line.timeMs!, opts.windowMs))
      .map((statement) => statement.id);
    let interpretationId: string | null = null;
    if (observationIds.length > 0) {
      const cited = audio.filter((statement) => observationIds.includes(statement.id));
      const onsets = cited.filter((statement) => statement.kind === "onset").length;
      const kicks = cited.filter((statement) => statement.kind === "kick").length;
      const dips = cited.filter((statement) => statement.kind === "energy_dip" || statement.value === "break").length;
      const boundaries = cited.filter((statement) => statement.kind === "segment_boundary").length;
      const segments = cited
        .filter((statement) => statement.kind === "segment")
        .map((statement) => String(statement.value));
      const parts: string[] = [];
      if (onsets > 0) parts.push(`${onsets} onset observation(s)`);
      if (kicks > 0) parts.push(`${kicks} kick observation(s)`);
      if (dips > 0) parts.push("an energy dip or break");
      if (boundaries > 0) parts.push(`${boundaries} segment boundary`);
      if (segments.length > 0) parts.push(`segment ${segments.join(", ")}`);
      const detail = parts.length > 0 ? parts.join("; ") : `${cited.length} audio observation(s)`;
      const interpretation = createInterpretation({
        id: opts.ids("int"),
        observationIds,
        context: "Co-occurrence of a timed lyric line and audio observations inside the joint window. The timestamp establishes time only.",
        confidence: null,
        text: `Within ±${opts.windowMs} ms of ${line.id}, offline analysis co-occurs with ${detail}.`,
      });
      interpretations.push(interpretation);
      interpretationId = interpretation.id;
    }
    links.push({
      lineId: line.id,
      timeMs: line.timeMs,
      windowMs: opts.windowMs,
      observationIds,
      interpretationId,
    });
  }
  return { links, interpretations };
}
