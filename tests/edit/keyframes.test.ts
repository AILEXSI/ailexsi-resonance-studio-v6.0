import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession } from "../../src/app/session";
import { keyFactorAt, visOpacityAt } from "../../src/core/clip-keys";
import { gainAtClipTime, videoAlphaAtClipTime } from "../../src/core/fades";
import { jobFromProject } from "../../src/core/exporter/job";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { EDIT_MENU_ITEMS } from "../../src/ui/toolbar/EditMenu";
import { asset, clip, projectWith } from "../helpers";

function session() {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "a1",
    selectedClipIds: ["a1"],
    project: {
      ...projectWith(
        [
          clip({ id: "a1", assetId: "aud", trackId: "A1", startMs: 0, durationMs: 1000, sourceOutMs: 1000 }),
          clip({ id: "v1", assetId: "vid", trackId: "V1", startMs: 0, durationMs: 1000, sourceOutMs: 1000 }),
        ],
        [
          asset({ id: "aud", kind: "audio", durationMs: 60000 }),
          asset({ id: "vid", kind: "video", durationMs: 60000 }),
        ],
      ),
      playheadMs: 500,
    },
  };
}

describe("clip and VIS keyframes", () => {
  it("loads a schema 5 project that has no key lanes", () => {
    const start = session();
    const raw = JSON.parse(serializeProject(start.project)) as {
      schemaVersion: number;
      clips: Array<Record<string, unknown>>;
    };
    expect(raw.schemaVersion).toBe(5);
    for (const item of raw.clips) {
      delete item.gainKeys;
      delete item.opacityKeys;
    }
    const loaded = deserializeProject(JSON.stringify(raw));
    const audio = loaded.clips.find((c) => c.id === "a1")!;
    expect(loaded.schemaVersion).toBe(5);
    expect(audio.gainKeys).toBeUndefined();
    expect(audio.opacityKeys).toBeUndefined();
    expect(gainAtClipTime(audio, 500)).toBe(1);
    expect(videoAlphaAtClipTime(loaded.clips.find((c) => c.id === "v1")!, 500)).toBe(1);
  });

  it("interpolates volume and opacity linearly and keeps them apart", () => {
    const lane = {
      enabled: true,
      points: [
        { timeMs: 0, value: 0 },
        { timeMs: 1000, value: 1 },
      ],
    };
    const audio = clip({ id: "a1", assetId: "aud", trackId: "A1", durationMs: 1000, gainKeys: lane });
    const video = clip({ id: "v1", assetId: "vid", trackId: "V1", durationMs: 1000, opacityKeys: lane });
    expect(gainAtClipTime(audio, 500)).toBeCloseTo(0.5);
    expect(gainAtClipTime(video, 500)).toBe(1);
    expect(videoAlphaAtClipTime(video, 500)).toBeCloseTo(0.5);
    expect(videoAlphaAtClipTime(audio, 500)).toBe(1);
    expect(keyFactorAt(undefined, 500)).toBe(1);
    expect(
      visOpacityAt(
        { id: "e", sceneId: "resonance-wave", startMs: 0, durationMs: 1000, opacityKeys: lane },
        250,
      ),
    ).toBeCloseTo(0.25);
  });

  it("adds a playhead keyframe in one undo and exports it", () => {
    const start = session();
    const next = applyCommand(start, { type: "addKeyframe" });
    expect(next.history.past).toHaveLength(1);
    const audio = next.project.clips.find((c) => c.id === "a1")!;
    expect(audio.gainKeys?.points).toEqual([{ timeMs: 500, value: 1 }]);
    expect(next.project.clips.find((c) => c.id === "v1")?.opacityKeys).toBeUndefined();
    const job = jobFromProject(next.project);
    const exported = job.tracks.flatMap((track) => track.clips).find((c) => c.id === "a1");
    expect(exported?.gainKeys?.points).toEqual([{ timeMs: 500, value: 1 }]);
    const undone = applyCommand(next, { type: "undo" });
    expect(undone.project.clips.find((c) => c.id === "a1")?.gainKeys).toBeUndefined();
  });

  it("routes V and lists Add keyframe in the Edit menu", () => {
    const start = session();
    const out = dispatchEditorKey(start, false, { key: "v" });
    expect(out.type).toBe("session");
    if (out.type !== "session") return;
    expect(out.session.project.clips.find((c) => c.id === "a1")?.gainKeys?.enabled).toBe(true);
    expect(EDIT_MENU_ITEMS.some((item) => item.command.type === "addKeyframe")).toBe(true);
  });
});
