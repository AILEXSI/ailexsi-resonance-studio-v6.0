import { describe, expect, it } from "vitest";
import { audioPlaybackPlan } from "../../src/core/exporter/audio";
import { jobFromProject } from "../../src/core/exporter/job";
import { timeStretchChannels } from "../../src/core/exporter/time-stretch";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { createSession } from "../../src/app/session";
import { asset, clip, projectWith } from "../helpers";

const SR = 44100;
const TONE = 440;

function sine(freq: number, seconds: number): Float32Array {
  const n = Math.floor(SR * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / SR);
  return out;
}

/** Rising zero crossings. Skips the fade at each end of a stretched buffer. */
function pitchHz(samples: Float32Array): number {
  const start = Math.floor(0.08 * SR);
  const end = Math.max(start + 2, samples.length - Math.floor(0.08 * SR));
  let first = -1;
  let last = -1;
  let crossings = 0;
  for (let i = start + 1; i < end; i++) {
    const prev = samples[i - 1] ?? 0;
    const curr = samples[i] ?? 0;
    if (prev <= 0 && curr > 0) {
      const frac = prev / (prev - curr);
      const at = i - 1 + frac;
      if (first < 0) first = at;
      last = at;
      crossings += 1;
    }
  }
  if (crossings < 3 || last <= first) return 0;
  return (crossings - 1) / ((last - first) / SR);
}

/** What playbackRate did at c3b4206: read the source faster, which moves the pitch. */
function resampleChangingPitch(input: Float32Array, factor: number): Float32Array {
  const outLen = Math.max(1, Math.round(input.length * factor));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcAt = i / factor;
    const i0 = Math.floor(srcAt);
    const frac = srcAt - i0;
    const a = input[Math.min(input.length - 1, i0)] ?? 0;
    const b = input[Math.min(input.length - 1, i0 + 1)] ?? a;
    out[i] = a * (1 - frac) + b * frac;
  }
  return out;
}

describe("export pitch and plain playback", () => {
  it("keeps the c3b4206 schedule when rate is 1 and nothing is reversed or held", () => {
    const plan = audioPlaybackPlan(
      { sourceInMs: 250, rate: 1 },
      { startMs: 500, endMs: 1500 },
      0,
    );
    expect(plan.stretch).toBe(false);
    expect(plan.playRate).toBe(1);
    expect(plan.offsetSec).toBeCloseTo((250 + 500) / 1000, 8);
    expect(plan.sourceDurSec).toBeCloseTo(1, 8);
    const identity = timeStretchChannels([sine(TONE, 0.2)], SR, 1)[0]!;
    const source = sine(TONE, 0.2);
    expect(identity.length).toBe(source.length);
    for (let i = 0; i < source.length; i++) expect(identity[i]).toBe(source[i]);
  });

  it("exports a plain clip without the new edit fields", () => {
    const base = createSession(createMemoryBlobStore());
    const project = {
      ...projectWith(
        [clip({ id: "a1", assetId: "aud", trackId: "A1", startMs: 0, durationMs: 1000, sourceOutMs: 1000 })],
        [asset({ id: "aud", kind: "audio", durationMs: 60000 })],
      ),
      playheadMs: 0,
    };
    const raw = JSON.parse(serializeProject(project)) as { schemaVersion: number };
    expect(raw.schemaVersion).toBe(5);
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.schemaVersion).toBe(5);
    const job = jobFromProject(loaded);
    const exported = job.tracks.flatMap((track) => track.clips).find((c) => c.id === "a1")!;
    expect(exported.rate).toBe(1);
    expect(exported.reversed).toBeUndefined();
    expect(exported.holdSourceMs).toBeUndefined();
    expect(exported.gainKeys).toBeUndefined();
    expect(exported.opacityKeys).toBeUndefined();
    expect(exported.fadeInMs).toBe(0);
    expect(exported.fadeOutMs).toBe(0);
    expect(exported.sourceInMs).toBe(0);
    expect(exported.sourceOutMs).toBe(1000);
    expect(base.project.schemaVersion).toBe(5);
  });

  it("holds 440 Hz at 0.5x and 2x while a plain resample does not", () => {
    const source = sine(TONE, 1);
    expect(pitchHz(source)).toBeCloseTo(TONE, 0);
    const slow = timeStretchChannels([source], SR, 1 / 0.5)[0]!;
    const fast = timeStretchChannels([source], SR, 1 / 2)[0]!;
    expect(slow.length).toBe(source.length * 2);
    expect(fast.length).toBe(source.length / 2);
    expect(pitchHz(slow)).toBeCloseTo(TONE, 0);
    expect(pitchHz(fast)).toBeCloseTo(TONE, 0);
    expect(audioPlaybackPlan({ sourceInMs: 0, rate: 0.5 }, { startMs: 0, endMs: 2000 }, 0).stretch).toBe(true);
    expect(audioPlaybackPlan({ sourceInMs: 0, rate: 2 }, { startMs: 0, endMs: 500 }, 0)).toMatchObject({
      stretch: true,
      playRate: 1,
      offsetSec: 0,
      sourceDurSec: 0.5,
    });
    const sped = resampleChangingPitch(source, 0.5);
    expect(pitchHz(sped)).toBeGreaterThan(TONE * 1.5);
  });
});
