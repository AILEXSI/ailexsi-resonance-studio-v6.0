/**
 * AILEXSI Visualz — createVisualEngine
 * Ported from @ailexsi/visualz 0.1.0-blueprint (b67410c).
 * From-scratch Canvas 2D. No MilkDrop/Butterchurn. Not copied from V4.
 */

import { builtinScenes } from "./scenes";
import type { AudioFeatures, Scene, SceneParams, VisualEngineOptions, VisualState } from "./types";

export interface VisualEngine {
  start(): void;
  stop(): void;
  setFeatures(features: AudioFeatures): void;
  /** Last vector passed to setFeatures. Scenes render this packet, not a second decay. */
  getFeatures(): AudioFeatures;
  setScene(sceneId: string): void;
  setParams(params: Partial<SceneParams>): void;
  listScenes(): Array<{ id: string; name: string; description?: string }>;
  resize(width: number, height: number): void;
  getState(): VisualState;
  captureFrame(): Promise<Blob>;
  destroy(): void;
}

const sceneRegistry = new Map<string, Scene>();

export function registerScene(scene: Scene): void {
  sceneRegistry.set(scene.id, scene);
}

export function ensureBuiltinsRegistered(): void {
  if (sceneRegistry.size >= builtinScenes.length) return;
  for (const s of builtinScenes) {
    sceneRegistry.set(s.id, s);
  }
}

export function getRegisteredScene(sceneId: string): Scene | undefined {
  ensureBuiltinsRegistered();
  return sceneRegistry.get(sceneId);
}

function mergeSceneParams(...parts: Array<Partial<SceneParams> | undefined>): SceneParams {
  const next: SceneParams = {
    intensity: 0.75,
    colorPrimary: "#ff6b35",
    colorSecondary: "#0a0a12",
    speed: 1,
    complexity: 0.55,
  };
  for (const part of parts) {
    if (!part) continue;
    for (const [key, value] of Object.entries(part)) {
      if (value !== undefined) next[key] = value;
    }
  }
  return next;
}

export function createVisualEngine(options: VisualEngineOptions): VisualEngine {
  ensureBuiltinsRegistered();

  const canvas = options.canvas;
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) {
    throw new Error("Could not get 2D context from canvas");
  }
  const ctx: CanvasRenderingContext2D = maybeCtx;

  let currentSceneId = options.initialSceneId ?? "resonance-wave";
  const initialScene = sceneRegistry.get(currentSceneId) ?? builtinScenes[0];
  if (initialScene) currentSceneId = initialScene.id;

  let params = mergeSceneParams(initialScene?.defaultParams, options.initialParams);

  let isPlaying = false;
  let rafId: number | null = null;
  let lastFeatures: AudioFeatures = {
    timeMs: 0,
    rms: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    spectrum: new Float32Array(64),
    onset: false,
    beatPulse: 0,
  };

  let lastTime = performance.now();
  let beatPulseDecay = 0;

  initialScene?.onEnter?.(
    {
      width: canvas.width,
      height: canvas.height,
      ctx,
    },
    params,
  );

  function frame(now: number) {
    if (!isPlaying) return;
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    if (lastFeatures.beatPulse > 0) {
      beatPulseDecay = Math.max(lastFeatures.beatPulse, beatPulseDecay);
    }
    beatPulseDecay = Math.max(0, beatPulseDecay - dt * 3.5);
    const features: AudioFeatures = {
      ...lastFeatures,
      beatPulse: Math.max(lastFeatures.beatPulse, beatPulseDecay),
    };

    const scene = sceneRegistry.get(currentSceneId);
    ctx.fillStyle = (params.colorSecondary as string) || "#0a0a12";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (scene) {
      scene.render({ width: canvas.width, height: canvas.height, ctx }, features, params, dt);
    } else {
      ctx.fillStyle = "#ff6b35";
      ctx.font = "16px sans-serif";
      ctx.fillText(`Scene "${currentSceneId}" not found`, 20, 40);
    }

    rafId = requestAnimationFrame(frame);
  }

  return {
    start() {
      if (isPlaying) return;
      isPlaying = true;
      lastTime = performance.now();
      rafId = requestAnimationFrame(frame);
    },

    stop() {
      isPlaying = false;
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    },

    setFeatures(features: AudioFeatures) {
      lastFeatures = features;
      if (features.onset || features.beatPulse > 0.5) {
        beatPulseDecay = Math.max(beatPulseDecay, features.beatPulse || 1);
      }
    },

    getFeatures() {
      return lastFeatures;
    },

    setScene(sceneId: string) {
      const next = sceneRegistry.get(sceneId);
      if (!next) {
        return;
      }
      const prev = sceneRegistry.get(currentSceneId);
      prev?.onExit?.();
      currentSceneId = sceneId;
      // Reset to the next scene's defaults so a prior scene cannot leak params.
      params = mergeSceneParams(next.defaultParams);
      next.onEnter?.(
        {
          width: canvas.width,
          height: canvas.height,
          ctx,
        },
        params,
      );
    },

    setParams(partial: Partial<SceneParams>) {
      params = mergeSceneParams(params, partial);
    },

    listScenes() {
      return Array.from(sceneRegistry.values()).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      }));
    },

    resize(width: number, height: number) {
      canvas.width = width;
      canvas.height = height;
    },

    getState(): VisualState {
      return {
        currentSceneId,
        params: { ...params },
        isPlaying,
        width: canvas.width,
        height: canvas.height,
      };
    },

    async captureFrame(): Promise<Blob> {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("toBlob failed"));
        }, "image/png");
      });
    },

    destroy() {
      this.stop();
      const prev = sceneRegistry.get(currentSceneId);
      prev?.onExit?.();
    },
  };
}
