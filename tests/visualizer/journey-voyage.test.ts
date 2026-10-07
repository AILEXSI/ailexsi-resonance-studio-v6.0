import { describe, expect, it } from "vitest";
import { deriveJourneyRoute } from "../../src/core/visualz/scenes/journey-voyage";
import type { AudioFeatures } from "../../src/core/visualz/types";
const f=(timeMs:number,p:Partial<AudioFeatures>={}):AudioFeatures=>({timeMs,rms:0,bass:0,mid:0,treble:0,spectrum:new Float32Array(64),onset:false,beatPulse:0,...p});
describe("Journey Voyage routing",()=>{
 it("starts in world zero without a transition",()=>{expect(deriveJourneyRoute(f(0))).toEqual({index:0,nextIndex:1,mix:0})});
 it("advances deterministically every chapter",()=>{expect(deriveJourneyRoute(f(16000)).index).toBe(1);expect(deriveJourneyRoute(f(32000)).index).toBe(2)});
 it("crossfades near the chapter edge",()=>{const r=deriveJourneyRoute(f(15000));expect(r.mix).toBeGreaterThan(0);expect(r.mix).toBeLessThanOrEqual(1)});
 it("lets a breakthrough pull the transition earlier",()=>{const plain=deriveJourneyRoute(f(10500));const drop=deriveJourneyRoute(f(10500,{rms:.95,bass:1,mid:.7,beatPulse:1,onset:true}));expect(drop.mix).toBeGreaterThan(plain.mix)});
 it("wraps after all six worlds",()=>{expect(deriveJourneyRoute(f(96000)).index).toBe(0)});
});
