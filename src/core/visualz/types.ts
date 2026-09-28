/**
 * Ported from AILEXSI Visualz (@ailexsi/visualz 0.1.0-blueprint, HEAD b67410c).
 * From-scratch Canvas 2D. Not copied from Resonance Studio V4.
 * https://github.com/AILEXSI/ailexsi-visualz
 */

export interface AudioFeatures {
  timeMs: number;
  rms: number;
  bass: number;
  mid: number;
  treble: number;
  spectrum: Float32Array;
  onset: boolean;
  beatPulse: number;
  tempoBpm?: number | null;
  /** Kick envelope 0–1 (impulse, not mass) */
  kick?: number;
  snare?: number;
  hat?: number;
  vocal?: number;
  buildup?: number;
  drop?: number;
}

export interface AudioAnalyserConfig {
  fftSize?: number;
  smoothingTimeConstant?: number;
  minDecibels?: number;
  maxDecibels?: number;
}

export interface SceneParams {
  intensity: number;
  colorPrimary: string;
  colorSecondary: string;
  speed: number;
  complexity: number;
  [key: string]: number | string | boolean;
}

export interface SceneContext {
  width: number;
  height: number;
  ctx: CanvasRenderingContext2D;
  gl?: WebGL2RenderingContext;
}

export interface Scene {
  id: string;
  name: string;
  description?: string;
  defaultParams: SceneParams;
  render(
    context: SceneContext,
    features: AudioFeatures,
    params: SceneParams,
    dt: number,
  ): void;
  onEnter?(context: SceneContext, params: SceneParams): void;
  onExit?(): void;
}

export interface VisualState {
  currentSceneId: string;
  params: SceneParams;
  isPlaying: boolean;
  width: number;
  height: number;
}

export interface VisualEngineOptions {
  canvas: HTMLCanvasElement;
  audioContext?: AudioContext;
  sourceNode?: AudioNode;
  initialSceneId?: string;
  initialParams?: Partial<SceneParams>;
}
