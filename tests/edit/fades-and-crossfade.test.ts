import { describe, expect, it } from "vitest";
import { acceptTransaction, proposeTransaction } from "../../src/app/ai/transactions";
import { planMutation } from "../../src/app/ai/tools/mutate";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession } from "../../src/app/session";
import { gainAtClipTime, videoAlphaAtClipTime } from "../../src/core/fades";
import { jobFromProject } from "../../src/core/exporter/job";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import {
  compositeVideoAt,
  contextFromExportClips,
  contextFromProject,
  equalPowerCrossfade,
  transitionAudioGain,
} from "../../src/core/transition";
import { EDIT_MENU_ITEMS } from "../../src/ui/toolbar/EditMenu";
import { asset, clip, projectWith } from "../helpers";

function session() {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "v1",
    selectedClipIds: ["v1", "a1"],
    project: {
      ...projectWith(
        [
          clip({ id: "v1", assetId: "vid", trackId: "V1", startMs: 0, durationMs: 4000, sourceOutMs: 4000 }),
          clip({ id: "v2", assetId: "vid", trackId: "V1", startMs: 4000, durationMs: 2000, sourceOutMs: 2000 }),
          clip({ id: "a1", assetId: "aud", trackId: "A1", startMs: 0, durationMs: 4000, sourceOutMs: 4000 }),
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

describe("fades and same-track crossfade", () => {
  it("fades the selection in one undo and feeds audio gain and video alpha", () => {
    const start = session();
    const next = applyCommand(start, { type: "setSelectionFades", fadeInMs: 500 });
    expect(next.history.past).toHaveLength(1);
    expect(next.project.schemaVersion).toBe(5);
    const video = next.project.clips.find((c) => c.id === "v1")!;
    const audio = next.project.clips.find((c) => c.id === "a1")!;
    expect(video.fadeInMs).toBe(500);
    expect(video.fadeOutMs).toBe(0);
    expect(audio.fadeInMs).toBe(500);
    expect(gainAtClipTime(audio, 0)).toBe(0);
    expect(gainAtClipTime(audio, 500)).toBe(1);
    expect(videoAlphaAtClipTime(video, 0)).toBe(0);
    expect(videoAlphaAtClipTime(video, 500)).toBe(1);
    const undone = applyCommand(next, { type: "undo" });
    expect(undone.project.clips.find((c) => c.id === "v1")?.fadeInMs).toBe(0);
  });

  it("overlaps touching clips and mixes both pictures and both audio sides", () => {
    const start = { ...session(), selectedClipId: "v1", selectedClipIds: ["v1"] };
    const next = applyCommand(start, { type: "addCrossfade", durationMs: 500 });
    expect(next.error).toBeFalsy();
    expect(next.history.past).toHaveLength(1);
    expect(next.project.schemaVersion).toBe(5);
    expect(next.project.clips.find((c) => c.id === "v1")?.startMs).toBe(0);
    expect(next.project.clips.find((c) => c.id === "v2")?.startMs).toBe(3500);
    const transition = next.project.transitions?.find((t) => t.type === "crossfade");
    expect(transition?.durationMs).toBe(500);
    expect(transition?.audio).toBe("crossfade");
    const mid = 3750;
    const layers = compositeVideoAt(contextFromProject(next.project), mid).layers;
    expect(layers.map((layer) => layer.clipId)).toEqual(["v1", "v2"]);
    expect(layers[0]?.alpha).toBeCloseTo(0.5);
    expect(layers[1]?.alpha).toBeCloseTo(0.5);
    const power = equalPowerCrossfade(0.5);
    expect(transitionAudioGain(next.project.transitions ?? [], "v1", mid, next.project)).toBeCloseTo(power.a);
    expect(transitionAudioGain(next.project.transitions ?? [], "v2", mid, next.project)).toBeCloseTo(power.b);

    const job = jobFromProject(next.project);
    const ctx = contextFromExportClips(
      job.tracks.filter((t) => t.kind === "video").flatMap((t) => t.clips),
      job.transitions ?? [],
      "V2",
    );
    const exported = compositeVideoAt(ctx, mid);
    expect(exported.layers.map((layer) => layer.alpha)).toEqual([0.5, 0.5]);
  });

  it("routes F and T and lists the actions in the Edit menu", () => {
    const start = session();
    const faded = dispatchEditorKey(start, false, { key: "f" });
    expect(faded.type).toBe("session");
    if (faded.type !== "session") return;
    expect(faded.session.project.clips.find((c) => c.id === "v1")?.fadeInMs).toBe(500);
    const crossed = dispatchEditorKey(
      { ...start, selectedClipIds: ["v1"], selectedClipId: "v1" },
      false,
      { key: "t" },
    );
    expect(crossed.type).toBe("session");
    if (crossed.type !== "session") return;
    expect(crossed.session.project.clips.find((c) => c.id === "v2")?.startMs).toBe(3500);
    const types = EDIT_MENU_ITEMS.map((item) => item.command.type);
    expect(types).toEqual(expect.arrayContaining(["setSelectionFades", "addCrossfade"]));
  });

  it("proposes a fade and applies it as one undo", () => {
    const start = session();
    const before = structuredClone(start.project);
    const planned = planMutation(start, "timeline.add_fade", { fadeOutMs: 250 });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(start.project).toEqual(before);
    const txn = proposeTransaction(start, planned.data, "fade");
    const accepted = acceptTransaction(start, txn);
    expect(accepted.error).toBeUndefined();
    expect(accepted.session.history.past).toHaveLength(1);
    expect(accepted.session.project.clips.find((c) => c.id === "v1")?.fadeOutMs).toBe(250);
    expect(accepted.session.project.clips.find((c) => c.id === "v1")?.fadeInMs).toBe(0);
    expect(accepted.session.project.clips.find((c) => c.id === "a1")?.fadeOutMs).toBe(250);
  });

  it("loads a schema 5 project that has no transition list", () => {
    const start = session();
    const raw = JSON.parse(serializeProject(start.project)) as { transitions?: unknown; schemaVersion: number };
    expect(raw.schemaVersion).toBe(5);
    delete raw.transitions;
    const loaded = deserializeProject(JSON.stringify(raw));
    expect(loaded.schemaVersion).toBe(5);
    expect(loaded.clips.find((c) => c.id === "v2")?.startMs).toBe(4000);
    expect(loaded.transitions ?? []).toEqual([]);
  });
});
