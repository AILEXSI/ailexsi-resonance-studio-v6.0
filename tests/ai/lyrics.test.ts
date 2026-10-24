import { describe, expect, it } from "vitest";
import { createSession } from "../../src/app/session";
import { acceptLyricSidecar } from "../../src/app/ai/transactions";
import { runDirectorTurn } from "../../src/app/ai/loop";
import type { AIProvider, ProviderEvent } from "../../src/app/ai/providers/types";
import { alignLyrics, applyWhisperTimes, segmentsFromWhisperJson, stampOf } from "../../src/app/ai/lyrics/align";
import { clearLegacyWhisperPaths, whisperStatusFrom } from "../../src/app/ai/lyrics/whisper-config";
import { proposeLyricScenes, sceneForLine } from "../../src/app/ai/lyrics/scenes";
import { createLyricSidecar, parseLyricSidecar } from "../../src/app/ai/lyrics/sidecar";
import { deserializeProject, PROJECT_SCHEMA_VERSION } from "../../src/core/project";

function lyricProvider(): AIProvider {
  return {
    id: "mock",
    async *complete(): AsyncIterable<ProviderEvent> {
      yield {
        type: "done",
        text: "",
        toolCalls: [{ id: "1", name: "lyrics.suggest_scenes", arguments: { text: "ignored by the host text" } }],
      };
    },
  };
}

describe("AI-7 lyric sidecar", () => {
  it("keeps project schemaVersion 5 and refuses to load the sidecar as a project", () => {
    const session = createSession();
    const sidecar = createLyricSidecar(session.project.id, "Nacht über dem Meer\nFeuer in der Stadt");
    expect(sidecar.projectSchemaVersion).toBe(5);
    expect(session.project.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
    expect(() => deserializeProject(JSON.stringify(sidecar))).toThrow(/schemaVersion/);
    expect(parseLyricSidecar(JSON.stringify(sidecar), session.project.id)?.lines).toHaveLength(2);
  });

  it("proposes a catalog scene per line and Accept does not push history", async () => {
    const session = createSession();
    const before = session.history.past.length;
    const turn = await runDirectorTurn({
      session,
      prompt: "suggest scenes",
      provider: lyricProvider(),
      lyricText: "Nacht über dem Meer\nFeuer in der Stadt\nhello there",
    });
    expect(turn.transaction?.tool).toBe("lyrics.suggest_scenes");
    expect(turn.transaction?.lyricSidecar?.lines.map((line) => line.sceneId)).toEqual([
      "aurora-veil",
      "ember-rain",
      "spectrum-bars",
    ]);
    expect(turn.transaction?.lyricSidecar?.lines[2]?.text).toBe("hello there");
    expect(turn.transaction?.lyricSidecar?.lines[0]?.imagePrompt).toContain("Nacht über dem Meer");
    const accepted = acceptLyricSidecar(session, turn.transaction!);
    expect(accepted.error).toBeUndefined();
    expect(accepted.session).toBe(session);
    expect(accepted.session.history.past).toHaveLength(before);
    expect(accepted.session.project).toBe(session.project);
    expect(sceneForLine("Liebe")).toMatchObject({ sceneId: "pulse-orb" });
  });

  it("says so when whisper.cpp is not configured and does not rewrite words", async () => {
    const lines = [{ text: "Meine eigene Zeile", startMs: null, endMs: null, sceneId: null, imagePrompt: null, reason: null }];
    const missing = await alignLyrics({ lines, configured: false, audioPath: null, tauri: false });
    expect(missing.alignment.status).toBe("unavailable");
    expect(missing.alignment.message).toContain("not configured");
    expect(missing.alignment.message).toContain("Nothing was sent");
    expect(missing.lines[0]?.text).toBe("Meine eigene Zeile");

    expect(stampOf("00:01:02,250")).toBe(62_250);
    const parsed = segmentsFromWhisperJson(
      JSON.stringify({
        transcription: [
          { offsets: { from: 0, to: 1200 }, text: "wrong spelling" },
          { timestamps: { from: "00:00:01,200", to: "00:00:02,000" }, text: "also wrong" },
        ],
      }),
    );
    const placed = applyWhisperTimes(
      [
        { text: "Zeile eins", startMs: null, endMs: null, sceneId: null, imagePrompt: null, reason: null },
        { text: "Zeile zwei", startMs: null, endMs: null, sceneId: null, imagePrompt: null, reason: null },
        { text: "Zeile drei", startMs: null, endMs: null, sceneId: null, imagePrompt: null, reason: null },
      ],
      parsed,
    );
    expect(placed.lines.map((line) => line.text)).toEqual(["Zeile eins", "Zeile zwei", "Zeile drei"]);
    expect(placed.lines[0]?.startMs).toBe(0);
    expect(placed.lines[1]?.startMs).toBe(1200);
    expect(placed.lines[2]?.startMs).toBeNull();
    expect(placed.alignment.status).toBe("partial");
    expect(placed.alignment.message).toContain("3");
  });

  it("aligns with the audio file only and drops legacy path storage", async () => {
    let payload: { command: string; args: { audioPath: string } } | null = null;
    const lines = [{ text: "Zeile eins", startMs: null, endMs: null, sceneId: null, imagePrompt: null, reason: null }];
    const aligned = await alignLyrics({
      lines,
      configured: true,
      audioPath: "/media/song.wav",
      invoke: async (command, args) => {
        payload = { command, args };
        return JSON.stringify({ transcription: [{ offsets: { from: 0, to: 800 }, text: "ignored" }] });
      },
    });
    expect(payload).toEqual({ command: "lyrics_whisper_align", args: { audioPath: "/media/song.wav" } });
    expect(JSON.stringify(payload)).not.toContain("executable");
    expect(JSON.stringify(payload)).not.toContain("model");
    expect(aligned.lines[0]?.text).toBe("Zeile eins");
    expect(aligned.lines[0]?.startMs).toBe(0);
    const removed: string[] = [];
    clearLegacyWhisperPaths({
      removeItem(key) {
        removed.push(key);
      },
    });
    expect(removed).toEqual(["resonance-studio-v6-0-whisper-cpp"]);
    expect(whisperStatusFrom({ executableName: "main", modelName: "ggml.bin", configured: true })).toEqual({
      executableName: "main",
      modelName: "ggml.bin",
      configured: true,
      message: "",
    });
    expect(whisperStatusFrom({ executable: "/tmp/secret/main", model: "/tmp/secret/ggml.bin" })).toEqual({
      executableName: "",
      modelName: "",
      configured: false,
      message: "",
    });
    const sealed = await alignLyrics({
      lines,
      configured: false,
      unavailableMessage:
        "The whisper.cpp choice was changed outside the file dialog. Choose the executable and model again. Nothing was started.",
      audioPath: "/media/song.wav",
      invoke: async () => {
        throw new Error("whisper should not start");
      },
    });
    expect(sealed.alignment.message).toContain("file dialog");
    expect(sealed.alignment.message).toContain("Nothing was started");
    expect(sealed.lines[0]?.text).toBe("Zeile eins");
  });

  it("does not invent a proposal when no lyrics were pasted", () => {
    const session = createSession();
    const proposed = proposeLyricScenes(session, "", {});
    expect(proposed.transaction).toBeNull();
    expect(proposed.text).toContain("Paste lyrics first");
  });
});
