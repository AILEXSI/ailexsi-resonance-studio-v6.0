import type { AudioFeatures } from "./types";

export type JourneyPhase = "drift" | "gather" | "threshold" | "breakthrough";

export interface JourneyState {
  phase: JourneyPhase;
  energy: number;
  tension: number;
  openness: number;
  density: number;
  speed: number;
  warp: number;
  horizon: number;
  gate: number;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / Math.max(1e-6, b - a));
  return t * t * (3 - 2 * t);
};

/**
 * Deterministic music -> spatial-world mapping.
 * It does not choose a scene and does not mutate project state.
 * Preview/export can therefore derive the same world state from the same features.
 */
export function deriveJourneyState(features: AudioFeatures): JourneyState {
  const rms = clamp01(features.rms);
  const bass = clamp01(features.bass);
  const mid = clamp01(features.mid);
  const treble = clamp01(features.treble);
  const beat = clamp01(features.beatPulse);

  const energy = clamp01(rms * 0.42 + bass * 0.34 + mid * 0.16 + treble * 0.08);
  const tension = clamp01(mid * 0.38 + treble * 0.28 + rms * 0.18 + beat * 0.16);
  const impact = clamp01(beat * 0.58 + bass * 0.30 + rms * 0.12);

  const gather = smoothstep(0.20, 0.58, energy + tension * 0.18);
  const threshold = smoothstep(0.48, 0.78, tension + energy * 0.20);
  const breakthrough = smoothstep(0.62, 0.92, impact + energy * 0.22);

  let phase: JourneyPhase = "drift";
  if (breakthrough > 0.72) phase = "breakthrough";
  else if (threshold > 0.62) phase = "threshold";
  else if (gather > 0.45) phase = "gather";

  const openness =
    phase === "breakthrough"
      ? clamp01(0.72 + breakthrough * 0.28)
      : clamp01(0.78 - threshold * 0.52 + (1 - gather) * 0.12);

  return {
    phase,
    energy,
    tension,
    openness,
    density: clamp01(0.18 + gather * 0.48 + threshold * 0.26 - breakthrough * 0.16),
    speed: 0.34 + energy * 0.72 + gather * 0.32 + breakthrough * 0.62,
    warp: clamp01(bass * 0.55 + beat * 0.25 + tension * 0.20),
    horizon: clamp01(0.72 - threshold * 0.38 + breakthrough * 0.22),
    gate: clamp01(threshold * (1 - breakthrough * 0.72)),
  };
}
