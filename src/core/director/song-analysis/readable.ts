/**
 * Minimal readable view of a pass-0 report. Not a second analysis.
 */
import type { SongAnalysisReport, Statement } from "./types";

function confidenceText(value: number | null): string {
  return value == null ? "UNKNOWN" : String(value);
}

function countLevels(statements: readonly Statement[]): Record<Statement["level"], number> {
  return {
    OBSERVATION: statements.filter((statement) => statement.level === "OBSERVATION").length,
    INTERPRETATION: statements.filter((statement) => statement.level === "INTERPRETATION").length,
    EFFECT_HYPOTHESIS: statements.filter((statement) => statement.level === "EFFECT_HYPOTHESIS").length,
  };
}

export function formatSongReport(report: SongAnalysisReport): string {
  const lines: string[] = [];
  lines.push("Song analysis (pass 0)");
  lines.push(`Timeline: ms, origin ${report.timelineOriginMs}`);
  if (report.audio.status === "UNAVAILABLE") {
    lines.push(`Audio: UNAVAILABLE (${report.audio.reason ?? "UNKNOWN"})`);
  } else {
    lines.push(
      `Audio: OK, ${report.audio.sampleRate} Hz, ${report.audio.channels} ch, ${report.audio.durationMs} ms, extractor ${report.audio.extractor}`,
    );
  }
  lines.push(
    report.tempo.bpm == null
      ? "Tempo: UNKNOWN"
      : `Tempo: ${report.tempo.bpm} BPM (confidence ${confidenceText(report.tempo.confidence)})`,
  );
  lines.push(`Onsets: ${report.tempo.onsetCount}`);
  lines.push("Segments:");
  if (report.segments.length === 0) lines.push("  (none)");
  for (const segment of report.segments) {
    lines.push(
      `  ${segment.startMs}–${segment.endMs} ms ${segment.label} (confidence ${confidenceText(segment.confidence)})`,
    );
  }
  lines.push("Lyrics:");
  if (report.lyrics.lines.length === 0) lines.push("  (none)");
  for (const line of report.lyrics.lines) {
    const when = line.timeMs == null ? "UNALIGNED" : `${line.timeMs} ms`;
    lines.push(`  [${when}] ${line.text}`);
  }
  lines.push("Joint:");
  if (report.joint.length === 0) lines.push("  (none)");
  for (const link of report.joint) {
    const cited = link.observationIds.length > 0 ? link.observationIds.join(", ") : "(no audio observations in window)";
    lines.push(`  ${link.lineId} @ ${link.timeMs} ms ±${link.windowMs}: ${cited}`);
    if (link.interpretationId) {
      const statement = report.statements.find((item) => item.id === link.interpretationId);
      if (statement && statement.level === "INTERPRETATION") {
        lines.push(`    INTERPRETATION: ${statement.text}`);
      }
    }
  }
  const counts = countLevels(report.statements);
  lines.push(
    `Statements: ${report.statements.length} (OBSERVATION ${counts.OBSERVATION}, INTERPRETATION ${counts.INTERPRETATION}, EFFECT_HYPOTHESIS ${counts.EFFECT_HYPOTHESIS})`,
  );
  lines.push("EFFECT_HYPOTHESIS, when present, is a hypothesis and not a fact. Pass 0 does not emit one.");
  return lines.join("\n");
}
