/**
 * P1a timeline.inspect_range — perception READ only.
 * Gates A–H. Zero Project mutation. Golden move + prepared-move seal stay intact.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  createSession,
  projectRevisionOf,
  type Session,
} from "../../src/app/session";
import {
  classifyDirectorIntent,
  planDirectorTurn,
} from "../../src/app/ai/orchestration";
import { invokeTool, listTools } from "../../src/app/ai/tools/registry";
import {
  INSPECT_RANGE_TOOL,
  parseInspectRangePrompt,
  type InspectRangeDto,
} from "../../src/app/ai/tools/inspect-range";
import { commitMoveClip } from "../../src/app/ai/tools/move-clip";
import { toolRequirementOf } from "../../src/app/ai/tools/requirements";
import { invokeTrustedRead } from "../../src/app/ai/transactions/invoke";
import { clearAudit, listAudit } from "../../src/app/ai/transactions/audit";
import {
  looksLikePreparedMoveClaim,
  UNSEALED_PREPARED_MOVE_MESSAGE,
} from "../../src/app/ai/contract";
import {
  createDirectorHostState,
  submitDirectorAutoTurn,
} from "../../src/app/ai/host";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const LEAK_RE =
  /sourcePath|objectUrl|blob:|pcm|spectrum|waveform|jpeg|png|apiKey|Bearer |secret/i;

const INSPECT_SECONDS = "Was passiert zwischen Sekunde 10 und 20?";
const INSPECT_TIMECODE = "Zeig mir den Timeline-Bereich von 1:30 bis 1:40.";
const INSPECT_PLAYHEAD = "Was liegt rund um den Playhead?";
const INSPECT_SELECTED = "Was befindet sich um den markierten Clip?";

function goldenSession(): Session {
  const media = asset({
    id: "asset_aa",
    kind: "video",
    durationMs: 30_000,
    sourcePath: "/secret/path.mp4",
    objectUrl: "blob:v6-test:inspect",
  });
  const clipA = clip({
    id: "clip_A",
    assetId: "asset_aa",
    trackId: "V1",
    startMs: 10_000,
    durationMs: 5000,
    sourceInMs: 0,
    sourceOutMs: 5000,
  });
  const clipB = clip({
    id: "clip_B",
    assetId: "asset_aa",
    trackId: "V1",
    startMs: 17_000,
    durationMs: 5000,
    sourceInMs: 5000,
    sourceOutMs: 10_000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: {
      ...projectWith([clipA, clipB], [media]),
      id: "proj_inspect",
      playheadMs: 12_000,
      inPointMs: 10_000,
      outPointMs: 20_000,
      loop: false,
      snap: true,
      markers: [{ id: "mk_drop", timeMs: 12_000, label: "DROP" }],
    },
    projectRevision: 42,
    selectedClipId: "clip_A",
    selectedClipIds: ["clip_A"],
    selectedMarkerId: null,
  };
}

function inspect(
  session: Session,
  args: { fromMs?: number; toMs?: number; trackIds?: string[]; maxClips?: number } = {
    fromMs: 10_000,
    toMs: 20_000,
  },
) {
  return invokeTrustedRead(INSPECT_RANGE_TOOL, args, {
    session,
    grant: "READ",
    mode: "ASK",
  });
}

function dtoOf(result: ReturnType<typeof inspect>): InspectRangeDto {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.data as InspectRangeDto;
}

describe("P1a timeline.inspect_range", () => {
  beforeEach(() => {
    clearAudit();
  });

  it("A exact facts 12/12 identical hash", () => {
    const hashes: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      const session = goldenSession();
      const dto = dtoOf(inspect(session));
      expect(dto.projectId).toBe("proj_inspect");
      expect(dto.projectRevision).toBe(42);
      expect(dto.schemaVersion).toBe(5);
      expect(dto.range).toEqual({ fromMs: 10_000, toMs: 20_000 });
      expect(dto.playheadMs).toBe(12_000);
      expect(dto.inPointMs).toBe(10_000);
      expect(dto.outPointMs).toBe(20_000);
      expect(dto.loop).toBe(false);
      expect(dto.selection).toEqual({
        clipIds: ["clip_A"],
        primaryClipId: "clip_A",
        markerId: null,
      });
      expect(dto.clips.map((c) => c.clipId)).toEqual(["clip_A", "clip_B"]);
      expect(dto.clips[0]).toMatchObject({
        clipId: "clip_A",
        trackId: "V1",
        kind: "video",
        startMs: 10_000,
        durationMs: 5000,
        endMs: 15_000,
        selected: true,
      });
      expect(dto.clips[1]).toMatchObject({
        clipId: "clip_B",
        trackId: "V1",
        startMs: 17_000,
        durationMs: 5000,
        endMs: 22_000,
        selected: false,
      });
      expect(dto.markers).toEqual([{ markerId: "mk_drop", timeMs: 12_000, label: "DROP" }]);
      expect(dto.gaps).toEqual([{ trackId: "V1", startMs: 15_000, endMs: 17_000 }]);
      expect(dto.counts).toEqual({ clips: 2, markers: 1, gaps: 1 });
      expect(dto.hash).toMatch(/^[0-9a-f]{8}$/);
      hashes.push(dto.hash);
    }
    expect(hashes).toEqual(Array.from({ length: 12 }, () => hashes[0]));
  });

  it("B zero mutation of project, history, and revision", () => {
    const session = goldenSession();
    const beforeProject = session.project;
    const beforeJson = serializeProject(session.project);
    const beforeHistory = session.history.past.length;
    const beforeRevision = projectRevisionOf(session);
    const dto = dtoOf(inspect(session));
    expect(session.project).toBe(beforeProject);
    expect(serializeProject(session.project)).toBe(beforeJson);
    expect(session.history.past.length).toBe(beforeHistory);
    expect(projectRevisionOf(session)).toBe(beforeRevision);
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(dto.projectRevision).toBe(42);
  });

  it("C return DTO is isolated from Session.project", () => {
    const session = goldenSession();
    const dto = dtoOf(inspect(session));
    const originalStart = session.project.clips[0]!.startMs;
    dto.clips[0]!.startMs = 99_999;
    dto.clips[0]!.gain = 0;
    dto.markers[0]!.label = "MUTATED";
    dto.range.fromMs = 0;
    expect(session.project.clips[0]!.startMs).toBe(originalStart);
    expect(session.project.clips[0]!.gain).toBe(1);
    expect(session.project.markers[0]!.label).toBe("DROP");
    expect(session.project.inPointMs).toBe(10_000);
  });

  it("D filter fail-closed: unknown trackId, invalid range, maxClips explicit", () => {
    const session = goldenSession();
    expect(inspect(session, { fromMs: 10_000, toMs: 20_000, trackIds: ["A9"] })).toMatchObject({
      ok: false,
      code: "UNKNOWN_TRACK",
    });
    expect(inspect(session, { fromMs: 10_000, toMs: 20_000, trackIds: ["VIS"] })).toMatchObject({
      ok: false,
      code: "INVALID_ARGS",
    });
    expect(inspect(session, { fromMs: 20_000, toMs: 10_000 })).toMatchObject({
      ok: false,
      code: "INVALID_ARGS",
    });
    expect(inspect(session, { fromMs: 10_000 })).toMatchObject({
      ok: false,
      code: "INVALID_ARGS",
    });
    expect(inspect(session, { fromMs: 10_000.5, toMs: 20_000 })).toMatchObject({
      ok: false,
      code: "INVALID_ARGS",
    });
    const overCap = inspect(session, { fromMs: 10_000, toMs: 20_000, maxClips: 1 });
    expect(overCap).toMatchObject({ ok: false, code: "INVALID_ARGS" });
    if (!overCap.ok) {
      expect(overCap.message).toMatch(/maxClips exceeded: 2 clips in range \(max 1\)/);
    }
    expect(session.project.clips).toHaveLength(2);
    expect(projectRevisionOf(session)).toBe(42);
  });

  it("E secret / raw media leak scan on serialized DTO", () => {
    const session = goldenSession();
    const dto = dtoOf(inspect(session));
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toMatch(LEAK_RE);
    expect(serialized).not.toContain("/secret/path.mp4");
    expect(serialized).not.toContain("blob:v6-test:inspect");
    expect(dto).not.toHaveProperty("sourcePath");
    expect(dto).not.toHaveProperty("objectUrl");
    expect(dto.clips.every((c) => !("sourcePath" in c) && !("objectUrl" in c))).toBe(true);
  });

  it("F audit entry with tool, projectId, projectRevision", () => {
    const session = goldenSession();
    const result = inspect(session);
    expect(result.ok).toBe(true);
    expect(result.projectRevision).toBe(42);
    const entry = listAudit().find((e) => e.toolName === INSPECT_RANGE_TOOL);
    expect(entry).toMatchObject({
      action: "tool",
      toolName: INSPECT_RANGE_TOOL,
      result: "ok",
      projectId: "proj_inspect",
      projectRevision: 42,
    });
    expect(JSON.stringify(listAudit())).not.toMatch(/sourcePath|Bearer |apiKey/);
  });

  it("G golden move +2000 12/12 and prepared-move seal still hold", () => {
    const results: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const media = asset({ id: "asset_aa", kind: "audio", durationMs: 8000 });
      const c = clip({
        id: "clip_test",
        assetId: "asset_aa",
        trackId: "A1",
        startMs: 30_000,
        durationMs: 2000,
      });
      const session = {
        ...createSession(createMemoryBlobStore()),
        project: { ...projectWith([c], [media]), snap: true },
        selectedClipId: "clip_test",
        selectedClipIds: ["clip_test"],
      };
      const applied = commitMoveClip({
        session,
        args: { deltaMs: 2000 },
        grant: "EDIT",
        mode: "AGENT",
        approval: true,
      });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.session.project.clips[0]!.startMs - 30_000).toBe(2000);
      expect(applied.session.history.past.length).toBe(1);
      results.push(applied.session.project.clips[0]!.startMs);
    }
    expect(results).toEqual(Array.from({ length: 12 }, () => 32_000));

    expect(looksLikePreparedMoveClaim("Prepared move clip_test by 4000ms")).toBe(true);
    expect(looksLikePreparedMoveClaim("Preview timeline.move_clip +2000ms")).toBe(true);
    expect(UNSEALED_PREPARED_MOVE_MESSAGE).toMatch(/not a draft/i);
    expect(toolRequirementOf("timeline.move_clip")).toMatchObject({
      mutation: true,
      requiredPermission: "EDIT",
    });
    expect(toolRequirementOf(INSPECT_RANGE_TOOL)).toMatchObject({
      mutation: false,
      requiredPermission: "READ",
      requiredContext: "PROJECT",
    });
  });

  it("requirement metadata is READ / mutation false", () => {
    expect(listTools().some((t) => t.name === INSPECT_RANGE_TOOL)).toBe(true);
    expect(listTools().find((t) => t.name === INSPECT_RANGE_TOOL)?.grant).toBe("READ");
    expect(toolRequirementOf(INSPECT_RANGE_TOOL)).toEqual({
      name: INSPECT_RANGE_TOOL,
      mutation: false,
      requiredPermission: "READ",
      requiredContext: "PROJECT",
      targetType: "project",
      supportsMultipleTargets: false,
    });
  });

  it("intent examples route to inspect_range; unclear ranges fail closed", () => {
    expect(parseInspectRangePrompt(INSPECT_SECONDS)).toEqual({ fromMs: 10_000, toMs: 20_000 });
    expect(parseInspectRangePrompt(INSPECT_TIMECODE)).toEqual({ fromMs: 90_000, toMs: 100_000 });
    expect(parseInspectRangePrompt(INSPECT_PLAYHEAD)).toEqual({});
    expect(parseInspectRangePrompt(INSPECT_SELECTED)).toEqual({});
    expect(parseInspectRangePrompt("Was passiert?")).toBeNull();
    expect(parseInspectRangePrompt("maybe inspect something around there")).toBeNull();
    expect(classifyDirectorIntent(INSPECT_SECONDS)).toMatchObject({
      kind: "INSPECT_RANGE",
      confidence: "known",
    });
    expect(classifyDirectorIntent("Was passiert?")).toMatchObject({
      kind: "UNCERTAIN",
    });
    expect(planDirectorTurn(INSPECT_SECONDS)).toMatchObject({
      toolName: INSPECT_RANGE_TOOL,
      providerAction: "read-tool",
      requiredPermission: "READ",
      contextLevel: "PROJECT",
      mode: "ASK",
    });
    expect(classifyDirectorIntent("What is selected?").kind).toBe("ASK_SELECTION");
  });

  it("default range: selection union, else playhead ±8000, fail-closed empty", () => {
    const selected = goldenSession();
    const selectedDto = dtoOf(inspect(selected, {}));
    expect(selectedDto.range).toEqual({ fromMs: 10_000, toMs: 15_000 });
    expect(selectedDto.clips.map((c) => c.clipId)).toEqual(["clip_A"]);

    const playhead = { ...goldenSession(), selectedClipId: null, selectedClipIds: [] };
    const playheadDto = dtoOf(inspect(playhead, {}));
    expect(playheadDto.range).toEqual({ fromMs: 4000, toMs: 20_000 });

    const empty = createSession(createMemoryBlobStore());
    expect(inspect(empty, {})).toMatchObject({ ok: false, code: "INVALID_ARGS" });
  });

  it("AUTO inspect uses invokeTrustedRead and does not mutate", async () => {
    const session = goldenSession();
    const before = session.project;
    const next = await submitDirectorAutoTurn(
      createDirectorHostState(),
      INSPECT_SECONDS,
      { provider: createMockProvider(), orchestrator: createOrchestrator() },
      undefined,
      session,
      { providerInjected: true },
    );
    expect(next.transaction).toBeNull();
    expect(next.pendingAuth).toBeNull();
    expect(next.lastPlan?.toolName).toBe(INSPECT_RANGE_TOOL);
    const text = next.conversation.messages.at(-1)?.text ?? "";
    expect(text).toMatch(/clip_A/);
    expect(text).toMatch(/mk_drop/);
    expect(text).toMatch(/"projectRevision":42/);
    expect(text).not.toMatch(LEAK_RE);
    expect(session.project).toBe(before);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(42);
    expect(listAudit().some((e) => e.toolName === INSPECT_RANGE_TOOL && e.projectRevision === 42)).toBe(
      true,
    );
    expect(next.grant).toBe("READ");
  });

  it("does not invent a second mutation path", () => {
    const session = goldenSession();
    invokeTool(INSPECT_RANGE_TOOL, { fromMs: 10_000, toMs: 20_000 }, { session, grant: "READ" });
    const moved = applyCommand(session, { type: "moveClips", clipIds: ["clip_A"], deltaMs: 2000 });
    expect(moved.project.clips.find((c) => c.id === "clip_A")?.startMs).toBe(12_000);
    expect(session.project.clips.find((c) => c.id === "clip_A")?.startMs).toBe(10_000);
    expect(session.history.past.length).toBe(0);
    expect(JSON.parse(serializeProject(session.project)).schemaVersion).toBe(5);
  });
});
