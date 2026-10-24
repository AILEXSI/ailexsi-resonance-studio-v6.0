import { existsSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  AFE_DECODE_QUEUE_HIGH_WATER_CAP,
  AFE_DECODE_QUEUE_RECOVERY_FILL,
  AfeVideoDecoder,
  decodeQueueHighWater,
  decodeQueueLowWater,
  exactRequestIdentityHolds,
  formatStallMessage,
  lastRequiredDecodeSample,
  mayFinalFlush,
  mayGenuineFinalDrain,
  parseIsoBmff,
  requestOwnershipHolds,
  tailDependencyClosed,
  usefulInputExhausted,
} from "../../src/core/frame-engine";
import {
  FlushLeavesQueueDecoder,
  installFlushLeavesQueueDecoder,
  installNeverEmitDecoder,
} from "./afe-videodecoder-mock";

const LONG = "tests/fixtures/afe/afe-cfr-30-g60-8s.mp4";
const BFRAME = "tests/fixtures/afe/afe-bframe-30-g30-2s.mp4";
const AFE15_MEDIA = existsSync(LONG) || existsSync(BFRAME);

/**
 * The dump names fields `visFrames` and `coldOpenAfterVis`. A substring search
 * for VIS matches those names. The ban is on the whole token.
 */
const AFE15_BANNED =
  /\b(?:nearest|snap|dup|last-good|paintFallback|allowSkip|vis|black|ffmpeg|wasm|mediabunny|htmlvideo)\b/i;

/** Latest Windows HUMAN failure — first-fill tail, no recreate. */
const HUMAN = {
  sample: 134,
  ptsUs: 5_625_000,
  lastDecodedTs: 5_583_333,
  decodeQueue: 2,
  submitted: 140,
  lastRequired: 140,
  req: 40,
  dec: 39,
  enc: 39,
  unresolved: 1,
  flushes: 1,
  high: 40,
  low: 6,
  peak: 40,
  maxReorder: 10,
  prefetch: 4,
  sampleCount: 141,
};

function loadMovie(path: string) {
  if (!existsSync(path)) return null;
  return parseIsoBmff(new Uint8Array(readFileSync(path)));
}

describe.skipIf(!AFE15_MEDIA)(
  AFE15_MEDIA
    ? "AFE-15 A–P exact-PTS tail ownership + final drain"
    : "AFE-15 skipped: fixture mp4 missing (tests/fixtures/afe/afe-cfr-30-g60-8s.mp4 or afe-bframe-30-g30-2s.mp4)",
  () => {
  let restore: (() => void) | undefined;
  afterEach(() => {
    restore?.();
    restore = undefined;
  });

  it("A. human stall: sample 134 PTS 5625000, streamPts 0, stale ptsRegistered, FINAL_FLUSH_ARMED, queue 2", () => {
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      originRequestedSample: HUMAN.sample,
      originRequestedPts: HUMAN.ptsUs,
      lastSubmittedSample: HUMAN.submitted,
      lastRequiredDecodeSample: HUMAN.lastRequired,
      lastRequestedSample: HUMAN.submitted,
      decodeQueueSize: HUMAN.decodeQueue,
      lastDecodedTimestamp: HUMAN.lastDecodedTs,
      streamPtsPending: 0,
      streamReadySize: 0,
      pendingPts: [],
      readyIndexes: [],
      decoderFlushCount: HUMAN.flushes,
      decoderResetCount: 0,
      decoderRecreateCount: 0,
      recoveryAttempts: 0,
      packetParity: null,
      ptsRegistered: false,
      ptsEverRegistered: true,
      ptsCurrentlyRegistered: false,
      targetPtsUs: HUMAN.ptsUs,
      targetPtsSeen: false,
      ownershipWaiterActive: false,
      ownershipRebuilt: true,
      ownershipState: "FINAL_FLUSH_ARMED",
      finalFlushArmed: true,
      finalFlushAttempted: true,
      usefulInputExhausted: true,
      unresolvedRequestedVideoFrames: HUMAN.unresolved,
      openedRequestedVideoFrames: HUMAN.req,
      videoFramesRequested: HUMAN.req,
      videoFramesDecoded: HUMAN.dec,
      videoFramesEncoded: HUMAN.enc,
      decodeQueueHighWater: HUMAN.high,
      decodeQueueLowWater: HUMAN.low,
      decodeQueuePeak: HUMAN.peak,
      backpressureBlocked: false,
      stallPhase: "FINAL_FLUSH",
      exactIdentityHolds: false,
      stalledMs: 3000,
      transactionComplete: false,
    });
    expect(text).toContain("requested sample 134 PTS 5625000");
    expect(text).toContain("streamPts 0");
    expect(text).toContain("streamReady 0");
    expect(text).toContain("pending PTS []");
    expect(text).toContain("decodeQueue 2");
    expect(text).toContain("lastDecodedTs 5583333");
    expect(text).toContain("flushes 1");
    expect(text).toContain("resets 0");
    expect(text).toContain("recreates 0");
    expect(text).toContain("recoveryAttempts 0");
    expect(text).toContain("packetParity n/a");
    expect(text).toContain("ptsRegistered no");
    expect(text).toContain("ptsEverRegistered yes");
    expect(text).toContain("ptsCurrentlyRegistered no");
    expect(text).toContain("targetPts 5625000");
    expect(text).toContain("targetPtsSeen no");
    expect(text).toContain("exactIdentity no");
    expect(text).toContain("waiterActive no");
    expect(text).toContain("ownershipState FINAL_FLUSH_ARMED");
    expect(text).toContain("usefulInputExhausted yes");
    expect(text).toContain("decodeQueueHighWater 40");
    expect(text).toContain("decodeQueueLowWater 6");
    expect(text).toContain("decodeQueuePeak 40");
    expect(text).toContain("backpressureBlocked no");
    expect(text).toContain("stalledMs 3000");
    expect(text).not.toMatch(AFE15_BANNED);
  });

  it("B. lifecycle OPEN_REQUEST → PTS_REGISTERED → FINAL_FLUSH_ARMED retains live identity", async () => {
    const movie = loadMovie(LONG) ?? loadMovie(BFRAME);
    if (!movie) return;
    const index = Math.min(HUMAN.sample, movie.sampleCount - 1);
    const pts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[index]!);
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: Math.min(movie.sampleCount - 1, index + 6),
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    decoder.bindOrigin({ sourceSampleRequested: index, requestedPtsUs: pts });
    expect(decoder.ownershipTrace(index)).toContain("OPEN_REQUEST");
    decoder.confirmPtsRegistered(index, pts);
    expect(decoder.ownershipTrace(index)).toContain("PTS_REGISTERED");
    expect(decoder.ptsCurrentlyRegisteredFor(index)).toBe(true);
    decoder.armFinalFlush([index]);
    expect(decoder.ownershipTrace(index)).toContain("FINAL_FLUSH_ARMED");
    expect(decoder.ptsCurrentlyRegisteredFor(index)).toBe(true);
    decoder.assertOpenedOwnership({ sourceSampleRequested: index, requestedPtsUs: pts });
    const actions = decoder.identityTrace(index).map((e) => e.action);
    expect(actions).toContain("OPEN_REQUEST");
    expect(actions).toContain("PTS_INSERT");
    expect(actions).toContain("RETAIN");
    decoder.close();
  });

  it("C. ptsEverRegistered survives takeExact leave; ptsCurrentlyRegistered does not", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 3,
      lastRequiredDecodeSample: 10,
      requestedIndexes: [3],
    });
    const pts = decoder.chunkTimestampUs(movie.samples[3]!);
    decoder.openRequested(3, pts);
    decoder.confirmPtsRegistered(3, pts);
    expect(decoder.ptsEverRegisteredFor(3)).toBe(true);
    expect(decoder.ptsCurrentlyRegisteredFor(3)).toBe(true);
    expect(decoder.dropLivePtsIdentity(3)).toBe(true);
    expect(decoder.ptsEverRegisteredFor(3)).toBe(true);
    expect(decoder.ptsCurrentlyRegisteredFor(3)).toBe(false);
    const snap = decoder.snapshot({ sourceSampleRequested: 3, requestedPtsUs: pts });
    expect(snap.ptsEverRegistered).toBe(true);
    expect(snap.ptsCurrentlyRegistered).toBe(false);
    expect(snap.ptsRegistered).toBe(false);
    decoder.close();
  });

  it("D. FINAL_FLUSH_ARMED alone is not identity → OWNERSHIP_LOST", () => {
    expect(
      requestOwnershipHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPts: [],
        ptsRegistered: false,
        ptsCurrentlyRegistered: false,
        recoveryRebuilding: false,
        finalFlushArmed: true,
        finalFlushInProgress: true,
      }),
    ).toBe(false);
    expect(
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: null,
        pendingPts: [],
        ptsCurrentlyRegistered: false,
        streamReadyExact: false,
        recoveryRebuilding: false,
      }),
    ).toBe(false);
  });

  it("E. live identity holds via PtsIndexMap OR ready exact OR waiter OR recovery", () => {
    expect(
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: 1,
        pendingPts: [HUMAN.ptsUs],
        requestedPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(true);
    expect(
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: 1,
        streamReadyExact: true,
        pendingPts: [],
      }),
    ).toBe(true);
    expect(
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: 1,
        streamWaiterIndex: HUMAN.sample,
        pendingPts: [],
      }),
    ).toBe(true);
    expect(
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: 1,
        recoveryRebuilding: true,
        pendingPts: [],
      }),
    ).toBe(true);
    expect(
      exactRequestIdentityHolds({
        unresolvedRequestedVideoFrames: 1,
        ptsCurrentlyRegistered: true,
        pendingPts: [],
      }),
    ).toBe(true);
  });

  it("F. takeExact leave without resolve rebinds identity (audit)", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: 3,
      lastRequiredDecodeSample: 10,
      requestedIndexes: [3],
    });
    const pts = decoder.chunkTimestampUs(movie.samples[3]!);
    decoder.openRequested(3, pts);
    decoder.confirmPtsRegistered(3, pts);
    decoder.dropLivePtsIdentity(3);
    const leave = decoder.identityTrace(3).map((e) => e.action);
    expect(leave).toContain("PTS_LEAVE_DELETE");
    expect(decoder.ptsCurrentlyRegisteredFor(3)).toBe(false);
    expect(decoder.retainExactIdentity(3, pts)).toBe(true);
    expect(decoder.ptsCurrentlyRegisteredFor(3)).toBe(true);
    decoder.assertOpenedOwnership({ sourceSampleRequested: 3, requestedPtsUs: pts });
    decoder.close();
  });

  it("G. CASE A: target output exists after map miss → rematch delivers exact PTS", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    restore = installNeverEmitDecoder();
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const index = 3;
    const pts = decoder.chunkTimestampUs(movie.samples[index]!);
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: index + 4,
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    decoder.confirmPtsRegistered(index, pts);
    expect(decoder.dropLivePtsIdentity(index)).toBe(true);
    expect(decoder.ptsCurrentlyRegisteredFor(index)).toBe(false);
    decoder.deliverOutputForTest(pts);
    const frame = decoder.takeReady(index);
    expect(frame).not.toBeNull();
    expect(frame!.timestamp).toBe(pts);
    expect(decoder.hasTargetPtsBeenSeen(pts)).toBe(true);
    expect(decoder.identityTrace(index).map((e) => e.action)).toContain("REMATCH_EXACT_PTS");
    frame!.close();
    decoder.close();
  }, 10_000);

  it("H. CASE B: target never emitted → no fake success; identity retained or OWNERSHIP_LOST", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    const index = 3;
    const pts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[index]!);
    restore = installFlushLeavesQueueDecoder({
      leaveOnFirstFlush: 2,
      skipPts: [pts],
      emitSkippedOnSecondFlush: false,
    });
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: index + 4,
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    decoder.bindOrigin({
      sourceSampleRequested: index,
      requestedPtsUs: pts,
      videoFramesRequested: 1,
      videoFramesDecoded: 0,
      videoFramesEncoded: 0,
    });
    for (let i = 0; i <= index + 4; i++) decoder.submitEncoded(movie.samples[i]!);
    decoder.armFinalFlush([index]);
    await decoder.flushTail();
    expect(decoder.takeReady(index)).toBeNull();
    expect(decoder.hasTargetPtsBeenSeen(pts)).toBe(false);
    expect(decoder.unresolvedRequestedCount()).toBe(1);
    expect(decoder.snapshot().transactionComplete).toBe(false);
    decoder.assertOpenedOwnership({ sourceSampleRequested: index, requestedPtsUs: pts });
    expect(decoder.ptsCurrentlyRegisteredFor(index) || decoder.ownershipTrace(index).includes("OWNERSHIP_LOST")).toBe(
      true,
    );
    decoder.close();
  }, 10_000);

  it("I. FINAL_FLUSH output trace exposes targetPts* / tailOutput*", () => {
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      targetPtsUs: HUMAN.ptsUs,
      targetPtsSeen: true,
      targetPtsOutputCount: 1,
      targetPtsLastSeenTs: HUMAN.ptsUs,
      tailOutputTimestamps: [5_583_333, 5_625_000],
      tailOutputCount: 2,
      ptsEverRegistered: true,
      ptsCurrentlyRegistered: true,
      exactIdentityHolds: true,
    });
    expect(text).toContain("targetPts 5625000");
    expect(text).toContain("targetPtsSeen yes");
    expect(text).toContain("targetPtsOutputs 1");
    expect(text).toContain("targetPtsLastSeenTs 5625000");
    expect(text).toContain("tailOutputs 2");
    expect(text).toContain("tailOutputTs [5583333,5625000]");
    expect(text).toContain("ptsEverRegistered yes");
    expect(text).toContain("ptsCurrentlyRegistered yes");
    expect(text).toContain("exactIdentity yes");
  });

  it("J. flush leaves decodeQueue 2 then target emits → genuine drain delivers (CASE A late)", async () => {
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    restore = installFlushLeavesQueueDecoder({ leaveOnFirstFlush: 2, emitSkippedOnSecondFlush: true });
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    const index = 3;
    const pts = decoder.chunkTimestampUs(movie.samples[index]!);
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: index + 4,
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    for (let i = 0; i <= index + 4; i++) decoder.submitEncoded(movie.samples[i]!);
    decoder.armFinalFlush([index]);
    await decoder.flushTail();
    const frame = decoder.takeReady(index);
    expect(frame).not.toBeNull();
    expect(frame!.timestamp).toBe(pts);
    expect(FlushLeavesQueueDecoder.last?.flushCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(decoder.snapshot().decoderRecreateCount).toBe(0);
    frame!.close();
    decoder.close();
  }, 10_000);

  it("K. lastRequired 140 vs sample 134 is dependency-closed; do not raise HIGH_WATER", () => {
    expect(
      tailDependencyClosed({
        requested: HUMAN.sample,
        lastRequiredDecodeSample: HUMAN.lastRequired,
        lastSubmittedSample: HUMAN.submitted,
        sampleCount: HUMAN.sampleCount,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
      }),
    ).toBe(true);
    expect(
      lastRequiredDecodeSample({
        lastRequested: HUMAN.sample,
        maxReorderSamples: HUMAN.maxReorder,
        prefetch: HUMAN.prefetch,
        sampleCount: HUMAN.sampleCount,
      }),
    ).toBe(HUMAN.lastRequired);
    expect(
      decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: false }),
    ).toBe(HUMAN.high);
  });

  it("L. AFE-11 FINAL_FLUSH still allowed when useful input is exhausted (not atTail)", () => {
    expect(
      usefulInputExhausted({
        lastSubmittedSample: HUMAN.submitted,
        lastRequiredDecodeSample: HUMAN.lastRequired,
        nextDecode: HUMAN.submitted + 1,
        sampleCount: HUMAN.sampleCount,
      }),
    ).toBe(true);
    expect(
      mayFinalFlush({
        unresolvedRequestedVideoFrames: 1,
        nextDecode: HUMAN.submitted + 1,
        sampleCount: HUMAN.sampleCount,
        lastRequiredDecodeSample: HUMAN.lastRequired,
        lastSubmittedSample: HUMAN.submitted,
        streamWaiterIndex: null,
        pendingPts: [],
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(true);
  });

  it("M. decodeQueue=2 does not lower first-fill HIGH_WATER", () => {
    expect(HUMAN.decodeQueue).toBe(2);
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: false })).toBe(40);
    expect(decodeQueueHighWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: false })).toBe(
      AFE_DECODE_QUEUE_RECOVERY_FILL,
    );
    expect(decodeQueueLowWater(HUMAN.maxReorder, HUMAN.prefetch, { afterRecreate: false })).toBe(HUMAN.low);
    expect(AFE_DECODE_QUEUE_HIGH_WATER_CAP).toBe(48);
  });

  it("N. no nearest / VIS / BLACK / null / software fallback in AFE-15 dump", () => {
    const text = formatStallMessage({
      sourceSampleRequested: HUMAN.sample,
      requestedPtsUs: HUMAN.ptsUs,
      unresolvedRequestedVideoFrames: 1,
      transactionComplete: false,
      stallPhase: "FINAL_FLUSH",
    });
    expect(text).not.toMatch(AFE15_BANNED);
  });

  it("O. genuine drain when queue>0 after flush; one extra flush; no GOP recreate", async () => {
    expect(
      mayGenuineFinalDrain({
        unresolvedRequestedVideoFrames: 1,
        usefulInputExhausted: true,
        finalFlushAttempted: true,
        targetPtsSeen: false,
        decodeQueueSize: 2,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
        recoveryRebuilding: false,
        transactionComplete: false,
      }),
    ).toBe(true);
    expect(
      mayGenuineFinalDrain({
        unresolvedRequestedVideoFrames: 1,
        usefulInputExhausted: true,
        finalFlushAttempted: true,
        targetPtsSeen: false,
        decodeQueueSize: 0,
        lastDecodedTimestamp: HUMAN.lastDecodedTs,
        targetPtsUs: HUMAN.ptsUs,
      }),
    ).toBe(false);
    expect(
      mayGenuineFinalDrain({
        unresolvedRequestedVideoFrames: 1,
        usefulInputExhausted: true,
        finalFlushAttempted: true,
        targetPtsSeen: true,
        decodeQueueSize: 2,
      }),
    ).toBe(false);
    const movie = loadMovie(BFRAME) ?? loadMovie(LONG);
    if (!movie) return;
    const index = 3;
    const pts = new AfeVideoDecoder(movie).chunkTimestampUs(movie.samples[index]!);
    restore = installFlushLeavesQueueDecoder({ leaveOnFirstFlush: 2, skipPts: [pts] });
    const decoder = new AfeVideoDecoder(movie);
    await decoder.ensure();
    decoder.beginStream(new Uint8Array(movie.sampleCount).fill(1), 0, {
      lastRequested: index,
      lastRequiredDecodeSample: index + 4,
      requestedIndexes: [index],
    });
    decoder.openRequested(index, pts);
    decoder.bindOrigin({ sourceSampleRequested: index, requestedPtsUs: pts });
    for (let i = 0; i <= index + 4; i++) decoder.submitEncoded(movie.samples[i]!);
    decoder.armFinalFlush([index]);
    await decoder.flushTail();
    expect(FlushLeavesQueueDecoder.last?.flushCount ?? 0).toBeGreaterThanOrEqual(2);
    expect(decoder.snapshot().decoderRecreateCount).toBe(0);
    expect(decoder.snapshot().recoveryAttempts).toBe(0);
    const frame = decoder.takeReady(index);
    expect(frame).not.toBeNull();
    frame?.close();
    decoder.close();
  }, 10_000);

  it("P. AFE-12/13/14 water marks unchanged; packetParity n/a when recreates=0", () => {
    expect(decodeQueueHighWater(10, 4, { afterRecreate: false })).toBe(40);
    expect(decodeQueueHighWater(10, 4, { afterRecreate: true })).toBe(20);
    expect(decodeQueueLowWater(10, 4, { afterRecreate: true })).toBe(6);
    const text = formatStallMessage({
      decoderRecreateCount: 0,
      packetParity: null,
      configParity: null,
      decodeQueueHighWater: 40,
      decodeQueueLowWater: 6,
    });
    expect(text).toContain("packetParity n/a");
    expect(text).toContain("configParity n/a");
    expect(text).toContain("recreates 0");
    expect(text).toContain("decodeQueueHighWater 40");
  });
});
