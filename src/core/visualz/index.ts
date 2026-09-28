/**
 * Vendored AILEXSI Visualz 0.1.0-blueprint (https://github.com/AILEXSI/ailexsi-visualz @ b67410c).
 * AGPL-free, from-scratch Canvas 2D. Not a live npm dependency. Not copied from V4.
 */

export type {
  AudioAnalyserConfig,
  AudioFeatures,
  Scene,
  SceneContext,
  SceneParams,
  VisualEngineOptions,
  VisualState,
} from "./types";
export { createVisualEngine, ensureBuiltinsRegistered, getRegisteredScene, registerScene } from "./engine";
export type { VisualEngine } from "./engine";
export { builtinScenes } from "./scenes";
export {
  CLASSIC_FAMILIES,
  LEXI_FAMILIES,
  LEXI_SCENE_IDS,
  SCENE_CATALOG,
  VIS_BROWSER_CATEGORIES,
  VIS_SUITES,
  VISUALIZER_SCENE_IDS,
  catalogEntriesFor,
  catalogFamiliesFor,
  getCatalogEntry,
  isVisualizerSceneId,
  lexiFamilyOf,
  sceneShortNameFromCatalog,
} from "./scene-catalog";
export type {
  ClassicFamilyId,
  LexiFamilyId,
  SceneCatalogEntry,
  VisBrowserCategory,
  VisFamilyId,
  VisSuiteId,
  VisualizerSceneId,
} from "./scene-catalog";
export {
  ANALYSER_FFT_SIZE,
  ANALYSER_MAX_DECIBELS,
  ANALYSER_MIN_DECIBELS,
  ANALYSER_SMOOTHING,
  applySilenceGate,
  assembleAudioFeatures,
  bandsFromSpectrum,
  createFeatureExtractor,
  createFeatureState,
  createLiveFeatureState,
  stepLiveAnalyser,
  LIVE_ANALYSER_SMOOTHING,
  createOfflineFeatureExtractor,
  featuresFromAnalyserBytes,
  isSilentEnergy,
  offlineExtractorFor,
  rmsFromTimeDomain,
  SILENCE_BASS,
  SILENCE_RMS,
} from "./feature-extractor";
export type { FeatureExtractor, OfflineFeatureExtractor } from "./feature-extractor";
export { analyserSpectrumFromWindow, binFrequencyHz } from "./fft";
export {
  applyVisResponse,
  clamp01 as clampVis01,
  DEFAULT_VIS_RESPONSE,
  shapeVisLevel,
  VIS_RESPONSE_01,
} from "./vis-response";
export type { RawAudioFeatures, VisResponseConfig, VisualizerPresentation } from "./vis-response";
export {
  latticeNodePulse,
  latticeWarp,
  lexiAccent,
  lexiAmbientExpand,
  lexiFormShift,
  lexiGlow,
  lexiHighlightBloom,
  lexiHorizonBody,
  lexiHorizonLift,
  lexiPeakBias,
  lexiPressureWave,
  lexiRibbonWidth,
  lexiSheen,
  lexiTerrainSpread,
  lexiTransientFlash,
  resonanceCoreRadius,
  resonanceMidFreq,
  resonanceRingPulse,
  resonanceWaveKickAmp,
} from "./scene-impact";
