import { describe, expect, it } from "vitest";
import { createSession, type Session } from "../../src/app/session";
import { planMutation } from "../../src/app/ai/tools/mutate";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function sessionAt(startMs: number, opts?: { locked?: boolean; snap?: boolean; selected?: string[] }): Session {
  const selected = opts?.selected ?? ["c1"];
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: selected[0] ?? null,
    selectedClipIds: selected,
    project: {
      ...projectWith(
        [
          clip({
            id: "c1",
            assetId: "a",
            trackId: "A1",
            startMs,
            durationMs: 8000,
            locked: opts?.locked,
            linkId: "link_1",
          }),
          clip({
            id: "c2",
            assetId: "v",
            trackId: "V1",
            startMs,
            durationMs: 8000,
            linkId: "link_1",
          }),
        ],
        [
          asset({ id: "a", kind: "audio", durationMs: 60000 }),
          asset({ id: "v", kind: "video", durationMs: 60000 }),
        ],
      ),
      snap: opts?.snap ?? true,
      markers: [{ id: "mk_near", timeMs: startMs + 1000, label: "near" }],
      playheadMs: startMs + 4000,
    },
  };
}

describe("AI-3 mutation proposals", () => {
  it("plans an exact +2000 ms move while snap is on and does not touch the session", () => {
    const session = sessionAt(30000);
    const before = structuredClone(session.project);
    const past = session.history.past.length;
    for (let i = 0; i < 12; i += 1) {
      const planned = planMutation(session, "timeline.move_clip", { deltaSeconds: 2 });
      expect(planned.ok).toBe(true);
      if (!planned.ok) return;
      expect(planned.data.command).toEqual({ type: "moveClips", clipIds: ["c1"], deltaMs: 2000 });
      expect(planned.data.command).not.toMatchObject({ type: "nudgeClip" });
      expect(planned.data.summary).toContain("not used");
      expect(planned.data.summary).toContain("c2");
    }
    expect(session.project).toEqual(before);
    expect(session.history.past).toHaveLength(past);
    expect(session.project.clips.find((c) => c.id === "c1")?.startMs).toBe(30000);
    expect(session.project.schemaVersion).toBe(5);
  });

  it("accepts an explicit target in seconds and rejects a guessed multi-select", () => {
    const session = sessionAt(30000);
    const targeted = planMutation(session, "timeline.move_clip", { targetStartSeconds: 32 });
    expect(targeted.ok).toBe(true);
    if (!targeted.ok) return;
    expect(targeted.data.command).toEqual({ type: "moveClips", clipIds: ["c1"], deltaMs: 2000 });

    const many = sessionAt(30000, { selected: ["c1", "c2"] });
    expect(planMutation(many, "timeline.move_clip", { deltaMs: 2000 })).toMatchObject({
      ok: false,
      code: "AMBIGUOUS_SELECTION",
    });
    expect(planMutation(sessionAt(30000, { selected: [] }), "timeline.move_clip", { deltaMs: 2000 })).toMatchObject({
      ok: false,
      code: "NO_SELECTION",
    });
  });

  it("reuses core errors for a locked clip and a missing id", () => {
    expect(planMutation(sessionAt(30000, { locked: true }), "timeline.move_clip", { deltaMs: 2000 })).toEqual({
      ok: false,
      code: "CLIP_LOCKED",
      error: "Clip is locked",
    });
    expect(planMutation(sessionAt(30000), "timeline.move_clip", { clipId: "clip_missing", deltaMs: 2000 })).toEqual({
      ok: false,
      code: "CLIP_NOT_FOUND",
      error: "Clip not found",
    });
    expect(planMutation(sessionAt(100), "timeline.move_clip", { deltaMs: -500 })).toMatchObject({
      ok: false,
      code: "NEGATIVE_START",
    });
    expect(planMutation(sessionAt(30000), "timeline.move_clip", { deltaMs: 1.5 })).toMatchObject({
      ok: false,
      code: "SCHEMA_INVALID",
    });
  });

  it("plans split and lift-delete as proposals, and describes nudge snap", () => {
    const session = sessionAt(30000);
    const before = session.history.past.length;
    const split = planMutation(session, "timeline.split_at_playhead");
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(split.data.command).toEqual({ type: "split" });

    const lift = planMutation(session, "timeline.lift_delete");
    expect(lift.ok).toBe(true);
    if (!lift.ok) return;
    expect(lift.data.command).toEqual({ type: "liftDelete" });

    const nudge = planMutation(
      {
        ...session,
        project: {
          ...session.project,
          markers: [{ id: "mk_snap", timeMs: 500, label: "snap" }],
          clips: session.project.clips.map((c) => ({ ...c, startMs: 0, linkId: undefined })),
        },
      },
      "timeline.nudge",
      { deltaMs: 450 },
    );
    expect(nudge.ok).toBe(true);
    if (!nudge.ok) return;
    expect(nudge.data.command).toEqual({ type: "nudgeClip", deltaMs: 450 });
    expect(nudge.data.summary).toContain("snap");
    expect(nudge.data.summary).toContain("500");
    expect(session.history.past).toHaveLength(before);
    expect(planMutation(session, "get_markers")).toMatchObject({ ok: false, code: "UNKNOWN_TOOL" });
  });
});
