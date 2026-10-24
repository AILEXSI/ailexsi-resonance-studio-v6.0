import { useEffect, useRef, useState } from "react";
import {
  analysisAudioClipAt,
  audioTracksOf,
  clipById,
  clipEndMs,
  clipOnTrackAt,
  isTrackAudible,
  mixClipsAt,
  projectDurationMs,
  projectHasMixAudio,
  sourceTimeAt,
  topVideoClipAt,
  trackIdsOf,
  trackPanOf,
  trackVolumeOf,
  type Project,
  type TrackId,
} from "../../core/models";
import { vClipMixesOwnAudio } from "../../core/link";
import { gainAtClipTime, videoAlphaAtClipTime } from "../../core/fades";
import {
  compositeVideoAt,
  contextFromProject,
  crossfadePartnerClip,
  formatResolvedSource,
  primaryLayer,
  resolvePictureSource,
  transitionAudioGain,
} from "../../core/transition";
import { mixLinearGain } from "../../core/volume";
import { volumeAutomationOf } from "../../core/volume-automation";
import { liveWriteAutomationValue } from "../../core/volume-write";

export { compositeVideoAt as previewComposite } from "../../core/transition";
import type { MixPeaks } from "../mixer/Mixer";
import {
  renderVisualizerScene,
  sceneAt,
  shouldShowVisualizer,
  visFeaturesForPreview,
  type MixPcm,
} from "../../core/visualizer";
import { createPlaybackTap, type PlaybackTap } from "../../core/visualz/playback-tap";
import { ensureLexiScenes } from "../../core/visualz/scenes";
import { decodeAudio, isPlayableSource } from "../../core/exporter/media";
import { loadStill, paintStill } from "../../core/still";

interface Props {
  project: Project;
  playing: boolean;
  liveWriteTrackId?: string | null;
  liveWriteValue?: number | null;
  onLevels?: (peaks: MixPeaks) => void;
}

/** Track-id key only — automation / volume edits must not rebuild the graph. */
export function previewAudioGraphKey(project: Project): string {
  return audioTracksOf(project)
    .map((t) => t.id)
    .join("|");
}

/** Media bind identity. Live write must not appear here — first fader move must not seek. */
export function previewMediaBindKey(input: {
  playheadMs: number;
  playing: boolean;
  audioGraphKey: string;
  masterVolume: number;
  assetGen?: number;
}): string {
  return `${input.audioGraphKey}|${input.playheadMs}|${input.playing ? 1 : 0}|${input.masterVolume}|${input.assetGen ?? 0}`;
}

function holdPitch(el: HTMLMediaElement): void {
  el.preservesPitch = true;
  (el as HTMLMediaElement & { mozPreservesPitch?: boolean }).mozPreservesPitch = true;
}

/** Forward clips play at rate with pitch held. Reverse and freeze scrub the element. */
function syncPreviewMedia(
  el: HTMLMediaElement,
  clip: {
    startMs: number;
    sourceInMs: number;
    sourceOutMs: number;
    rate?: number;
    reversed?: boolean;
    holdSourceMs?: number;
  },
  playheadMs: number,
  playing: boolean,
): void {
  holdPitch(el);
  const want = sourceTimeAt(clip, playheadMs) / 1000;
  const scrub = clip.reversed === true || (clip.holdSourceMs != null && Number.isFinite(clip.holdSourceMs));
  if (scrub) {
    el.pause();
    if (Number.isFinite(el.currentTime) && Math.abs(el.currentTime - want) > 0.04) el.currentTime = want;
    return;
  }
  if (Number.isFinite(el.currentTime) && Math.abs(el.currentTime - want) > 0.08) el.currentTime = want;
  el.playbackRate = clip.rate && clip.rate > 0 ? clip.rate : 1;
  if (playing && el.paused) void el.play().catch(() => undefined);
  if (!playing && !el.paused) el.pause();
}

export function Preview({ project, playing, liveWriteTrackId = null, liveWriteValue = null, onLevels }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const partnerVideoRef = useRef<HTMLVideoElement>(null);
  const partnerStillRef = useRef<HTMLCanvasElement>(null);
  const xfadeRef = useRef<HTMLAudioElement>(null);
  const liveWriteRef = useRef({ trackId: liveWriteTrackId, value: liveWriteValue });
  liveWriteRef.current = { trackId: liveWriteTrackId, value: liveWriteValue };
  const stillRef = useRef<HTMLCanvasElement>(null);
  const v1Ref = useRef<HTMLAudioElement>(null);
  const v2Ref = useRef<HTMLAudioElement>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastPlayheadRef = useRef(project.playheadMs);
  const tapRef = useRef<PlaybackTap | null>(null);
  const mixPcmRef = useRef<MixPcm | null>(null);
  const [mixReady, setMixReady] = useState(0);

  const pictureCtx = contextFromProject(project);
  const composite = compositeVideoAt(pictureCtx, project.playheadMs);
  const picture = resolvePictureSource(pictureCtx, project.playheadMs);
  const hideVideo = picture.source === "vis" || picture.source === "black";
  const primary = primaryLayer(composite);
  const videoClip = hideVideo
    ? undefined
    : (primary ? clipById(project, primary.clipId) : undefined) ??
      topVideoClipAt(project, project.playheadMs);
  const layerA = primary && videoClip && primary.clipId === videoClip.id ? primary.alpha : 1;
  const partnerLayer =
    !hideVideo && videoClip
      ? composite.layers.find((layer) => layer.clipId !== videoClip.id && layer.alpha > 0.001)
      : undefined;
  const partnerClip = partnerLayer ? clipById(project, partnerLayer.clipId) : undefined;
  const partnerCovers =
    partnerClip != null &&
    project.playheadMs >= partnerClip.startMs &&
    project.playheadMs < clipEndMs(partnerClip);
  const partnerAsset = partnerCovers && partnerClip
    ? project.assets.find((a) => a.id === partnerClip.assetId)
    : undefined;
  const partnerIsStill = partnerAsset?.kind === "image";
  const partnerAlpha =
    partnerLayer && partnerClip
      ? partnerLayer.alpha * videoAlphaAtClipTime(partnerClip, project.playheadMs - partnerClip.startMs)
      : 0;
  const partnerBehind = partnerLayer
    ? composite.layers.findIndex((layer) => layer.clipId === partnerLayer.clipId) <
      composite.layers.findIndex((layer) => layer.clipId === videoClip?.id)
    : true;
  const audioPartner = crossfadePartnerClip(project, project.playheadMs);
  const videoAsset = videoClip
    ? project.assets.find((a) => a.id === videoClip.assetId)
    : undefined;
  const isStill = videoAsset?.kind === "image";
  const mixClips = mixClipsAt(project, project.playheadMs);
  const showViz = shouldShowVisualizer(project, project.playheadMs);
  const analysisClip = analysisAudioClipAt(project, project.playheadMs) ?? mixClips[0];
  const analysisAsset = analysisClip
    ? project.assets.find((a) => a.id === analysisClip.assetId)
    : undefined;
  const analysisUrl = analysisAsset?.objectUrl;
  const audioLoaded = projectHasMixAudio(project);
  const hasClipAtPlayhead = mixClips.length > 0 || Boolean(analysisClip);
  const audioGraphKey = previewAudioGraphKey(project);

  useEffect(() => {
    if (!analysisUrl || !isPlayableSource(analysisUrl)) {
      mixPcmRef.current = null;
      return;
    }
    let cancelled = false;
    void decodeAudio(analysisUrl)
      .then((buf) => {
        if (cancelled) return;
        mixPcmRef.current = buf;
        setMixReady((n) => n + 1);
      })
      .catch(() => {
        if (!cancelled) mixPcmRef.current = null;
      });
    return () => {
      cancelled = true;
    };
  }, [analysisUrl]);

  useEffect(() => {
    if (isStill) return;
    const video = videoRef.current;
    if (!video || !videoClip || !videoAsset?.objectUrl) return;
    syncPreviewMedia(video, videoClip, project.playheadMs, playing);
  }, [project.playheadMs, playing, videoClip, videoAsset?.objectUrl, isStill]);

  useEffect(() => {
    if (partnerIsStill) return;
    const video = partnerVideoRef.current;
    if (!video || !partnerClip || !partnerAsset?.objectUrl) return;
    syncPreviewMedia(video, partnerClip, project.playheadMs, playing);
  }, [project.playheadMs, playing, partnerClip, partnerAsset?.objectUrl, partnerIsStill]);

  useEffect(() => {
    if (!isStill || !videoClip || !videoAsset?.objectUrl) return;
    const canvas = stillRef.current;
    if (!canvas) return;
    let cancelled = false;
    const alpha =
      layerA * videoAlphaAtClipTime(videoClip, project.playheadMs - videoClip.startMs);
    void (async () => {
      try {
        const img = await loadStill(videoAsset.objectUrl!);
        if (cancelled) return;
        const parent = canvas.parentElement;
        const cssW = parent?.clientWidth || canvas.clientWidth || 640;
        const cssH = parent?.clientHeight || canvas.clientHeight || 360;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.floor(cssW * dpr));
        const h = Math.max(1, Math.floor(cssH * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        paintStill(ctx, canvas, img, alpha);
      } catch {
        /* missing still */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isStill, videoClip, videoAsset?.objectUrl, project.playheadMs, layerA]);

  useEffect(() => {
    if (!partnerIsStill || !partnerClip || !partnerAsset?.objectUrl) return;
    const canvas = partnerStillRef.current;
    if (!canvas) return;
    let cancelled = false;
    void (async () => {
      try {
        const img = await loadStill(partnerAsset.objectUrl!);
        if (cancelled) return;
        const parent = canvas.parentElement;
        const cssW = parent?.clientWidth || canvas.clientWidth || 640;
        const cssH = parent?.clientHeight || canvas.clientHeight || 360;
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(1, Math.floor(cssW * dpr));
        const h = Math.max(1, Math.floor(cssH * dpr));
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        paintStill(ctx, canvas, img, partnerAlpha);
      } catch {
        /* missing still */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [partnerIsStill, partnerClip, partnerAsset?.objectUrl, project.playheadMs, partnerAlpha]);

  useEffect(() => {
    const bind = (el: HTMLAudioElement | null, trackId: TrackId) => {
      if (!el) return;
      const clip = isTrackAudible(project, trackId)
        ? clipOnTrackAt(project, trackId, project.playheadMs)
        : undefined;
      const asset = clip ? project.assets.find((a) => a.id === clip.assetId) : undefined;
      if (clip && !vClipMixesOwnAudio(project, clip, project.playheadMs)) {
        el.pause();
        el.removeAttribute("src");
        return;
      }
      if (!clip || !asset?.objectUrl) {
        el.pause();
        el.removeAttribute("src");
        return;
      }
      if (el.src !== asset.objectUrl) el.src = asset.objectUrl;
      const live = liveWriteRef.current;
      const mix =
        mixLinearGain(
          gainAtClipTime(clip, project.playheadMs - clip.startMs),
          trackVolumeOf(project, trackId),
          project.masterVolume ?? 1,
          !isTrackAudible(project, trackId),
          liveWriteAutomationValue(
            trackId,
            volumeAutomationOf(project.tracks.find((t) => t.id === trackId)),
            project.playheadMs,
            live.trackId,
            live.value,
          ),
        ) * transitionAudioGain(project.transitions ?? [], clip.id, project.playheadMs, project);
      const tap = tapRef.current;
      if (tap) {
        el.volume = 1;
      } else {
        el.volume = Math.max(0, Math.min(1, mix));
      }
      syncPreviewMedia(el, clip, project.playheadMs, playing);
    };
    bind(v1Ref.current, "V1");
    bind(v2Ref.current, "V2");
    for (const track of audioTracksOf(project)) {
      bind(audioRefs.current[track.id] ?? null, track.id);
    }
    const partnerEl = xfadeRef.current;
    const partner = audioPartner;
    const partnerAsset = partner ? project.assets.find((a) => a.id === partner.assetId) : undefined;
    if (
      partnerEl &&
      partner &&
      partnerAsset?.objectUrl &&
      isTrackAudible(project, partner.trackId) &&
      vClipMixesOwnAudio(project, partner, project.playheadMs)
    ) {
      if (partnerEl.src !== partnerAsset.objectUrl) partnerEl.src = partnerAsset.objectUrl;
      const live = liveWriteRef.current;
      const mix =
        mixLinearGain(
          gainAtClipTime(partner, project.playheadMs - partner.startMs),
          trackVolumeOf(project, partner.trackId),
          project.masterVolume ?? 1,
          false,
          liveWriteAutomationValue(
            partner.trackId,
            volumeAutomationOf(project.tracks.find((t) => t.id === partner.trackId)),
            project.playheadMs,
            live.trackId,
            live.value,
          ),
        ) * transitionAudioGain(project.transitions ?? [], partner.id, project.playheadMs, project);
      partnerEl.volume = Math.max(0, Math.min(1, mix));
      syncPreviewMedia(partnerEl, partner, project.playheadMs, playing);
    } else if (partnerEl) {
      partnerEl.pause();
      partnerEl.removeAttribute("src");
    }
  }, [mixClips, playing, project.assets, project.playheadMs, audioGraphKey, project.masterVolume, audioPartner]);

  useEffect(() => {
    if (tapRef.current) return;
    const tap = createPlaybackTap({
      V1: v1Ref.current,
      V2: v2Ref.current,
      ...Object.fromEntries(
        audioTracksOf(project).map((t) => [t.id, audioRefs.current[t.id] ?? null]),
      ),
    });
    if (!tap) return;
    tapRef.current = tap;
    return () => {
      tap.disconnect();
      tapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const tap = tapRef.current;
    if (!tap) return;
    tap.connect("V1", v1Ref.current);
    tap.connect("V2", v2Ref.current);
    for (const track of audioTracksOf(project)) {
      tap.connect(track.id, audioRefs.current[track.id] ?? null);
    }
  }, [audioGraphKey]);

  useEffect(() => {
    if (playing) tapRef.current?.resume();
  }, [playing]);

  useEffect(() => {
    const tap = tapRef.current;
    if (!tap) return;
    const gainOf = (trackId: TrackId) => {
      if (!isTrackAudible(project, trackId)) return 0;
      const clip = clipOnTrackAt(project, trackId, project.playheadMs);
      if (!clip || !vClipMixesOwnAudio(project, clip, project.playheadMs)) return 0;
      return (
        mixLinearGain(
          gainAtClipTime(clip, project.playheadMs - clip.startMs),
          trackVolumeOf(project, trackId),
          1,
          false,
          liveWriteAutomationValue(
            trackId,
            volumeAutomationOf(project.tracks.find((t) => t.id === trackId)),
            project.playheadMs,
            liveWriteTrackId,
            liveWriteValue,
          ),
        ) * transitionAudioGain(project.transitions ?? [], clip.id, project.playheadMs, project)
      );
    };
    const pans: Record<string, number> = {};
    const next: Record<string, number> = {
      V1: gainOf("V1"),
      V2: gainOf("V2"),
    };
    for (const id of trackIdsOf(project)) {
      next[id] = gainOf(id);
      pans[id] = trackPanOf(project, id);
    }
    tap.setGains({
      ...next,
      master: project.masterVolume ?? 1,
      pans,
      V1pan: pans.V1,
      V2pan: pans.V2,
      A1pan: pans.A1,
      A2pan: pans.A2,
    });
  }, [mixClips, project, liveWriteTrackId, liveWriteValue]);

  useEffect(() => {
    if (!playing || !onLevels) return;
    let raf = 0;
    const tick = () => {
      const p = tapRef.current?.peaks();
      onLevels({
        ...(p ?? {}),
        V1: p?.V1 ?? 0,
        V2: p?.V2 ?? 0,
        A1: p?.A1 ?? 0,
        A2: p?.A2 ?? 0,
        master: p?.master ?? 0,
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, onLevels]);

  useEffect(() => {
    if (!showViz) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const paint = (dt: number) => {
      const parent = canvas.parentElement;
      const cssW = parent?.clientWidth || canvas.clientWidth || 640;
      const cssH = parent?.clientHeight || canvas.clientHeight || 360;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.floor(cssW * dpr));
      const h = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const durationMs = Math.max(projectDurationMs(project), 10_000);
      let live = null as ReturnType<PlaybackTap["sample"]> | null;
      try {
        live = tapRef.current?.sample(project.playheadMs) ?? null;
      } catch {
        live = null;
      }
      const mix = analysisClip ? mixPcmRef.current : null;
      const featureTimeMs =
        mix && analysisClip ? sourceTimeAt(analysisClip, project.playheadMs) : project.playheadMs;
      const features = visFeaturesForPreview({
        timeMs: featureTimeMs,
        durationMs,
        mix,
        live,
        audioLoaded,
        hasClipAtPlayhead,
      });
      const sceneId = sceneAt(project, project.playheadMs) ?? project.visualizer.sceneId;
      renderVisualizerScene(ctx, canvas.width, canvas.height, sceneId, features, dt);
    };

    const dt = Math.max(0, (project.playheadMs - lastPlayheadRef.current) / 1000);
    lastPlayheadRef.current = project.playheadMs;
    paint(dt);
    let cancelled = false;
    void ensureLexiScenes().then(() => {
      if (!cancelled) paint(0);
    });

    const target = canvas.parentElement ?? canvas;
    const ro = new ResizeObserver(() => paint(0));
    ro.observe(target);
    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [showViz, project, mixReady, analysisClip, audioLoaded, hasClipAtPlayhead]);

  const activeLabel = formatResolvedSource(picture);

  return (
    <section className="preview-wrap" data-testid="preview">
      <div className="preview-chrome">
        <span>Preview</span>
        <span>{playing ? "Live" : "Paused"}</span>
      </div>
      <div className="preview-stage">
        {videoAsset?.objectUrl && videoClip ? (
          <>
            {isStill ? (
              <canvas
                ref={stillRef}
                data-testid="preview-still"
                style={{
                  width: "100%",
                  height: "100%",
                  opacity:
                    layerA *
                    videoAlphaAtClipTime(videoClip, project.playheadMs - videoClip.startMs),
                }}
              />
            ) : (
              <video
                ref={videoRef}
                src={videoAsset.objectUrl}
                muted
                playsInline
                data-testid="preview-video"
                style={{
                  opacity:
                    layerA *
                    videoAlphaAtClipTime(videoClip, project.playheadMs - videoClip.startMs),
                  position: "relative",
                  zIndex: 1,
                }}
              />
            )}
            {partnerAsset?.objectUrl && partnerClip ? (
              partnerIsStill ? (
                <canvas
                  ref={partnerStillRef}
                  data-testid="preview-partner"
                  className="preview-partner"
                  style={{ opacity: partnerAlpha, zIndex: partnerBehind ? 0 : 2 }}
                />
              ) : (
                <video
                  ref={partnerVideoRef}
                  src={partnerAsset.objectUrl}
                  muted
                  playsInline
                  data-testid="preview-partner"
                  className="preview-partner"
                  style={{ opacity: partnerAlpha, zIndex: partnerBehind ? 0 : 2 }}
                />
              )
            ) : null}
            {composite.plate && composite.plate.alpha > 0 ? (
              <div
                data-testid="preview-plate"
                style={{
                  position: "absolute",
                  inset: 0,
                  background: composite.plate.color,
                  opacity: composite.plate.alpha,
                  pointerEvents: "none",
                }}
              />
            ) : null}
          </>
        ) : null}
        {showViz ? (
          <canvas
            ref={canvasRef}
            data-testid="visualizer-canvas"
            style={videoAsset?.objectUrl && videoClip ? { position: "absolute", inset: 0 } : undefined}
          />
        ) : !videoAsset?.objectUrl || !videoClip ? (
          <div className="preview-empty">
            {videoClip && videoAsset?.missing
              ? `missing:${videoAsset.name}`
              : "No video under playhead"}
          </div>
        ) : null}
      </div>
      <audio ref={xfadeRef} className="hidden-audio" data-testid="preview-xfade" />
      <audio ref={v1Ref} className="hidden-audio" data-testid="preview-v1" />
      <audio ref={v2Ref} className="hidden-audio" data-testid="preview-v2" />
      {audioTracksOf(project).map((track) => (
        <audio
          key={track.id}
          ref={(el) => {
            audioRefs.current[track.id] = el;
          }}
          className="hidden-audio"
          data-testid={
            track.id === "A1" ? "preview-a1" : track.id === "A2" ? "preview-a2" : `preview-audio-${track.id}`
          }
        />
      ))}
      <div className="preview-meta">
        Active: {activeLabel} · audio{" "}
        {trackIdsOf(project)
          .filter((id) => mixClips.some((c) => c.trackId === id))
          .join(" ") || "—"}
      </div>
    </section>
  );
}
