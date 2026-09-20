import { describe, expect, it } from "vitest";
import { invokeTool, listTools } from "../../src/app/ai/tools/registry";
import type { MixPcm } from "../../src/core/visualz/feature-extractor";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { addVolumeAutomationPoint } from "../../src/core/volume-automation";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function fakePcm(n = 48_000): MixPcm {
  const data = new Float32Array(n);
  for (let i = 0; i < n; i += 1) data[i] = Math.sin((i / 48_000) * 440 * Math.PI * 2) * 0.25;
  return {
    sampleRate: 48_000,
    length: n,
    numberOfChannels: 1,
    getChannelData: () => data,
  };
}

function sessionWithClip(): Session {
  const a = asset({
    id: "asset_aa",
    kind: "audio",
    durationMs: 4000,
    sourcePath: "/secret/path.wav",
    objectUrl: "blob:v5-test:9",
  });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs: 30_000,
    durationMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), playheadMs: 31_000 },
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
    targetTrackId: "A1",
    selectedTrackIds: ["A1"],
  };
}

describe("AI-5 read-only tool registry", () => {
  it("lists the read tools", () => {
    const names = listTools().map((t) => t.name);
    expect(names).toEqual([
      "project.describe",
      "timeline.describe",
      "timeline.get_selection",
      "timeline.get_clip",
      "audio.get_analysis",
      "automation.read",
      "timeline.inspect_range",
    ]);
    expect(listTools().every((t) => t.grant === "READ")).toBe(true);
  });

  it("project.describe returns a compact DTO", () => {
    const session = sessionWithClip();
    const result = invokeTool("project.describe", {}, { session, grant: "READ" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as Record<string, unknown>;
    expect(data.projectId).toBe(session.project.id);
    expect(data.schemaVersion).toBe(5);
    expect(data.clipCount).toBe(1);
    expect(JSON.stringify(data)).not.toMatch(/sourcePath|objectUrl|Session/);
  });

  it("timeline.describe and get_clip / get_selection work", () => {
    const session = sessionWithClip();
    const desc = invokeTool("timeline.describe", { fromMs: 0, toMs: 60_000 }, { session, grant: "READ" });
    expect(desc.ok).toBe(true);
    if (desc.ok) {
      const clips = (desc.data as { clips: { clipId: string }[] }).clips;
      expect(clips[0]?.clipId).toBe("clip_test");
    }
    const clip = invokeTool("timeline.get_clip", { clipId: "clip_test" }, { session, grant: "READ" });
    expect(clip.ok).toBe(true);
    if (clip.ok) expect((clip.data as { startMs: number }).startMs).toBe(30_000);
    const sel = invokeTool("timeline.get_selection", {}, { session, grant: "READ" });
    expect(sel.ok).toBe(true);
    if (sel.ok) expect((sel.data as { clipIds: string[] }).clipIds).toEqual(["clip_test"]);
  });

  it("unknown tool / invalid args / unknown clipId / display name", () => {
    const session = sessionWithClip();
    expect(invokeTool("timeline.explode", {}, { session, grant: "READ" })).toMatchObject({
      code: "UNKNOWN_TOOL",
    });
    expect(invokeTool("timeline.get_clip", { clipId: 1 }, { session, grant: "READ" })).toMatchObject({
      code: "INVALID_ARGS",
    });
    expect(invokeTool("timeline.get_clip", { clipId: "clip_missing" }, { session, grant: "READ" })).toMatchObject({
      code: "UNKNOWN_CLIP",
    });
    expect(invokeTool("timeline.get_clip", { clipId: "Vocals" }, { session, grant: "READ" })).toMatchObject({
      code: "INVALID_ARGS",
    });
  });

  it("audio.get_analysis documents NO_PCM and can summarize offline PCM", () => {
    const session = sessionWithClip();
    const gap = invokeTool("audio.get_analysis", { clipId: "clip_test", timeMs: 31_000 }, { session, grant: "READ" });
    expect(gap.ok).toBe(true);
    if (gap.ok) {
      const data = gap.data as { available: boolean; reason?: string };
      expect(data.available).toBe(false);
      expect(data.reason).toBe("NO_PCM");
      expect(JSON.stringify(data)).not.toMatch(/spectrum|sourcePath/);
    }
    const analyzed = invokeTool(
      "audio.get_analysis",
      { clipId: "clip_test", timeMs: 0 },
      { session, grant: "READ", pcmByClipId: { clip_test: fakePcm() } },
    );
    expect(analyzed.ok).toBe(true);
    if (analyzed.ok) {
      const data = analyzed.data as { available: boolean; rms?: number; spectrum?: unknown };
      expect(data.available).toBe(true);
      expect(typeof data.rms).toBe("number");
      expect(data.spectrum).toBeUndefined();
    }
  });

  it("automation.read returns the G envelope", () => {
    let session = sessionWithClip();
    session = {
      ...session,
      project: addVolumeAutomationPoint(session.project, "A1", 1000, 0.5).project,
    };
    const result = invokeTool("automation.read", { trackId: "A1", timeMs: 1000 }, { session, grant: "READ" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const data = result.data as { enabled: boolean; valueAt: number; points: { timeMs: number }[] };
      expect(data.enabled).toBe(true);
      expect(data.valueAt).toBe(0.5);
      expect(data.points[0]?.timeMs).toBe(1000);
    }
    expect(invokeTool("automation.read", { trackId: "VIS" }, { session, grant: "READ" })).toMatchObject({
      code: "INVALID_ARGS",
    });
  });

  it("tools do not mutate Project, push history, or change schema", () => {
    const session = sessionWithClip();
    const before = session.project;
    const beforeHistory = session.history.past.length;
    invokeTool("project.describe", {}, { session, grant: "READ" });
    invokeTool("timeline.describe", {}, { session, grant: "READ" });
    invokeTool("timeline.get_selection", {}, { session, grant: "READ" });
    invokeTool("timeline.get_clip", { clipId: "clip_test" }, { session, grant: "READ" });
    invokeTool("audio.get_analysis", { clipId: "clip_test" }, { session, grant: "READ" });
    invokeTool("automation.read", { trackId: "A1" }, { session, grant: "READ" });
    invokeTool("timeline.inspect_range", { fromMs: 0, toMs: 60_000 }, { session, grant: "READ" });
    expect(session.project).toBe(before);
    expect(session.history.past.length).toBe(beforeHistory);
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(session.project)).schemaVersion).toBe(5);
    const moved = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 2000 });
    expect(moved.history.past.length).toBe(1);
    expect(session.history.past.length).toBe(0);
  });
});
