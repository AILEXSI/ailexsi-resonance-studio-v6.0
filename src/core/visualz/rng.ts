/** Deterministic RNG. Same songTime + trackSeed + id = same universe. */

export function hash32(n: number): number {
  let x = n | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function seedFrom(songTimeMs: number, trackSeed: number, particleId: number): number {
  return hash32(hash32(Math.floor(songTimeMs * 0.06) + 1) ^ hash32(trackSeed + 17) ^ hash32(particleId + 99));
}

export function rand01(seed: number): number {
  return hash32(seed) / 4294967295;
}
