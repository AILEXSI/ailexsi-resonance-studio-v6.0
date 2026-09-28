/**
 * resonance-dunes — generative golden particle landscape
 * Canvas2D heightfield. Bloom, feedback, grain, vignette stay in the WebGL2 post.
 */

import type { Scene, SceneContext, SceneParams } from "../types";
import type { AudioFeatures } from "../types";
import { hexToRgba, mixHex } from "../color";
import { musicClock, logSpectrumSample } from "../motion";
import { rand01, seedFrom } from "../rng";

const TRACK_SEED = 19770822;
const LANDMARK_U = 0.72;
const LANDMARK_V = 0.38;

let phase = 0;
let kickFront = LANDMARK_V;
let kickAmp = 0;
let ringArmed = true;
const groundRings: Array<{ r: number; life: number }> = [];

function num(value: number | string | boolean | undefined, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

interface RowPoint {
  x: number;
  y: number;
  u: number;
  v: number;
  scale: number;
}

export const resonanceDunesScene: Scene = {
  id: "resonance-dunes",
  name: "Resonance Dunes",
  description: "Generative golden particle landscape bound to spectrum and rhythm",
  defaultParams: {
    intensity: 0.72,
    colorPrimary: "#e0b03a",
    colorSecondary: "#7a4a12",
    speed: 0.85,
    complexity: 0.62,
    fog: 0.55,
    glitter: 0.4,
    landmark: "obelisk",
  },
  onEnter() {
    phase = 0;
    kickFront = LANDMARK_V;
    kickAmp = 0;
    ringArmed = true;
    groundRings.length = 0;
  },
  onExit() {
    groundRings.length = 0;
  },
  render(ctxWrap: SceneContext, features: AudioFeatures, params: SceneParams, dt: number) {
    const { ctx, width, height } = ctxWrap;
    const kickFallback = features.kick ?? (features.onset ? Math.max(features.beatPulse, 0.85) : features.beatPulse);
    const snare = features.snare ?? 0;
    const hat = features.hat ?? features.treble;
    const buildup = features.buildup ?? 0;
    const drop = features.drop ?? 0;
    const energy = features.rms * 0.4 + features.bass * 0.4 + features.mid * 0.2;
    const speed = num(params.speed, 0.85);
    const intensity = num(params.intensity, 0.72);
    const complexity = Math.max(0, Math.min(1, num(params.complexity, 0.62)));
    const fogParam = Math.max(0, Math.min(1, num(params.fog, 0.55)));
    const glitter = Math.max(0, Math.min(1, num(params.glitter, 0.4)));
    const landmark = params.landmark === "sun" ? "sun" : "obelisk";
    const primary = String(params.colorPrimary || "#e0b03a");
    const secondary = String(params.colorSecondary || "#7a4a12");
    const trackSeed = typeof params.trackSeed === "number" ? params.trackSeed : TRACK_SEED;
    const anchorU = landmark === "sun" ? 0.5 : LANDMARK_U;
    const anchorV = landmark === "sun" ? 0.02 : LANDMARK_V;

    phase += musicClock(dt, energy, features.beatPulse, speed);
    const ringClock = musicClock(dt, energy, Math.max(features.beatPulse, kickFallback), speed);
    const hit = features.onset || kickFallback > 0.8;
    if (hit && ringArmed) {
      kickFront = anchorV;
      groundRings.push({ r: 0.045, life: 1 });
      ringArmed = false;
    } else if (!features.onset && kickFallback < 0.36) {
      ringArmed = true;
    }
    kickFront += ringClock * 1.65;
    const traveled = Math.exp(-Math.max(0, kickFront - anchorV) * 1.8);
    kickAmp = Math.max(kickAmp * Math.exp(-ringClock * 3.2), kickFallback * traveled);
    for (let i = groundRings.length - 1; i >= 0; i--) {
      const ring = groundRings[i];
      ring.r += ringClock * 2.1;
      ring.life -= ringClock * 1.55;
      if (ring.life <= 0.03 || ring.r > 1.6) groundRings.splice(i, 1);
    }
    if (groundRings.length > 6) groundRings.splice(0, groundRings.length - 6);

    const cols = 48 + Math.floor(complexity * 48);
    const rows = 18 + Math.floor(complexity * 14);
    const zoom = 1 + buildup * 0.1;
    const horizonY = height * 0.4;
    const cx = width * 0.5;
    const vocal = features.vocal;
    const fogSrc = vocal ?? features.mid;
    const fogAmt = fogParam * (0.36 + fogSrc * 0.64);

    const project = (u: number, v: number, h: number): RowPoint => {
      const scale = (0.22 + v * 1.15) * zoom;
      const ground = horizonY + Math.pow(v, 1.18) * (height - horizonY) * 0.94;
      return {
        x: cx + (u - 0.5) * width * scale * 1.55,
        y: ground - h * height * 0.3 * scale,
        u,
        v,
        scale,
      };
    };

    const heightAt = (u: number, v: number, row: number): number => {
      const spec = logSpectrumSample(features.spectrum, u);
      let h =
        features.bass * 0.55 * (1 - v * 0.35) +
        spec * 0.45 * intensity +
        Math.sin(u * Math.PI * 3 + phase * 0.35 + v * 2) * features.mid * 0.12;
      const kickRing = Math.exp(-((v - kickFront) * (v - kickFront)) / 0.012) * kickAmp;
      h += kickRing * 0.25;
      if (v > 0.62 && snare > 0) {
        h += Math.sin(u * Math.PI * 14 + row) * snare * 0.04 * (v - 0.55);
      }
      return h;
    };

    const buildRow = (v: number, row: number): RowPoint[] => {
      const pts: RowPoint[] = [];
      const denom = Math.max(1, cols - 1);
      for (let i = 0; i < cols; i++) {
        const u = i / denom;
        pts.push(project(u, v, heightAt(u, v, row)));
      }
      return pts;
    };

    const strokeRow = (pts: RowPoint[], alphaMul: number, weight: number) => {
      if (pts.length < 2) return;
      const v = pts[0].v;
      const depth = 0.4 + v * 0.6;
      const col = mixHex(secondary, primary, 0.28 + v * 0.72);
      const scale = pts[0].scale;
      const layers = [
        { w: 6.4 * weight * (0.45 + scale * 0.55), a: 0.055 * alphaMul * depth, color: secondary },
        { w: 2.15 * weight * (0.7 + scale * 0.25), a: 0.18 * alphaMul * depth, color: col },
        { w: 1.15 * weight, a: 0.46 * alphaMul * depth, color: "#fff1c4" },
      ];
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const layer of layers) {
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.strokeStyle = hexToRgba(layer.color, Math.max(0.02, Math.min(0.9, layer.a)));
        ctx.lineWidth = layer.w;
        ctx.stroke();
      }
    };

    const sky = ctx.createLinearGradient(0, 0, 0, horizonY * 1.05);
    sky.addColorStop(0, hexToRgba("#120a04", 0.1));
    sky.addColorStop(1, hexToRgba(secondary, 0));
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, horizonY * 1.05);

    const drawRings = (x: number, y: number, scale: number) => {
      for (const ring of groundRings) {
        const rx = ring.r * Math.min(width, height) * scale * 0.9;
        const ry = Math.max(1.5, rx * 0.22);
        ctx.beginPath();
        const seg = 36;
        for (let s = 0; s <= seg; s++) {
          const a = (s / seg) * Math.PI * 2;
          const px = x + Math.cos(a) * rx;
          const py = y + Math.sin(a) * ry;
          if (s === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = hexToRgba(primary, Math.max(0, ring.life) * 0.55);
        ctx.lineWidth = 1.4;
        ctx.stroke();
      }
    };

    const drawOrb = (x: number, y: number, radius: number) => {
      const r = Math.max(1.5, radius);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
      g.addColorStop(0, `rgba(255,255,255,${0.28 + kickFallback * 0.67})`);
      g.addColorStop(0.2, hexToRgba(primary, 0.32 + kickFallback * 0.5));
      g.addColorStop(0.55, hexToRgba(primary, 0.1));
      g.addColorStop(1, hexToRgba(primary, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
    };

    if (landmark === "sun") {
      const sunR = (0.15 + kickFallback * 0.85) * Math.min(width, height) * 0.16;
      drawOrb(cx, horizonY, sunR);
      drawRings(cx, horizonY, 0.22 + anchorV * 1.15);
    }

    const alphaMul = 0.82 + energy * 0.65 + drop * 0.5;
    let landmarkDrawn = false;
    const rowDenom = Math.max(1, rows - 1);

    for (let j = 0; j < rows; j++) {
      const v = j / rowDenom;
      const pts = buildRow(v, j);
      const mid = pts[Math.floor(pts.length / 2)];
      if (mid && fogAmt > 0.01) {
        const drift = (vocal ?? 0) * Math.sin(phase * 0.28 + j * 0.6) * height * 0.015;
        const y = mid.y + drift;
        const band = Math.max(6, (height - horizonY) / rows);
        const fog = ctx.createLinearGradient(0, y - band, 0, y + band * 0.2);
        const a = Math.min(0.2, fogAmt * (0.04 + v * 0.05));
        fog.addColorStop(0, hexToRgba(secondary, 0));
        fog.addColorStop(0.72, hexToRgba(primary, a));
        fog.addColorStop(1, hexToRgba(secondary, a * 0.3));
        ctx.fillStyle = fog;
        ctx.fillRect(0, y - band, width, band);
      }
      strokeRow(pts, alphaMul, 1);
      if (drop > 0.22 && j < rows - 1) {
        const vMid = (j + 0.5) / rowDenom;
        strokeRow(buildRow(vMid, j), alphaMul * (0.42 + drop * 0.35), 0.8);
      }
      const densify = 1 + buildup * 0.85 + drop * 0.4;
      for (let i = 1; i < pts.length - 1; i++) {
        const u = pts[i].u;
        const ridge = Math.sin(u * Math.PI * 3 + phase * 0.35 + v * 2);
        if (ridge < 0.58) continue;
        // Right-side grit needs treble/hat. Hats alone stay in foreground glitter.
        const detail = u > 0.66 ? Math.min(energy, hat) : energy;
        if (detail <= 0.04) continue;
        const s = seedFrom(features.timeMs, trackSeed, j * 131 + i);
        const chance = Math.min(0.9, (0.08 + complexity * 0.22) * detail * densify);
        if (rand01(s) > chance) continue;
        const rad = Math.max(0.6, pts[i].scale * (0.65 + rand01(s ^ 0x9e3779b9) * 1.05));
        ctx.beginPath();
        ctx.arc(pts[i].x, pts[i].y, rad, 0, Math.PI * 2);
        ctx.fillStyle = hexToRgba("#ffe7a8", Math.min(0.88, 0.22 + detail * 0.5));
        ctx.fill();
      }
      if (!landmarkDrawn && landmark === "obelisk" && v >= anchorV) {
        const base = project(anchorU, anchorV, 0);
        const shaftH = Math.min(width, height) * 0.2 * base.scale;
        const topY = base.y - shaftH;
        const botW = 5.5 * base.scale;
        const topW = 1.6 * base.scale;
        drawRings(base.x, base.y, base.scale);
        ctx.beginPath();
        ctx.moveTo(base.x - botW, base.y);
        ctx.lineTo(base.x + botW, base.y);
        ctx.lineTo(base.x + topW, topY);
        ctx.lineTo(base.x - topW, topY);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(secondary, 0.84);
        ctx.fill();
        ctx.strokeStyle = hexToRgba(primary, 0.72);
        ctx.lineWidth = 1.25;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(base.x - botW * 0.12, base.y);
        ctx.lineTo(base.x, topY + 2);
        ctx.strokeStyle = hexToRgba("#fff1c4", 0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
        const orbR = (0.15 + kickFallback * 0.85) * Math.min(width, height) * 0.085 * base.scale;
        drawOrb(base.x, topY, orbR);
        landmarkDrawn = true;
      }
    }

    const glitterGate = hat * glitter;
    if (glitterGate > 0.02) {
      const n = Math.floor(3 + glitterGate * 28);
      for (let i = 0; i < n; i++) {
        const s = seedFrom(features.timeMs, trackSeed, 80000 + i);
        const px = rand01(s) * width;
        const py = height * (2 / 3 + rand01(s ^ 0x9e3779b9) * (1 / 3));
        ctx.fillStyle = hexToRgba("#fff6d2", Math.min(0.95, 0.35 + glitterGate));
        ctx.fillRect(px, py, 1.4, 1.4);
      }
    }
  },
};
