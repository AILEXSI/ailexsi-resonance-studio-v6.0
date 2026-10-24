/**
 * Per-clip linear fade in/out. Shared by preview audio, export mix, and video opacity.
 * Fade factor is 0..1; gainAtClipTime multiplies that by clip.gain.
 */

/** Menu, shortcut, and Director default when a fade length is omitted. */
export const DEFAULT_FADE_MS = 500;

export type Fadeable = {
  durationMs: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  /** Factor at local 0 when the export window starts mid fade-in (default 0). */
  fadeInFrom?: number;
  /** Factor at local duration when the export window ends mid fade-out (default 0). */
  fadeOutTo?: number;
};

export type GainFadeable = Fadeable & { gain: number };

/** Clamp each fade to [0, duration]. If they would overlap, scale both so they meet in the middle. */
export function normalizeClipFades(
  fadeInMs: number,
  fadeOutMs: number,
  durationMs: number,
): { fadeInMs: number; fadeOutMs: number } {
  const dur = Math.max(0, Number.isFinite(durationMs) ? durationMs : 0);
  let fadeIn = Number.isFinite(fadeInMs) ? fadeInMs : 0;
  let fadeOut = Number.isFinite(fadeOutMs) ? fadeOutMs : 0;
  fadeIn = Math.max(0, Math.min(dur, fadeIn));
  fadeOut = Math.max(0, Math.min(dur, fadeOut));
  const sum = fadeIn + fadeOut;
  if (sum > dur && sum > 0) {
    const scale = dur / sum;
    fadeIn *= scale;
    fadeOut *= scale;
  }
  return { fadeInMs: fadeIn, fadeOutMs: fadeOut };
}

export function applyNormalizedFades<T extends Fadeable>(clip: T): T {
  const { fadeInMs, fadeOutMs } = normalizeClipFades(
    clip.fadeInMs ?? 0,
    clip.fadeOutMs ?? 0,
    clip.durationMs,
  );
  if (clip.fadeInMs === fadeInMs && clip.fadeOutMs === fadeOutMs) return clip;
  return { ...clip, fadeInMs, fadeOutMs };
}

/** Linear envelope 0..1 at clip-local time. 0→1 over fadeIn, 1 in the middle, 1→0 over fadeOut. */
export function fadeFactorAt(clip: Fadeable, localMs: number): number {
  const durationMs = Math.max(0, clip.durationMs);
  const { fadeInMs, fadeOutMs } = normalizeClipFades(
    clip.fadeInMs ?? 0,
    clip.fadeOutMs ?? 0,
    durationMs,
  );
  if (durationMs <= 0 || !Number.isFinite(localMs)) return 0;
  if (localMs < 0 || localMs > durationMs) return 0;

  const from = clip.fadeInFrom != null ? clampFadeUnit(clip.fadeInFrom) : fadeInMs > 0 ? 0 : 1;
  const to = clip.fadeOutTo != null ? clampFadeUnit(clip.fadeOutTo) : fadeOutMs > 0 ? 0 : 1;
  let factor = 1;
  if (fadeInMs > 0 && fadeOutMs <= 0 && fadeInMs >= durationMs) {
    factor = from + (to - from) * (localMs / durationMs);
  } else if (fadeInMs <= 0 && fadeOutMs >= durationMs) {
    factor = from + (to - from) * (localMs / durationMs);
  } else {
    if (fadeInMs > 0 && localMs < fadeInMs) {
      factor = from + (1 - from) * (localMs / fadeInMs);
    }
    if (fadeOutMs > 0 && localMs > durationMs - fadeOutMs) {
      const u = (durationMs - localMs) / fadeOutMs;
      factor = Math.min(factor, to + (1 - to) * u);
    }
  }
  return Math.max(0, Math.min(1, factor));
}

function clampFadeUnit(value: number | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Shift/trim clip fades onto a visible [headTrim, headTrim+visibleDur) window
 * so export t=0 matches preview at IN (and the last frame matches preview at OUT).
 */
export function remapClipFadesForWindow(
  fadeInMs: number,
  fadeOutMs: number,
  clipDurationMs: number,
  headTrimMs: number,
  visibleDurationMs: number,
): { fadeInMs: number; fadeOutMs: number; fadeInFrom: number; fadeOutTo: number } {
  const clipDur = Math.max(0, clipDurationMs);
  const vis = Math.max(0, visibleDurationMs);
  const head = Math.max(0, Math.min(clipDur, headTrimMs));
  const orig = {
    durationMs: clipDur,
    ...normalizeClipFades(fadeInMs, fadeOutMs, clipDur),
  };
  const fadeInFrom = vis <= 0 ? 0 : fadeFactorAt(orig, head);
  const fadeOutTo = vis <= 0 ? 0 : fadeFactorAt(orig, Math.min(clipDur, head + vis));
  const tail = Math.max(0, clipDur - head - vis);
  const remainingIn = Math.max(0, orig.fadeInMs - head);
  const remainingOut = Math.max(0, orig.fadeOutMs - tail);
  const trimmed = normalizeClipFades(remainingIn, remainingOut, vis);
  return {
    fadeInMs: trimmed.fadeInMs,
    fadeOutMs: trimmed.fadeOutMs,
    fadeInFrom,
    fadeOutTo,
  };
}

/** Fade factor times existing clip gain. Mute/solo/track fader are applied by the caller. */
export function gainAtClipTime(clip: GainFadeable, localMs: number): number {
  return fadeFactorAt(clip, localMs) * Math.max(0, Number.isFinite(clip.gain) ? clip.gain : 0);
}

/** Canvas/CSS alpha: same factor, clamped to 0..1 (clip gain may be > 1). */
export function videoAlphaAtClipTime(clip: GainFadeable, localMs: number): number {
  return Math.min(1, gainAtClipTime(clip, localMs));
}

export type GainEnvelopePoint = { tMs: number; value: number };

/** Keyframes for an AudioParam linear envelope. `peak` is already-mixed clip/track/master gain. */
export function clipGainEnvelope(
  durationMs: number,
  fadeInMs: number,
  fadeOutMs: number,
  peak: number,
  opts?: { startFactor?: number; endFactor?: number },
): GainEnvelopePoint[] {
  const { fadeInMs: fadeIn, fadeOutMs: fadeOut } = normalizeClipFades(
    fadeInMs,
    fadeOutMs,
    durationMs,
  );
  const p = Math.max(0, Number.isFinite(peak) ? peak : 0);
  const fadeable: Fadeable = {
    durationMs,
    fadeInMs: fadeIn,
    fadeOutMs: fadeOut,
    fadeInFrom: opts?.startFactor,
    fadeOutTo: opts?.endFactor,
  };
  const times = [0, fadeIn, durationMs - fadeOut, durationMs]
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= durationMs)
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t !== all[i - 1]);
  return times.map((tMs) => ({ tMs, value: fadeFactorAt(fadeable, tMs) * p }));
}

export function scheduleGainEnvelope(
  param: { setValueAtTime(value: number, time: number): unknown; linearRampToValueAtTime(value: number, time: number): unknown },
  startMs: number,
  durationMs: number,
  fadeInMs: number,
  fadeOutMs: number,
  peak: number,
  opts?: { startFactor?: number; endFactor?: number },
): void {
  const points = clipGainEnvelope(durationMs, fadeInMs, fadeOutMs, peak, opts);
  points.forEach((point, i) => {
    const t = (startMs + point.tMs) / 1000;
    if (i === 0) param.setValueAtTime(point.value, t);
    else param.linearRampToValueAtTime(point.value, t);
  });
}
