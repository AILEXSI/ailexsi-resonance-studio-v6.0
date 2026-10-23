import { describe, expect, it, vi } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { runDirectorTurn } from "../../src/app/ai/loop";
import { acceptTransaction } from "../../src/app/ai/transactions";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function marked(opts?: { markers?: { id: string; timeMs: number; label: string }[]; selected?: string[]; locked?: boolean }): Session {
  const base = createSession(createMemoryBlobStore());
  const selected = opts?.selected ?? ["c1"];
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
            startMs: 0,
            durationMs: 10000,
            locked: opts?.locked,
          }),
        ],
        [asset({ id: "a", kind: "audio", durationMs: 10000, name: "secret.wav", sourcePath: "/tmp/secret.wav" })],
      ),
      snap: true,
      markers: opts?.markers ?? [
        { id: "mk_a", timeMs: 2000, label: "verse" },
        { id: "mk_b", timeMs: 6000, label: "chorus" },
        { id: "mk_out", timeMs: 50000, label: "outside" },
      ],
    },
  };
}

describe("AI-6 marker splits", () => {
  it("cuts only at project markers and undoes every cut in one step", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const session = marked();
    const turn = await runDirectorTurn({
      session,
      prompt: "Schneide den Song an den Beats und füge Transitions ein",
    });
    expect(turn.transaction?.tool).toBe("timeline.split_at_markers");
    expect(turn.transaction?.status).toBe("proposed");
    expect(turn.text).toMatch(/Audio was not analyzed/);
    expect(turn.text).toMatch(/No transition was proposed/);
    expect(turn.text).toContain("50000");
    expect(turn.text).not.toMatch(/\b120\b/);
    expect(turn.text).not.toContain("secret.wav");
    expect(session.history.past).toHaveLength(0);
    expect(session.project.clips).toHaveLength(1);
    if (!turn.transaction) throw new Error("expected proposal");

    const accepted = acceptTransaction(session, turn.transaction);
    expect(accepted.error).toBeUndefined();
    expect(accepted.transaction.statuses).toEqual(["proposed", "accepted", "executed"]);
    expect(accepted.session.history.past).toHaveLength(1);
    expect(accepted.session.project.clips).toHaveLength(3);
    expect(accepted.session.project.transitions).toHaveLength(0);
    expect(accepted.session.project.schemaVersion).toBe(5);
    expect(accepted.session.project.clips.map((item) => item.startMs).sort((a, b) => a - b)).toEqual([0, 2000, 6000]);
    expect(fetchSpy).not.toHaveBeenCalled();

    const undone = applyCommand(accepted.session, { type: "undo" });
    expect(undone.history.past).toHaveLength(0);
    expect(undone.project.clips).toHaveLength(1);
    expect(undone.project.clips[0]).toMatchObject({ id: "c1", startMs: 0, durationMs: 10000 });
    expect(undone.project.playheadMs).toBe(0);
    vi.unstubAllGlobals();
  });

  it("fails closed with no markers, several selected clips, or a locked clip", async () => {
    const empty = marked({ markers: [] });
    const noData = await runDirectorTurn({ session: empty, prompt: "cut the song on the beats" });
    expect(noData.transaction).toBeNull();
    expect(noData.text).toMatch(/No beat or marker data/);
    expect(noData.text).toMatch(/not analyzed audio/i);
    expect(empty.history.past).toHaveLength(0);

    const many = marked({ selected: ["c1", "c2"] });
    const ambiguous = await runDirectorTurn({ session: many, prompt: "cut on the beats" });
    expect(ambiguous.transaction).toBeNull();
    expect(ambiguous.text).toMatch(/exactly one clip/i);
    expect(many.history.past).toHaveLength(0);

    const locked = marked({ locked: true });
    const refused = await runDirectorTurn({ session: locked, prompt: "cut on the beats" });
    expect(refused.transaction).toBeNull();
    expect(refused.text).toMatch(/Clip is locked/);
    expect(locked.history.past).toHaveLength(0);
  });
});
