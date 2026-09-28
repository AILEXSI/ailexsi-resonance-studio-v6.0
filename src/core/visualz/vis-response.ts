/**
 * VIS-RESPONSE-01 — presentation shaping after truthful analysis.
 *
 *   REAL AUDIO → shared FFT / RMS / bands / onset → applyVisResponse → scenes
 *
 * The analyser (fftSize 2048, Blackman, dB [-100, -30], smoothing 0.75,
 * 1024 bins, Visualz silence gate, stepOnset) is not tuned here. Raw
 * AudioFeatures stay intact. This module only builds a scene packet.
 *
 * Phase 1 evidence (3b16a09 extractor, 44.1 kHz, sequential 60 Hz hop):
 *
 *   | PCM                         | rms   | bass  | energy | specPeak | specMean | orbBreath |
 *   | silence                     | 0     | 0     | 0      | 0        | 0        | 1.000     |
 *   | quiet 220 Hz amp 0.06       | 0.085 | 0.027 | 0.056  | 0.968    | 0.004    | 1.015     |
 *   | pad 220 Hz amp 0.35         | 0.494 | 0.045 | 0.270  | 1.000    | 0.008    | 1.025     |
 *   | kick 70 Hz                  | 0.393 | 0.166 | 0.280  | 0.455    | 0.031    | 1.091     |
 *   | snare                       | 0.203 | 0.256 | 0.229  | 0.369    | 0.242    | 1.141     |
 *   | bass tone 55 Hz amp 0.55    | 0.770 | 0.045 | 0.408  | 1.000    | 0.008    | 1.025     |
 *   | 110 Hz amp sweep 0.1 → 1.0  | 0.140→1.00 | 0.028→0.046 | — | 1.0→1.0 | — | — |
 *
 * Classification **F** (B + A + C + E; D already works):
 *   B bands   — `third = 170` averages 0–3.66 kHz. A sine saturates 1–5 bins
 *               in the Analyser dB map; the 170-bin mean stays ~0.03–0.05
 *               from amp 0.1 to 1.0. Bass is spectral occupancy, not level.
 *   A spectrum — peak hits 1.0 by amp 0.1 (dB ceiling −30). Mean stays ~0.01
 *               for tones. 48-bar scenes sample ~every 22 bins and miss the
 *               peak (pad barsPeakPow 0.07 while specPeak is 1.0).
 *   C energy   — `0.5*rms + 0.5*bass` is pulled down by diluted bass.
 *   D beatPulse — already ~1 after a kick (onset + 360 ms decay). Keep it.
 *   E scenes    — `1 + bass*0.55` needs bass ≳ 0.3 to read as impact.
 *
 * Response (small model, chosen from that table — not AGC, not per-song peak):
 *   shape(x) = clamp01(pow(clamp01(x * gain), gamma))
 *   presence = shape(rms)                               amplitude carrier
 *   visBand  = max(shape(rawBand), presence * mix)      mix = band / sum
 *   spectrum = peak-hold spread then min(shape(bin), presence)
 *              (dB-sat peaks cannot outrun RMS; no hard sat cliff)
 *   energy   = 0.5*visRms + 0.5*visBass; +transientBoost on onset
 *   beatPulse= onset ? 1 : shape(raw.beatPulse, 1, gamma)
 *
 * VIS-RESPONSE-02 (human soft-PASS on 01, more felt kick / mid):
 *   01 defaults were gain=1.2 gamma=0.75 spread=12 transient=0.24
 *   02 defaults:   gain=1.25 gamma=0.68 spread=18 transient=0.38
 *   Pad 0.35 rms 0.494 → shape 0.720 (must stay < 1). Quiet 0.085 → 0.218.
 */

import type { AudioFeatures } from "./types";

/** Untouched analyser packet. Never mutated by applyVisResponse. */
export type RawAudioFeatures = AudioFeatures;

/** Scene / host packet after applyVisResponse. */
export type VisualizerPresentation = AudioFeatures & {
  energy: number;
  high: number;
};

export type VisResponseConfig = {
  /** Global pre-gain inside shape(). */
  gain: number;
  /** Power < 1 expands mid-lows; still monotonic. */
  gamma: number;
  /** Peak-hold radius at 1024 bins so coarse scene sampling sees narrow peaks. */
  spectrumSpreadBins: number;
  /** Added to presentation energy on a true onset (not added to rms/bands). */
  transientBoost: number;
};

/** VIS-RESPONSE-01 shipped defaults (human soft-PASS). Kept for before/after tests. */
export const VIS_RESPONSE_01: VisResponseConfig = {
  gain: 1.2,
  gamma: 0.75,
  spectrumSpreadBins: 12,
  transientBoost: 0.24,
};

/**
 * VIS-RESPONSE-02 — more kick / mid, same monotonic model.
 * gain 1.25 still keeps a 0.35-amp pad (raw rms 0.494) at ~0.72, not 1.
 * Lower gamma expands mid-lows. Wider spread helps 48-bar / wave sampling.
 * Stronger transientBoost punches presentation energy on onset only.
 */
export const DEFAULT_VIS_RESPONSE: VisResponseConfig = {
  gain: 1.25,
  gamma: 0.68,
  spectrumSpreadBins: 18,
  transientBoost: 0.38,
};

export function clamp01(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/** `clamp01(pow(clamp01(x * gain), gamma))` — the only continuous curve. */
export function shapeVisLevel(x: number, gain: number, gamma: number): number {
  const y = clamp01(x) * gain;
  if (y <= 0) return 0;
  if (y >= 1) return 1;
  return clamp01(Math.pow(y, gamma));
}

function spreadSpectrum(src: ArrayLike<number>, radius: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(n);
  if (radius <= 0) {
    for (let i = 0; i < n; i++) out[i] = src[i] ?? 0;
    return out;
  }
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = Math.max(0, i - radius);
    const b = Math.min(n - 1, i + radius);
    for (let k = a; k <= b; k++) {
      const v = src[k] ?? 0;
      if (v > m) m = v;
    }
    out[i] = m;
  }
  return out;
}

function shapeSpectrum(
  spectrum: ArrayLike<number>,
  presence: number,
  cfg: VisResponseConfig,
): Float32Array {
  const n = spectrum.length;
  const radius =
    n >= 16 ? Math.max(1, Math.round(cfg.spectrumSpreadBins * (n / 1024))) : 0;
  const smeared = spreadSpectrum(spectrum, radius);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = smeared[i] ?? 0;
    // Cap by RMS presence so dB-sat peaks stay amplitude-true and monotonic.
    out[i] = Math.min(shapeVisLevel(v, cfg.gain, cfg.gamma), presence);
  }
  return out;
}

function bandMix(raw: number, sum: number): number {
  if (sum <= 1e-6) return 0;
  return clamp01(raw / sum);
}

/**
 * Shared Preview / Export presentation. Same raw + same config ⇒ same packet.
 * Does not write into `raw` or `raw.spectrum`.
 */
export function applyVisResponse(
  raw: RawAudioFeatures,
  config: Readonly<VisResponseConfig> = DEFAULT_VIS_RESPONSE,
): VisualizerPresentation {
  const cfg = config;
  const presence = shapeVisLevel(raw.rms, cfg.gain, cfg.gamma);
  const visRms = presence;
  const sum = raw.bass + raw.mid + raw.treble;
  const visBass = clamp01(
    Math.max(shapeVisLevel(raw.bass, cfg.gain, cfg.gamma), presence * bandMix(raw.bass, sum)),
  );
  const visMid = clamp01(
    Math.max(shapeVisLevel(raw.mid, cfg.gain, cfg.gamma), presence * bandMix(raw.mid, sum)),
  );
  const visTreble = clamp01(
    Math.max(shapeVisLevel(raw.treble, cfg.gain, cfg.gamma), presence * bandMix(raw.treble, sum)),
  );
  const visBeat = raw.onset ? 1 : shapeVisLevel(raw.beatPulse, 1, cfg.gamma);
  let energy = clamp01(visRms * 0.5 + visBass * 0.5);
  if (raw.onset) energy = clamp01(energy + cfg.transientBoost);
  // Ceiling is the loudest presented channel so 120 BPM hats (rms=0, treble>0)
  // still move, while true silence (all channels 0) stays black.
  const specPresence = clamp01(Math.max(presence, visBass, visMid, visTreble));
  return {
    timeMs: raw.timeMs,
    rms: visRms,
    bass: visBass,
    mid: visMid,
    treble: visTreble,
    spectrum: shapeSpectrum(raw.spectrum, specPresence, cfg),
    onset: raw.onset,
    beatPulse: visBeat,
    tempoBpm: raw.tempoBpm,
    kick: raw.kick,
    snare: raw.snare,
    hat: raw.hat,
    vocal: raw.vocal,
    buildup: raw.buildup,
    drop: raw.drop,
    energy,
    high: visTreble,
  };
}
