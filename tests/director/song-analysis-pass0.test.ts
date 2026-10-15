/**
 * Pass-0 song analysis hard rules.
 * The signal is generated here: clicks, a tone, and a silence gap. No binary assets.
 */
import { describe, expect, it } from "vitest";
import { invokeTool } from "../../src/app/ai/tools/registry";
import { createSession } from "../../src/app/session";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import {
  analyzeSong,
  createEffectHypothesis,
  formatSongReport,
  MAX_LYRICS_BYTES,
  MAX_LYRICS_LINES,
  nullAligner,
  parseLrc,
  SEMANTIC_FIT_RE,
  sealStatement,
  SongInputError,
  splitLyricsText,
  StatementLevelError,
  type SongAnalysisReport,
  type Statement,
} from "../../src/core/director/song-analysis";
import { toSongAnalyzeError } from "../../src/app/ai/tools/song-analyze";
import type { MixPcm } from "../../src/core/visualz/feature-extractor";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const SR = 44100;

function silence(durationMs: number): Float32Array {
  return new Float32Array(Math.round((SR * durationMs) / 1000));
}

function pcmOf(data: Float32Array): MixPcm {
  return {
    sampleRate: SR,
    length: data.length,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as MixPcm;
}

function addTone(data: Float32Array, fromMs: number, toMs: number, freqHz: number, amp: number): void {
  const start = Math.round((fromMs / 1000) * SR);
  const end = Math.min(data.length, Math.round((toMs / 1000) * SR));
  for (let i = start; i < end; i += 1) {
    const t = (i - start) / SR;
    data[i] = (data[i] ?? 0) + amp * Math.sin(2 * Math.PI * freqHz * t);
  }
}

/** Short bass click. Same shape as the in-repo visualizer probes, generated in-test. */
function addClick(data: Float32Array, timeMs: number): void {
  const start = Math.round((timeMs / 1000) * SR);
  const clickN = Math.round(SR * 0.012);
  for (let i = 0; i < clickN && start + i < data.length; i += 1) {
    const env = 1 - i / clickN;
    const t = i / SR;
    data[start + i] = env * (0.95 * Math.sin(2 * Math.PI * 70 * t) + 0.3 * Math.sin(2 * Math.PI * 160 * t));
  }
}

/** Clicks + tone + a one-second silence gap. License-free, no file. */
function syntheticTrack(): Float32Array {
  const data = silence(4200);
  addTone(data, 500, 2000, 220, 0.35);
  for (const timeMs of [500, 1000, 1500, 2000]) addClick(data, timeMs);
  for (const timeMs of [3200, 3700]) addClick(data, timeMs);
  return data;
}

function audioStatements(report: SongAnalysisReport): Statement[] {
  return report.statements.filter(
    (statement) => statement.level === "OBSERVATION" && statement.signalSource === "pcm.offline_extractor",
  );
}

describe("song analysis pass 0", () => {
  it("no audio marks audio UNAVAILABLE and emits no audio-event statements", () => {
    const report = analyzeSong({ lyricsText: "warp remains\nactive" });
    expect(report.audio.status).toBe("UNAVAILABLE");
    expect(report.audio.reason).toBe("NO_PCM");
    expect(audioStatements(report)).toEqual([]);
    expect(report.tempo.bpm).toBeNull();
    expect(report.tempo.confidence).toBeNull();
    expect(report.segments).toEqual([]);
    expect(report.joint).toEqual([]);
    expect(report.statements.every((statement) => statement.level === "OBSERVATION")).toBe(true);
    expect(formatSongReport(report)).toMatch(/Audio: UNAVAILABLE \(NO_PCM\)/);
  });

  it("text-only input never produces an audio OBSERVATION", () => {
    const report = analyzeSong({ lyricsText: "engine room\nout" });
    expect(report.lyrics.status).toBe("TEXT");
    expect(report.lyrics.lines.every((line) => line.timeMs == null && line.status === "UNALIGNED")).toBe(true);
    for (const statement of report.statements) {
      if (statement.level !== "OBSERVATION") continue;
      expect(statement.signalSource).not.toBe("pcm.offline_extractor");
      expect(["onset", "kick", "energy", "tempo", "segment", "segment_boundary", "energy_dip"]).not.toContain(statement.kind);
    }
    expect(audioStatements(report)).toHaveLength(0);
  });

  it("alignment-only result never produces a semantic-fit statement", () => {
    const aligned = analyzeSong({
      manualLines: [
        {
          text: "warp remains",
          timeMs: 1000,
          words: [
            { text: "warp", timeMs: 1000 },
            { text: "remains", timeMs: 1400 },
          ],
        },
      ],
      aligner: nullAligner,
    });
    expect(aligned.lyrics.lines[0]?.timeMs).toBe(1000);
    expect(aligned.lyrics.lines[0]?.words[0]?.status).toBe("MANUAL");
    expect(aligned.audio.status).toBe("UNAVAILABLE");
    for (const statement of aligned.statements) {
      expect(statement.level).not.toBe("INTERPRETATION");
      expect(statement.text).not.toMatch(SEMANTIC_FIT_RE);
    }

    const withAudio = analyzeSong({
      pcm: pcmOf(syntheticTrack()),
      manualLines: [{ text: "warp remains", timeMs: 1000, words: [{ text: "warp", timeMs: 1000 }] }],
    });
    let sawInterpretation = false;
    for (const statement of withAudio.statements) {
      expect(statement.text).not.toMatch(SEMANTIC_FIT_RE);
      if (statement.level === "INTERPRETATION") {
        sawInterpretation = true;
        expect(statement.basis).toBe("co_occurrence");
        expect(statement.context).not.toMatch(SEMANTIC_FIT_RE);
        expect(statement.observationIds.length).toBeGreaterThan(0);
      }
    }
    expect(sawInterpretation).toBe(true);
    expect(() =>
      sealStatement({
        id: "bad_fit",
        level: "INTERPRETATION",
        basis: "semantic_fit",
        observationIds: ["obs_0000"],
        context: "the words match the drop",
        confidence: null,
        evidenceRefs: ["obs_0000"],
        text: "this semantic fit means that the line expresses the drop",
      }),
    ).toThrow(StatementLevelError);
  });

  it("EFFECT_HYPOTHESIS is never emitted as OBSERVATION or INTERPRETATION", () => {
    const hypothesis = createEffectHypothesis({
      id: "hyp_0000",
      text: "A cut on this onset might read as impact.",
      observationIds: [],
    });
    expect(hypothesis.level).toBe("EFFECT_HYPOTHESIS");
    expect(hypothesis.hypothesis).toBe(true);
    expect(hypothesis.statedAs).toBe("HYPOTHESIS");
    expect(() => sealStatement({ ...hypothesis, level: "OBSERVATION" })).toThrow(/OBSERVATION or INTERPRETATION/);
    expect(() => sealStatement({ ...hypothesis, level: "INTERPRETATION" })).toThrow(/OBSERVATION or INTERPRETATION/);
    expect(() => sealStatement({ ...hypothesis, hypothesis: false })).toThrow(/flagged/);

    const report = analyzeSong({ pcm: pcmOf(syntheticTrack()), lyricsText: "warp" });
    expect(report.notDone.effectHypothesis).toBe("NOT_EMITTED");
    expect(report.statements.filter((statement) => statement.level === "EFFECT_HYPOTHESIS")).toHaveLength(0);
    for (const statement of report.statements) {
      expect(statement.level === "OBSERVATION" || statement.level === "INTERPRETATION").toBe(true);
      expect("hypothesis" in statement).toBe(false);
    }
  });

  it("unknown tempo and unaligned times stay null and are never invented", () => {
    const quiet = analyzeSong({
      pcm: pcmOf(silence(2000)),
      lyricsText: "one two\nthree",
    });
    expect(quiet.tempo).toEqual({ bpm: null, confidence: null, onsetCount: 0 });
    expect(quiet.statements.some((statement) => statement.level === "OBSERVATION" && statement.kind === "tempo")).toBe(false);
    for (const line of quiet.lyrics.lines) {
      expect(line.timeMs).toBeNull();
      expect(line.status).toBe("UNALIGNED");
      for (const word of line.words) {
        expect(word.timeMs).toBeNull();
        expect(word.endMs).toBeNull();
        expect(word.status).toBe("UNALIGNED");
        expect(word.confidence).toBeNull();
      }
    }
    const plain = splitLyricsText("alpha beta");
    expect(plain[0]?.words.map((word) => word.timeMs)).toEqual([null, null]);
    const json = JSON.stringify(quiet);
    expect(json).not.toContain("undefined");
    for (const line of quiet.lyrics.lines) {
      expect(JSON.stringify(line)).not.toMatch(/"timeMs":(?!null)/);
    }
    expect(formatSongReport(quiet)).toMatch(/Tempo: UNKNOWN/);
  });

  it("the same PCM produces the same report", () => {
    const pcm = pcmOf(syntheticTrack());
    const input = {
      pcm,
      lrc: "[00:01.00]warp remains\n[00:03.20]still active",
      windowMs: 400,
    };
    const a = analyzeSong(input);
    const b = analyzeSong(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.pass).toBe(0);
    expect(a.timeline).toBe("ms");
    const onsets = a.statements.flatMap((statement) =>
      statement.level === "OBSERVATION" && statement.kind === "onset" ? [statement.timeMs] : [],
    );
    expect(onsets).toEqual([520, 3220, 3720]);
    expect(a.tempo.bpm).toBeNull();
    expect(a.tempo.confidence).toBeNull();
  });

  it("tempo stays null when intervals are unreliable and is reported when a click train agrees", () => {
    const masked = analyzeSong({ pcm: pcmOf(syntheticTrack()) });
    expect(masked.tempo).toEqual({ bpm: null, confidence: null, onsetCount: 3 });
    const clicks = silence(3000);
    for (const timeMs of [200, 700, 1200, 1700, 2200]) addClick(clicks, timeMs);
    const train = analyzeSong({ pcm: pcmOf(clicks) });
    expect(train.tempo.bpm).toBe(120);
    expect(train.tempo.confidence).toBe(1);
    expect(train.statements.some((statement) => statement.level === "OBSERVATION" && statement.kind === "tempo" && statement.value === 120)).toBe(true);
    expect(JSON.stringify(train)).toBe(JSON.stringify(analyzeSong({ pcm: pcmOf(clicks) })));
  });

  it("LRC and manual times are kept and NullAligner does not invent the rest", () => {
    const lrc = parseLrc("[ti:Engine]\n[offset:0]\n[00:01.00]Hello <00:01.40>world\n[00:02.50]only line");
    expect(lrc[0]?.timeMs).toBe(1000);
    expect(lrc[0]?.status).toBe("LRC");
    expect(lrc[0]?.text).toBe("Hello world");
    expect(lrc[0]?.words.map((word) => word.timeMs)).toEqual([null, 1400]);
    expect(lrc[0]?.words[0]?.status).toBe("UNALIGNED");
    expect(lrc[0]?.words[1]?.status).toBe("LRC");
    expect(lrc[1]?.words.every((word) => word.timeMs == null && word.status === "UNALIGNED")).toBe(true);

    const report = analyzeSong({
      lyricsText: "this plain text must not replace lrc",
      lrc: "[00:00.50]kept",
    });
    expect(report.lyrics.lines.map((line) => line.text)).toEqual(["kept"]);
    expect(report.lyrics.alignerId).toBe("null");
    expect(report.lyrics.lines[0]?.timeMs).toBe(500);

    const untouched = nullAligner.align({ lines: splitLyricsText("no times here"), pcm: pcmOf(syntheticTrack()) });
    expect(untouched.every((line) => line.timeMs == null && line.words.every((word) => word.timeMs == null))).toBe(true);
  });

  it("a timed lyric line attaches audio observations and an untimed line does not", () => {
    const report = analyzeSong({
      pcm: pcmOf(syntheticTrack()),
      manualLines: [
        { text: "inside the tone", timeMs: 1000 },
        { text: "no clock" },
      ],
    });
    const timed = report.joint.find((link) => link.lineId === "line_0000");
    const untimed = report.joint.find((link) => link.lineId === "line_0001");
    expect(timed).toBeTruthy();
    expect(timed!.observationIds.length).toBeGreaterThan(0);
    expect(timed!.interpretationId).toBeTruthy();
    expect(untimed).toBeUndefined();
    const interpretation = report.statements.find((statement) => statement.id === timed!.interpretationId);
    expect(interpretation?.level).toBe("INTERPRETATION");
    if (interpretation?.level === "INTERPRETATION") {
      for (const id of interpretation.observationIds) {
        const cited = report.statements.find((statement) => statement.id === id);
        expect(cited?.level).toBe("OBSERVATION");
        expect(cited && cited.level === "OBSERVATION" ? cited.signalSource : null).toBe("pcm.offline_extractor");
      }
    }
    const dip = report.statements.find(
      (statement) => statement.level === "OBSERVATION" && statement.kind === "energy_dip",
    );
    expect(dip?.level).toBe("OBSERVATION");
    const breakSeg = report.segments.find((segment) => segment.label === "break");
    expect(breakSeg).toBeTruthy();
    expect(breakSeg!.startMs).toBeGreaterThanOrEqual(1800);
    expect(breakSeg!.endMs).toBeLessThanOrEqual(3400);
  });

  it("song.analyze is a read-only Director tool and does not mutate the project", () => {
    const stored = asset({ id: "asset_song", kind: "audio", durationMs: 4200 });
    const placed = clip({ id: "clip_song", assetId: stored.id, trackId: "A1", startMs: 0, durationMs: 4200 });
    const session = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith([placed], [stored]),
      selectedClipId: placed.id,
      selectedClipIds: [placed.id],
    };
    const before = session.project;
    const beforeHistory = session.history.past.length;
    const samples = syntheticTrack();
    const pcmSnapshot = samples.slice();
    const pcm = pcmOf(samples);
    const result = invokeTool(
      "song.analyze",
      { clipId: placed.id, lyrics: "plain only", lrc: "[00:01.00]warp remains" },
      { session, grant: "READ", pcmByClipId: { [placed.id]: pcm } },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { summary: string; report: SongAnalysisReport };
    expect(data.summary).toMatch(/Song analysis \(pass 0\)/);
    expect(data.report.audio.status).toBe("OK");
    expect(data.report.pass).toBe(0);
    expect(data.summary).toMatch(/warp remains/);
    expect(JSON.stringify(data)).not.toMatch(/sourcePath|objectUrl/);
    expect(session.project).toBe(before);
    expect(session.history.past.length).toBe(beforeHistory);
    expect(pcm.getChannelData(0)).toEqual(pcmSnapshot);
    expect(pcm.sampleRate).toBe(SR);
    expect(pcm.length).toBe(pcmSnapshot.length);
    expect(pcm.numberOfChannels).toBe(1);
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(session.project)).schemaVersion).toBe(5);

    const missing = invokeTool("song.analyze", { lyrics: "text only" }, { session, grant: "READ" });
    expect(missing.ok).toBe(true);
    if (missing.ok) {
      const report = (missing.data as { report: SongAnalysisReport }).report;
      expect(report.audio.status).toBe("UNAVAILABLE");
      expect(audioStatements(report)).toHaveLength(0);
    }
    expect(invokeTool("song.analyze", { clipId: "clip_missing" }, { session, grant: "READ" })).toMatchObject({
      code: "UNKNOWN_CLIP",
    });
  });

  it("song.analyze rejects lyrics over 256 KB with INVALID_ARGS", () => {
    const session = createSession(createMemoryBlobStore());
    const over = "x".repeat(MAX_LYRICS_BYTES + 1);
    const result = invokeTool("song.analyze", { lyrics: over }, { session, grant: "READ" });
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_ARGS",
      message: `lyrics exceeds ${MAX_LYRICS_BYTES} bytes`,
    });
    expect(JSON.stringify(result)).not.toContain(over);
    const atLimit = analyzeSong({ lyricsText: "y".repeat(MAX_LYRICS_BYTES) });
    expect(atLimit.lyrics.lines).toHaveLength(1);
    expect(atLimit.lyrics.lines[0]?.text).toHaveLength(MAX_LYRICS_BYTES);
  });

  it("song.analyze rejects more than 5000 lyric lines with INVALID_ARGS", () => {
    const session = createSession(createMemoryBlobStore());
    const tooMany = Array.from({ length: MAX_LYRICS_LINES + 1 }, () => "a").join("\n");
    const result = invokeTool("song.analyze", { lrc: tooMany }, { session, grant: "READ" });
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_ARGS",
      message: `lrc exceeds ${MAX_LYRICS_LINES} lines`,
    });
    const atLimit = splitLyricsText(Array.from({ length: MAX_LYRICS_LINES }, () => "a").join("\n"));
    expect(atLimit).toHaveLength(MAX_LYRICS_LINES);
  });

  it("song.analyze rejects an LRC timestamp with huge minutes", () => {
    const session = createSession(createMemoryBlobStore());
    const lrc = `[${"9".repeat(30)}:00.00]hello`;
    expect(() => parseLrc(lrc)).toThrow(SongInputError);
    const result = invokeTool("song.analyze", { lrc }, { session, grant: "READ" });
    expect(result).toMatchObject({ ok: false, code: "INVALID_ARGS" });
    if (!result.ok) expect(result.message).toMatch(/LRC timestamp is invalid/);
    expect(JSON.stringify(result)).not.toMatch(/Infinity|9{10}/);
  });

  it("song.analyze rejects an Infinity or huge LRC offset", () => {
    const session = createSession(createMemoryBlobStore());
    for (const lrc of ["[offset:Infinity]\n[00:01.00]hello", `[offset:${"9".repeat(20)}]\n[00:01.00]hello`, "[offset:86400001]\n[00:01.00]hello"]) {
      expect(() => parseLrc(lrc)).toThrow(SongInputError);
      const result = invokeTool("song.analyze", { lrc }, { session, grant: "READ" });
      expect(result).toMatchObject({ ok: false, code: "INVALID_ARGS" });
      if (!result.ok) expect(result.message).toMatch(/LRC offset is invalid/);
      expect(JSON.stringify(result)).not.toMatch(/Infinity/);
    }
    const shifted = parseLrc("[offset:-500]\n[00:01.00]hello");
    expect(shifted[0]?.timeMs).toBe(1500);
    expect(Number.isFinite(shifted[0]?.timeMs)).toBe(true);
  });

  it("LRC offset is one file-wide value and a positive offset is earlier", () => {
    const lyric = "[00:01.00]a <00:01.50>b";
    for (const lrc of [`[offset:500]\n${lyric}`, `${lyric}\n[offset:500]`]) {
      const lines = parseLrc(lrc);
      expect(lines).toHaveLength(1);
      expect(lines[0]?.timeMs).toBe(500);
      expect(lines[0]?.words.map((word) => [word.text, word.timeMs])).toEqual([
        ["a", null],
        ["b", 1000],
      ]);
      expect(lines[0]?.words.every((word) => word.timeMs == null || Number.isFinite(word.timeMs))).toBe(true);
    }
    const later = parseLrc(`[offset:-500]\n${lyric}`);
    expect(later[0]?.timeMs).toBe(1500);
    expect(later[0]?.words.map((word) => word.timeMs)).toEqual([null, 2000]);
  });

  it("LRC keeps fraction widths, colon stamps, repeated stamps, and drops empty text", () => {
    expect(parseLrc("[00:00.5]tenth")[0]?.timeMs).toBe(500);
    expect(parseLrc("[00:01.250]millis")[0]?.timeMs).toBe(1250);
    const colon = parseLrc("[00:01:40]colon form");
    expect(colon[0]?.timeMs).toBe(1400);
    expect(colon[0]?.text).toBe("colon form");

    const repeated = parseLrc("[00:03.00][00:01.00]same words");
    expect(repeated.map((line) => [line.timeMs, line.text])).toEqual([
      [1000, "same words"],
      [3000, "same words"],
    ]);

    const skipped = parseLrc("[00:01.00]\n[00:02.00]   \n\n[00:03.00]kept");
    expect(skipped.map((line) => [line.timeMs, line.text])).toEqual([[3000, "kept"]]);
  });

  it("song.analyze rejects malformed LRC with INVALID_ARGS", () => {
    const session = createSession(createMemoryBlobStore());
    const result = invokeTool("song.analyze", { lrc: "[00:99.00]broken" }, { session, grant: "READ" });
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_ARGS",
      message: "LRC timestamp is invalid",
    });
    expect(toSongAnalyzeError(new SongInputError("LRC timestamp is invalid")).code).toBe("INVALID_ARGS");
  });

  it("song.analyze returns a structured INTERNAL error instead of throwing", () => {
    const stored = asset({ id: "asset_song", kind: "audio", durationMs: 1000 });
    const placed = clip({ id: "clip_song", assetId: stored.id, trackId: "A1", startMs: 0, durationMs: 1000 });
    const session = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith([placed], [stored]),
    };
    const pcm = {
      sampleRate: 44100,
      length: 44100,
      numberOfChannels: 1,
      getChannelData(): Float32Array {
        throw new Error("pcm exploded");
      },
    } as MixPcm;
    let result: ReturnType<typeof invokeTool> | undefined;
    expect(() => {
      result = invokeTool(
        "song.analyze",
        { clipId: placed.id, lyrics: "hi" },
        { session, grant: "READ", pcmByClipId: { [placed.id]: pcm } },
      );
    }).not.toThrow();
    expect(result).toMatchObject({ ok: false, code: "INTERNAL", message: "song.analyze failed: pcm exploded" });
    expect(toSongAnalyzeError("nope")).toMatchObject({ ok: false, code: "INTERNAL" });
  });
});
