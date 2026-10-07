import { hexToRgba } from "../color";
import { cam3, project3 } from "../project3d";
import { deriveJourneyState } from "../journey";
import type { AudioFeatures, SceneContext, SceneParams } from "../types";

export function journeyFrame(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams) {
  const j = deriveJourneyState(features);
  const fly = features.timeMs * 0.00115 * params.speed * j.speed;
  const cam = cam3({
    x: Math.sin(features.timeMs * 0.00016) * (0.08 + j.openness * 0.12),
    y: 0.55 + j.openness * 0.25,
    z: fly,
    yaw: Math.sin(features.timeMs * 0.00011) * 0.06,
    pitch: -0.08 - j.gate * 0.04,
    far: 18 + j.openness * 8,
  });
  return { ...ctxWrap, j, fly, cam, project: (x:number,y:number,z:number)=>project3(x,y,z,cam,ctxWrap.width,ctxWrap.height), rgba: hexToRgba };
}

export function pathLine(ctx: CanvasRenderingContext2D, pts: Array<{x:number;y:number;ok:boolean}>) {
  ctx.beginPath(); let on=false;
  for (const p of pts) { if (!p.ok) continue; if (!on) { ctx.moveTo(p.x,p.y); on=true; } else ctx.lineTo(p.x,p.y); }
  if (on) ctx.stroke();
}
