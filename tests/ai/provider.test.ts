import { describe, expect, it, vi } from "vitest";
import { buildSendContext } from "../../src/app/ai/context";
import { runDirectorTurn } from "../../src/app/ai/loop";
import { createMockProvider, mockIntent } from "../../src/app/ai/providers/mock";
import {
  createOpenAiCompatibleProvider,
  validateProviderTarget,
} from "../../src/app/ai/providers/openai-compatible";
import { AI_PREFS_KEY, readAiPrefs, writeAiPrefs } from "../../src/app/ai/providers/prefs";
import type { AIProvider, ProviderRequest } from "../../src/app/ai/providers/types";
import { createSession, type Session } from "../../src/app/session";
import { FRAME_MS } from "../../src/core/models";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

function sessionAt(): Session {
  const base = createSession(createMemoryBlobStore());
  return {
    ...base,
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
    project: {
      ...projectWith(
        [clip({ id: "c1", assetId: "a", trackId: "A1", startMs: 30000, durationMs: 8000 })],
        [
          asset({
            id: "a",
            kind: "audio",
            name: "SECRET-vocals.wav",
            sourcePath: "/home/secret/SECRET-vocals.wav",
            durationMs: 60000,
          }),
        ],
      ),
      snap: true,
      markers: [{ id: "mk_1", timeMs: 1000, label: "SECRET chorus" }],
      tracks: base.project.tracks,
    },
  };
}

function fixedSession(): Session {
  const session = sessionAt();
  return {
    ...session,
    project: {
      ...session.project,
      tracks: session.project.tracks.map((track) =>
        track.id === "A1" ? { ...track, name: "SECRET-Vocals" } : track,
      ),
    },
  };
}

describe("AI-5 mock provider", () => {
  it("turns the German +2s sentence into an exact move and does not call fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const session = fixedSession();
    const before = structuredClone(session.project);
    const seen: { request: ProviderRequest | null } = { request: null };
    const inner = createMockProvider();
    const provider: AIProvider = {
      id: "mock",
      complete(request) {
        seen.request = request;
        return inner.complete(request);
      },
    };
    const turn = await runDirectorTurn({
      session,
      prompt: "Verschiebe den markierten Clip exakt zwei Sekunden nach rechts",
      provider,
    });
    expect(turn.transaction?.command).toEqual({ type: "moveClips", clipIds: ["c1"], deltaMs: 2000 });
    expect(turn.transaction?.status).toBe("proposed");
    expect(seen.request?.context).toBeNull();
    expect(JSON.stringify(seen.request)).not.toContain("SECRET");
    expect(session.project).toEqual(before);
    expect(session.history.past).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("treats Überblendungen as a transition request", () => {
    const markers = JSON.stringify({ ok: true, data: [{ id: "m", timeMs: 400 }] });
    const blended = mockIntent([
      { role: "user", content: "Schneide an den Beats und füge Überblendungen hinzu" },
      { role: "tool", content: markers, toolCallId: "m" },
    ]);
    expect(blended.toolCalls[0]?.name).toBe("timeline.split_at_markers");
    expect(blended.toolCalls[0]?.arguments).toEqual({ includeTransitions: true });
    const passages = mockIntent([
      { role: "user", content: "Schneide an den Beats und füge Übergänge hinzu" },
      { role: "tool", content: markers, toolCallId: "m" },
    ]);
    expect(passages.toolCalls[0]?.arguments).toEqual({ includeTransitions: true });
    const plain = mockIntent([
      { role: "user", content: "Schneide an den Beats" },
      { role: "tool", content: markers, toolCallId: "m" },
    ]);
    expect(plain.toolCalls[0]?.arguments).toEqual({ includeTransitions: false });
  });

  it("asks for markers before a beat cut and refuses when none exist", async () => {
    const first = mockIntent([
      { role: "user", content: "Schneide den Song an den Beats und füge Transitions ein" },
    ]);
    expect(first.toolCalls.map((call) => call.name)).toEqual(["get_markers"]);
    expect(first.text).toMatch(/not analyzed/i);
    expect(first.text).not.toMatch(/\b120\b/);
    const empty = mockIntent([
      { role: "user", content: "Schneide den Song an den Beats und füge Transitions ein" },
      { role: "tool", content: JSON.stringify({ ok: true, data: [] }), toolCallId: "m" },
    ]);
    expect(empty.toolCalls).toEqual([]);
    expect(empty.text).toMatch(/No beat or marker data/);
    expect(empty.text).toMatch(/not analyzed audio/i);
    expect(empty.text).not.toMatch(/\b120\b/);

    const session = fixedSession();
    session.project = { ...session.project, markers: [] };
    const turn = await runDirectorTurn({
      session,
      prompt: "Schneide den Song an den Beats und füge Transitions ein",
    });
    expect(turn.transaction).toBeNull();
    expect(turn.text).toMatch(/No beat or marker data/);
    expect(session.history.past).toHaveLength(0);
  });

  it("reads markers locally and stops", async () => {
    const session = fixedSession();
    const turn = await runDirectorTurn({ session, prompt: "Welche Marker gibt es?" });
    expect(turn.transaction).toBeNull();
    expect(turn.text).toMatch(/Read complete/);
    expect(turn.text).not.toContain("SECRET");
    expect(session.history.past).toHaveLength(0);
  });

  it("refuses two mutations in one turn", async () => {
    const session = fixedSession();
    const provider: AIProvider = {
      id: "mock",
      async *complete() {
        yield {
          type: "done",
          text: "",
          toolCalls: [
            { id: "a", name: "timeline.move_clip", arguments: { deltaMs: 2000 } },
            { id: "b", name: "timeline.lift_delete", arguments: {} },
          ],
        };
      },
    };
    const turn = await runDirectorTurn({ session, prompt: "both", provider });
    expect(turn.transaction).toBeNull();
    expect(turn.text).toMatch(/One edit per proposal/);
    expect(session.history.past).toHaveLength(0);
  });

  it("plans a nudge with the frame delta", () => {
    const intent = mockIntent([{ role: "user", content: "nudge one frame right" }]);
    expect(intent.toolCalls[0]).toMatchObject({ name: "timeline.nudge", arguments: { deltaMs: FRAME_MS } });
  });
});

describe("AI-5 provider gate", () => {
  it("stores no API key in prefs", () => {
    const data: Record<string, string> = {};
    const storage = {
      getItem: (key: string) => data[key] ?? null,
      setItem: (key: string, value: string) => {
        data[key] = value;
      },
    };
    storage.setItem(AI_PREFS_KEY, JSON.stringify({ provider: "cloud", baseUrl: "https://example.com/v1", model: "m", apiKey: "super-secret" }));
    const prefs = readAiPrefs(storage);
    expect(prefs).toEqual({ provider: "cloud", baseUrl: "https://example.com/v1", model: "m", rememberKey: false });
    expect(JSON.stringify(prefs)).not.toContain("super-secret");
    writeAiPrefs(prefs, storage);
    expect(storage.getItem(AI_PREFS_KEY)).not.toContain("super-secret");
    expect(storage.getItem(AI_PREFS_KEY)).not.toContain("apiKey");
  });

  it("fails closed without sending when the cloud key or URL is missing", async () => {
    const fetchSpy = vi.fn();
    expect(validateProviderTarget({ baseUrl: "https://example.com/v1", model: "m" })).toMatchObject({ ok: false });
    expect(validateProviderTarget({ baseUrl: "http://example.com/v1", model: "m", apiKey: "k" })).toMatchObject({
      ok: false,
    });
    expect(validateProviderTarget({ baseUrl: "http://127.0.0.1:11434/v1", model: "local" })).toMatchObject({
      ok: true,
      local: true,
    });
    expect(
      validateProviderTarget({
        baseUrl: "https://example.com/v1",
        model: "m",
        desktop: { invoke: async () => ({}), useKeychain: true },
      }),
    ).toMatchObject({ ok: true, local: false });
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://example.com/v1",
      model: "m",
      fetchImpl: fetchSpy,
    });
    const turn = await runDirectorTurn({ session: fixedSession(), prompt: "hello", provider });
    expect(turn.transaction).toBeNull();
    expect(turn.text).toMatch(/Nothing was sent/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("streams a tool call and sends structure without paths or the key in the body", async () => {
    const session = fixedSession();
    const encoder = new TextEncoder();
    const sse = [
      'data: {"choices":[{"delta":{"content":"Ok"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"timeline.move_clip","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"deltaMs\\":2000}"}}]}}]}\n\n',
      "data: [DONE]\n\n",
    ].join("");
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = String(init?.body ?? "");
      expect(body).toContain("SECRET-Vocals");
      expect(body).toContain("SECRET chorus");
      expect(body).not.toContain("SECRET-vocals.wav");
      expect(body).not.toContain("/home/secret");
      expect(body).not.toContain("runtime-key");
      expect(body).toContain("SEND_STRUCTURE");
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer runtime-key");
      expect(init?.redirect).toBe("error");
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(sse));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://example.com/v1",
      model: "m",
      apiKey: "runtime-key",
      fetchImpl,
    });
    const deltas: string[] = [];
    const turn = await runDirectorTurn({
      session,
      prompt: "move",
      provider,
      onDelta: (chunk) => deltas.push(chunk),
    });
    expect(deltas).toEqual(["Ok"]);
    expect(turn.transaction?.command).toEqual({ type: "moveClips", clipIds: ["c1"], deltaMs: 2000 });
    expect(session.history.past).toHaveLength(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks Ollama on loopback through the desktop command without a key", async () => {
    const sse = ['data: {"choices":[{"delta":{"content":"local-ok"}}]}\n', "data: [DONE]\n"].join("\n");
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      expect(command).toBe("ai_chat");
      expect(args?.sessionKey).toBeNull();
      expect(args?.baseUrl).toBe("http://127.0.0.1:11434/v1");
      expect(args?.shownBaseUrl).toBe("http://127.0.0.1:11434/v1");
      expect(JSON.stringify(args)).not.toContain("Authorization");
      expect(JSON.stringify(args?.messages)).not.toContain("runtime-key");
      return { status: 200, body: sse };
    });
    const fetchImpl = vi.fn();
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      desktop: { invoke, useKeychain: false },
    });
    const turn = await runDirectorTurn({ session: fixedSession(), prompt: "hello", provider });
    expect(turn.text).toContain("local-ok");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes a session key only to the desktop command and does not store it", async () => {
    const commands: string[] = [];
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      commands.push(command);
      expect(args?.sessionKey).toBe("runtime-key");
      expect(args?.shownBaseUrl).toBe("https://example.com/v1");
      expect(args?.baseUrl).toBe(args?.shownBaseUrl);
      expect(JSON.stringify(args?.messages)).not.toContain("runtime-key");
      expect(command).not.toBe("ai_keychain_set");
      expect(command).not.toBe("ai_keychain_get");
      return { status: 200, body: 'data: {"choices":[{"delta":{"content":"cloud-ok"}}]}\n\ndata: [DONE]\n' };
    });
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://example.com/v1",
      model: "m",
      apiKey: "runtime-key",
      desktop: { invoke, useKeychain: false },
    });
    const turn = await runDirectorTurn({ session: fixedSession(), prompt: "hello", provider });
    expect(turn.text).toContain("cloud-ok");
    expect(commands).toEqual(["ai_chat"]);
  });

  it("does not put a saved key in the webview when the desktop shell reads the keychain", async () => {
    const invoke = vi.fn(async (_command: string, args?: Record<string, unknown>) => {
      expect(args?.sessionKey).toBeNull();
      expect(JSON.stringify(args)).not.toContain("Bearer");
      expect(JSON.stringify(args)).not.toContain("stored-cloud-key");
      return { status: 200, body: 'data: {"choices":[{"delta":{"content":"saved"}}]}\n\ndata: [DONE]\n' };
    });
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "https://example.com/v1",
      model: "m",
      desktop: { invoke, useKeychain: true },
    });
    const turn = await runDirectorTurn({ session: fixedSession(), prompt: "hello", provider });
    expect(turn.text).toContain("saved");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("includes project, track, and marker names and still omits paths and media", () => {
    const context = buildSendContext(fixedSession());
    const encoded = JSON.stringify(context);
    expect(context?.privacy).toBe("SEND_STRUCTURE");
    expect(context?.includesNames).toBe(true);
    expect(context?.project.name).toBe("Test");
    expect(encoded).toContain("SECRET-Vocals");
    expect(encoded).toContain("SECRET chorus");
    expect(encoded).not.toContain("SECRET-vocals.wav");
    expect(encoded).not.toContain("/home/secret");
    expect(encoded).not.toContain("blob:");
    expect(encoded).toContain("c1");
    expect(encoded).toContain("30000");
  });
});
