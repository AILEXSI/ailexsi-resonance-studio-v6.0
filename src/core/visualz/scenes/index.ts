/**
 * AILEXSI Visualz — Built-in scenes (ported from b67410c) plus V5 Canvas-2D additions.
 * Cycle order matches VISUALIZER_SCENE_IDS / SCENE_CATALOG.
 * Lexi scenes load on demand so the app chunk stays smaller.
 */

import type { Scene } from "../types";
import { spectrumBarsScene } from "./spectrum-bars";
import { pulseOrbScene } from "./pulse-orb";
import { auroraVeilScene } from "./aurora-veil";
import { starBloomScene } from "./star-bloom";
import { liquidGoldScene } from "./liquid-gold";
import { kaleidoHexScene } from "./kaleido-hex";
import { sunCoreScene } from "./sun-core";
import { emberRainScene } from "./ember-rain";
import { particleFieldScene } from "./particle-field";
import { resonanceWaveScene } from "./resonance-wave";
import { tunnelSpiralScene } from "./tunnel-spiral";
import { litaBloomScene } from "./lita-bloom";
import { voidLatticeScene } from "./void-lattice";
import { nebulaHelixScene } from "./nebula-helix";
import { accretionDiskScene } from "./accretion-disk";
import { crystalStormScene } from "./crystal-storm";

const classicScenes: Scene[] = [
  spectrumBarsScene,
  pulseOrbScene,
  auroraVeilScene,
  starBloomScene,
  liquidGoldScene,
  kaleidoHexScene,
  sunCoreScene,
  emberRainScene,
  particleFieldScene,
  resonanceWaveScene,
  tunnelSpiralScene,
  litaBloomScene,
  voidLatticeScene,
  nebulaHelixScene,
  accretionDiskScene,
  crystalStormScene,
];

const lexiLoaders = [
  () => import("./lexi").then((mod) => mod.lexiScene),
  () => import("./lexi-ref").then((mod) => mod.lexiRefScene),
  () => import("./lexi-2036").then((mod) => mod.lexi2036Scene),
  () => import("./lexi-v3").then((mod) => mod.lexiV3Scene),
  () => import("./lexi-v2").then((mod) => mod.lexiV2Scene),
  () => import("./lexi-minimal").then((mod) => mod.lexiMinimalScene),
  () => import("./lexi-v1").then((mod) => mod.lexiV1Scene),
];

/** Classics are present immediately. Lexi scenes are appended by `ensureLexiScenes`. */
export const builtinScenes: Scene[] = [...classicScenes];

let lexiLoad: Promise<void> | null = null;

/** Load Lexi scene modules once. Safe to call from preview and from export. */
export function ensureLexiScenes(): Promise<void> {
  if (builtinScenes.some((scene) => scene.id === "lexi")) return Promise.resolve();
  if (!lexiLoad) {
    lexiLoad = Promise.all(lexiLoaders.map((load) => load()))
      .then((scenes) => {
        for (const scene of scenes) {
          if (!builtinScenes.some((existing) => existing.id === scene.id)) builtinScenes.push(scene);
        }
      })
      .catch((error: unknown) => {
        lexiLoad = null;
        throw error;
      });
  }
  return lexiLoad;
}

export {
  spectrumBarsScene,
  pulseOrbScene,
  auroraVeilScene,
  starBloomScene,
  liquidGoldScene,
  kaleidoHexScene,
  sunCoreScene,
  emberRainScene,
  particleFieldScene,
  resonanceWaveScene,
  tunnelSpiralScene,
  litaBloomScene,
  voidLatticeScene,
  nebulaHelixScene,
  accretionDiskScene,
  crystalStormScene,
};
