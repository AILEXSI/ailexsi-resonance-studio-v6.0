/**
 * P1b — human-readable inspect READ presentation.
 * Trusted evidence stays structured. Conversation is NL. Provider is untrusted.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createSession, projectRevisionOf, type Session } from "../../src/app/session";
import { INSPECT_RANGE_TOOL, type InspectRangeDto } from "../../src/app/ai/tools/inspect-range";
import { invokeTrustedRead } from "../../src/app/ai/transactions/invoke";
import { clearAudit, listAudit } from "../../src/app/ai/transactions/audit";
import { createDirectorHostState, submitDirectorAutoTurn } from "../../src/app/ai/host";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import type { AIProvider, ChatRequest, ChatResponse } from "../../src/app/ai/providers/types";
import { PROJECT_SCHEMA_VERSION } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";
import {
  formatInspectRangeReply,
  groundInspectPresentation,
  looksLikeRawInspectJson,
  presentInspectRead,
} from "../../src/app/ai/read-presentation";
import { DIRECTOR_MUTATING_TOOL } from "../../src/app/ai/contract";

const LEAK_RE =
  /sourcePath|objectUrl|blob:|pcm|spectrum|waveform|jpeg|png|apiKey|Bearer |secret/i;

const INSPECT_SECONDS = "Was passiert zwischen Sekunde 10 und 20?";
const INSPECT_PLAYHEAD = "Was liegt rund um den Playhead?";
const INSPECT_SELECTED = "Was befindet sich um den markierten Clip?";
const INSPECT_EMPTY = "Was passiert zwischen Sekunde 0 und 1?";
const INSPECT_SECONDS_EN = "What happens between second 10 and 20?";

const RAW_JSON_DUMP_RE = /\{\s*"ok"\s*:\s*true|"data"\s*:|"projectRevision"\s*:|"hash"\s*:/;
const INVENTED_MEDIA_RE = /\b(beat drop|the video shows|film scene|music drop|audio waveform|pcm|transcript)\b/i;

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

function scriptedProvider(text: string): AIProvider {
  return {
    id: "mock",
    capabilities: () => ({ chat: true, stream: false, tools: false, local: true }),
    getModels: async () => [{ id: "script", name: "script" }],
    testConnection: async () => ({ ok: true }),
    chat: async (request: ChatRequest): Promise<ChatResponse> => ({
      requestId: request.requestId,
      text,
      model: "script",
    }),
  };
}

async function autoInspect(
  session: Session,
  prompt: string,
  provider: AIProvider = createMockProvider(),
) {
  return submitDirectorAutoTurn(
    createDirectorHostState(),
    prompt,
    { provider, orchestrator: createOrchestrator() },
    undefined,
    session,
    { providerInjected: true },
  );
}

function dtoOf(result: ReturnType<typeof invokeTrustedRead>): InspectRangeDto {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.data as InspectRangeDto;
}

function evidenceDto(next: Awaited<ReturnType<typeof autoInspect>>): InspectRangeDto {
  expect(next.lastReadResult?.result.ok).toBe(true);
  if (!next.lastReadResult?.result.ok) throw new Error("missing trusted inspect");
  return next.lastReadResult.result.data as InspectRangeDto;
}

describe("P1b inspect READ presentation", () => {
  beforeEach(() => {
    clearAudit();
  });

  it("A explicit range — human-readable, evidence facts only, no raw JSON, no mutation", async () => {
    const session = goldenSession();
    const beforeProject = session.project;
    const beforeHistory = session.history.past.length;
    const next = await autoInspect(session, INSPECT_SECONDS);
    const text = next.conversation.messages.at(-1)?.text ?? "";
    const dto = evidenceDto(next);

    expect(text).toMatch(/clip_A/);
    expect(text).toMatch(/clip_B/);
    expect(text).toMatch(/DROP|mk_drop/);
    expect(text).toMatch(/ausgew[aä]hlt|Bereich|Clip/i);
    expect(looksLikeRawInspectJson(text)).toBe(false);
    expect(text).not.toMatch(RAW_JSON_DUMP_RE);
    expect(text).not.toContain(JSON.stringify(dto));
    expect(text).not.toMatch(LEAK_RE);

    expect(dto.range).toEqual({ fromMs: 10_000, toMs: 20_000 });
    expect(dto.projectRevision).toBe(42);
    expect(dto.hash).toMatch(/^[0-9a-f]{8}$/);
    expect(next.lastReadResult?.toolName).toBe(INSPECT_RANGE_TOOL);
    expect(next.transaction).toBeNull();
    expect(session.project).toBe(beforeProject);
    expect(session.project.clips.find((c) => c.id === "clip_A")?.startMs).toBe(10_000);
    expect(session.history.past.length).toBe(beforeHistory);
    expect(projectRevisionOf(session)).toBe(42);
    expect(listAudit().some((e) => e.toolName === INSPECT_RANGE_TOOL && e.projectRevision === 42)).toBe(
      true,
    );
  });

  it("B playhead — uses inspect, no invented media semantics", async () => {
    const session = { ...goldenSession(), selectedClipId: null, selectedClipIds: [] };
    const next = await autoInspect(session, INSPECT_PLAYHEAD);
    const text = next.conversation.messages.at(-1)?.text ?? "";
    const dto = evidenceDto(next);

    expect(dto.playheadMs).toBe(12_000);
    expect(dto.range).toEqual({ fromMs: 4000, toMs: 20_000 });
    expect(text).toMatch(/Playhead|00:12/);
    expect(text).toMatch(/clip_A|clip_B/);
    expect(text).not.toMatch(INVENTED_MEDIA_RE);
    expect(text).not.toMatch(RAW_JSON_DUMP_RE);
    expect(next.transaction).toBeNull();
    expect(projectRevisionOf(session)).toBe(42);
    expect(session.history.past.length).toBe(0);
  });

  it("C selection — selected clip correct, no false selected, no mutation", async () => {
    const session = goldenSession();
    const next = await autoInspect(session, INSPECT_SELECTED);
    const text = next.conversation.messages.at(-1)?.text ?? "";
    const dto = evidenceDto(next);

    expect(dto.selection).toEqual({
      clipIds: ["clip_A"],
      primaryClipId: "clip_A",
      markerId: null,
    });
    expect(dto.clips.map((c) => c.clipId)).toEqual(["clip_A"]);
    expect(dto.clips[0]?.selected).toBe(true);
    expect(text).toMatch(/clip_A/);
    expect(text).toMatch(/ausgew[aä]hlt|Auswahl|selected|Selection/i);
    expect(text).not.toMatch(/clip_B[^\n.]{0,40}(selected|ausgew[aä]hlt)/i);
    expect(text).not.toMatch(RAW_JSON_DUMP_RE);
    expect(next.transaction).toBeNull();
    expect(session.project.clips.find((c) => c.id === "clip_A")?.startMs).toBe(10_000);
    expect(session.history.past.length).toBe(0);
  });

  it("D empty range — truthful empty NL", async () => {
    const session = goldenSession();
    const next = await autoInspect(session, INSPECT_EMPTY);
    const text = next.conversation.messages.at(-1)?.text ?? "";
    const dto = evidenceDto(next);

    expect(dto.range).toEqual({ fromMs: 0, toMs: 1000 });
    expect(dto.counts).toEqual({ clips: 0, markers: 0, gaps: 0 });
    expect(dto.clips).toEqual([]);
    expect(dto.markers).toEqual([]);
    expect(text).toMatch(/keine|empty|No clips|Keine Clips/i);
    expect(text).not.toMatch(/clip_B|DROP|mk_drop/);
    expect(text).not.toMatch(/Clips:.*clip_A/);
    expect(text).not.toMatch(RAW_JSON_DUMP_RE);
    expect(next.transaction).toBeNull();
    expect(projectRevisionOf(session)).toBe(42);
  });

  it("E provider hallucination — DROP marker rejected when evidence has 0 markers", async () => {
    const session = {
      ...goldenSession(),
      project: { ...goldenSession().project, markers: [] },
    };
    const trusted = dtoOf(
      invokeTrustedRead(INSPECT_RANGE_TOOL, { fromMs: 10_000, toMs: 20_000 }, {
        session,
        grant: "READ",
        mode: "ASK",
      }),
    );
    expect(trusted.counts.markers).toBe(0);
    expect(trusted.markers).toEqual([]);

    const hallucinated = "There is a DROP marker at the playhead. clip_A is present.";
    expect(groundInspectPresentation(hallucinated, trusted).ok).toBe(false);

    const next = await autoInspect(
      session,
      INSPECT_SECONDS,
      scriptedProvider(JSON.stringify({ message: hallucinated })),
    );
    const text = next.conversation.messages.at(-1)?.text ?? "";
    const dto = evidenceDto(next);

    expect(dto.markers).toEqual([]);
    expect(dto.counts.markers).toBe(0);
    expect(text).not.toBe(hallucinated);
    expect(text).not.toMatch(/\bDROP\b/);
    expect(text).toMatch(/keine Marker|No markers|0 Marker/i);
    expect(next.lastReadResult?.presentation.source).toBe("fallback");
    expect(next.lastReadResult?.presentation.reason).toBe("unsupported-claim");
    expect(next.transaction).toBeNull();
    expect(projectRevisionOf(session)).toBe(42);
    expect(session.history.past.length).toBe(0);
  });

  it("F READ presentation toolRequest — reject WRITE, zero mutation", async () => {
    const session = goldenSession();
    const beforeProject = session.project;
    const beforeHistory = session.history.past.length;
    const next = await autoInspect(
      session,
      INSPECT_SECONDS,
      scriptedProvider(
        JSON.stringify({
          message: "Prepared move clip_A by 4000ms",
          toolRequest: { name: DIRECTOR_MUTATING_TOOL, arguments: { deltaMs: 4000 } },
        }),
      ),
    );
    const text = next.conversation.messages.at(-1)?.text ?? "";

    expect(next.transaction).toBeNull();
    expect(next.lastGateCode).toBeNull();
    expect(text).toMatch(/cannot request timeline\.move_clip|darf timeline\.move_clip nicht/i);
    expect(text).toMatch(/No project changes were made|Keine Projektänderung/);
    expect(next.lastReadResult?.result.ok).toBe(true);
    expect(next.lastReadResult?.presentation.source).toBe("rejected-write");
    expect(session.project).toBe(beforeProject);
    expect(session.project.clips.find((c) => c.id === "clip_A")?.startMs).toBe(10_000);
    expect(session.history.past.length).toBe(beforeHistory);
    expect(projectRevisionOf(session)).toBe(42);
    expect(session.project.clips.find((c) => c.id === "clip_A")?.startMs).toBe(10_000);
  });

  it("G trusted inspect OK, provider fails — zero mutation, fallback keeps evidence", async () => {
    const session = goldenSession();
    const next = await autoInspect(
      session,
      INSPECT_SECONDS,
      createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
    );
    const text = next.conversation.messages.at(-1)?.text ?? "";
    const dto = evidenceDto(next);

    expect(dto.projectRevision).toBe(42);
    expect(dto.clips.map((c) => c.clipId)).toEqual(["clip_A", "clip_B"]);
    expect(text).toMatch(/clip_A/);
    expect(text).not.toMatch(RAW_JSON_DUMP_RE);
    expect(next.lastReadResult?.presentation.source).toBe("fallback");
    expect(next.lastReadResult?.presentation.reason).toBe("PROVIDER_UNAVAILABLE");
    expect(next.transaction).toBeNull();
    expect(session.project.clips.find((c) => c.id === "clip_A")?.startMs).toBe(10_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(42);
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("grounded provider German presentation is used when it stays inside evidence", async () => {
    const session = goldenSession();
    const message =
      "Zwischen 10s und 20s liegen clip_A (ausgewählt) und clip_B. Marker DROP. Playhead bei 12s.";
    const next = await autoInspect(
      session,
      INSPECT_SECONDS,
      scriptedProvider(JSON.stringify({ message })),
    );
    expect(next.conversation.messages.at(-1)?.text).toBe(message);
    expect(next.lastReadResult?.presentation.source).toBe("provider");
    expect(next.transaction).toBeNull();
  });

  it("deterministic fallback stays inside evidence and is not raw JSON", () => {
    const session = goldenSession();
    const dto = dtoOf(
      invokeTrustedRead(INSPECT_RANGE_TOOL, { fromMs: 10_000, toMs: 20_000 }, {
        session,
        grant: "READ",
        mode: "ASK",
      }),
    );
    const de = formatInspectRangeReply(dto, INSPECT_SECONDS);
    const en = formatInspectRangeReply(dto, INSPECT_SECONDS_EN);
    expect(de).toMatch(/Bereich|Clip|ausgewählt/);
    expect(en).toMatch(/range|clip|selected/i);
    expect(looksLikeRawInspectJson(de)).toBe(false);
    expect(looksLikeRawInspectJson(en)).toBe(false);
    expect(groundInspectPresentation(de, dto).ok).toBe(true);
    expect(groundInspectPresentation(en, dto).ok).toBe(true);
  });

  it("presentInspectRead never escalates WRITE when provider asks to move", async () => {
    const session = goldenSession();
    const dto = dtoOf(
      invokeTrustedRead(INSPECT_RANGE_TOOL, { fromMs: 10_000, toMs: 20_000 }, {
        session,
        grant: "READ",
        mode: "ASK",
      }),
    );
    const presented = await presentInspectRead({
      dto,
      userText: INSPECT_SECONDS,
      provider: scriptedProvider(
        JSON.stringify({
          message: "Preview timeline.move_clip +4000ms",
          toolRequest: { name: DIRECTOR_MUTATING_TOOL, arguments: { deltaMs: 4000 } },
        }),
      ),
      orchestrator: createOrchestrator(),
    });
    expect(presented.source).toBe("rejected-write");
    expect(presented.text).not.toMatch(/Prepared move|Preview timeline/);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(42);
  });
});
