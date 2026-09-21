import { describe, expect, it } from "vitest";
import {
  cachePlayheadMs,
  captureContextSnapshot,
  clearPlayheadCache,
  readPlayheadCacheMs,
  snapshotContainsForbidden,
  trackAutomationHint,
} from "../../src/app/ai/context/snapshot";
import { SEND_RAW_MEDIA } from "../../src/app/ai/context/types";
import { applyContextLevel, createDirectorHostState, submitDirectorMockTurn } from "../../src/app/ai/host";
import { applyCommand } from "../../src/app/commands";
import { applyPlayhead, createSession, type Session } from "../../src/app/session";
import { addVolumeAutomationPoint } from "../../src/core/volume-automation";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function sessionWithClip(startMs = 30_000): Session {
  const a = asset({
    id: "asset_aa",
    kind: "audio",
    durationMs: 4000,
    name: "C:\\Users\\me\\vocals.wav",
    sourcePath: "C:\\Users\\me\\vocals.wav",
    objectUrl: "blob:v5-test:1",
  });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs,
    durationMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), playheadMs: 31_000, snap: true },
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
    targetTrackId: "A1",
    selectedTrackIds: ["A1"],
  };
}

describe("AI-4 context snapshots", () => {
  it("captures immutable snapshot with stable ids", () => {
    const session = sessionWithClip();
    const snap = captureContextSnapshot(session, { level: "SELECTION", outboundClass: "SEND_STRUCTURE" });
    expect(snap.projectId).toBe(session.project.id);
    expect(snap.projectId.startsWith("proj_")).toBe(true);
    expect(snap.selection.clipIds).toEqual(["clip_test"]);
    expect(snap.selection.primaryClipId).toBe("clip_test");
    expect(snap.playheadMs).toBe(31_000);
    expect(snap.activeTrack).toBe("A1");
    expect(snap.structure?.[0]?.clipId).toBe("clip_test");
    expect(snap.structure?.[0]?.startMs).toBe(30_000);
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.selection)).toBe(true);
    expect(() => {
      (snap as { playheadMs: number }).playheadMs = 0;
    }).toThrow();
  });

  it("omits sourcePath, objectUrl, and raw media", () => {
    const session = sessionWithClip();
    const snap = captureContextSnapshot(session, {
      level: "SELECTION",
      outboundClass: "SEND_MEDIA_METADATA",
    });
    expect(snapshotContainsForbidden(snap)).toBe(false);
    expect(JSON.stringify(snap)).not.toMatch(/sourcePath|objectUrl|C:\\\\Users/);
    expect(snap.mediaMetadata?.[0]?.filename).toBe("vocals.wav");
    expect(snap.mediaMetadata?.[0]?.assetId).toBe("asset_aa");
  });

  it("SEND_RAW_MEDIA is forbidden", () => {
    const session = sessionWithClip();
    expect(() =>
      captureContextSnapshot(session, { outboundClass: SEND_RAW_MEDIA }),
    ).toThrow(/SEND_RAW_MEDIA/);
  });

  it("playhead cache is local only and does not change Project", () => {
    clearPlayheadCache();
    const session = sessionWithClip();
    const before = session.project;
    cachePlayheadMs(12_345);
    expect(readPlayheadCacheMs()).toBe(12_345);
    expect(session.project).toBe(before);
    expect(session.project.playheadMs).toBe(31_000);
    const snap = captureContextSnapshot(session, { level: "PLAYHEAD", outboundClass: "SEND_STRUCTURE" });
    expect(snap.playheadMs).toBe(31_000);
    expect(snap.analysisHint?.clipId).toBe("clip_test");
  });

  it("capture on submit leaves Project unchanged and schema 5", () => {
    const session = sessionWithClip();
    const beforeClips = structuredClone(session.project.clips);
    const host = applyContextLevel(createDirectorHostState(), "SELECTION");
    const next = submitDirectorMockTurn(host, "inspect selection", session);
    expect(next.lastSnapshot?.selection.clipIds).toEqual(["clip_test"]);
    expect(next.lastSnapshot?.projectId).toBe(session.project.id);
    expect(session.project.clips).toEqual(beforeClips);
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(session.project)).schemaVersion).toBe(5);
    expect(serializeProject(session.project)).not.toMatch(/lastSnapshot|SEND_/);
    const moved = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 2000 });
    expect(moved.project.clips[0]?.startMs).toBe(32_000);
    expect(session.project.clips[0]?.startMs).toBe(30_000);
  });

  it("NONE / SEND_NONE does not leak clip structure", () => {
    const session = sessionWithClip();
    const snap = captureContextSnapshot(session, { level: "NONE", outboundClass: "SEND_NONE" });
    expect(snap.selection.clipIds).toEqual([]);
    expect(snap.structure).toBeUndefined();
    expect(snap.mediaMetadata).toBeUndefined();
  });

  it("reuses volumeAutomationOf without copying raw points into the snapshot", () => {
    let session = sessionWithClip();
    session = {
      ...session,
      project: addVolumeAutomationPoint(session.project, "A1", 1000, 0.5).project,
    };
    const hint = trackAutomationHint(session, "A1");
    expect(hint.enabled).toBe(true);
    expect(hint.pointCount).toBeGreaterThan(0);
    const snap = captureContextSnapshot(session, { level: "TRACK", outboundClass: "SEND_IDS" });
    expect(JSON.stringify(snap)).not.toMatch(/"value":0\.5/);
    expect(snap.selection.trackIds).toContain("A1");
  });

  it("playhead seek on session does not by itself call a provider", () => {
    const session = sessionWithClip();
    let fetchCalls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls += 1;
      return original(input, init);
    }) as typeof fetch;
    try {
      const next = applyPlayhead(session, 40_000);
      cachePlayheadMs(next.project.playheadMs);
      expect(next.project.playheadMs).toBe(40_000);
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });
});
