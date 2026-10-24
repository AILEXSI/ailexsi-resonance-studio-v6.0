import { describe, expect, it, vi } from "vitest";
import { detectBeatsFromPcm } from "../../src/app/ai/audio/beats";
import type { MixPcm } from "../../src/core/visualz/feature-extractor";
import { DIRECTOR_TOOL_SPECS, runDirectorTurn } from "../../src/app/ai/loop";
import { acceptTransaction } from "../../src/app/ai/transactions";
import {
  createOpenAiCompatibleProvider,
  parseTextToolCalls,
} from "../../src/app/ai/providers/openai-compatible";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { asset, clip, projectWith } from "../helpers";

const ALLOWED = DIRECTOR_TOOL_SPECS.map((tool) => tool.name);

function clicks(timesMs: number[], durationMs: number, sampleRate = 44100): MixPcm {
  const length = Math.round((durationMs / 1000) * sampleRate);
  const data = new Float32Array(length);
  const burst = Math.round(0.012 * sampleRate);
  for (const time of timesMs) {
    const at = Math.round((time / 1000) * sampleRate);
    for (let index = 0; index < burst && at + index < length; index += 1) data[at + index] = 0.9;
  }
  return { sampleRate, length, numberOfChannels: 1, getChannelData: () => data };
}

describe("text tool-call parser", () => {
  it("reads a JSON array, a JSON object, fences, and tool_call tags", () => {
    const array = parseTextToolCalls(
      '[{"name":"audio.detect_beats","arguments":{"clipIds":["clip_v"]}}]',
      ALLOWED,
    );
    expect(array).toEqual([
      { id: "audio.detect_beats", name: "audio.detect_beats", arguments: { clipIds: ["clip_v"] } },
    ]);
    const object = parseTextToolCalls('{"name":"get_markers","arguments":{}}', ALLOWED);
    expect(object.map((call) => call.name)).toEqual(["get_markers"]);
    const fenced = parseTextToolCalls(
      'Sure\n```json\n{"name":"timeline.move_clip","arguments":{"deltaMs":5000}}\n```',
      ALLOWED,
    );
    expect(fenced[0]?.arguments).toEqual({ deltaMs: 5000 });
    const tagged = parseTextToolCalls(
      '<tool_call>{"name":"audio.detect_beats","arguments":"{\\"clipId\\":\\"c1\\"}"}</tool_call>',
      ALLOWED,
    );
    expect(tagged[0]?.arguments).toEqual({ clipId: "c1" });
    const nested = parseTextToolCalls(
      '{"function":{"name":"get_playhead","arguments":{}}}',
      ALLOWED,
    );
    expect(nested.map((call) => call.name)).toEqual(["get_playhead"]);
  });

  it("drops unknown tools and ignores prose", () => {
    expect(parseTextToolCalls('[{"name":"shell","arguments":{}}]', ALLOWED)).toEqual([]);
    expect(parseTextToolCalls("analyse beat and propose cuepoints", ALLOWED)).toEqual([]);
    const mixed = parseTextToolCalls(
      '[{"name":"shell","arguments":{}},{"name":"audio.detect_beats","arguments":{}}]',
      ALLOWED,
    );
    expect(mixed.map((call) => call.name)).toEqual(["audio.detect_beats"]);
    expect(parseTextToolCalls('{"name":"audio.detect_beats","arguments":"not-json"}', ALLOWED)).toEqual([]);
  });
});

function song(selected: "video" | "audio" | "none"): Session {
  const base = createSession(createMemoryBlobStore());
  const clips = [
    clip({ id: "clip_v", assetId: "vid", trackId: "V1", startMs: 0, durationMs: 2500 }),
    clip({ id: "clip_a", assetId: "aud", trackId: "A1", startMs: 0, durationMs: 2500 }),
  ];
  const session: Session = {
    ...base,
    selectedClipId: selected === "video" ? "clip_v" : selected === "audio" ? "clip_a" : null,
    selectedClipIds: selected === "video" ? ["clip_v"] : selected === "audio" ? ["clip_a"] : [],
    project: {
      ...projectWith(clips, [
        asset({ id: "vid", kind: "video", name: "picture.mp4", durationMs: 2500, objectUrl: "blob:video" }),
        asset({
          id: "aud",
          kind: "audio",
          name: "song.wav",
          sourcePath: "/tmp/secret-song.wav",
          durationMs: 2500,
          objectUrl: "blob:song",
        }),
      ]),
      snap: true,
      name: "Song",
    },
  };
  return session;
}

function sse(content: string): string {
  const payload = JSON.stringify({ choices: [{ delta: { content } }] });
  return `data: ${payload}\n\ndata: [DONE]\n\n`;
}

describe("Ollama JSON tool text", () => {
  it("turns a content-only detect_beats array into one marker proposal", async () => {
    const fetchSpy = vi.fn(async () => {
      const body = sse('[{"name":"audio.detect_beats","arguments":{"clipIds":["clip_v"]}}]');
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
      return new Response(stream, { status: 200 });
    });
    const session = song("video");
    const pcm = clicks([400, 900, 1400, 1900], 2500);
    const decoded: string[] = [];
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      fetchImpl: fetchSpy,
    });
    const turn = await runDirectorTurn({
      session,
      prompt: "analyse beat and propose cuepoints",
      provider,
      decodeClip: async (url) => {
        decoded.push(url);
        return pcm;
      },
    });
    expect(decoded).toEqual(["blob:song"]);
    expect(turn.transaction?.tool).toBe("audio.detect_beats");
    expect(turn.transaction?.status).toBe("proposed");
    expect(turn.text).toMatch(/clip_v is video/);
    expect(turn.text).toMatch(/A1 \(clip_a/);
    expect(turn.text).not.toContain("/tmp/secret");
    expect(turn.text).not.toMatch(/\b120\b/);
    expect(session.project.markers).toHaveLength(0);
    expect(session.history.past).toHaveLength(0);
    if (!turn.transaction) throw new Error("expected proposal");
    const accepted = acceptTransaction(session, turn.transaction);
    expect(accepted.error).toBeUndefined();
    expect(accepted.session.history.past).toHaveLength(1);
    expect(accepted.session.project.schemaVersion).toBe(5);
    expect(accepted.session.project.markers.map((marker) => marker.timeMs).sort((a, b) => a - b)).toEqual([
      400, 900, 1400, 1900,
    ]);
    const undone = applyCommand(accepted.session, { type: "undo" });
    expect(undone.project.markers).toHaveLength(0);
    const analysis = detectBeatsFromPcm(pcm, { sourceInMs: 0, sourceOutMs: 2500, timelineStartMs: 0, rate: 1 });
    expect(analysis.events).toHaveLength(4);
  });

  it("does not measure a video clip when A1 has no audio", async () => {
    const base = createSession(createMemoryBlobStore());
    const session: Session = {
      ...base,
      selectedClipId: "clip_v",
      selectedClipIds: ["clip_v"],
      project: projectWith(
        [clip({ id: "clip_v", assetId: "vid", trackId: "V1", startMs: 0, durationMs: 2500 })],
        [asset({ id: "vid", kind: "video", durationMs: 2500, objectUrl: "blob:video" })],
      ),
    };
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      fetchImpl: async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse('[{"name":"audio.detect_beats","arguments":{"clipIds":["clip_v"]}}]')));
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      },
    });
    let decoded = false;
    const turn = await runDirectorTurn({
      session,
      prompt: "analyse beat and propose cuepoints",
      provider,
      decodeClip: async () => {
        decoded = true;
        throw new Error("should not decode");
      },
    });
    expect(decoded).toBe(false);
    expect(turn.transaction).toBeNull();
    expect(turn.text).toMatch(/No audio in this project/);
    expect(session.history.past).toHaveLength(0);
  });

  it("reports a video clip when A1 exists but has no audio clip", async () => {
    const base = createSession(createMemoryBlobStore());
    const session: Session = {
      ...base,
      project: {
        ...projectWith(
          [
            clip({ id: "clip_v", assetId: "vid", trackId: "V1", startMs: 0, durationMs: 2500 }),
            clip({ id: "clip_a", assetId: "aud", trackId: "A2", startMs: 0, durationMs: 2500 }),
          ],
          [
            asset({ id: "vid", kind: "video", objectUrl: "blob:video", durationMs: 2500 }),
            asset({ id: "aud", kind: "audio", objectUrl: "blob:a2", durationMs: 2500 }),
          ],
        ),
      },
    };
    const provider = createOpenAiCompatibleProvider({
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "qwen2.5:7b",
      fetchImpl: async () => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(sse('[{"name":"audio.detect_beats","arguments":{"clipIds":["clip_v"]}}]')),
            );
            controller.close();
          },
        });
        return new Response(stream, { status: 200 });
      },
    });
    const turn = await runDirectorTurn({
      session,
      prompt: "analyse beat",
      provider,
      decodeClip: async () => {
        throw new Error("should not decode");
      },
    });
    expect(turn.transaction).toBeNull();
    expect(turn.text).toMatch(/Clip clip_v is video/);
    expect(turn.text).toMatch(/A1 has no audio clip/);
  });
});
