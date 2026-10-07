import { describe, expect, it } from "vitest";
import { deriveJourneyState } from "../../src/core/visualz/journey";
import type { AudioFeatures } from "../../src/core/visualz/types";

const f = (p: Partial<AudioFeatures>): AudioFeatures => ({
  timeMs: 0, rms: 0, bass: 0, mid: 0, treble: 0,
  spectrum: new Float32Array(64), onset: false, beatPulse: 0, ...p,
});

describe("music journey world state", () => {
  it("keeps silence in a slow open drift", () => {
    const s = deriveJourneyState(f({}));
    expect(s.phase).toBe("drift");
    expect(s.speed).toBeGreaterThan(0);
    expect(s.openness).toBeGreaterThan(0.7);
    expect(s.gate).toBe(0);
  });

  it("turns sustained energy into denser forward motion", () => {
    const quiet = deriveJourneyState(f({ rms: 0.12, bass: 0.12, mid: 0.1, treble: 0.08 }));
    const build = deriveJourneyState(f({ rms: 0.72, bass: 0.55, mid: 0.82, treble: 0.72, beatPulse: 0.12 }));
    expect(build.speed).toBeGreaterThan(quiet.speed);
    expect(build.density).toBeGreaterThan(quiet.density);
    expect(["gather", "threshold"]).toContain(build.phase);
  });

  it("maps a bass/beat impact to breakthrough and re-opens the world", () => {
    const s = deriveJourneyState(f({ rms: 0.92, bass: 1, mid: 0.58, treble: 0.4, beatPulse: 1, onset: true }));
    expect(s.phase).toBe("breakthrough");
    expect(s.openness).toBeGreaterThan(0.85);
    expect(s.speed).toBeGreaterThan(1.2);
  });

  it("is deterministic and finite for identical features", () => {
    const input = f({ rms: 0.43, bass: 0.61, mid: 0.37, treble: 0.22, beatPulse: 0.4 });
    expect(deriveJourneyState(input)).toEqual(deriveJourneyState(input));
    for (const value of Object.values(deriveJourneyState(input))) {
      if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
    }
  });
});
