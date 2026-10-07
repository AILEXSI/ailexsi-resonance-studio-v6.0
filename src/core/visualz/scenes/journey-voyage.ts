import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";
import { deriveJourneyState } from "../journey";
import { journeyTerrainScene } from "./journey-terrain";
import { journeyCanyonScene } from "./journey-canyon";
import { journeyGatesScene } from "./journey-gates";
import { journeyOceanScene } from "./journey-ocean";
import { journeyMonolithsScene } from "./journey-monoliths";
import { journeyLatticeScene } from "./journey-lattice";

const WORLDS: Scene[] = [
  journeyTerrainScene,
  journeyCanyonScene,
  journeyGatesScene,
  journeyOceanScene,
  journeyMonolithsScene,
  journeyLatticeScene,
];

export interface JourneyRoute {
  index: number;
  nextIndex: number;
  mix: number;
}

export function deriveJourneyRoute(features: AudioFeatures): JourneyRoute {
  const j = deriveJourneyState(features);
  // 16-second deterministic chapters preserve preview/export parity.
  // Musical threshold/breakthrough pulls the next world forward near chapter edges.
  const chapterMs = 16000;
  const chapter = Math.max(0, features.timeMs) / chapterMs;
  const base = Math.floor(chapter);
  const local = chapter - base;
  const musicalPull = Math.max(j.gate * 0.12, j.phase === "breakthrough" ? 0.16 : 0);
  const mix = Math.max(0, Math.min(1, (local - (0.72 - musicalPull)) / 0.28));
  return { index: base % WORLDS.length, nextIndex: (base + 1) % WORLDS.length, mix };
}

function renderWithAlpha(scene: Scene, w: SceneContext, f: AudioFeatures, p: SceneParams, dt: number, alpha: number) {
  if (alpha <= 0.001) return;
  w.ctx.save();
  w.ctx.globalAlpha *= alpha;
  scene.render(w, f, p, dt);
  w.ctx.restore();
}

export const journeyVoyageScene: Scene = {
  id: "journey-voyage",
  name: "Journey Voyage",
  description: "Continuous musical voyage transitioning through all Journey worlds",
  defaultParams: {
    intensity: 0.9,
    colorPrimary: "#7de8ff",
    colorSecondary: "#02040a",
    speed: 1,
    complexity: 0.7,
  },
  render(w, f, p, dt) {
    const route = deriveJourneyRoute(f);
    const current = WORLDS[route.index];
    const next = WORLDS[route.nextIndex];
    renderWithAlpha(current, w, f, p, dt, 1);
    if (route.mix > 0) {
      // Smoothstep avoids a visibly linear dissolve while both worlds share
      // the same absolute audio clock and JourneyState.
      const m = route.mix * route.mix * (3 - 2 * route.mix);
      renderWithAlpha(next, w, f, p, dt, m);
    }
  },
};
