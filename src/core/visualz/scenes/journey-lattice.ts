/**
 * Scene: void-lattice — infinite 3D grid; camera flies through; bass warps.
 */

import { hexToRgba } from "../color";
import { cam3, project3, sortFarFirst } from "../project3d";
import { latticeNodePulse, latticeWarp } from "../scene-impact";
import { deriveJourneyState } from "../journey";
import type { AudioFeatures, Scene, SceneContext, SceneParams } from "../types";

type Mark = { x: number; y: number; z: number; r: number; color: string };

export const journeyLatticeScene: Scene = {
  id: "journey-lattice",
  name: "Journey Lattice",
  description: "Music-shaped forward journey through an evolving 3D lattice",
  defaultParams: {
    intensity: 0.85,
    colorPrimary: "#3cf0ff",
    colorSecondary: "#02040a",
    speed: 1,
    complexity: 0.55,
  },

  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, _dt: number) {
    const { ctx, width, height } = ctxWrap;
    const journey = deriveJourneyState(features);
    // Absolute audio time keeps preview/export deterministic. Journey speed changes
    // how aggressively the world approaches without introducing hidden frame state.
    const fly = features.timeMs * 0.00135 * params.speed * journey.speed;
    const cam = cam3({
      x: Math.sin(features.timeMs * 0.00022) * 0.18,
      y: 0.2 + Math.sin(features.timeMs * 0.00017) * (0.04 + journey.openness * 0.06),
      z: fly,
      yaw: Math.sin(features.timeMs * 0.00015) * (0.05 + journey.openness * 0.11),
      pitch: -0.035 - journey.gate * 0.055,
      far: 10 + journey.openness * 6,
    });
    const spacing = 1.15;
    const warp = latticeWarp(features, params.intensity) * (0.55 + journey.warp * 1.15);
    const half = 2 + Math.round(journey.openness * 2);
    const depth = 7 + Math.round(journey.density * 7);
    const originZ = Math.floor(fly / spacing) * spacing;
    const marks: Mark[] = [];

    for (let ix = -half; ix <= half; ix++) {
      for (let iy = -half; iy <= half; iy++) {
        for (let iz = 0; iz < depth; iz++) {
          const gx = ix * spacing;
          const gz = originZ + iz * spacing;
          const gy = iy * spacing + Math.sin(gx * 1.6 + gz * 0.85) * warp;
          const p = project3(gx, gy, gz, cam, width, height);
          if (!p.ok) continue;
          const node = (ix + iy + iz) % 2 === 0;
          marks.push({
            x: p.x,
            y: p.y,
            z: p.z,
            r: (node ? 1.6 : 1.05) * (0.45 + p.fog) * latticeNodePulse(features),
            color: hexToRgba(
              iy === 0 ? "#ffffff" : (params.colorPrimary as string),
              (0.14 + p.fog * (0.52 + journey.density * 0.34)) * params.intensity,
            ),
          });
        }
      }
    }

    for (const m of sortFarFirst(marks)) {
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.strokeStyle = hexToRgba(
      params.colorPrimary as string,
      0.12 + features.rms * 0.16 + features.beatPulse * 0.12 + journey.gate * 0.16,
    );
    ctx.lineWidth = 1;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iy = -1; iy <= 1; iy++) {
        ctx.beginPath();
        let started = false;
        for (let iz = 0; iz < depth; iz++) {
          const p = project3(
            ix * spacing,
            iy * spacing + Math.sin(ix * spacing * 1.6 + (originZ + iz * spacing) * 0.85) * warp,
            originZ + iz * spacing,
            cam,
            width,
            height,
          );
          if (!p.ok) continue;
          if (!started) {
            ctx.moveTo(p.x, p.y);
            started = true;
          } else ctx.lineTo(p.x, p.y);
        }
        if (started) ctx.stroke();
      }
    }
  },
};
