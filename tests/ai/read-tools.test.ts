import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCommand } from "../../src/app/commands";
import { createSession, type Session } from "../../src/app/session";
import { createMemoryBlobStore } from "../../src/core/persistence";
import { callReadTool } from "../../src/app/ai/tools/registry";
import { asset, clip, projectWith } from "../helpers";

function sessionWith(): Session {
  const session = createSession(createMemoryBlobStore());
  return {
    ...session,
    selectedClipId: "c1",
    selectedClipIds: ["c1"],
    project: projectWith(
      [
        clip({
          id: "c1",
          assetId: "secret-asset",
          trackId: "A1",
          startMs: 30000,
          durationMs: 8000,
          linkId: "link_1",
        }),
        clip({ id: "c2", assetId: "secret-asset", trackId: "V1", startMs: 30000, durationMs: 8000, linkId: "link_1" }),
      ],
      [
        asset({
          id: "secret-asset",
          kind: "audio",
          name: "SECRET-vocals.wav",
          sourcePath: "/home/secret/SECRET-vocals.wav",
          durationMs: 60000,
        }),
      ],
    ),
  };
}

function withNamedTracks(session: Session): Session {
  return {
    ...session,
    project: {
      ...session.project,
      markers: [
        { id: "mk_b", timeMs: 2000, label: "SECRET chorus" },
        { id: "mk_a", timeMs: 500, label: "intro" },
      ],
      tracks: session.project.tracks.map((track) =>
        track.id === "A1" ? { ...track, name: "SECRET-Vocals" } : track,
      ),
    },
  };
}

describe("AI-2 read tools", () => {
  it("reads a structure summary and leaves the session unchanged", () => {
    const session = withNamedTracks(sessionWith());
    const before = structuredClone(session.project);
    const past = session.history.past.length;
    const summary = callReadTool(session, "get_project_summary");
    expect(summary.ok).toBe(true);
    if (!summary.ok) return;
    expect(summary.data).toMatchObject({
      schemaVersion: 5,
      clipCount: 2,
      markerCount: 2,
      snap: true,
      playheadMs: 0,
    });
    expect(session.project).toEqual(before);
    expect(session.history.past).toHaveLength(past);
    const encoded = JSON.stringify(summary.data);
    expect(encoded).not.toContain("SECRET");
    expect(encoded).not.toContain("sourcePath");
    expect(encoded).not.toContain("/home/secret");
  });

  it("returns selection, playhead, markers, and audio tracks without labels or names", () => {
    const session = withNamedTracks(sessionWith());
    session.project.playheadMs = 1250;
    const selection = callReadTool(session, "get_selection");
    const playhead = callReadTool(session, "get_playhead");
    const markers = callReadTool(session, "get_markers");
    const tracks = callReadTool(session, "list_audio_tracks");
    expect(selection).toMatchObject({
      ok: true,
      data: { clipIds: ["c1"], primaryClipId: "c1", trackIds: ["A1"] },
    });
    expect(playhead).toEqual({ ok: true, data: { playheadMs: 1250, playing: false, shuttleRate: 0 } });
    expect(markers).toEqual({
      ok: true,
      data: [
        { id: "mk_a", timeMs: 500 },
        { id: "mk_b", timeMs: 2000 },
      ],
    });
    expect(tracks.ok).toBe(true);
    if (!tracks.ok) return;
    const rows = tracks.data as { id: string }[];
    expect(rows.map((row) => row.id)).toContain("A1");
    expect(JSON.stringify(tracks.data)).not.toContain("SECRET");
    expect(JSON.stringify(markers)).not.toContain("chorus");
  });

  it("lists clips on a real track id and rejects display names", () => {
    const session = withNamedTracks(sessionWith());
    const clips = callReadTool(session, "get_clips_on_track", { trackId: "A1" });
    expect(clips).toMatchObject({
      ok: true,
      data: [{ id: "c1", trackId: "A1", startMs: 30000, durationMs: 8000, linkId: "link_1" }],
    });
    expect(JSON.stringify(clips)).not.toContain("secret-asset");
    expect(callReadTool(session, "get_clips_on_track", { trackId: "SECRET-Vocals" })).toEqual({
      ok: false,
      code: "TRACK_NOT_FOUND",
      error: "Track not found",
    });
    expect(callReadTool(session, "get_clips_on_track", { trackId: "A3" })).toMatchObject({
      ok: false,
      code: "TRACK_NOT_FOUND",
    });
    expect(callReadTool(session, "get_clips_on_track", {})).toMatchObject({
      ok: false,
      code: "SCHEMA_INVALID",
    });
    expect(callReadTool(session, "timeline.move_clip")).toEqual({
      ok: false,
      code: "UNKNOWN_TOOL",
      error: "Unknown tool",
    });
    expect(session.history.past).toHaveLength(0);
  });

  it("does not change history when a human command would", () => {
    const session = sessionWith();
    callReadTool(session, "get_project_summary");
    const moved = applyCommand(session, { type: "moveClips", clipIds: ["c1"], deltaMs: 2000 });
    expect(moved.project.clips.find((c) => c.id === "c1")?.startMs).toBe(32000);
    expect(session.project.clips.find((c) => c.id === "c1")?.startMs).toBe(30000);
  });
});

describe("AI source boundary", () => {
  it("keeps provider and frame-engine imports out of the AI tree so far", () => {
    const root = join(process.cwd(), "src/app/ai");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.endsWith(".ts") || path.endsWith(".tsx")) files.push(path);
      }
    };
    walk(root);
    const source = files.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toContain("frame-engine");
    expect(source).not.toContain("sk-");
    expect(source).not.toMatch(/api[_-]?key\s*[:=]\s*["'][^"']+["']/i);
  });
});
