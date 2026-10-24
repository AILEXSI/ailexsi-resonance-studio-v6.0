import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyFile, importMediaFile } from "../../src/core/media";
import { createEmptyProject } from "../../src/core/project";
import { placeAsset, splitClipAt } from "../../src/core/timeline";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const videoPath = join(fixturesDir, "user-video.mp4");
const audioPath = join(fixturesDir, "user-audio.mp3");
const USER_FIXTURES = existsSync(videoPath) && existsSync(audioPath);

function ffprobeOnPath(): boolean {
  try {
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const FFPROBE = ffprobeOnPath();

function fileFromDisk(path: string, name: string, type: string): File {
  const buf = readFileSync(path);
  return new File([buf], name, { type });
}

function ffprobeDurationMs(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
    { encoding: "utf8" },
  );
  return Math.round(Number(out.trim()) * 1000);
}

describe.skipIf(!USER_FIXTURES)(
  USER_FIXTURES
    ? "user fixtures video + mp3"
    : "user fixtures skipped: tests/fixtures/user-video.mp4 or user-audio.mp3 missing",
  () => {
  it("both files exist and classify correctly", () => {
    const video = fileFromDisk(videoPath, "user-video.mp4", "video/mp4");
    const audio = fileFromDisk(audioPath, "user-audio.mp3", "audio/mpeg");
    expect(video.size).toBeGreaterThan(1000);
    expect(audio.size).toBeGreaterThan(1000);
    expect(classifyFile(video)).toBe("video");
    expect(classifyFile(audio)).toBe("audio");
    expect(readFileSync(videoPath).subarray(4, 8).toString("ascii")).toBe("ftyp");
    expect(readFileSync(audioPath).subarray(0, 3).toString("ascii")).toBe("ID3");
  });

  it.skipIf(!FFPROBE)(
    FFPROBE
      ? "imports video to V1 and mp3 to A1 then splits video"
      : "user fixtures skipped: ffprobe is not on PATH",
    async () => {
    const videoFile = fileFromDisk(videoPath, "user-video.mp4", "video/mp4");
    const audioFile = fileFromDisk(audioPath, "user-audio.mp3", "audio/mpeg");
    const videoMs = ffprobeDurationMs(videoPath);
    const audioMs = ffprobeDurationMs(audioPath);
    expect(videoMs).toBeGreaterThan(4000);
    expect(audioMs).toBeGreaterThan(4000);

    const video = await importMediaFile(videoFile, async () => ({
      durationMs: videoMs,
      width: 832,
      height: 464,
    }));
    const audio = await importMediaFile(audioFile, async () => ({ durationMs: audioMs }));

    let project = createEmptyProject("User fixtures");
    project = { ...project, assets: [video, audio] };

    const vPlace = placeAsset(project, video.id, "V1", 0);
    expect(vPlace.error).toBeUndefined();
    project = vPlace.project;
    const aPlace = placeAsset(project, audio.id, "A1", 0);
    expect(aPlace.error).toBeUndefined();
    project = aPlace.project;

    expect(project.clips).toHaveLength(2);
    expect(project.clips.find((c) => c.trackId === "V1")?.durationMs).toBe(videoMs);
    expect(project.clips.find((c) => c.trackId === "A1")?.durationMs).toBe(audioMs);

    const split = splitClipAt(project, vPlace.clip!.id, 2000);
    expect(split.error).toBeUndefined();
    expect(split.project.clips.filter((c) => c.trackId === "V1")).toHaveLength(2);
    expect(split.project.clips.filter((c) => c.trackId === "A1")).toHaveLength(1);
  });
});
