import { describe, expect, it } from "vitest";
import { dispatchEditorKey } from "../../src/app/keys";
import { applyCopy, createSession, type Session } from "../../src/app/session";
import { FRAME_MS } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function clipSession(): Session {
  const a = asset({ id: "a", kind: "audio", durationMs: 2000 });
  const c = clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 2000 });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), playheadMs: 1000, inPointMs: 200, outPointMs: 1800 },
    selectedClipId: "c1",
  };
}

function sessionOf(action: ReturnType<typeof dispatchEditorKey>): Session {
  expect(action.type).toBe("session");
  if (action.type !== "session") throw new Error("expected session action");
  return action.session;
}

describe("editor keys", () => {
  it("S splits at the playhead", () => {
    const next = sessionOf(dispatchEditorKey(clipSession(), false, { key: "s" }));
    expect(next.project.clips).toHaveLength(2);
    expect(next.status).toBe("Split at playhead");
  });

  it("bare V adds a keyframe and does not split", () => {
    const start = clipSession();
    const next = sessionOf(dispatchEditorKey(start, false, { key: "v" }));
    expect(next.project.clips).toHaveLength(1);
    expect(next.project.clips[0]?.gainKeys?.points).toEqual([{ timeMs: 1000, value: 1 }]);
    expect(next.history.past).toHaveLength(1);
  });

  it("Ctrl+V pastes and does not split", () => {
    let s = applyCopy(clipSession());
    s = { ...s, project: { ...s.project, playheadMs: 2000 } };
    const next = sessionOf(dispatchEditorKey(s, false, { key: "v", ctrlKey: true }));
    expect(next.project.clips).toHaveLength(2);
    expect(next.status).toBe("Pasted clip");
    const original = next.project.clips.find((c) => c.id === "c1");
    expect(original?.durationMs).toBe(2000);
    expect(original?.startMs).toBe(0);
  });

  it("Ctrl+D duplicates at the playhead; C/X/V stay bound", () => {
    const start = clipSession();
    const copied = applyCopy(start);
    const duped = sessionOf(dispatchEditorKey(copied, false, { key: "d", ctrlKey: true }));
    expect(duped.project.clips).toHaveLength(2);
    expect(duped.clipboard[0]?.id).toBe("c1");
    expect(duped.project.clips.find((c) => c.id !== "c1")!.startMs).toBe(1000);
    const stillCopy = sessionOf(dispatchEditorKey(start, false, { key: "c", ctrlKey: true }));
    expect(stillCopy.clipboard[0]?.id).toBe("c1");
    expect(stillCopy.project.clips).toHaveLength(1);
    const stillCut = sessionOf(dispatchEditorKey(start, false, { key: "x", ctrlKey: true }));
    expect(stillCut.project.clips).toHaveLength(0);
    expect(stillCut.clipboard[0]?.id).toBe("c1");
    const stillPaste = sessionOf(dispatchEditorKey(copied, false, { key: "v", ctrlKey: true }));
    expect(stillPaste.status).toBe("Pasted clip");
    expect(stillPaste.project.clips).toHaveLength(2);
    const metaD = sessionOf(dispatchEditorKey(start, false, { key: "d", metaKey: true }));
    expect(metaD.project.clips).toHaveLength(2);
  });

  it("Ctrl+C copies and leaves the clip", () => {
    const start = clipSession();
    const next = sessionOf(dispatchEditorKey(start, false, { key: "c", ctrlKey: true }));
    expect(next.project.clips).toHaveLength(1);
    expect(next.clipboard[0]?.id).toBe("c1");
    expect(next.project.clips[0]!.id).toBe("c1");
    expect(next.status).toBe("Copied clip");
  });

  it("Ctrl+X cuts: clipboard filled and clip removed", () => {
    const next = sessionOf(dispatchEditorKey(clipSession(), false, { key: "x", ctrlKey: true }));
    expect(next.project.clips).toHaveLength(0);
    expect(next.clipboard[0]?.id).toBe("c1");
    expect(next.selectedClipId).toBeNull();
    expect(next.status).toBe("Cut clip");
  });

  it("bare X still clears IN/OUT", () => {
    const next = sessionOf(dispatchEditorKey(clipSession(), false, { key: "x" }));
    expect(next.project.clips).toHaveLength(1);
    expect(next.project.inPointMs).toBeNull();
    expect(next.project.outPointMs).toBeNull();
    expect(next.status).toBe("IN/OUT cleared");
  });

  it("Shift+Delete ripple-deletes; Delete still lifts", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 2000 });
    const s: Session = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith(
        [
          clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 0, durationMs: 1000 }),
          clip({ id: "c2", assetId: "a", trackId: "A1", startMs: 1000, durationMs: 500 }),
        ],
        [a],
      ),
      selectedClipId: "c1",
    };
    const lifted = sessionOf(dispatchEditorKey(s, false, { key: "Delete" }));
    expect(lifted.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    expect(lifted.project.clips.find((c) => c.id === "c1")).toBeUndefined();

    const rippled = sessionOf(dispatchEditorKey(s, false, { key: "Delete", shiftKey: true }));
    expect(rippled.project.clips.find((c) => c.id === "c2")!.startMs).toBe(0);
    expect(rippled.status).toBe("Ripple deleted");

    const backspace = sessionOf(dispatchEditorKey(s, false, { key: "Backspace", shiftKey: true }));
    expect(backspace.project.clips.find((c) => c.id === "c2")!.startMs).toBe(0);
  });

  it("J K L shuttle; Space is 1x play/pause", () => {
    let s = clipSession();
    s = sessionOf(dispatchEditorKey(s, false, { key: "l" }));
    expect(s.shuttleRate).toBe(1);
    s = sessionOf(dispatchEditorKey(s, true, { key: "l" }));
    expect(s.shuttleRate).toBe(2);
    s = sessionOf(dispatchEditorKey(s, true, { key: "l" }));
    expect(s.shuttleRate).toBe(4);
    s = sessionOf(dispatchEditorKey(s, true, { key: "k" }));
    expect(s.shuttleRate).toBe(0);
    expect(s.playing).toBe(false);
    s = sessionOf(dispatchEditorKey(s, false, { key: "j" }));
    expect(s.shuttleRate).toBe(-1);
    s = sessionOf(dispatchEditorKey(s, true, { key: "j" }));
    expect(s.shuttleRate).toBe(-2);
    s = sessionOf(dispatchEditorKey(s, true, { key: " " }));
    expect(s.shuttleRate).toBe(0);
    expect(s.playing).toBe(false);
    s = sessionOf(dispatchEditorKey(s, false, { key: " " }));
    expect(s.shuttleRate).toBe(1);
    expect(s.playing).toBe(true);
  });

  it("comma / period nudge 1 frame; Shift is 10 frames; arrows still move the playhead", () => {
    const start = clipSession();
    const right = sessionOf(dispatchEditorKey(start, false, { key: "." }));
    expect(right.project.clips[0]!.startMs).toBeCloseTo(FRAME_MS, 5);
    const left = sessionOf(dispatchEditorKey(right, false, { key: "," }));
    expect(left.project.clips[0]!.startMs).toBe(0);
    const ten = sessionOf(dispatchEditorKey(start, false, { key: ".", shiftKey: true }));
    expect(ten.project.clips[0]!.startMs).toBeCloseTo(10 * FRAME_MS, 5);
    const playhead = sessionOf(dispatchEditorKey(start, false, { key: "ArrowRight" }));
    expect(playhead.project.playheadMs).toBe(start.project.playheadMs + FRAME_MS);
    expect(playhead.project.clips[0]!.startMs).toBe(0);
  });

  it("Alt+, / Alt+. slip source ±1 frame and do not nudge start", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const c = clip({
      id: "c1",
      assetId: "a",
      trackId: "A1",
      startMs: 1000,
      durationMs: 2000,
      sourceInMs: 0,
      sourceOutMs: 2000,
    });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith([c], [a]),
      selectedClipId: "c1",
      selectedClipIds: ["c1"],
    };
    const right = sessionOf(dispatchEditorKey(start, false, { key: ".", altKey: true }));
    expect(right.project.clips[0]!.startMs).toBe(1000);
    expect(right.project.clips[0]!.durationMs).toBe(2000);
    expect(right.project.clips[0]!.sourceInMs).toBeCloseTo(FRAME_MS, 5);
    const left = sessionOf(dispatchEditorKey(right, false, { key: ",", altKey: true }));
    expect(left.project.clips[0]!.sourceInMs).toBe(0);
    expect(left.project.clips[0]!.startMs).toBe(1000);
  });

  it("Alt+, / Alt+. slips a contiguous selected block; gapped no-ops; Shift+Alt still slides", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "L",
              assetId: "a",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "A",
              assetId: "a",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 50,
              sourceOutMs: 1050,
            }),
            clip({
              id: "B",
              assetId: "a",
              trackId: "A1",
              startMs: 2000,
              durationMs: 1000,
              sourceInMs: 80,
              sourceOutMs: 1080,
            }),
            clip({
              id: "R",
              assetId: "a",
              trackId: "A1",
              startMs: 3000,
              durationMs: 1000,
              sourceInMs: 400,
              sourceOutMs: 1400,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "A",
      selectedClipIds: ["A", "B"],
    };
    const slipped = sessionOf(dispatchEditorKey(start, false, { key: ".", altKey: true }));
    expect(slipped.project.clips.find((c) => c.id === "A")!.sourceInMs).toBeCloseTo(50 + FRAME_MS, 5);
    expect(slipped.project.clips.find((c) => c.id === "B")!.sourceInMs).toBeCloseTo(80 + FRAME_MS, 5);
    expect(slipped.project.clips.find((c) => c.id === "A")!.startMs).toBe(1000);
    expect(slipped.project.clips.find((c) => c.id === "B")!.startMs).toBe(2000);
    expect(slipped.project.clips.find((c) => c.id === "L")!.durationMs).toBe(1000);
    expect(slipped.project.clips.find((c) => c.id === "R")!.startMs).toBe(3000);

    const gapped: Session = { ...start, selectedClipIds: ["A", "R"], selectedClipId: "A" };
    const blocked = dispatchEditorKey(gapped, false, { key: ".", altKey: true });
    expect(blocked.type).toBe("session");
    if (blocked.type === "session") {
      expect(blocked.session.project.clips.find((c) => c.id === "A")!.sourceInMs).toBe(50);
      expect(blocked.session.project.clips.find((c) => c.id === "R")!.sourceInMs).toBe(400);
      expect(blocked.session.error).toMatch(/contiguous|gap/i);
    }

    const slid = sessionOf(
      dispatchEditorKey(start, false, { key: ".", altKey: true, shiftKey: true }),
    );
    expect(slid.project.clips.find((c) => c.id === "A")!.startMs).toBeCloseTo(1000 + FRAME_MS, 5);
    expect(slid.project.clips.find((c) => c.id === "B")!.startMs).toBeCloseTo(2000 + FRAME_MS, 5);
    expect(slid.project.clips.find((c) => c.id === "A")!.sourceInMs).toBe(50);
  });

  it("Shift+Alt+, / Shift+Alt+. slide ±1 frame and do not slip source", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "L",
              assetId: "a",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "M",
              assetId: "a",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 200,
              sourceOutMs: 1200,
            }),
            clip({
              id: "R",
              assetId: "a",
              trackId: "A1",
              startMs: 2000,
              durationMs: 1000,
              sourceInMs: 400,
              sourceOutMs: 1400,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "M",
      selectedClipIds: ["M"],
    };
    const right = sessionOf(
      dispatchEditorKey(start, false, { key: ".", altKey: true, shiftKey: true }),
    );
    expect(right.project.clips.find((c) => c.id === "M")!.startMs).toBeCloseTo(1000 + FRAME_MS, 5);
    expect(right.project.clips.find((c) => c.id === "M")!.sourceInMs).toBe(200);
    expect(right.project.clips.find((c) => c.id === "L")!.durationMs).toBeCloseTo(1000 + FRAME_MS, 5);
    const back = sessionOf(
      dispatchEditorKey(right, false, { key: ",", altKey: true, shiftKey: true }),
    );
    expect(back.project.clips.find((c) => c.id === "M")!.startMs).toBeCloseTo(1000, 5);
    expect(back.project.clips.find((c) => c.id === "M")!.sourceInMs).toBe(200);
  });

  it("Shift+Alt+, / . slides a valid selected block; gap falls back to single", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 8000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "L",
              assetId: "a",
              trackId: "A1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "A",
              assetId: "a",
              trackId: "A1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 50,
              sourceOutMs: 1050,
            }),
            clip({
              id: "B",
              assetId: "a",
              trackId: "A1",
              startMs: 2000,
              durationMs: 1000,
              sourceInMs: 80,
              sourceOutMs: 1080,
            }),
            clip({
              id: "R",
              assetId: "a",
              trackId: "A1",
              startMs: 3000,
              durationMs: 1000,
              sourceInMs: 400,
              sourceOutMs: 1400,
            }),
          ],
          [a],
        ),
        snap: false,
      },
      selectedClipId: "A",
      selectedClipIds: ["A", "B"],
    };
    const right = sessionOf(
      dispatchEditorKey(start, false, { key: ".", altKey: true, shiftKey: true }),
    );
    expect(right.project.clips.find((c) => c.id === "A")!.startMs).toBeCloseTo(1000 + FRAME_MS, 5);
    expect(right.project.clips.find((c) => c.id === "B")!.startMs).toBeCloseTo(2000 + FRAME_MS, 5);
    expect(right.project.clips.find((c) => c.id === "B")!.durationMs).toBe(1000);
    expect(right.project.clips.find((c) => c.id === "A")!.sourceInMs).toBe(50);
    expect(right.project.clips.find((c) => c.id === "B")!.sourceInMs).toBe(80);
    expect(right.project.clips.find((c) => c.id === "R")!.startMs).toBeCloseTo(3000 + FRAME_MS, 5);

    const gapped: Session = {
      ...start,
      selectedClipIds: ["A", "R"],
      selectedClipId: "A",
    };
    const fallback = sessionOf(
      dispatchEditorKey(gapped, false, { key: ".", altKey: true, shiftKey: true }),
    );
    expect(fallback.project.clips.find((c) => c.id === "A")!.startMs).toBeCloseTo(1000 + FRAME_MS, 5);
    expect(fallback.project.clips.find((c) => c.id === "B")!.durationMs).toBeCloseTo(1000 - FRAME_MS, 5);
    expect(fallback.project.clips.find((c) => c.id === "R")!.startMs).toBe(3000);
    expect(fallback.project.clips.find((c) => c.id === "R")!.durationMs).toBe(1000);
  });

  it("; lifts range and ' extracts; empty Delete uses the range", () => {
    const a = asset({ id: "a", kind: "audio", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "a",
              trackId: "A1",
              startMs: 0,
              durationMs: 3000,
              sourceInMs: 0,
              sourceOutMs: 3000,
            }),
          ],
          [a],
        ),
        inPointMs: 1000,
        outPointMs: 2000,
      },
      selectedClipId: null,
      selectedClipIds: [],
    };
    const lifted = sessionOf(dispatchEditorKey(start, false, { key: ";" }));
    expect(lifted.project.clips).toHaveLength(2);
    expect(lifted.project.clips.sort((x, y) => x.startMs - y.startMs)[1]!.startMs).toBe(2000);
    expect(lifted.status).toBe("Lifted range");

    const extracted = sessionOf(dispatchEditorKey(start, false, { key: "'" }));
    expect(extracted.project.clips.sort((x, y) => x.startMs - y.startMs)[1]!.startMs).toBe(1000);
    expect(extracted.status).toBe("Extracted range");

    const del = sessionOf(dispatchEditorKey(start, false, { key: "Delete" }));
    expect(del.status).toBe("Lifted range");
    const shiftDel = sessionOf(dispatchEditorKey(start, false, { key: "Delete", shiftKey: true }));
    expect(shiftDel.status).toBe("Extracted range");
  });

  it("Ctrl+Shift+L unlinks a living pair; Ctrl+L links video and audio; bare L shuttles", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 2000, hasAudio: true });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: projectWith(
        [
          clip({
            id: "v1",
            assetId: "va",
            trackId: "V1",
            startMs: 0,
            durationMs: 2000,
            sourceInMs: 0,
            sourceOutMs: 2000,
            linkId: "lnk1",
          }),
          clip({
            id: "a1",
            assetId: "va",
            trackId: "A1",
            startMs: 0,
            durationMs: 2000,
            sourceInMs: 0,
            sourceOutMs: 2000,
            linkId: "lnk1",
          }),
        ],
        [va],
      ),
      selectedClipId: "v1",
      selectedClipIds: ["v1"],
    };
    const unlinked = sessionOf(
      dispatchEditorKey(start, false, { key: "L", ctrlKey: true, shiftKey: true }),
    );
    expect(unlinked.status).toBe("Unlinked clips");
    expect(unlinked.project.clips.every((c) => !c.linkId)).toBe(true);

    const viaMeta = sessionOf(
      dispatchEditorKey(start, false, { key: "l", metaKey: true, shiftKey: true }),
    );
    expect(viaMeta.status).toBe("Unlinked clips");
    expect(viaMeta.project.clips.every((c) => !c.linkId)).toBe(true);

    const onlyVideo = sessionOf(dispatchEditorKey(start, false, { key: "l", ctrlKey: true }));
    expect(onlyVideo.error).toBe("Select one video clip and one audio clip");
    expect(onlyVideo.history.past).toHaveLength(0);
    expect(onlyVideo.project.clips.every((c) => c.linkId === "lnk1")).toBe(true);

    const unlinkedPair: Session = {
      ...start,
      selectedClipIds: ["v1", "a1"],
      project: {
        ...start.project,
        clips: start.project.clips.map((c) => ({ ...c, linkId: undefined })),
      },
    };
    const linked = sessionOf(dispatchEditorKey(unlinkedPair, false, { key: "l", ctrlKey: true }));
    expect(linked.status).toBe("Linked clips");
    expect(linked.history.past).toHaveLength(1);
    expect(linked.project.clips[0]?.linkId).toBeTruthy();
    expect(linked.project.clips[0]?.linkId).toBe(linked.project.clips[1]?.linkId);

    const shuttle = sessionOf(dispatchEditorKey(start, false, { key: "l" }));
    expect(shuttle.shuttleRate).toBe(1);
    expect(shuttle.project.clips.every((c) => c.linkId === "lnk1")).toBe(true);

    const noMate = dispatchEditorKey(unlinked, false, {
      key: "l",
      ctrlKey: true,
      shiftKey: true,
    });
    expect(noMate.type).toBe("none");
  });

  it("Ctrl/Cmd+S saves and does not split; Ctrl+M/I/O stay unused", () => {
    const start = clipSession();
    const save = dispatchEditorKey(start, false, { key: "s", ctrlKey: true });
    expect(save).toEqual({ type: "save", preventDefault: true });
    expect(start.project.clips).toHaveLength(1);
    expect(dispatchEditorKey(start, false, { key: "s", metaKey: true })).toEqual({
      type: "save",
      preventDefault: true,
    });
    expect(dispatchEditorKey(start, false, { key: "s", ctrlKey: true, formFocus: true })).toEqual({
      type: "save",
      preventDefault: true,
    });
    expect(dispatchEditorKey(start, false, { key: "s", ctrlKey: true, shiftKey: true })).toEqual({
      type: "saveAs",
      preventDefault: true,
    });
    expect(dispatchEditorKey(start, false, { key: "s", metaKey: true, shiftKey: true })).toEqual({
      type: "saveAs",
      preventDefault: true,
    });
    expect(start.project.clips).toHaveLength(1);
    for (const key of ["m", "i", "o"] as const) {
      expect(dispatchEditorKey(start, false, { key, ctrlKey: true }).type).toBe("none");
    }
    const cut = dispatchEditorKey(start, false, { key: "x", ctrlKey: true });
    expect(cut.type).toBe("session");
    if (cut.type === "session") expect(cut.session.status).toBe("Cut clip");
  });

  it("? toggles the existing shortcuts sheet and does not split", () => {
    const start = clipSession();
    expect(dispatchEditorKey(start, false, { key: "?" })).toEqual({
      type: "toggleShortcuts",
      preventDefault: true,
    });
    expect(start.project.clips).toHaveLength(1);
    expect(dispatchEditorKey(start, false, { key: "?", formFocus: true }).type).toBe("none");
  });

  it("Tab cycles screens; Shift+Tab reverses; form focus does not cycle", () => {
    const start = clipSession();
    const tab = dispatchEditorKey(start, false, { key: "Tab" });
    expect(tab).toEqual({ type: "cycleScreen", dir: 1, preventDefault: true });
    const shiftTab = dispatchEditorKey(start, false, { key: "Tab", shiftKey: true });
    expect(shiftTab).toEqual({ type: "cycleScreen", dir: -1, preventDefault: true });
    const inField = dispatchEditorKey(start, false, { key: "Tab", formFocus: true });
    expect(inField.type).toBe("none");
    const space = dispatchEditorKey(start, false, { key: " " });
    expect(space.type).toBe("session");
    if (space.type === "session") expect(space.session.playing).toBe(true);
    expect(dispatchEditorKey(start, false, { key: " ", formFocus: true }).type).toBe("session");
    expect(dispatchEditorKey(start, false, { key: " ", formFocus: true, textEditFocus: true }).type).toBe("none");
    expect(dispatchEditorKey(start, false, { key: "s", formFocus: true }).type).toBe("none");
  });

  it("ArrowDown / ArrowUp jump next/prev edit; inspector form focus does not", () => {
    const start = clipSession();
    expect(start.project.playheadMs).toBe(1000);
    const down = dispatchEditorKey(start, false, { key: "ArrowDown" });
    expect(down.type).toBe("session");
    if (down.type === "session") {
      expect(down.preventDefault).toBe(true);
      expect(down.session.project.playheadMs).toBe(1800);
    }
    const up = dispatchEditorKey(start, false, { key: "ArrowUp" });
    expect(up.type).toBe("session");
    if (up.type === "session") {
      expect(up.preventDefault).toBe(true);
      expect(up.session.project.playheadMs).toBe(200);
    }
    expect(dispatchEditorKey(start, false, { key: "ArrowDown", formFocus: true }).type).toBe("none");
    expect(dispatchEditorKey(start, false, { key: "ArrowUp", formFocus: true }).type).toBe("none");
    const stepped = sessionOf(dispatchEditorKey(start, false, { key: "ArrowRight" }));
    expect(stepped.project.playheadMs).toBe(start.project.playheadMs + FRAME_MS);
  });

  it("G closes the gap under the playhead; form focus does not", () => {
    const a = asset({ id: "va", kind: "video", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "v1a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({ id: "v1b", assetId: "va", trackId: "V1", startMs: 2000, durationMs: 1000 }),
          ],
          [a],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "v1a",
      selectedClipIds: ["v1a"],
    };
    const closed = sessionOf(dispatchEditorKey(start, false, { key: "g" }));
    expect(closed.project.clips.find((c) => c.id === "v1b")!.startMs).toBe(1000);
    expect(closed.project.playheadMs).toBe(1500);
    const inField = dispatchEditorKey(start, false, { key: "g", formFocus: true });
    expect(inField.type).toBe("none");
    expect(start.project.clips.find((c) => c.id === "v1b")!.startMs).toBe(2000);
  });

  it("Q / Alt+W ripple-trim to playhead; bare W does not trim; form focus does not; G/S/Tab stay bound", () => {
    const va = asset({ id: "va", kind: "video", durationMs: 4000 });
    const start: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({
              id: "c1",
              assetId: "va",
              trackId: "V1",
              startMs: 0,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
            clip({
              id: "c2",
              assetId: "va",
              trackId: "V1",
              startMs: 1000,
              durationMs: 1000,
              sourceInMs: 0,
              sourceOutMs: 1000,
            }),
          ],
          [va],
        ),
        snap: false,
        playheadMs: 200,
      },
      selectedClipId: "c1",
      selectedClipIds: ["c1"],
    };
    const q = sessionOf(dispatchEditorKey(start, false, { key: "q" }));
    expect(q.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(800);
    expect(q.project.clips.find((c) => c.id === "c1")!.sourceInMs).toBe(200);
    expect(q.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
    const wAtPlayhead = { ...start, project: { ...start.project, playheadMs: 800 } };
    const bareW = dispatchEditorKey(wAtPlayhead, false, { key: "w" });
    expect(bareW.type).toBe("none");
    expect(wAtPlayhead.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(1000);
    expect(wAtPlayhead.project.clips.find((c) => c.id === "c2")!.startMs).toBe(1000);
    const w = sessionOf(dispatchEditorKey(wAtPlayhead, false, { key: "w", altKey: true }));
    expect(w.project.clips.find((c) => c.id === "c1")!.durationMs).toBe(800);
    expect(w.project.clips.find((c) => c.id === "c1")!.sourceOutMs).toBe(800);
    expect(w.project.clips.find((c) => c.id === "c2")!.startMs).toBe(800);
    expect(dispatchEditorKey(start, false, { key: "q", formFocus: true }).type).toBe("none");
    expect(dispatchEditorKey(start, false, { key: "w", formFocus: true }).type).toBe("none");
    expect(dispatchEditorKey(start, false, { key: "w", altKey: true, formFocus: true }).type).toBe("none");
    expect(dispatchEditorKey(clipSession(), false, { key: "s" }).type).toBe("session");
    expect(dispatchEditorKey(clipSession(), false, { key: "Tab" })).toEqual({
      type: "cycleScreen",
      dir: 1,
      preventDefault: true,
    });
    const gapStart: Session = {
      ...createSession(createMemoryBlobStore()),
      project: {
        ...projectWith(
          [
            clip({ id: "v1a", assetId: "va", trackId: "V1", startMs: 0, durationMs: 1000 }),
            clip({ id: "v1b", assetId: "va", trackId: "V1", startMs: 2000, durationMs: 1000 }),
          ],
          [va],
        ),
        playheadMs: 1500,
      },
      selectedClipId: "v1a",
      selectedClipIds: ["v1a"],
    };
    const g = sessionOf(dispatchEditorKey(gapStart, false, { key: "g" }));
    expect(g.project.clips.find((c) => c.id === "v1b")!.startMs).toBe(1000);
  });

  it("bare W arms volume write on the selected audio track and never trims", () => {
    const start = clipSession();
    expect(start.project.clips[0]!.durationMs).toBe(2000);
    const armed = dispatchEditorKey(start, false, { key: "w" });
    expect(armed.type).toBe("session");
    if (armed.type !== "session") throw new Error("expected session action");
    expect(armed.preventDefault).toBe(true);
    expect(armed.session.volumeWriteArmedIds).toEqual(["A1"]);
    expect(armed.session.status).toBe("Write armed");
    expect(armed.session.project.clips).toHaveLength(1);
    expect(armed.session.project.clips[0]!.durationMs).toBe(2000);
    expect(armed.session.project.clips[0]!.startMs).toBe(0);

    const off = sessionOf(dispatchEditorKey(armed.session, false, { key: "w" }));
    expect(off.volumeWriteArmedIds).toEqual([]);
    expect(off.status).toBe("Write off");
    expect(off.project.clips[0]!.durationMs).toBe(2000);

    const videoOnly: Session = {
      ...start,
      selectedClipId: null,
      selectedClipIds: [],
      targetTrackId: "V1",
      selectedTrackIds: ["V1"],
    };
    expect(dispatchEditorKey(videoOnly, false, { key: "w" }).type).toBe("none");
    expect(videoOnly.project.clips[0]!.durationMs).toBe(2000);

    const lane: Session = {
      ...createSession(createMemoryBlobStore()),
      targetTrackId: "A1",
      selectedTrackIds: ["A1"],
      selectedClipId: null,
      selectedClipIds: [],
    };
    const laneArmed = sessionOf(dispatchEditorKey(lane, false, { key: "w" }));
    expect(laneArmed.volumeWriteArmedIds).toEqual(["A1"]);
    expect(laneArmed.status).toBe("Write armed");

    const shiftW = dispatchEditorKey(start, false, { key: "w", shiftKey: true });
    expect(shiftW.type).toBe("none");
    expect(start.project.clips[0]!.durationMs).toBe(2000);

    expect(dispatchEditorKey(start, false, { key: "w", ctrlKey: true }).type).toBe("none");

    const trimmed = sessionOf(dispatchEditorKey(start, false, { key: "w", altKey: true }));
    expect(trimmed.project.clips[0]!.durationMs).toBe(1000);
    expect(trimmed.volumeWriteArmedIds ?? []).not.toContain("A1");

    expect(dispatchEditorKey(start, false, { key: "s" }).type).toBe("session");
    const cut = sessionOf(dispatchEditorKey(start, false, { key: "x", ctrlKey: true }));
    expect(cut.project.clips).toHaveLength(0);
    expect(cut.clipboard[0]?.id).toBe("c1");
  });
});
