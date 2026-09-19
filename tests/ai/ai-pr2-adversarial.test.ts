import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  applyMove,
  applyNudge,
  applyPlayhead,
  createSession,
  newProject,
  openSerialized,
  projectRevisionOf,
  type Session,
} from "../../src/app/session";
import {
  applyMoveClip,
  commitMoveClip,
  draftMoveClip,
  GOLDEN_MOVE_PROMPT,
  resolveMoveClipCommand,
} from "../../src/app/ai/tools/move-clip";
import {
  applyCommandTransaction,
  draftCommandTransaction,
  rejectTransaction,
  type AITransaction,
} from "../../src/app/ai/transactions/transaction";
import { clearAudit, listAudit, recordAudit } from "../../src/app/ai/transactions/audit";
import { invokeTrustedRead } from "../../src/app/ai/transactions/invoke";
import { canCommit, canDraft, canRead, DIRECTOR_MODES, GRANTS } from "../../src/app/ai/permissions/policy";
import { invokeTool } from "../../src/app/ai/tools/registry";
import { captureContextSnapshot } from "../../src/app/ai/context/snapshot";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import {
  createOpenAICompatibleProvider,
  isAllowedLocalProviderUrl,
} from "../../src/app/ai/providers/openai-compatible";
import { loadAiPrefs, saveAiPrefs } from "../../src/app/ai/providers/prefs";
import { createOrchestrator, orchestrateChat } from "../../src/app/ai/orchestrator";
import {
  applyHostApproved,
  applyHostTransaction,
  createDirectorHostState,
  submitDirectorProviderTurn,
} from "../../src/app/ai/host";
import { isDirectorEnabled, setDirectorEnabledForTests } from "../../src/app/ai/flag";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const CLIP_ID = "clip_123";
const edit = { grant: "EDIT" as const, mode: "AGENT" as const, approval: true };

function fixture(opts?: {
  startMs?: number;
  projectId?: string;
  clipId?: string;
  locked?: boolean;
  extraClips?: Session["project"]["clips"];
  playheadMs?: number;
}): Session {
  const clipId = opts?.clipId ?? CLIP_ID;
  const a = asset({ id: "asset_aa", kind: "audio", durationMs: 12_000 });
  const c = clip({
    id: clipId,
    assetId: "asset_aa",
    trackId: "A1",
    startMs: opts?.startMs ?? 30_000,
    durationMs: 2000,
    locked: opts?.locked,
  });
  const project = {
    ...projectWith([c, ...(opts?.extraClips ?? [])], [a]),
    snap: true,
    playheadMs: opts?.playheadMs ?? 31_000,
  };
  if (opts?.projectId) project.id = opts.projectId;
  return {
    ...createSession(createMemoryBlobStore()),
    project,
    selectedClipId: clipId,
    selectedClipIds: [clipId],
  };
}

function startOf(session: Session, clipId = CLIP_ID): number {
  return session.project.clips.find((c) => c.id === clipId)!.startMs;
}

function walkAiSources(dir = "src/app/ai"): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walkAiSources(path));
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("PR #2 adversarial review", () => {
  it("0 start state: schema 5, revision 0, one mutation one revision", () => {
    const session = fixture();
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(projectRevisionOf(session)).toBe(0);
    expect(JSON.parse(serializeProject(session.project))).not.toHaveProperty("projectRevision");
    const moved = applyCommand(session, { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 100 });
    expect(projectRevisionOf(moved)).toBe(1);
    expect(moved.history.past.length).toBe(1);
    const playhead = applyPlayhead(session, 40_000);
    expect(projectRevisionOf(playhead)).toBe(0);
    expect(playhead.history.past.length).toBe(0);
  });

  it("2 revision: draft/read/UI-only do not increment; undo/redo/open/new/apply do", () => {
    const session = fixture();
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    expect(projectRevisionOf(session)).toBe(0);
    expect(projectRevisionOf(drafted.ok ? drafted.session : session)).toBe(0);

    const read = invokeTrustedRead("project.describe", {}, { session, grant: "READ", mode: "ASK" });
    expect(read.ok).toBe(true);
    expect(read.projectRevision).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);

    const applied = applyMoveClip({ session, result: drafted as never, ...edit });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(projectRevisionOf(applied.session)).toBe(1);
    expect(applied.session.history.past.length).toBe(1);

    const undone = applyCommand(applied.session, { type: "undo" });
    expect(projectRevisionOf(undone)).toBe(2);
    const redone = applyCommand(undone, { type: "redo" });
    expect(projectRevisionOf(redone)).toBe(3);

    const opened = openSerialized(redone, serializeProject(fixture({ projectId: "proj_other" }).project));
    expect(projectRevisionOf(opened)).toBe(4);
    const fresh = newProject(opened);
    expect(projectRevisionOf(fresh)).toBe(5);
    expect(fresh.project.id).not.toBe(session.project.id);
  });

  it("3 human edit after draft: move/trim/split/delete/undo/redo/open/drag → TRANSACTION_CONFLICT", () => {
    const cases: Array<{ name: string; next: (s: Session) => Session }> = [
      {
        name: "move",
        next: (s) => applyCommand(s, { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 50 }),
      },
      {
        name: "trim",
        next: (s) => applyCommand(s, { type: "liftTrim", clipId: CLIP_ID, edge: "out", nextEdgeMs: 31_500 }),
      },
      {
        name: "split",
        next: (s) => applyCommand({ ...s, project: { ...s.project, playheadMs: 31_000 } }, { type: "split" }),
      },
      {
        name: "delete",
        next: (s) => applyCommand(s, { type: "liftDelete" }),
      },
      {
        name: "undo",
        next: (s) => {
          const moved = applyCommand(s, { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 50 });
          return applyCommand(moved, { type: "undo" });
        },
      },
      {
        name: "redo",
        next: (s) => {
          const moved = applyCommand(s, { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 50 });
          return applyCommand(applyCommand(moved, { type: "undo" }), { type: "redo" });
        },
      },
      {
        name: "open",
        next: (s) => openSerialized(s, serializeProject(fixture({ projectId: "proj_opened" }).project)),
      },
      {
        name: "drag-commit",
        next: (s) => ({
          ...s,
          history: { past: [...s.history.past, structuredClone(s.project)], future: [] },
          projectRevision: projectRevisionOf(s) + 1,
          status: "Moved clip",
        }),
      },
    ];

    for (const c of cases) {
      const session = fixture();
      const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
      expect(drafted.ok, c.name).toBe(true);
      if (!drafted.ok) return;
      const human = c.next(session);
      const applied = applyMoveClip({ session: human, result: drafted, ...edit });
      expect(applied.ok, c.name).toBe(false);
      if (!applied.ok) expect(applied.code, c.name).toBe("TRANSACTION_CONFLICT");
      if (c.name !== "delete" && c.name !== "open") {
        expect(startOf(human === session ? session : human), c.name).not.toBe(32_000);
      }
      expect(human.history.past.length === 0 || startOf(session) === 30_000).toBe(true);
    }
  });

  it("4 revision ABA: undo to visually equivalent still conflicts", () => {
    const session = fixture();
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const human = applyCommand(session, { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 250 });
    const undone = applyCommand(human, { type: "undo" });
    expect(startOf(undone)).toBe(30_000);
    expect(projectRevisionOf(undone)).toBeGreaterThan(projectRevisionOf(session));
    const applied = applyMoveClip({ session: undone, result: drafted, ...edit });
    expect(applied.ok).toBe(false);
    if (!applied.ok) expect(applied.code).toBe("TRANSACTION_CONFLICT");
    expect(startOf(undone)).toBe(30_000);
    expect(undone.history.past.length).toBe(0);
  });

  it("5 project replacement: coincidental clip_123 on Project B cannot apply Project A draft", () => {
    const projectA = fixture({ projectId: "proj_a", clipId: CLIP_ID });
    const drafted = draftMoveClip({ session: projectA, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(drafted.transaction.projectId).toBe("proj_a");
    expect(drafted.transaction.baseRevision).toBe(0);

    const projectB = fixture({ projectId: "proj_b", clipId: CLIP_ID });
    expect(projectRevisionOf(projectB)).toBe(0);
    expect(projectB.project.clips[0]?.id).toBe(CLIP_ID);
    const appliedB = applyMoveClip({ session: projectB, result: drafted, ...edit });
    expect(appliedB.ok).toBe(false);
    if (!appliedB.ok) expect(appliedB.code).toBe("TRANSACTION_CONFLICT");
    expect(startOf(projectB)).toBe(30_000);
    expect(projectB.history.past.length).toBe(0);

    const opened = openSerialized(projectA, serializeProject(projectB.project));
    expect(opened.project.id).toBe("proj_b");
    const appliedOpen = applyMoveClip({ session: opened, result: drafted, ...edit });
    expect(appliedOpen.ok).toBe(false);
    if (!appliedOpen.ok) expect(appliedOpen.code).toBe("TRANSACTION_CONFLICT");
    expect(startOf(opened)).toBe(30_000);
  });

  it("6 transaction immutability: mutating command after draft cannot change commit", () => {
    const session = fixture();
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(Object.isFrozen(drafted.transaction.command)).toBe(true);
    expect(() => {
      (drafted.transaction.command as { deltaMs: number }).deltaMs = 99_000;
    }).toThrow();
    const forged: AITransaction = {
      ...drafted.transaction,
      command: { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 99_000 },
    };
    const mutated = applyCommandTransaction({
      session,
      transaction: forged,
      grant: "EDIT",
      mode: "AGENT",
      approval: true,
    });
    expect(mutated.ok).toBe(false);
    if (!mutated.ok) expect(mutated.code).toBe("TRANSACTION_CONFLICT");
    expect(startOf(session)).toBe(30_000);

    const honest = applyMoveClip({ session, result: drafted, ...edit });
    expect(honest.ok).toBe(true);
    if (!honest.ok) return;
    expect(startOf(honest.session)).toBe(32_000);
    expect(honest.transaction.preview.afterStartMs).toBe(32_000);
  });

  it("7 TOCTOU: live-drag start change and lock are revalidated at commit", () => {
    const session = fixture();
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const liveDragged: Session = {
      ...session,
      project: {
        ...session.project,
        clips: session.project.clips.map((c) => (c.id === CLIP_ID ? { ...c, startMs: 31_000 } : c)),
      },
    };
    const midDrag = applyMoveClip({ session: liveDragged, result: drafted, ...edit });
    expect(midDrag.ok).toBe(false);
    if (!midDrag.ok) expect(midDrag.code).toBe("TRANSACTION_CONFLICT");
    expect(startOf(liveDragged)).toBe(31_000);

    const locked = applyCommand(session, { type: "setClipsLocked", locked: true });
    const lockedApply = applyMoveClip({ session: locked, result: drafted, ...edit });
    expect(lockedApply.ok).toBe(false);
  });

  it("8 selection attacks fail closed", () => {
    const session = fixture();
    const none = { ...session, selectedClipId: null, selectedClipIds: [] };
    expect(resolveMoveClipCommand(none, { deltaMs: 2000 })).toMatchObject({ error: "No clip selected" });

    const extra = clip({ id: "clip_other", assetId: "asset_aa", trackId: "A1", startMs: 0, durationMs: 1000 });
    const multi = fixture({ extraClips: [extra] });
    multi.selectedClipId = CLIP_ID;
    multi.selectedClipIds = [CLIP_ID, "clip_other"];
    expect(resolveMoveClipCommand(multi, { deltaMs: 2000 })).toMatchObject({ error: "AMBIGUOUS_SELECTION" });

    const inconsistent = fixture();
    inconsistent.selectedClipId = "clip_other";
    inconsistent.selectedClipIds = [CLIP_ID];
    expect(resolveMoveClipCommand(inconsistent, { deltaMs: 2000 })).toMatchObject({
      error: "AMBIGUOUS_SELECTION",
    });

    expect(resolveMoveClipCommand(session, { clipId: "clip_missing", deltaMs: 2000 })).toMatchObject({
      error: "Clip not found",
    });
    expect(resolveMoveClipCommand(session, { clipId: "Vocals", deltaMs: 2000 })).toMatchObject({
      error: "Display names are not ids",
    });
    expect(resolveMoveClipCommand(session, { clipId: "unknown", deltaMs: 2000 })).toMatchObject({
      error: "Display names are not ids",
    });
    expect(resolveMoveClipCommand(fixture({ locked: true }), { deltaMs: 2000 })).toMatchObject({
      error: "Clip is locked",
    });
    const deleted = applyCommand(session, { type: "liftDelete" });
    expect(resolveMoveClipCommand(deleted, { clipId: CLIP_ID, deltaMs: 2000 })).toMatchObject({
      error: "Clip not found",
    });
  });

  it("9 numeric attacks fail closed; +2000 is exact", () => {
    const session = fixture();
    const bad = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      0,
      -2000,
      2000.4,
      2000.6,
      Number.MAX_SAFE_INTEGER + 1,
      "2000",
      null,
      undefined,
    ];
    for (const deltaMs of bad) {
      expect(resolveMoveClipCommand(session, { deltaMs: deltaMs as never }), String(deltaMs)).toMatchObject({
        error: "INVALID_DELTA",
      });
    }
    expect(resolveMoveClipCommand(session, { targetStartSeconds: Number.NaN })).toMatchObject({
      error: "INVALID_DELTA",
    });
    const ok = resolveMoveClipCommand(session, { deltaMs: 2000 });
    expect(ok).toEqual({ clipIds: [CLIP_ID], deltaMs: 2000 });
    const applied = commitMoveClip({ session, args: { deltaMs: 2000 }, ...edit });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(startOf(applied.session) - 30_000).toBe(2000);
  });

  it("10 snap: Project.snap=true still exact +2000 (not applyMove/nudge)", () => {
    const session = fixture({ playheadMs: 31_950 });
    expect(session.project.snap).toBe(true);
    const viaMove = applyMove(session, CLIP_ID, 32_000);
    expect(startOf(viaMove)).toBe(31_950);
    const viaNudge = applyNudge(session, 2000);
    expect(startOf(viaNudge)).not.toBe(32_000);
    const applied = commitMoveClip({ session, args: { deltaMs: 2000 }, ...edit });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(startOf(applied.session)).toBe(32_000);
    expect(applied.transaction.command).toEqual({
      type: "moveClips",
      clipIds: [CLIP_ID],
      deltaMs: 2000,
    });
  });

  it("11 history: one Apply = one entry; reject/fail/stale/draft = 0", () => {
    const session = fixture();
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    expect(session.history.past.length).toBe(0);
    expect(rejectTransaction(drafted.transaction).status).toBe("rejected");
    expect(session.history.past.length).toBe(0);

    const human = applyCommand(session, { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 10 });
    const stale = applyMoveClip({ session: human, result: drafted, ...edit });
    expect(stale.ok).toBe(false);
    expect(human.history.past.length).toBe(1);

    const failed = commitMoveClip({ session, args: { deltaMs: 2000 }, grant: "READ", mode: "ASK", approval: true });
    expect(failed.ok).toBe(false);
    expect(session.history.past.length).toBe(0);

    const applied = applyMoveClip({ session, result: drafted, ...edit });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.session.history.past.length).toBe(1);
  });

  it("12 provider: stale A after B / abort / throw / malformed / timeout do not mutate Project", async () => {
    const session = fixture();
    const before = startOf(session);
    const orch = createOrchestrator();
    const slow = createMockProvider({ delayMs: 40 });
    const fast = createMockProvider({ delayMs: 0 });
    const [a, b] = await Promise.all([
      orchestrateChat(slow, [{ role: "user", content: "first" }], orch),
      orchestrateChat(fast, [{ role: "user", content: "second" }], orch),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["ok", "stale"]);
    expect(startOf(session)).toBe(before);

    const ctl = new AbortController();
    const hanging = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:9/v1",
      model: "m",
      timeoutMs: 30,
      fetchImpl: async () => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return new Response("{}", { status: 200 });
      },
    });
    const pending = hanging.chat({ requestId: "late", messages: [{ role: "user", content: "x" }], signal: ctl.signal });
    ctl.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });

    const malformed = await submitDirectorProviderTurn(
      { ...createDirectorHostState(), grant: "EDIT", mode: "AGENT" },
      GOLDEN_MOVE_PROMPT,
      {
        provider: createOpenAICompatibleProvider({
          baseUrl: "http://127.0.0.1:9/v1",
          model: "m",
          fetchImpl: async () => new Response("{not-json", { status: 200 }),
        }),
        orchestrator: createOrchestrator(),
      },
      undefined,
      session,
    );
    expect(malformed.status).toBe("error");
    expect(startOf(session)).toBe(before);
    expect(session.history.past.length).toBe(0);
  });

  it("13 context snapshot has no media secrets and is frozen", () => {
    const session = fixture();
    session.project.assets[0] = {
      ...session.project.assets[0]!,
      sourcePath: "/secret/path.wav",
      objectUrl: "blob:v6-test:9",
    };
    const snap = captureContextSnapshot(session, { level: "SELECTION", outboundClass: "SEND_STRUCTURE" });
    expect(Object.isFrozen(snap)).toBe(true);
    const raw = JSON.stringify(snap);
    expect(raw).not.toMatch(/sourcePath|objectUrl|blob:|apiKey|Bearer |secret\/path/);
    expect(() => {
      (snap as { playheadMs: number }).playheadMs = 0;
    }).toThrow();
  });

  it("14 secrets never persist to Project / prefs / audit / conversation", () => {
    const session = fixture();
    const storage = new Map<string, string>();
    saveAiPrefs(
      {
        getItem: (k) => storage.get(k) ?? null,
        setItem: (k, v) => storage.set(k, v),
      },
      { providerId: "openai-compatible", baseUrl: "http://127.0.0.1:11434/v1", model: "m" },
    );
    const prefs = loadAiPrefs({
      getItem: (k) => storage.get(k) ?? null,
    });
    expect(JSON.stringify(prefs)).not.toMatch(/apiKey|Bearer |sk-/);
    expect(serializeProject(session.project)).not.toMatch(/apiKey|Authorization|Bearer /);
    clearAudit();
    recordAudit({ action: "draft", toolName: "timeline.move_clip", result: "ok", detail: "Bearer sk-secret apiKey=x" });
    expect(JSON.stringify(listAudit())).not.toMatch(/sk-secret|apiKey=x/);
    expect(JSON.stringify(listAudit())).toMatch(/\[redacted\]/);
  });

  it("15 local provider SSRF: non-loopback URLs fail closed and do not fetch", async () => {
    expect(isAllowedLocalProviderUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isAllowedLocalProviderUrl("http://localhost:1234")).toBe(true);
    expect(isAllowedLocalProviderUrl("http://[::1]:11434/v1")).toBe(true);
    expect(isAllowedLocalProviderUrl("https://api.openai.com/v1")).toBe(false);
    expect(isAllowedLocalProviderUrl("http://10.0.0.8/v1")).toBe(false);
    expect(isAllowedLocalProviderUrl("http://127.0.0.1.attacker.test/v1")).toBe(false);
    let fetches = 0;
    const cloud = createOpenAICompatibleProvider({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt",
      fetchImpl: (async () => {
        fetches += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    await expect(cloud.chat({ requestId: "r", messages: [{ role: "user", content: "x" }] })).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
    });
    expect(fetches).toBe(0);
  });

  it("16/17 AI-off and playhead cache do not start provider traffic", () => {
    setDirectorEnabledForTests(null);
    expect(isDirectorEnabled({ search: "", storage: null })).toBe(false);
    let fetches = 0;
    const original = globalThis.fetch;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      fetches += 1;
      return original(input, init);
    }) as typeof fetch;
    try {
      createDirectorHostState();
      applyPlayhead(fixture(), 12_000);
      expect(fetches).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("18 read tools: no mutation/history/revision; mutating DTO does not affect Project", () => {
    const session = fixture();
    const result = invokeTool("timeline.get_clip", { clipId: CLIP_ID }, { session, grant: "READ" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data as { startMs: number };
    data.startMs = 1;
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
  });

  it("19 permission matrix ASK/DRAFT/AGENT × READ/DRAFT/EDIT", () => {
    const expectedDraft: Record<string, boolean> = {
      "ASK:READ": false,
      "ASK:DRAFT": false,
      "ASK:EDIT": false,
      "DRAFT:READ": false,
      "DRAFT:DRAFT": true,
      "DRAFT:EDIT": true,
      "AGENT:READ": false,
      "AGENT:DRAFT": true,
      "AGENT:EDIT": true,
    };
    const expectedCommit: Record<string, boolean> = {
      "ASK:READ": false,
      "ASK:DRAFT": false,
      "ASK:EDIT": false,
      "DRAFT:READ": false,
      "DRAFT:DRAFT": false,
      "DRAFT:EDIT": false,
      "AGENT:READ": false,
      "AGENT:DRAFT": false,
      "AGENT:EDIT": true,
    };
    for (const mode of DIRECTOR_MODES) {
      for (const grant of GRANTS) {
        expect(canRead(grant)).toBe(true);
        expect(canDraft(grant, mode), `${mode}:${grant} draft`).toBe(expectedDraft[`${mode}:${grant}`]);
        expect(canCommit(grant, mode, true), `${mode}:${grant} commit`).toBe(expectedCommit[`${mode}:${grant}`]);
        expect(canCommit(grant, mode, false)).toBe(false);
      }
    }
  });

  it("20 audit records draft/apply/reject/conflict and audit throw does not corrupt Project", () => {
    clearAudit();
    const session = fixture();
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const stale = applyMoveClip({
      session: applyCommand(session, { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 10 }),
      result: drafted,
      ...edit,
    });
    expect(stale.ok).toBe(false);
    rejectTransaction(drafted.transaction);
    const actions = listAudit().map((e) => `${e.action}:${e.result}`);
    expect(actions.some((a) => a.startsWith("draft:"))).toBe(true);
    expect(actions).toContain("apply:denied");
    expect(actions).toContain("reject:ok");
    expect(JSON.stringify(listAudit())).not.toMatch(/sourcePath|Bearer |apiKey/);
    expect(startOf(session)).toBe(30_000);

    const applied = applyMoveClip({ session, result: drafted, ...edit });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(startOf(applied.session)).toBe(32_000);
    expect(applied.session.project.schemaVersion).toBe(5);
  });

  it("21/22/23 no direct AI project writes, no second engine, frame-engine/exporter untouched", () => {
    const sources = walkAiSources();
    expect(sources.length).toBeGreaterThan(5);
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/session\.project\.clips\s*=/);
      expect(text, file).not.toMatch(/AIProject|AICommandBus/);
      expect(text, file).not.toMatch(/frame-engine|src\/core\/exporter/);
    }
    const host = readFileSync("src/app/ai/host.ts", "utf8");
    expect(host).toContain("applyCommandTransaction");
    expect(host).not.toContain("applyMove(");
    expect(host).not.toContain("nudgeClip");
  });

  it("golden 12/12 + chain 12/12 still hold after hardening", () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const session = fixture({ startMs: 30_000 });
      const applied = commitMoveClip({ session, args: { deltaMs: 2000 }, ...edit });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      results.push(startOf(applied.session));
    }
    expect(results).toEqual(Array.from({ length: 12 }, () => 32_000));

    let session = fixture({ startMs: 30_000 });
    for (let i = 0; i < 12; i += 1) {
      const applied = commitMoveClip({ session, args: { deltaMs: 2000 }, ...edit });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      session = applied.session;
    }
    expect(startOf(session)).toBe(30_000 + 24_000);
  });

  it("host Apply after human edit stays conflicted and leaves Project unchanged", () => {
    const session = fixture();
    const drafted = draftMoveClip({ session, args: { deltaMs: 2000 }, grant: "EDIT", mode: "AGENT" });
    expect(drafted.ok).toBe(true);
    if (!drafted.ok) return;
    const host = applyHostTransaction(
      { ...createDirectorHostState(), grant: "EDIT", mode: "AGENT" },
      drafted.transaction,
    );
    const human = applyCommand(session, { type: "moveClips", clipIds: [CLIP_ID], deltaMs: 80 });
    const approved = applyHostApproved(host, human);
    expect(approved.session).toBe(human);
    expect(startOf(approved.session)).toBe(30_080);
    expect(approved.state.statusLabel).toMatch(/TRANSACTION_CONFLICT/);
  });
});
