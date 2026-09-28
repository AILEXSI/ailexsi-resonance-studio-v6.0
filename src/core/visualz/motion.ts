/**
 * Motion is gated by the song.
 * Silence (gate under 0.03) → no phase advance.
 * Energy / beat → motion.
 */

export function musicClock(
  dt: number,
  energy: number,
  beatPulse: number,
  speed: number
): number {
  const gate = Math.max(0, Math.min(1, energy * 1.35 + beatPulse * 0.45));
  if (gate < 0.03) return 0;
  return dt * speed * gate;
}

/** Log-frequency sample of a linear FFT spectrum (more musical bar layout). */
export function logSpectrumSample(
  spectrum: Float32Array,
  t: number
): number {
  if (!spectrum.length) return 0;
  const x = Math.max(0, Math.min(0.999, t));
  const idx = Math.floor(Math.pow(x, 1.65) * (spectrum.length - 1));
  return spectrum[idx] ?? 0;
}
