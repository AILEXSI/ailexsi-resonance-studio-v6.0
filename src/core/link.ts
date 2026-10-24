import { createId } from "./ids";
import {
  assetById,
  audioTrackIdsOf,
  clipById,
  clipEndMs,
  clipIsEnabled,
  clipIsLocked,
  isTrackAudible,
  kindOfTrack,
  type Clip,
  type Project,
  type TrackId,
} from "./models";

export function livingLinkedMate(project: Project, clipId: string): Clip | undefined {
  const clip = clipById(project, clipId);
  if (!clip?.linkId) return undefined;
  return project.clips.find((c) => c.id !== clip.id && c.linkId === clip.linkId);
}

/**
 * Living mate that may take the same relocate/trim/split. Locked and
 * disabled mates stay parked (same as lift skip disabled mate / skip
 * locked mate). A disabled primary does not drag a living mate
 * (inverse of P141). Mix still uses livingLinkedMate (disabled A
 * silences V).
 */
export function editableLinkedMate(project: Project, clipId: string): Clip | undefined {
  const clip = clipById(project, clipId);
  if (!clip || !clipIsEnabled(clip)) return undefined;
  const mate = livingLinkedMate(project, clipId);
  if (!mate || clipIsLocked(mate) || !clipIsEnabled(mate)) return undefined;
  return mate;
}

/** First selected clip that still has a living same-`linkId` mate. */
export function firstClipIdWithLivingMate(
  project: Project,
  clipIds: readonly string[],
): string | undefined {
  for (const id of clipIds) {
    if (livingLinkedMate(project, id)) return id;
  }
  return undefined;
}

/**
 * V clip mixes its own audio unless a living linked A clip carries it.
 * When `timeMs` is set, an enabled/present A mate only suppresses V at
 * times it covers — the tail after Q/W on the soundtrack can play V audio.
 * Disabled, muted, or missing A still silences all V (P113).
 */
export function vClipMixesOwnAudio(project: Project, clip: Clip, timeMs?: number): boolean {
  if (assetById(project, clip.assetId)?.kind === "image") return false;
  if (kindOfTrack(clip.trackId) !== "video") return true;
  const mate = livingLinkedMate(project, clip.id);
  if (!mate || kindOfTrack(mate.trackId) !== "audio") return true;
  if (timeMs == null) return false;
  if (!clipIsEnabled(mate) || !isTrackAudible(project, mate.trackId)) return false;
  const asset = assetById(project, mate.assetId);
  if (!asset || asset.missing || !asset.objectUrl) return false;
  return timeMs < mate.startMs || timeMs >= clipEndMs(mate);
}

export function expandLinkedClipIds(project: Project, clipIds: readonly string[]): string[] {
  const ids = new Set(clipIds.filter(Boolean));
  for (const id of [...ids]) {
    const mate = livingLinkedMate(project, id);
    if (mate) ids.add(mate.id);
  }
  return [...ids];
}

export function rangeOverlapsClip(clip: Clip, startMs: number, durationMs: number): boolean {
  return clip.startMs < startMs + durationMs && clipEndMs(clip) > startMs;
}

/**
 * First audio lane in collection order that can hold
 * `[startMs, startMs+durationMs)` without overlapping an enabled clip.
 * Disabled takes do not occupy (same as G / lift / extract / roll-slide neighbor).
 */
export function firstFreeAudioTrack(
  project: Project,
  startMs: number,
  durationMs: number,
): TrackId | undefined {
  for (const id of audioTrackIdsOf(project)) {
    const busy = project.clips.some(
      (c) =>
        c.trackId === id && clipIsEnabled(c) && rangeOverlapsClip(c, startMs, durationMs),
    );
    if (!busy) return id;
  }
  return undefined;
}

/** Link exactly one video clip and one audio clip. Previous partners of those clips are released. */
export function linkClipPair(
  project: Project,
  clipIds: readonly string[],
): { project: Project; error?: string } {
  const found = [...new Set(clipIds)]
    .map((id) => clipById(project, id))
    .filter((c): c is Clip => c != null && clipIsEnabled(c));
  const video = found.filter((c) => kindOfTrack(c.trackId) === "video");
  const audio = found.filter((c) => kindOfTrack(c.trackId) === "audio");
  if (video.length !== 1 || audio.length !== 1 || found.length !== 2) {
    return { project, error: "Select one video clip and one audio clip" };
  }
  const picture = video[0]!;
  const sound = audio[0]!;
  if (clipIsLocked(picture) || clipIsLocked(sound)) return { project, error: "Clip is locked" };
  if (picture.linkId && picture.linkId === sound.linkId) return { project };
  const previous = new Set([picture.linkId, sound.linkId].filter((id): id is string => Boolean(id)));
  const linkId = createId("link");
  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      clips: project.clips.map((c) => {
        if (c.id === picture.id || c.id === sound.id) return { ...c, linkId };
        if (c.linkId && previous.has(c.linkId)) return { ...c, linkId: undefined };
        return c;
      }),
    },
  };
}

export function unlinkClips(
  project: Project,
  clipId: string,
): { project: Project; error?: string } {
  const clip = clipById(project, clipId);
  if (!clip) return { project, error: "Clip not found" };
  if (!clip.linkId) return { project };
  const linkId = clip.linkId;
  return {
    project: {
      ...project,
      updatedAt: new Date().toISOString(),
      clips: project.clips.map((c) => (c.linkId === linkId ? { ...c, linkId: undefined } : c)),
    },
  };
}

/** After paste: pairs that are both present get a new linkId; orphans lose linkId. */
export function remapPastedLinkIds(clips: readonly Clip[]): Clip[] {
  const groups = new Map<string, number>();
  for (const c of clips) {
    if (!c.linkId) continue;
    groups.set(c.linkId, (groups.get(c.linkId) ?? 0) + 1);
  }
  const nextLink = new Map<string, string | undefined>();
  for (const [old, n] of groups) {
    nextLink.set(old, n >= 2 ? createId("link") : undefined);
  }
  return clips.map((c) => {
    if (!c.linkId) return c;
    const mapped = nextLink.get(c.linkId);
    return { ...c, linkId: mapped };
  });
}
