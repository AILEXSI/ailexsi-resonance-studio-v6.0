/**
 * Human EXE: qwen "Prepared move <clipId> by 4000ms" after AUTO MOVE_CLIP
 * must seal a real Transaction PREVIEW. Prose alone is not success.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import {
  applyHostApproved,
  createDirectorHostState,
  rejectHostTransaction,
  submitDirectorAutoTurn,
  submitDirectorProviderTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import {
  looksLikePreparedMoveClaim,
  parseDirectorResponse,
  UNSEALED_PREPARED_MOVE_MESSAGE,
} from "../../src/app/ai/contract";
import { parseMoveClipPrompt, planDirectorTurn } from "../../src/app/ai/orchestration";
import { createOrchestrator } from "../../src/app/ai/orchestrator";
import type { AIProvider, ChatRequest, ChatResponse } from "../../src/app/ai/providers/types";
import { createSession, projectRevisionOf, type Session } from "../../src/app/session";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { DirectorPanel } from "../../src/ui/director/DirectorPanel";
import { asset, clip, projectWith } from "../helpers";

const HUMAN_FOUR_SECOND_PROMPT = "Verschiebe den markierten Clip 4 Sekunden nach rechts.";

function fixture(startMs = 30_000): Session {
  const a = asset({ id: "asset_aa", kind: "video", durationMs: 8000 });
  const c = clip({
    id: "clip_test",
    assetId: "asset_aa",
    trackId: "A1",
    startMs,
    durationMs: 4000,
  });
  return {
    ...createSession(createMemoryBlobStore()),
    project: { ...projectWith([c], [a]), snap: true, playheadMs: 31_950 },
    selectedClipId: "clip_test",
    selectedClipIds: ["clip_test"],
  };
}

function host(patch?: Partial<DirectorHostState>): DirectorHostState {
  return { ...createDirectorHostState(), grant: "EDIT", ...patch };
}

function startOf(session: Session): number {
  return session.project.clips[0]!.startMs;
}

function preparedMoveProseProvider(clipId: string, deltaMs: number): AIProvider {
  return {
    id: "openai-compatible",
    capabilities: () => ({ chat: true, stream: false, tools: false, local: true }),
    getModels: async () => [{ id: "qwen2.5:7b", name: "qwen2.5:7b" }],
    testConnection: async () => ({ ok: true }),
    abort: () => undefined,
    chat: async (request: ChatRequest): Promise<ChatResponse> => ({
      requestId: request.requestId,
      text: `Prepared move ${clipId} by ${deltaMs}ms`,
      model: "qwen2.5:7b",
    }),
  };
}

function preparedMoveMessageOnlyProvider(clipId: string, deltaMs: number): AIProvider {
  return {
    id: "openai-compatible",
    capabilities: () => ({ chat: true, stream: false, tools: false, local: true }),
    getModels: async () => [{ id: "qwen2.5:7b", name: "qwen2.5:7b" }],
    testConnection: async () => ({ ok: true }),
    abort: () => undefined,
    chat: async (request: ChatRequest): Promise<ChatResponse> => ({
      requestId: request.requestId,
      text: JSON.stringify({ message: `Prepared move ${clipId} by ${deltaMs}ms` }),
      model: "qwen2.5:7b",
    }),
  };
}

async function autoTurn(
  session: Session,
  text: string,
  state: DirectorHostState = host(),
  provider: AIProvider = preparedMoveProseProvider("clip_test", 4000),
) {
  return submitDirectorAutoTurn(
    state,
    text,
    { provider, orchestrator: createOrchestrator() },
    undefined,
    session,
    { providerInjected: true },
  );
}

describe("Prepared move without sealed PREVIEW is not success", () => {
  it("documents CASE 1: qwen prose parses as conversation, no toolRequest", () => {
    const parsed = parseDirectorResponse("Prepared move clip_test by 4000ms");
    expect(parsed).toEqual({ ok: true, message: "Prepared move clip_test by 4000ms" });
    expect("toolRequest" in parsed && parsed.ok ? parsed.toolRequest : undefined).toBeUndefined();
    expect(looksLikePreparedMoveClaim("Prepared move clip_test by 4000ms")).toBe(true);
    expect(parseMoveClipPrompt(HUMAN_FOUR_SECOND_PROMPT)).toEqual({ deltaMs: 4000 });
    expect(planDirectorTurn(HUMAN_FOUR_SECOND_PROMPT).intent.kind).toBe("MOVE_CLIP");
    expect(planDirectorTurn(HUMAN_FOUR_SECOND_PROMPT).toolName).toBe("timeline.move_clip");
  });

  it("Prepared move text alone without sealed MOVE_CLIP is rewritten, no PREVIEW", async () => {
    const session = fixture();
    const next = await submitDirectorProviderTurn(
      host(),
      "thanks",
      {
        provider: preparedMoveProseProvider("clip_test", 4000),
        orchestrator: createOrchestrator(),
      },
      undefined,
      session,
    );
    expect(next.transaction).toBeNull();
    expect(startOf(session)).toBe(30_000);
    expect(next.conversation.messages.some((m) => looksLikePreparedMoveClaim(m.text))).toBe(false);
    expect(next.conversation.messages.at(-1)?.text).toBe(UNSEALED_PREPARED_MOVE_MESSAGE);
  });

  it("AUTO NL → MOVE_CLIP +4000 → sealed PREVIEW from qwen prose (no toolRequest)", async () => {
    const session = fixture();
    const preview = await autoTurn(session, HUMAN_FOUR_SECOND_PROMPT);
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.toolName).toBe("timeline.move_clip");
    expect(preview.transaction?.preview.clipId).toBe("clip_test");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 4000,
    });
    expect(preview.transaction?.preview.afterStartMs).toBe(34_000);
    expect(startOf(session)).toBe(30_000);
    expect(session.history.past.length).toBe(0);
    expect(projectRevisionOf(session)).toBe(0);
    expect(preview.conversation.messages.some((m) => m.text.includes("Prepared move clip_test by 4000ms"))).toBe(
      true,
    );
  });

  it("AUTO JSON message-only (no toolRequest) still seals +4000 PREVIEW", async () => {
    const session = fixture();
    const preview = await autoTurn(
      session,
      HUMAN_FOUR_SECOND_PROMPT,
      host(),
      preparedMoveMessageOnlyProvider("clip_test", 4000),
    );
    expect(preview.transaction?.status).toBe("draft");
    expect(preview.transaction?.command).toEqual({
      type: "moveClips",
      clipIds: ["clip_test"],
      deltaMs: 4000,
    });
    expect(startOf(session)).toBe(30_000);
  });

  it("Apply commits exact +4000 through HistoryStack; Reject mutates nothing", async () => {
    const session = fixture();
    const preview = await autoTurn(session, HUMAN_FOUR_SECOND_PROMPT);
    expect(startOf(session)).toBe(30_000);
    const applied = applyHostApproved(preview, session);
    expect(startOf(applied.session)).toBe(34_000);
    expect(applied.session.history.past.length).toBe(1);
    expect(applied.session.project.schemaVersion).toBe(5);
    expect(JSON.parse(serializeProject(applied.session.project)).schemaVersion).toBe(PROJECT_SCHEMA_VERSION);

    const other = fixture();
    const rejected = rejectHostTransaction(await autoTurn(other, HUMAN_FOUR_SECOND_PROMPT));
    expect(rejected.transaction?.status).toBe("rejected");
    expect(startOf(other)).toBe(30_000);
    expect(other.history.past.length).toBe(0);
    expect(projectRevisionOf(other)).toBe(0);
  });
});

describe("Prepared move PREVIEW UI", () => {
  let node: HTMLDivElement | undefined;
  let root: Root | undefined;
  let session: Session;
  let committed: Session | undefined;

  beforeEach(() => {
    session = fixture();
    committed = undefined;
  });

  afterEach(() => {
    act(() => {
      root?.unmount();
    });
    node?.remove();
    node = undefined;
    root = undefined;
  });

  it("renders PREVIEW Apply/Reject for the human 4s qwen prose path", async () => {
    const preview = await autoTurn(session, HUMAN_FOUR_SECOND_PROMPT);
    node = document.createElement("div");
    document.body.appendChild(node);
    root = createRoot(node);
    await act(async () => {
      root!.render(
        <DirectorPanel
          initialState={preview}
          session={session}
          provider={preparedMoveProseProvider("clip_test", 4000)}
          onCanonicalCommit={(next) => {
            committed = next;
          }}
        />,
      );
    });
    expect(node.querySelector('[data-testid="director-txn-phase"]')?.textContent).toBe("PREVIEW");
    expect(node.querySelector('[data-testid="director-txn-tool"]')?.textContent).toMatch(/timeline\.move_clip/);
    expect(node.querySelector('[data-testid="director-txn-target"]')?.textContent).toMatch(/clip_test/);
    expect(node.querySelector('[data-testid="director-txn-delta"]')?.textContent).toMatch(/\+4000ms/);
    expect(node.querySelector('[data-testid="director-txn-apply"]')).toBeTruthy();
    expect(node.querySelector('[data-testid="director-txn-reject"]')).toBeTruthy();
    expect(startOf(session)).toBe(30_000);
    await act(async () => {
      (node!.querySelector('[data-testid="director-txn-apply"]') as HTMLButtonElement).click();
    });
    expect(committed).toBeTruthy();
    expect(startOf(committed!)).toBe(34_000);
  });

  it("hostile snap after prose PREVIEW still Apply-conflicts; manual edit intact", async () => {
    const preview = await autoTurn(session, HUMAN_FOUR_SECOND_PROMPT);
    const human = applyCommand(session, { type: "moveClips", clipIds: ["clip_test"], deltaMs: 80 });
    const approved = applyHostApproved(preview, human);
    expect(startOf(approved.session)).toBe(30_080);
    expect(approved.state.statusLabel).toMatch(/TRANSACTION_CONFLICT/);
    expect(human.history.past.length).toBe(1);
  });
});
