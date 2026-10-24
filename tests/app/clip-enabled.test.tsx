import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { dispatchEditorKey } from "../../src/app/keys";
import { createSession, selectionOf, type Session } from "../../src/app/session";
import { jobFromProject } from "../../src/core/exporter/job";
import { mixClipsAt, topVideoClipAt, type TrackId } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { deserializeProject, serializeProject } from "../../src/core/project";
import { compositeVideoAt, contextFromProject, resolvePictureSource } from "../../src/core/transition";
import { Inspector } from "../../src/ui/inspector/Inspector";
import { Timeline } from "../../src/ui/timeline/Timeline";
import { asset, clip, projectWith } from "../helpers";

function stackedSession(): Session {
  return {
    ...createSession(createMemoryBlobStore()),
    project: projectWith(
      [
        clip({ id: "v1", assetId: "va", trackId: "V1", startMs: 0, durationMs: 2000 }),
        clip({ id: "v2", assetId: "vb", trackId: "V2", startMs: 0, durationMs: 2000 }),
        clip({ id: "a1", assetId: "aa", trackId: "A1", startMs: 0, durationMs: 2000 }),
      ],
      [
        asset({ id: "va", kind: "video", durationMs: 4000, objectUrl: "blob:v1", missing: false }),
        asset({ id: "vb", kind: "video", durationMs: 4000, objectUrl: "blob:v2", missing: false }),
        asset({ id: "aa", kind: "audio", durationMs: 4000, objectUrl: "blob:a1", missing: false }),
      ],
    ),
    selectedClipId: "v1",
    selectedClipIds: ["v1"],
  };
}

describe("clip enable / disable (P45)", () => {
  it("disabled V1 is skipped by picture and export; V2 covers", () => {
    const start = stackedSession();
    start.project.frontVideoTrackId = "V1";
    expect(resolvePictureSource(contextFromProject(start.project), 500)).toMatchObject({
      kind: "V1",
      clipId: "v1",
    });
    const next = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    expect(next.project.clips.find((c) => c.id === "v1")?.enabled).toBe(false);
    expect(topVideoClipAt(next.project, 500)?.id).toBe("v2");
    expect(resolvePictureSource(contextFromProject(next.project), 500)).toMatchObject({
      kind: "V2",
      clipId: "v2",
    });
    expect(compositeVideoAt(contextFromProject(next.project), 500).layers).toEqual([
      { clipId: "v2", alpha: 1 },
    ]);
    const job = jobFromProject(next.project);
    expect(job.tracks.find((t) => t.id === "V1")?.clips.map((c) => c.id)).toEqual([]);
    expect(job.tracks.find((t) => t.id === "V2")?.clips.map((c) => c.id)).toEqual(["v2"]);
  });

  it("disabled A1 is skipped by mix; re-enable restores mix and picture", () => {
    const start = stackedSession();
    const silent = applyCommand(
      { ...start, selectedClipId: "a1", selectedClipIds: ["a1"] },
      { type: "setClipsEnabled", enabled: false },
    );
    expect(mixClipsAt(silent.project, 500).map((c) => c.id).sort()).toEqual(["v1", "v2"]);
    const restored = applyCommand(silent, { type: "setClipsEnabled", enabled: true });
    expect(restored.project.clips.find((c) => c.id === "a1")?.enabled).not.toBe(false);
    expect(mixClipsAt(restored.project, 500).map((c) => c.id).sort()).toEqual(["a1", "v1", "v2"]);

    const videoOff = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    start.project.frontVideoTrackId = "V1";
    videoOff.project.frontVideoTrackId = "V1";
    expect(topVideoClipAt(start.project, 500)?.id).toBe("v1");
    expect(topVideoClipAt(videoOff.project, 500)?.id).toBe("v2");
    const videoOn = applyCommand(videoOff, { type: "setClipsEnabled", enabled: true });
    expect(topVideoClipAt(videoOn.project, 500)?.id).toBe("v1");
    expect(mixClipsAt(start.project, 500).map((c) => c.id).sort()).toEqual(["a1", "v1", "v2"]);
  });

  it("persist/reload keeps enabled: false; missing field stays enabled", () => {
    const start = stackedSession();
    const next = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    const loaded = deserializeProject(serializeProject(next.project));
    expect(loaded.clips.find((c) => c.id === "v1")?.enabled).toBe(false);
    expect(loaded.clips.find((c) => c.id === "v2")?.enabled).toBeUndefined();
    expect(topVideoClipAt(loaded, 500)?.id).toBe("v2");
    expect(
      JSON.parse(serializeProject(next.project)).clips.find((c: { id: string }) => c.id === "v2")
        .enabled,
    ).toBeUndefined();
  });

  it("empty selection is a no-op; disable pushes history and undo restores", () => {
    const empty = { ...stackedSession(), selectedClipId: null, selectedClipIds: [] };
    expect(applyCommand(empty, { type: "setClipsEnabled", enabled: false })).toBe(empty);
    const start = stackedSession();
    const past = start.history.past.length;
    const disabled = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    expect(disabled.history.past.length).toBe(past + 1);
    expect(disabled.status).toBe("Clip disabled");
    const undone = applyCommand(disabled, { type: "undo" });
    expect(undone.project.clips.find((c) => c.id === "v1")?.enabled).not.toBe(false);
    expect(topVideoClipAt({ ...undone.project, frontVideoTrackId: "V1" }, 500)?.id).toBe("v1");
    const same = applyCommand(disabled, { type: "setClipsEnabled", enabled: false });
    expect(same).toBe(disabled);
  });

  it("S with a multi-select still skips a disabled clip under the playhead (P144)", () => {
    const start = stackedSession();
    start.project.playheadMs = 500;
    start.project.frontVideoTrackId = "V1";
    const disabled = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    const multi = {
      ...disabled,
      selectedClipId: "v1",
      selectedClipIds: ["v1", "v2"],
    };
    const split = applyCommand(multi, { type: "split" });
    expect(split.error).toBeNull();
    expect(split.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(split.project.clips.find((c) => c.id === "v1")!.enabled).toBe(false);
    expect(split.project.clips.filter((c) => c.assetId === "vb")).toHaveLength(2);
    expect(split.project.clips.filter((c) => c.assetId === "aa")).toHaveLength(1);
  });

  it("S on a disabled selected clip does not cut other tracks (P102)", () => {
    const start = stackedSession();
    start.project.playheadMs = 500;
    start.project.frontVideoTrackId = "V1";
    const disabled = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    expect(topVideoClipAt(disabled.project, 500)?.id).toBe("v2");
    const split = applyCommand(disabled, { type: "split" });
    expect(split.project.clips.filter((c) => c.assetId === "va").map((c) => c.id)).toEqual(["v1"]);
    expect(split.project.clips.find((c) => c.id === "v1")?.enabled).toBe(false);
    expect(split.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(split.project.clips.filter((c) => c.assetId === "vb")).toHaveLength(1);
    expect(split.project.clips.filter((c) => c.assetId === "aa")).toHaveLength(1);
    expect(split.status).toBe("Split rejected");
  });

  it("S on the covering enabled track still skips a disabled clip on another lane (P102)", () => {
    const start = stackedSession();
    start.project.playheadMs = 500;
    start.project.frontVideoTrackId = "V1";
    const disabled = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    const onV2 = {
      ...disabled,
      selectedClipId: "v2",
      selectedClipIds: ["v2"],
      targetTrackId: "V2" as const,
      selectedTrackIds: ["V2" as const],
    };
    const split = applyCommand(onV2, { type: "split" });
    expect(split.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    expect(split.project.clips.filter((c) => c.assetId === "vb")).toHaveLength(2);
    expect(split.project.clips.filter((c) => c.assetId === "aa")).toHaveLength(1);
    const halves = split.project.clips.filter((c) => c.assetId === "vb").sort((a, b) => a.startMs - b.startMs);
    expect(halves[0]!.durationMs).toBe(500);
    expect(halves[1]!.startMs).toBe(500);
  });

  it("Q/W ripple-trim the covering enabled clip, not a selected disabled clip (P105)", () => {
    const start = stackedSession();
    start.project.playheadMs = 500;
    start.project.frontVideoTrackId = "V1";
    const disabled = applyCommand(start, { type: "setClipsEnabled", enabled: false });
    expect(disabled.selectedClipId).toBe("v1");
    expect(topVideoClipAt(disabled.project, 500)?.id).toBe("v2");
    const q = applyCommand(disabled, { type: "rippleTrimToPlayhead", edge: "in" });
    expect(q.project.clips.find((c) => c.id === "v1")!.startMs).toBe(0);
    expect(q.project.clips.find((c) => c.id === "v1")!.durationMs).toBe(2000);
    const v2 = q.project.clips.find((c) => c.id === "v2")!;
    expect(v2.startMs).toBe(0);
    expect(v2.durationMs).toBe(1500);
    expect(v2.sourceInMs).toBe(500);
    expect(q.selectedClipId).toBe("v2");
  });

  it("does not steal a key for enable/disable", () => {
    const start = stackedSession();
    for (const key of ["e", "d"]) {
      expect(dispatchEditorKey(start, false, { key }).type).not.toBe("session");
    }
    expect(selectionOf(start)).toEqual(["v1"]);
  });
});

describe("clip enable UI", () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    host?.remove();
    host = undefined;
    root = undefined;
  });

  it("Inspector checkbox and multi-select Enable/Disable", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const project = stackedSession().project;
    const enabled: boolean[] = [];
    act(() => {
      root!.render(
        <Inspector
          project={project}
          selectedClipId="v1"
          selectedClipIds={["v1"]}
          onChange={() => {}}
          onSetEnabled={(next) => enabled.push(next)}
        />,
      );
    });
    const box = host.querySelector('[data-testid="inspector-clip-enabled"]') as HTMLInputElement;
    expect(box).toBeTruthy();
    expect(box.checked).toBe(true);
    act(() => {
      box.click();
    });
    expect(enabled).toEqual([false]);

    act(() => {
      root!.render(
        <Inspector
          project={project}
          selectedClipId="v1"
          selectedClipIds={["v1", "v2"]}
          onChange={() => {}}
          onSetEnabled={(next) => enabled.push(next)}
        />,
      );
    });
    expect(host.querySelector('[data-testid="inspector-clip-enabled"]')).toBeNull();
    act(() => {
      (host!.querySelector('[data-testid="inspector-disable-clips"]') as HTMLButtonElement).click();
    });
    expect(enabled).toEqual([false, false]);
  });

  it("clip menu Disable/Enable and dim class", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    const project = stackedSession().project;
    const noop = () => {};
    let last: boolean | undefined;
    act(() => {
      root!.render(
        <Timeline
          project={project}
          selectedClipId="v1"
          onSelect={() => {}}
          onPlayhead={noop}
          onMoveLive={noop}
          onMoveCommit={noop}
          onTrimLive={noop}
          onTrimCommit={noop}
          onToggleMute={(_id: TrackId) => {}}
          onToggleVisualizerMute={noop}
          onCycleVisualizerScene={noop}
          onSplitHere={noop}
          onCut={noop}
          onCopy={noop}
          onPaste={noop}
          onDelete={noop}
          onZoom={noop}
          onFit={noop}
          onScroll={noop}
          onLoopClick={noop}
          onLoopInLive={noop}
          onLoopOutLive={noop}
          onLoopMoveLive={noop}
          onLoopCommit={noop}
          onSetClipsEnabled={(value) => {
            last = value;
          }}
        />,
      );
    });
    const clipEl = host.querySelector('[data-testid="clip-v1"]');
    expect(clipEl?.className).not.toContain("disabled");
    act(() => {
      clipEl!.dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
      );
    });
    const disable = host.querySelector('[data-testid="clip-menu-toggle-enabled"]');
    expect(disable?.textContent).toContain("Disable");
    act(() => {
      (disable as HTMLButtonElement).click();
    });
    expect(last).toBe(false);

    const off = {
      ...project,
      clips: project.clips.map((c) => (c.id === "v1" ? { ...c, enabled: false } : c)),
    };
    act(() => {
      root!.render(
        <Timeline
          project={off}
          selectedClipId="v1"
          onSelect={() => {}}
          onPlayhead={noop}
          onMoveLive={noop}
          onMoveCommit={noop}
          onTrimLive={noop}
          onTrimCommit={noop}
          onToggleMute={(_id: TrackId) => {}}
          onToggleVisualizerMute={noop}
          onCycleVisualizerScene={noop}
          onSplitHere={noop}
          onCut={noop}
          onCopy={noop}
          onPaste={noop}
          onDelete={noop}
          onZoom={noop}
          onFit={noop}
          onScroll={noop}
          onLoopClick={noop}
          onLoopInLive={noop}
          onLoopOutLive={noop}
          onLoopMoveLive={noop}
          onLoopCommit={noop}
          onSetClipsEnabled={(value) => {
            last = value;
          }}
        />,
      );
    });
    expect(host.querySelector('[data-testid="clip-v1"]')?.className).toContain("disabled");
    expect(host.querySelector('[data-testid="clip-v1"]')?.getAttribute("data-enabled")).toBe("false");
  });
});
