/**
 * Pitch-preserving time scale (WSOLA).
 *
 * `factor` is output length / input length. 2 slows the clip to 0.5x.
 * 0.5 plays it at 2x. The waveform period stays, so the pitch stays.
 *
 * SoundTouch and soundtouch-ts are LGPL. This file is original code and
 * stays on the project license. The rate-1 export path does not call it.
 */

const WIN_SEC = 0.03;

function hann(length: number): Float32Array {
  const out = new Float32Array(length);
  const denom = Math.max(1, length - 1);
  for (let i = 0; i < length; i++) out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / denom));
  return out;
}

function tileChannels(channels: readonly Float32Array[], outLen: number): Float32Array[] {
  return channels.map((src) => {
    const out = new Float32Array(outLen);
    if (src.length === 0) return out;
    for (let i = 0; i < outLen; i++) out[i] = src[i % src.length] ?? 0;
    return out;
  });
}

function bestOffset(
  input: Float32Array,
  prevPos: number,
  nominal: number,
  win: number,
  hs: number,
  overlap: number,
  delta: number,
  length: number,
): number {
  const limit = length - win;
  const searchFrom = Math.max(0, Math.min(limit, nominal) - delta);
  const searchTo = Math.min(limit, Math.max(0, nominal) + delta);
  const ref = prevPos + hs;
  let bestPos = Math.max(0, Math.min(limit, Math.round(nominal)));
  let best = -Infinity;
  const scoreAt = (pos: number): number => {
    let corr = 0;
    let e1 = 1e-12;
    let e2 = 1e-12;
    for (let i = 0; i < overlap; i += 2) {
      const a = input[ref + i] ?? 0;
      const b = input[pos + i] ?? 0;
      corr += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    return corr / Math.sqrt(e1 * e2);
  };
  for (let pos = searchFrom; pos <= searchTo; pos += 4) {
    const score = scoreAt(pos);
    if (score > best) {
      best = score;
      bestPos = pos;
    }
  }
  const fineFrom = Math.max(searchFrom, bestPos - 4);
  const fineTo = Math.min(searchTo, bestPos + 4);
  for (let pos = fineFrom; pos <= fineTo; pos++) {
    const score = scoreAt(pos);
    if (score > best) {
      best = score;
      bestPos = pos;
    }
  }
  return bestPos;
}

/** Time-scale each channel with one shared analysis track so stereo stays paired. */
export function timeStretchChannels(
  channels: readonly Float32Array[],
  sampleRate: number,
  factor: number,
): Float32Array[] {
  if (channels.length === 0) return [];
  const length = channels[0]?.length ?? 0;
  const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const outLen = Math.max(1, Math.round(length * safeFactor));
  if (length === 0) return channels.map(() => new Float32Array(outLen));
  if (Math.abs(safeFactor - 1) < 1e-4) {
    return channels.map((src) => {
      const out = new Float32Array(outLen);
      out.set(src.subarray(0, Math.min(length, outLen)));
      return out;
    });
  }

  let win = Math.round(Math.max(1, sampleRate) * WIN_SEC);
  if (win % 2) win += 1;
  const maxWin = length >= 64 ? length >> 1 : 0;
  if (maxWin >= 32) win = Math.min(win, maxWin - (maxWin % 2));
  if (win < 32 || length < win + 8) return tileChannels(channels, outLen);

  const hs = win >> 1;
  const ha = Math.max(1, Math.round(hs / safeFactor));
  const delta = Math.max(1, hs >> 1);
  const overlap = win - hs;
  const window = hann(win);
  const guide = channels[0]!;
  const outs = channels.map(() => new Float32Array(outLen));
  const weight = new Float32Array(outLen);

  let ana = 0;
  let syn = 0;
  let prev = 0;
  let first = true;
  for (let guard = 0; syn < outLen && guard < outLen; guard++) {
    const limit = length - win;
    let pos = Math.max(0, Math.min(limit, Math.round(ana)));
    if (!first) pos = bestOffset(guide, prev, ana, win, hs, overlap, delta, length);
    const frame = Math.min(win, outLen - syn);
    for (let ch = 0; ch < channels.length; ch++) {
      const src = channels[ch]!;
      const dst = outs[ch]!;
      for (let i = 0; i < frame; i++) dst[syn + i] = (dst[syn + i] ?? 0) + (src[pos + i] ?? 0) * (window[i] ?? 0);
    }
    for (let i = 0; i < frame; i++) weight[syn + i] = (weight[syn + i] ?? 0) + (window[i] ?? 0);
    first = false;
    prev = pos;
    syn += hs;
    ana = pos + ha;
    if (pos >= limit && ana > limit) break;
  }
  for (const dst of outs) {
    for (let i = 0; i < outLen; i++) {
      const w = weight[i] ?? 0;
      dst[i] = w > 1e-8 ? (dst[i] ?? 0) / w : 0;
    }
  }
  return outs;
}
