import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import {
  GOLDEN_MOVE_PROMPT,
  applyMoveClip,
  commitMoveClip,
  draftMoveClip,
  parseGoldenMovePrompt,
  resolveMoveClipCommand,
} from "../../src/app/ai/tools/move-clip";
import { rejectTransaction } from "../../src/app/ai/transactions/transaction";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { createDirectorHostState, submitDirectorProviderTurn } from "../../src/app/ai/host";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function fixture(startMs = 30_000, locked = false): Session {
  const a = asset({ id: "asset_aa", kind: "audio", durationMs: 8000 });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs,
    durationMs: 2000,
    locked,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true },
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
  };
}

const edit = { grant: "EDIT" as const, mode: "AGENT" as const, approval: true };

function startOf(session: Session): number {
  return session.project.clips[0]!.startMs;
}

describe("AI-7 timeline.move_clip", () => {
  it("parses the golden German prompt as +2000 ms", () => {
    expect(parseGoldenMovePrompt(GOLDEN_MOVE_PROMPT)).toEqual({ deltaMs: 2000 });
    expect(parseGoldenMovePrompt("move it a bit")).toBeNull();
  });

  it("golden fixture 12/12: reset each run, snap true, exact +2000", () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const session = fixture(30_000);
      expect(session.project.snap).toBe(true);
      const applied = commitMoveClip({ session, args: { deltaMs: 2000 }, ...edit });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      const before = 30_000;
      const after = startOf(applied.session);
      expect(after - before).toBe(2000);
      expect(applied.session.project.clips[0]!.id).toBe("clip_test");
      results.push(after);
    }
    expect(results).toEqual(Array.from({ length: 12 }, () => 32_000));
  });

  it("chained X→X+2000…→X+24000 is 12/12", () => {
    let session = fixture(30_000);
    const starts = [startOf(session)];
    for (let i = 0; i < 12; i += 1) {
      const applied = commitMoveClip({ session, args: { deltaMs: 2000 }, ...edit });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      session = applied.session;
      starts.push(startOf(session));
    }
    expect(starts[starts.length - 1]).toBe(30_000 + 24_000);
    for (let i = 1; i < starts.length; i += 1) {
      expect(starts[i]! - starts[i - 1]!).toBe(2000);
    }
  });

  it("undo/redo restore exact starts", () => {
    const session = fixture(30_000);
    const applied = commitMoveClip({ session, args: { deltaMs: 2000 }, ...edit });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.session.history.past.length).toBe(1);
    const undone = applyCommand(applied.session, { type: "undo" });
    expect(startOf(undone)).toBe(30_000);
    const redone = applyCommand(undone, { type: "redo" });
    expect(startOf(redone)).toBe(32_000);
  });

  it("reject leaves history and startMs unchanged", () => {
    const session = fixture(30_000);
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const rejected = rejectTransaction(drafted.transaction);
    expect(rejected.status).toBe("rejected");
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("stale revision / invalid id / locked / NaN / Infinity fail closed", () => {
    const session = fixture(30_000);
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 50 });
    const stale = applyMoveClip({
      session: human,
      result: drafted,
      grant: "EDIT",
      mode: "AGENT",
      approval: true,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("TRANSACTION_CONFLICT");

    expect(resolveMoveClipCommand(session, { clipId: "clip_missing", deltaMs: 2000 })).toMatchObject({
      error: "Clip not found",
    });
    expect(resolveMoveClipCommand(session, { clipId: "Vocals", deltaMs: 2000 })).toMatchObject({
      error: "Display names are not ids",
    });
    expect(resolveMoveClipCommand(fixture(30_000, true), { deltaMs: 2000 })).toMatchObject({
      error: "Clip is locked",
    });
    expect(resolveMoveClipCommand(session, { deltaMs: Number.NaN })).toMatchObject({ error: "INVALID_DELTA" });
    expect(resolveMoveClipCommand(session, { deltaMs: Number.POSITIVE_INFINITY })).toMatchObject({
      error: "INVALID_DELTA",
    });
    expect(commitMoveClip({ session, args: { deltaMs: 2000 }, grant: "READ", mode: "ASK", approval: true }).ok).toBe(
      false,
    );
    expect(commitMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT", approval: false }).ok).toBe(
      false,
    );
  });

  it("provider failure after a draft does not apply", async () => {
    const session = fixture(30_000);
    const host = {
      ...createDirectorHostState(),
      grant: "EDIT" as const,
      mode: "AGENT" as const,
    };
    const next = await submitDirectorProviderTurn(
      host,
      GOLDEN_MOVE_PROMPT,
      {
        provider: createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
        orchestrator: createOrchestrator(),
      },
      undefined,
      session,
    );
    expect(next.status).toBe("error");
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("uses moveClips deltaMs (not applyMove/nudge) and keeps schema 5", () => {
    const session = fixture(30_000);
    const resolved = resolveMoveClipCommand(session, { deltaMs: 2000 });
    expect("deltaMs" in resolved && resolved.deltaMs === 2000).toBe(true);
    const applied = commitMoveClip({
      session,
      args: { targetStartSeconds: 32 },
      ...edit,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(startOf(applied.session)).toBe(32_000);
    expect(applied.session.project.schemaVersion).toBe(5);
    expect(JSON.parse(serializeProject(applied.session.project)).schemaVersion).toBe(5);
    expect(applied.transaction.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 2000,
    });
  });
});
