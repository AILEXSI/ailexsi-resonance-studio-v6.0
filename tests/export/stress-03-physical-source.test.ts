/**
 * STRESS-03 physical `1000001827 - Kopie.mp4` open/parse/configure.
 * Uses node:fs — excluded from `tsc --noEmit` like STRESS-01.
 */
import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  decoderConfigOf,
  firstAvcCSps,
  firstBlockedStage,
  inspectAvcSpsRestriction,
  markStage,
  parseIsoBmff,
  planSampleIndexes,
  resetStageTrace,
  sampleIndexAtTime,
  stageTraceEntries,
  ticksToUs,
} from "../../src/core/frame-engine";
import { sourceTimeSec } from "../../src/core/exporter/frame-source";

const HUMAN = {
  originTimelineMs: 168733.3333333333,
  originExportFrame: 5062,
  clipName: "1000001827 - Kopie.mp4",
  sourceInMs: 0,
  sourceOutMs: 5208,
  fps: 30,
};

const CLIP_CANDIDATES = [
  process.env.STRESS03_CLIP,
  "/home/ubuntu/.cursor/projects/workspace/uploads/stress-03-1000001827-Kopie_0828.mp4",
  "uploads/stress-03-1000001827-Kopie_0828.mp4",
  "scripts/stress-03-evidence/1000001827-Kopie.mp4",
].filter((p): p is string => typeof p === "string" && p.length > 0);

const PRECEDING = "tests/fixtures/user-video.mp4";
const PRECEDING_AFE = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";

function clipPath(): string | null {
  return CLIP_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

const STRESS03_MEDIA = clipPath();

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

afterEach(() => {
  resetStageTrace();
});

describe.skipIf(!STRESS03_MEDIA)(
  STRESS03_MEDIA
    ? "STRESS-03 physical source 1000001827 - Kopie.mp4"
    : "STRESS-03 skipped: physical clip missing, set STRESS03_CLIP to 1000001827 - Kopie.mp4",
  () => {
  it("H. alone at sourceInMs 0: parse + sample select + decoderConfig succeed", () => {
    const path = clipPath();
    expect(path, "STRESS-03 clip missing — set STRESS03_CLIP").toBeTruthy();
    if (!path) return;
    const movie = loadMovie(path);
    expect(movie).not.toBeNull();
    if (!movie) return;
    expect(movie.sampleCount).toBeGreaterThan(0);
    expect(movie.avc.width).toBe(464);
    expect(movie.avc.height).toBe(832);
    expect(movie.avc.codec.startsWith("avc1.")).toBe(true);

    const clip = {
      startMs: 0,
      sourceInMs: HUMAN.sourceInMs,
      sourceOutMs: HUMAN.sourceOutMs,
      rate: 1,
    } as never;
    const t0 = sourceTimeSec(clip, 0, HUMAN.fps);
    const selected = sampleIndexAtTime(movie, t0);
    expect(selected).not.toBeNull();
    const sample = movie.samples[selected!];
    expect(sample).toBeTruthy();
    expect(ticksToUs(sample!.ptsTimescale, movie.timescale)).toBeGreaterThanOrEqual(0);

    const indexes = planSampleIndexes(
      movie,
      Array.from({ length: Math.ceil((HUMAN.sourceOutMs / 1000) * HUMAN.fps) }, (_, i) =>
        sourceTimeSec(clip, (i / HUMAN.fps) * 1000, HUMAN.fps),
      ),
    );
    expect(indexes[0]).toBe(selected);
    expect(indexes.every((idx) => idx != null)).toBe(true);

    const cfg = decoderConfigOf(movie.avc);
    expect(cfg.codec).toBe(movie.avc.codec);
    expect(cfg.codedWidth).toBe(464);
    expect(cfg.codedHeight).toBe(832);
    expect(cfg.hardwareAcceleration).toBe("prefer-software");
    const sps = inspectAvcSpsRestriction(firstAvcCSps(movie.avc.description)!);
    expect(sps).not.toBeNull();
  });

  it("I. after preceding clip in the same project: parse/select/configure still succeed", () => {
    const path = clipPath();
    expect(path, "STRESS-03 clip missing — set STRESS03_CLIP").toBeTruthy();
    if (!path) return;
    const precedingPath = existsSync(PRECEDING) ? PRECEDING : PRECEDING_AFE;
    const preceding = loadMovie(precedingPath);
    expect(preceding).not.toBeNull();
    if (!preceding) return;
    const precedingT0 = sourceTimeSec(
      { startMs: 0, sourceInMs: 0, sourceOutMs: 2000, rate: 1 } as never,
      0,
      30,
    );
    expect(sampleIndexAtTime(preceding, precedingT0)).not.toBeNull();
    const precedingCfg = decoderConfigOf(preceding.avc);
    expect(precedingCfg.codec.startsWith("avc1.")).toBe(true);

    const movie = loadMovie(path);
    expect(movie).not.toBeNull();
    if (!movie) return;
    const t0 = sourceTimeSec(
      { startMs: HUMAN.originTimelineMs, sourceInMs: 0, sourceOutMs: HUMAN.sourceOutMs, rate: 1 } as never,
      HUMAN.originTimelineMs,
      HUMAN.fps,
    );
    const selected = sampleIndexAtTime(movie, t0);
    expect(selected).not.toBeNull();
    const cfg = decoderConfigOf(movie.avc);
    expect(cfg.codedWidth).toBe(movie.avc.width);
    expect(cfg.hardwareAcceleration).toBe("prefer-software");
    expect(movie.sampleCount).not.toBe(preceding.sampleCount);
  });

  it("J. clip-start timestamps plan to sample 0 (SAMPLE_SELECT no longer returns n/a)", () => {
    const path = clipPath();
    expect(path, "STRESS-03 clip missing — set STRESS03_CLIP").toBeTruthy();
    if (!path) return;
    const movie = loadMovie(path);
    expect(movie).not.toBeNull();
    if (!movie) return;
    resetStageTrace();
    markStage("FRAME_REQUESTED", {
      timelineMs: 0,
      exportFrame: 0,
      clipId: "clip-k",
      clipName: HUMAN.clipName,
      sourceId: "1000001827_-_Kopie.mp4",
    });
    markStage("CLIP_SELECTED");
    markStage("SOURCE_RESOLVED");
    markStage("SAMPLE_SELECT");
    const clip = { startMs: 0, sourceInMs: 0, sourceOutMs: HUMAN.sourceOutMs, rate: 1 } as never;
    const times = Array.from({ length: 8 }, (_, i) => sourceTimeSec(clip, (i / HUMAN.fps) * 1000, HUMAN.fps));
    const indexes = planSampleIndexes(movie, times);
    expect(indexes[0]).toBe(0);
    expect(indexes.every((idx) => idx != null)).toBe(true);
    expect(firstBlockedStage()).toBe("SAMPLE_SELECT");
    expect(stageTraceEntries().map((e) => e.stage)).toContain("SAMPLE_SELECT");
  });

  it("K. after-preceding parse of the same physical source still selects sample 0 at clip start", () => {
    const path = clipPath();
    const precedingPath = existsSync(PRECEDING) ? PRECEDING : PRECEDING_AFE;
    expect(path, "STRESS-03 clip missing — set STRESS03_CLIP").toBeTruthy();
    if (!path) return;
    const preceding = loadMovie(precedingPath);
    expect(preceding).not.toBeNull();
    if (!preceding) return;
    expect(
      sampleIndexAtTime(
        preceding,
        sourceTimeSec({ startMs: 0, sourceInMs: 0, sourceOutMs: 2000, rate: 1 } as never, 0, 30),
      ),
    ).not.toBeNull();

    const movie = loadMovie(path);
    expect(movie).not.toBeNull();
    if (!movie) return;
    const t0 = sourceTimeSec(
      { startMs: HUMAN.originTimelineMs, sourceInMs: 0, sourceOutMs: HUMAN.sourceOutMs, rate: 1 } as never,
      HUMAN.originTimelineMs,
      HUMAN.fps,
    );
    expect(sampleIndexAtTime(movie, t0)).toBe(0);
    expect(decoderConfigOf(movie.avc).hardwareAcceleration).toBe("prefer-software");
  });
});
