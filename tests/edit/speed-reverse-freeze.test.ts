import { describe, expect, it } from "vitest";
import { acceptTransaction, proposeTransaction } from "../../src/app/ai/transactions";
import { planMutation } from "../../src/app/ai/tools/mutate";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession } from "../../src/app/session";
import { sourceTimeSec } from "../../src/core/exporter/frame-source";
import { jobFromProject } from "../../src/core/exporter/job";
import type { ExportClip } from "../../src/core/exporter/types";
import { sourceTimeAt } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { EDIT_MENU_ITEMS } from "../../src/ui/toolbar/EditMenu";
import { asset, clip, projectWith } from "../helpers";

function session() {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "v1",
    selectedClipIds: ["v1"],
    project: {
      ...projectWith(
        [
          clip({
            id: "v1",
            assetId: "vid",
            trackId: "V1",
            startMs: 0,
            durationMs: 4000,
            sourceInMs: 0,
            sourceOutMs: 4000,
            linkId: "pair",
          }),
          clip({
            id: "a1",
            assetId: "aud",
            trackId: "A1",
            startMs: 0,
            durationMs: 4000,
            sourceInMs: 0,
            sourceOutMs: 4000,
            linkId: "pair",
          }),
        ],
        [
          asset({ id: "vid", kind: "video", durationMs: 60000 }),
          asset({ id: "aud", kind: "audio", durationMs: 60000 }),
        ],
      ),
      playheadMs: 1000,
    },
  };
}

describe("speed, reverse, and freeze", () => {
  it("keeps forward mapping when reversed and hold are absent", () => {
    const start = session();
    const raw = JSON.parse(serializeProject(start.project)) as {
      schemaVersion: number;
      clips: Array<Record<string, unknown>>;
    };
    expect(raw.schemaVersion).toBe(5);
    for (const clip of raw.clips) {
      delete clip.reversed;
      delete clip.holdSourceMs;
    }
    const loaded = deserializeProject(JSON.stringify(raw));
    const video = loaded.clips.find((c) => c.id === "v1")!;
    expect(loaded.schemaVersion).toBe(5);
    expect(video.reversed).toBeUndefined();
    expect(video.holdSourceMs).toBeUndefined();
    expect(sourceTimeAt(video, 1000)).toBe(1000);
  });

  it("sets speed in one undo and proposes timeline.set_speed", () => {
    const start = session();
    const next = applyCommand(start, { type: "setSelectionRate", rate: 2 });
    expect(next.history.past).toHaveLength(1);
    expect(next.project.clips.find((c) => c.id === "v1")?.durationMs).toBe(2000);
    expect(next.project.clips.find((c) => c.id === "v1")?.rate).toBe(2);
    expect(next.project.clips.find((c) => c.id === "a1")?.rate).toBe(2);
    const before = structuredClone(start.project);
    const planned = planMutation(start, "timeline.set_speed", { rate: 0.5 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(start.project).toEqual(before);
    const accepted = acceptTransaction(start, proposeTransaction(start, planned.data, "speed"));
    expect(accepted.session.history.past).toHaveLength(1);
    expect(accepted.session.project.clips.find((c) => c.id === "v1")?.rate).toBe(0.5);
  });

  it("plays a reversed clip from the source out point and a freeze from one frame", () => {
    const start = session();
    const reversed = applyCommand(start, { type: "toggleReverse" });
    expect(reversed.history.past).toHaveLength(1);
    const video = reversed.project.clips.find((c) => c.id === "v1")!;
    const audio = reversed.project.clips.find((c) => c.id === "a1")!;
    expect(video.reversed).toBe(true);
    expect(audio.reversed).toBe(true);
    expect(video.durationMs).toBe(4000);
    expect(sourceTimeAt(video, 0)).toBe(4000);
    expect(sourceTimeAt(video, 1000)).toBe(3000);
    const job = jobFromProject(reversed.project);
    const exported = job.tracks.flatMap((t) => t.clips).find((c) => c.id === "v1")!;
    expect(exported.reversed).toBe(true);
    expect(exported.sourceInMs).toBe(4000);
    expect(sourceTimeSec(exported, 0, 30)).toBeCloseTo((4000 - 500 / 30) / 1000, 5);
    expect(sourceTimeSec(exported, 1000, 30)).toBeCloseTo((3000 - 500 / 30) / 1000, 5);
    const held = {
      ...exported,
      holdSourceMs: 1500,
      reversed: undefined,
    } as ExportClip;
    expect(sourceTimeSec(held, 800, 30)).toBeCloseTo(1.5, 5);
  });

  it("inserts a 2s freeze and pauses linked audio so the rest stays in sync", () => {
    const start = session();
    const next = applyCommand(start, { type: "freezeFrame" });
    expect(next.history.past).toHaveLength(1);
    expect(next.project.schemaVersion).toBe(5);
    const leftAudio = next.project.clips.find((c) => c.id === "a1")!;
    expect(leftAudio.startMs).toBe(0);
    expect(leftAudio.durationMs).toBe(1000);
    expect(leftAudio.sourceOutMs).toBe(1000);
    const rightAudio = next.project.clips.find((c) => c.trackId === "A1" && c.id !== "a1")!;
    expect(rightAudio.startMs).toBe(3000);
    expect(rightAudio.durationMs).toBe(3000);
    expect(rightAudio.sourceInMs).toBe(1000);
    const during = next.project.clips.some(
      (c) => c.trackId === "A1" && c.startMs < 2500 && c.startMs + c.durationMs > 1500,
    );
    expect(during).toBe(false);
    const freeze = next.project.clips.find((c) => c.holdSourceMs != null);
    expect(freeze?.trackId).toBe("V1");
    expect(freeze?.startMs).toBe(1000);
    expect(freeze?.durationMs).toBe(2000);
    expect(freeze?.holdSourceMs).toBe(1000);
    expect(freeze?.linkId).toBeUndefined();
    expect(sourceTimeAt(freeze!, 1500)).toBe(1000);
    const leftVideo = next.project.clips.find((c) => c.id === "v1")!;
    const rightVideo = next.project.clips.find(
      (c) => c.trackId === "V1" && c.id !== "v1" && c.holdSourceMs == null,
    )!;
    expect(rightVideo.startMs).toBe(3000);
    expect(leftVideo.linkId).toBe(leftAudio.linkId);
    expect(rightVideo.linkId).toBe(rightAudio.linkId);
    expect(rightVideo.linkId).not.toBe(leftVideo.linkId);
    const undone = applyCommand(next, { type: "undo" });
    expect(undone.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(1);
    expect(undone.project.clips.find((c) => c.id === "a1")?.durationMs).toBe(4000);
  });

  it("does not freeze when the linked audio is locked", () => {
    const start = session();
    start.project = {
      ...start.project,
      clips: start.project.clips.map((c) => (c.id === "a1" ? { ...c, locked: true } : c)),
    };
    const next = applyCommand(start, { type: "freezeFrame" });
    expect(next.history.past).toHaveLength(0);
    expect(next.error).toBe("Clip is locked");
    expect(next.project.clips).toHaveLength(2);
  });

  it("routes R, Shift+R, and Alt+3 and lists them in the Edit menu", () => {
    const start = session();
    const reversed = dispatchEditorKey(start, false, { key: "r" });
    expect(reversed.type).toBe("session");
    if (reversed.type !== "session") return;
    expect(reversed.session.project.clips.find((c) => c.id === "v1")?.reversed).toBe(true);
    const frozen = dispatchEditorKey(start, false, { key: "R", shiftKey: true });
    expect(frozen.type).toBe("session");
    if (frozen.type !== "session") return;
    expect(frozen.session.project.clips.some((c) => c.holdSourceMs != null)).toBe(true);
    const fast = dispatchEditorKey(start, false, { key: "3", code: "Digit3", altKey: true });
    expect(fast.type).toBe("session");
    if (fast.type !== "session") return;
    expect(fast.session.project.clips.find((c) => c.id === "v1")?.rate).toBe(2);
    const types = EDIT_MENU_ITEMS.map((item) => item.command.type);
    expect(types).toEqual(expect.arrayContaining(["setSelectionRate", "toggleReverse", "freezeFrame"]));
  });
});
