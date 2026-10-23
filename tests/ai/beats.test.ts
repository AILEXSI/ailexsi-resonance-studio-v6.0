import { describe, expect, it, vi } from "vitest";
import { detectBeatsFromPcm } from "../../src/app/ai/audio/beats";
import type { MixPcm } from "../../src/core/visualz/feature-extractor";
import { runDirectorTurn } from "../../src/app/ai/loop";
import { acceptTransaction } from "../../src/app/ai/transactions";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function clicks(timesMs: number[], durationMs: number, sampleRate = 44100): MixPcm {
  const length = Math.round((durationMs / 1000) * sampleRate);
  const data = new Float32Array(length);
  const burst = Math.round(0.012 * sampleRate);
  for (const time of timesMs) {
    const at = Math.round((time / 1000) * sampleRate);
    for (let index = 0; index < burst && at + index < length; index += 1) data[at + index] = 0.9;
  }
  return {
    sampleRate,
    length,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}

function sessionWithAudio(objectUrl?: string): Session {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
    project: {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 2500 })],
        [
          asset({
            id: "a",
            kind: "audio",
            name: "clicks.wav",
            sourcePath: "/tmp/secret-clicks.wav",
            durationMs: 2500,
            objectUrl,
          }),
        ],
      ),
      snap: true,
      name: "Click song",
    },
  };
}

describe("beat detection", () => {
  it("measures regular clicks and does not invent a 120 BPM grid", () => {
    const pcm = clicks([400, 900, 1400, 1900], 2500);
    const analysis = detectBeatsFromPcm(pcm, {
      sourceInMs: 0,
      sourceOutMs: 2500,
      timelineStartMs: 0,
      rate: 1,
    });
    expect(analysis.method).toBe("rms-onset");
    expect(analysis.events.map((event) => event.timeMs)).toEqual([400, 900, 1400, 1900]);
    expect(analysis.events.every((event) => event.kind === "beat")).toBe(true);
    expect(analysis.confidence).toBeGreaterThanOrEqual(0.5);
    expect(analysis.medianGapMs).toBe(500);
    expect(JSON.stringify(analysis)).not.toContain("120");
  });

  it("returns no events for silence", () => {
    const length = 44100;
    const data = new Float32Array(length);
    const analysis = detectBeatsFromPcm(
      { sampleRate: 44100, length, numberOfChannels: 1, getChannelData: () => data },
      { sourceInMs: 0, sourceOutMs: 1000, timelineStartMs: 0, rate: 1 },
    );
    expect(analysis.events).toEqual([]);
    expect(analysis.confidence).toBe(0);
  });

  it("proposes exact marker times, keeps the selection, and undoes in one step", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const session = sessionWithAudio("blob:clicks");
    const pcm = clicks([400, 900, 1400, 1900], 2500);
    const turn = await runDirectorTurn({
      session,
      prompt: "Erkenne die Beats in der markierten Audiodatei",
      decodeClip: async () => pcm,
    });
    expect(turn.transaction?.tool).toBe("audio.detect_beats");
    expect(turn.transaction?.status).toBe("proposed");
    expect(turn.text).toMatch(/Confidence 1.00/);
    expect(turn.text).toMatch(/rms-onset/);
    expect(turn.text).not.toContain("/tmp/secret");
    expect(turn.text).not.toMatch(/\b120\b/);
    expect(session.project.markers).toHaveLength(0);
    expect(session.history.past).toHaveLength(0);
    if (!turn.transaction) throw new Error("expected proposal");

    const accepted = acceptTransaction(session, turn.transaction);
    expect(accepted.error).toBeUndefined();
    expect(accepted.session.history.past).toHaveLength(1);
    expect(accepted.session.project.schemaVersion).toBe(5);
    expect(accepted.session.project.snap).toBe(true);
    expect(accepted.session.selectedClipId).toBe("c1");
    expect(accepted.session.project.markers.map((marker) => marker.timeMs).sort((a, b) => a - b)).toEqual([
      400, 900, 1400, 1900,
    ]);
    expect(accepted.session.project.markers.every((marker) => /Beat \d+ ms · 1\.00/.test(marker.label))).toBe(true);
    expect(JSON.stringify(accepted.session.project.markers)).not.toContain("/tmp/secret");

    const undone = applyCommand(accepted.session, { type: "undo" });
    expect(undone.history.past).toHaveLength(0);
    expect(undone.project.markers).toHaveLength(0);
    expect(undone.project.clips).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not detect beats when the audio is not loaded", async () => {
    const session = sessionWithAudio(undefined);
    const turn = await runDirectorTurn({
      session,
      prompt: "Detect the beats",
      decodeClip: async () => {
        throw new Error("should not decode");
      },
    });
    expect(turn.transaction).toBeNull();
    expect(turn.text).toMatch(/audio is not loaded/i);
    expect(turn.text).toMatch(/No beats were detected/);
    expect(session.history.past).toHaveLength(0);
  });
});
