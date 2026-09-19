import { describe, expect, it } from "vitest";
import {
  createSession,
  newProject,
  openSerialized,
  projectRevisionOf,
  type Session,
} from "../../src/app/session";
import {
  applyHostApproved,
  createDirectorHostState,
  submitDirectorProviderTurn,
  type DirectorHostState,
} from "../../src/app/ai/host";
import { GOLDEN_MOVE_PROMPT } from "../../src/app/ai/tools/move-clip";
import { createMockProvider } from "../../src/app/ai/providers/mock";
import {
  createOpenAICompatibleProvider,
  isAllowedLocalProviderUrl,
} from "../../src/app/ai/providers/openai-compatible";
import { createOrchestrator, orchestrateChat } from "../../src/app/ai/orchestrator";
import { PROJECT_SCHEMA_VERSION, serializeProject } from "../../src/core/project";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const CLIP_ID = "clip_test";

function fixture(opts?: {
  startMs?: number;
  projectId?: string;
  clipId?: string;
  locked?: boolean;
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
  const project = { ...projectWith([c], [a]), snap: true };
  if (opts?.projectId) project.id = opts.projectId;
  return {
    ...createSession(createMemoryBlobStore()),
    project,
    selectedClipId: clipId,
    selectedClipIds: [clipId],
  };
}

function goldenHost(patch?: Partial<DirectorHostState>): DirectorHostState {
  return {
    ...createDirectorHostState(),
    grant: "EDIT",
    mode: "AGENT",
    modeLabel: "Mode: AGENT",
    contextLevel: "SELECTION",
    contextLabel: "Context: SELECTION",
    ...patch,
  };
}

function startOf(session: Session, clipId = CLIP_ID): number {
  return session.project.clips.find((c) => c.id === clipId)!.startMs;
}

function structuredProvider(content: unknown, extra?: { delayMs?: number; baseUrl?: string }) {
  return createOpenAICompatibleProvider({
    baseUrl: extra?.baseUrl ?? "http://127.0.0.1:11434/v1",
    model: "local-model",
    timeoutMs: extra?.delayMs ? 30 : 8_000,
    fetchImpl: (async (_input, init) => {
      if (extra?.delayMs) {
        const signal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, extra.delayMs);
          const onAbort = () => {
            clearTimeout(timer);
            reject(new DOMException("The operation was aborted.", "AbortError"));
          };
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      const text = typeof content === "string" ? content : JSON.stringify(content);
      const body =
        typeof content === "string" && !content.trim().startsWith("{")
          ? content
          : JSON.stringify({
              choices: [{ message: { role: "assistant", content: text } }],
            });
      return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch,
  });
}

async function submitWith(
  session: Session,
  provider: ReturnType<typeof createMockProvider> | ReturnType<typeof createOpenAICompatibleProvider>,
  text = GOLDEN_MOVE_PROMPT,
  host = goldenHost(),
  signal?: AbortSignal,
) {
  return submitDirectorProviderTurn(
    host,
    text,
    { provider, orchestrator: createOrchestrator() },
    signal,
    session,
  );
}

describe("AI Director golden-path adversarial", () => {
  it("ADV-5 loopback remains fail-closed and does not fetch cloud", async () => {
    expect(isAllowedLocalProviderUrl("http://127.0.0.1:11434/v1")).toBe(true);
    expect(isAllowedLocalProviderUrl("http://localhost:1234")).toBe(true);
    expect(isAllowedLocalProviderUrl("http://[::1]:11434/v1")).toBe(true);
    expect(isAllowedLocalProviderUrl("https://api.openai.com/v1")).toBe(false);
    expect(isAllowedLocalProviderUrl("http://10.0.0.8/v1")).toBe(false);
    let fetches = 0;
    const cloud = createOpenAICompatibleProvider({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt",
      fetchImpl: (async () => {
        fetches += 1;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    const session = fixture();
    const next = await submitWith(session, cloud);
    expect(next.status).toBe("error");
    expect(next.transaction).toBeNull();
    expect(fetches).toBe(0);
    expect(startOf(session)).toBe(30_000);
  });

  it("unavailable / timeout / abort / late-after-newer-req never mutate", async () => {
    const session = fixture();
    const before = startOf(session);

    const unavailable = await submitWith(
      session,
      createMockProvider({ failWith: "PROVIDER_UNAVAILABLE" }),
    );
    expect(unavailable.transaction).toBeNull();

    const hanging = structuredProvider("late", { delayMs: 500 });
    await expect(
      hanging.chat({ requestId: "t", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });

    const ctl = new AbortController();
    const aborting = createOpenAICompatibleProvider({
      baseUrl: "http://127.0.0.1:9/v1",
      model: "m",
      timeoutMs: 5_000,
      fetchImpl: (async (_input, init) => {
        const signal = init?.signal;
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
        });
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    });
    const pending = submitWith(session, aborting, GOLDEN_MOVE_PROMPT, goldenHost(), ctl.signal);
    ctl.abort();
    const aborted = await pending;
    expect(aborted.transaction).toBeNull();

    const orch = createOrchestrator();
    const slow = createMockProvider({ delayMs: 40 });
    const fast = createMockProvider({ delayMs: 0 });
    const [a, b] = await Promise.all([
      orchestrateChat(slow, [{ role: "user", content: "first" }], orch),
      orchestrateChat(fast, [{ role: "user", content: "second" }], orch),
    ]);
    expect([a.kind, b.kind].sort()).toEqual(["ok", "stale"]);
    expect(startOf(session)).toBe(before);
    expect(session.history.past.length).toBe(0);
  });

  it("malformed / unknown tool / wrong types / absurd values fail closed", async () => {
    const session = fixture();
    const cases: unknown[] = [
      "{not-json",
      { message: "x", toolRequest: { name: "timeline.explode", arguments: { deltaMs: 2000 } } },
      { message: "x", toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: "2000" } } },
      { message: "x", toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: 0 } } },
      { message: "x", toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: -2000 } } },
      { message: "x", toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: 2000.4 } } },
      { message: "x", toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: Number.POSITIVE_INFINITY } } },
      { message: "x", toolRequest: { name: "timeline.move_clip", arguments: { deltaMs: 99_000_000_000 } } },
    ];
    for (const content of cases) {
      const next = await submitWith(session, structuredProvider(content));
      expect(next.transaction, String(content)).toBeNull();
      expect(startOf(session)).toBe(30_000);
      expect(session.history.past.length).toBe(0);
    }
  });

  it("nonexistent / locked clip and missing selection fail closed", async () => {
    const missing = fixture();
    const missingReply = await submitWith(
      missing,
      structuredProvider({
        message: "move",
        toolRequest: { name: "timeline.move_clip", arguments: { clipId: "clip_missing", deltaMs: 2000 } },
      }),
    );
    expect(missingReply.transaction).toBeNull();
    expect(startOf(missing)).toBe(30_000);

    const locked = fixture({ locked: true });
    const lockedReply = await submitWith(locked, createMockProvider());
    expect(lockedReply.transaction).toBeNull();
    expect(startOf(locked)).toBe(30_000);

    const none = fixture();
    none.selectedClipId = null;
    none.selectedClipIds = [];
    const noSel = await submitWith(none, createMockProvider());
    expect(noSel.transaction).toBeNull();
    expect(none.history.past.length).toBe(0);
  });

  it("READ / ASK / NONE context never draft; DRAFT cannot Apply", async () => {
    const session = fixture();
    const read = await submitWith(session, createMockProvider(), GOLDEN_MOVE_PROMPT, goldenHost({ grant: "READ" }));
    expect(read.transaction).toBeNull();
    const ask = await submitWith(
      session,
      createMockProvider(),
      GOLDEN_MOVE_PROMPT,
      goldenHost({ mode: "ASK", modeLabel: "Mode: ASK" }),
    );
    expect(ask.transaction).toBeNull();
    const none = await submitWith(
      session,
      createMockProvider(),
      GOLDEN_MOVE_PROMPT,
      goldenHost({ contextLevel: "NONE" }),
    );
    expect(none.transaction).toBeNull();

    const draftOnly = await submitWith(
      session,
      createMockProvider(),
      GOLDEN_MOVE_PROMPT,
      goldenHost({ grant: "DRAFT", mode: "DRAFT", modeLabel: "Mode: DRAFT" }),
    );
    expect(draftOnly.transaction?.status).toBe("draft");
    const applied = applyHostApproved({ ...draftOnly, grant: "DRAFT", mode: "DRAFT" }, session);
    expect(applied.session).toBe(session);
    expect(startOf(applied.session)).toBe(30_000);
    expect(applied.state.statusLabel).toMatch(/GRANT_DENIED|APPROVAL_REQUIRED/);
  });

  it("project switch / ABA: Apply after open/new is TRANSACTION_CONFLICT", async () => {
    const session = fixture({ projectId: "proj_a" });
    const preview = await submitWith(session, createMockProvider());
    expect(preview.transaction?.status).toBe("draft");

    const other = fixture({ projectId: "proj_b", clipId: CLIP_ID });
    const opened = openSerialized(session, serializeProject(other.project));
    const afterOpen = applyHostApproved(preview, opened);
    expect(afterOpen.session).toBe(opened);
    expect(startOf(afterOpen.session)).toBe(30_000);
    expect(afterOpen.state.statusLabel).toMatch(/TRANSACTION_CONFLICT/);

    const fresh = newProject(session);
    const afterNew = applyHostApproved(preview, fresh);
    expect(afterNew.session).toBe(fresh);
    expect(afterNew.state.statusLabel).toMatch(/TRANSACTION_CONFLICT/);
    expect(projectRevisionOf(fresh)).toBeGreaterThan(0);
    expect(fresh.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it("late structured reply after a newer request does not keep a stale draft", async () => {
    const session = fixture();
    const host = goldenHost();
    const orch = createOrchestrator();
    const slow = createMockProvider({ delayMs: 40 });
    const fast = createMockProvider({ delayMs: 0 });
    const [first, second] = await Promise.all([
      submitDirectorProviderTurn(host, GOLDEN_MOVE_PROMPT, { provider: slow, orchestrator: orch }, undefined, session),
      submitDirectorProviderTurn(host, GOLDEN_MOVE_PROMPT, { provider: fast, orchestrator: orch }, undefined, session),
    ]);
    const kinds = [first.transaction?.status ?? "none", second.transaction?.status ?? "none"];
    expect(kinds.filter((k) => k === "draft").length).toBeLessThanOrEqual(1);
    expect(startOf(session)).toBe(30_000);
    if (second.transaction?.status === "draft") {
      const applied = applyHostApproved(second, session);
      expect(startOf(applied.session)).toBe(32_000);
    }
  });

  it("direct mutation / second engine / frame-engine stay absent in AI modules", () => {
    const files = import.meta.glob("../../src/app/ai/**/*.{ts,tsx}", {
      eager: true,
      query: "?raw",
      import: "default",
    }) as Record<string, string>;
    for (const [file, text] of Object.entries(files)) {
      expect(text, file).not.toMatch(/session\.project\.clips\s*=/);
      expect(text, file).not.toMatch(/AIProject|AICommandBus/);
      expect(text, file).not.toMatch(/frame-engine|src\/core\/exporter/);
    }
    const host = Object.entries(files).find(([file]) => file.endsWith("host.ts"))?.[1] ?? "";
    expect(host).toContain("applyCommandTransaction");
    expect(host).not.toContain("parseGoldenMovePrompt");
    expect(host).not.toContain("applyMove(");
    expect(host).not.toContain("nudgeClip");
  });
});
