import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, projectRevisionOf, type Session } from "../../src/app/session";
import { clearAudit, listAudit } from "../../src/app/ai/transactions/audit";
import {
  applyCommandTransaction,
  draftCommandTransaction,
  rejectTransaction,
} from "../../src/app/ai/transactions/transaction";
import { invokeTrustedRead } from "../../src/app/ai/transactions/invoke";
import { canCommit, canDraft, isGrant } from "../../src/app/ai/permissions/policy";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { createDirectorHostState, submitDirectorProviderTurn } from "../../src/app/ai/host";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function sessionWithClip(): Session {
  const a = asset({ id: "asset_aa", kind: "audio", durationMs: 4000 });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs: 30_000,
    durationMs: 2000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true },
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
  };
}

const move = { type: "moveClips" as const, clipIds: ["clip_test"], deltaMs: 2000 };

describe("AI-6 permissions and transaction foundation", () => {
  it("READ cannot draft; DRAFT cannot commit; EDIT without approval denied", () => {
    const session = sessionWithClip();
    expect(canDraft("READ", "AGENT")).toBe(false);
    expect(canCommit("EDIT", "AGENT", false)).toBe(false);
    expect(canCommit("DRAFT", "AGENT", true)).toBe(false);
    expect(canCommit("EDIT", "DRAFT", true)).toBe(false);
    expect(canCommit("EDIT", "AGENT", true)).toBe(true);

    const readDraft = draftCommandTransaction({
      session,
      command: move,
      grant: "READ",
      mode: "AGENT",
      toolName: "timeline.move_clip",
    });
    expect(readDraft.ok).toBe(false);
    if (!readDraft.ok) expect(readDraft.code).toBe("GRANT_DENIED");

    const drafted = draftCommandTransaction({
      session,
      command: move,
      grant: "DRAFT",
      mode: "DRAFT",
      toolName: "timeline.move_clip",
    });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(session.project.clips[0]?.startMs).toBe(30_000);
    const commitDraft = applyCommandTransaction({
      session,
      transaction: drafted.transaction,
      grant: "DRAFT",
      mode: "DRAFT",
      approval: true,
    });
    expect(commitDraft.ok).toBe(false);
    if (!commitDraft.ok) expect(commitDraft.code).toBe("GRANT_DENIED");

    const noApproval = applyCommandTransaction({
      session,
      transaction: drafted.transaction,
      grant: "EDIT",
      mode: "AGENT",
      approval: false,
    });
    expect(noApproval.ok).toBe(false);
    if (!noApproval.ok) expect(noApproval.code).toBe("APPROVAL_REQUIRED");
    expect(session.project.clips[0]?.startMs).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("invalid grant is denied", () => {
    const session = sessionWithClip();
    const result = draftCommandTransaction({
      session,
      command: move,
      grant: "EXPORT",
      mode: "AGENT",
      toolName: "timeline.move_clip",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("INVALID_GRANT");
    expect(isGrant("EXPORT")).toBe(false);
  });

  it("draft + reject leave canonical Project and history unchanged", () => {
    const session = sessionWithClip();
    const drafted = draftCommandTransaction({
      session,
      command: move,
      grant: "EDIT",
      mode: "AGENT",
      toolName: "timeline.move_clip",
    });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(drafted.transaction.preview.beforeStartMs).toBe(30_000);
    expect(drafted.transaction.preview.afterStartMs).toBe(32_000);
    expect(drafted.session).toBe(session);
    expect(session.project.clips[0]?.startMs).toBe(30_000);
    const rejected = rejectTransaction(drafted.transaction);
    expect(rejected.status).toBe("rejected");
    expect(rejected.draftProject).toBeNull();
    expect(session.project.clips[0]?.startMs).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("stale revision is denied", () => {
    const session = sessionWithClip();
    const drafted = draftCommandTransaction({
      session,
      command: move,
      grant: "EDIT",
      mode: "AGENT",
      toolName: "timeline.move_clip",
    });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 100 });
    expect(projectRevisionOf(human)).toBeGreaterThan(projectRevisionOf(session));
    const applied = applyCommandTransaction({
      session: human,
      transaction: drafted.transaction,
      grant: "EDIT",
      mode: "AGENT",
      approval: true,
    });
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.code).toBe("TRANSACTION_CONFLICT");
    expect(human.project.clips[0]?.startMs).toBe(30_100);
  });

  it("provider failure does not mutate Project", async () => {
    const session = sessionWithClip();
    const next = await submitDirectorProviderTurn(
      createDirectorHostState(),
      "fail",
      {
        provider: createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
        orchestrator: createOrchestrator(),
      },
    );
    expect(next.status).toBe("error");
    expect(session.project.clips[0]?.startMs).toBe(30_000);
    expect(session.history.past.length).toBe(0);
  });

  it("one approved apply is one history entry and schema stays 5", () => {
    clearAudit();
    const session = sessionWithClip();
    const drafted = draftCommandTransaction({
      session,
      command: move,
      grant: "EDIT",
      mode: "AGENT",
      toolName: "timeline.move_clip",
    });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const applied = applyCommandTransaction({
      session,
      transaction: drafted.transaction,
      grant: "EDIT",
      mode: "AGENT",
      approval: true,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.session.history.past.length).toBe(1);
    expect(applied.session.project.clips[0]?.startMs).toBe(32_000);
    expect(applied.session.project.snap).toBe(true);
    expect(session.project.clips[0]?.startMs).toBe(30_000);
    expect(applied.session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(serializeProject(applied.session.project)).schemaVersion).toBe(5);
    expect(JSON.parse(serializeProject(applied.session.project))).not.toHaveProperty("projectRevision");
    const undone = applyCommand(applied.session, { type: "undo" });
    expect(undone.project.clips[0]?.startMs).toBe(30_000);
    expect(listAudit().some((e) => e.action === "apply" && e.result === "ok")).toBe(true);
    expect(JSON.stringify(listAudit())).not.toMatch(/sourcePath|Bearer |apiKey/);
  });

  it("trusted read path stamps revision and does not write", () => {
    const session = sessionWithClip();
    const result = invokeTrustedRead("project.describe", {}, {
      session,
      grant: "READ",
      mode: "ASK",
    });
    expect(result.ok).toBe(true);
    expect(result.projectRevision).toBe(0);
    expect(session.history.past.length).toBe(0);
    const denied = invokeTrustedRead("project.describe", {}, {
      session,
      grant: "EXPORT",
      mode: "ASK",
    });
    expect(denied.ok).toBe(false);
  });
});
