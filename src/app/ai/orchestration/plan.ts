/**
 * DirectorPlan. How to invoke the existing pipeline.
 * No Project mutation. No tool execution. No second command engine.
 */
import type { ContextLevel } from "../context/types";
import type { DirectorMode, Grant } from "../permissions/policy";
import { classifyDirectorIntent, type DirectorIntent } from "./intent";

export const DIRECTOR_CAPABILITIES = [
  "chat",
  "timeline.get_selection",
  "timeline.get_clip",
  "audio.get_analysis",
  "timeline.move_clip",
  "none",
] as const;

export type DirectorCapability = (typeof DIRECTOR_CAPABILITIES)[number];

export interface DirectorPlan {
  intent: DirectorIntent;
  mode: DirectorMode;
  requiredGrant: Grant;
  contextLevel: ContextLevel;
  capability: DirectorCapability;
  toolName: string | null;
  providerAction: "chat" | "read-tool" | "none";
}

/** Freeze the plan so later UI / setState writes cannot mutate it. */
export function sealDirectorPlan(plan: DirectorPlan): DirectorPlan {
  return Object.freeze({
    ...plan,
    intent: Object.freeze({ ...plan.intent }),
  });
}

/** Compact AUTO status. Not the Advanced dropdown values. */
export function directorPlanStatus(plan: DirectorPlan): string {
  return `${plan.mode} · ${plan.contextLevel} · ${plan.requiredGrant}`;
}

/**
 * Minimum necessary context. Selected/markierter clip → SELECTION.
 * General / capability / unsupported → NONE. Never PROJECT.
 */
export function planDirectorTurn(text: string): DirectorPlan {
  const intent = classifyDirectorIntent(text);
  return sealDirectorPlan(planForIntent(intent));
}

function planForIntent(intent: DirectorIntent): DirectorPlan {
  switch (intent.kind) {
    case "ASK_SELECTION":
      return {
        intent,
        mode: "ASK",
        requiredGrant: "READ",
        contextLevel: "SELECTION",
        capability: "timeline.get_selection",
        toolName: "timeline.get_selection",
        providerAction: "read-tool",
      };
    case "READ_CLIP":
      return {
        intent,
        mode: "ASK",
        requiredGrant: "READ",
        contextLevel: "SELECTION",
        capability: "timeline.get_clip",
        toolName: "timeline.get_clip",
        providerAction: "read-tool",
      };
    case "MOVE_CLIP":
      return {
        intent,
        mode: "AGENT",
        requiredGrant: "EDIT",
        contextLevel: "SELECTION",
        capability: "timeline.move_clip",
        toolName: "timeline.move_clip",
        providerAction: "chat",
      };
    case "DRAFT_CUT":
      return {
        intent,
        mode: "DRAFT",
        requiredGrant: "READ",
        contextLevel: "NONE",
        capability: "none",
        toolName: null,
        providerAction: "none",
      };
    case "ASK_CAPABILITY":
      return {
        intent,
        mode: "ASK",
        requiredGrant: "READ",
        contextLevel: "NONE",
        capability: "none",
        toolName: null,
        providerAction: "none",
      };
    case "UNSUPPORTED":
      return {
        intent,
        mode: "ASK",
        requiredGrant: "READ",
        contextLevel: "NONE",
        capability: "none",
        toolName: null,
        providerAction: "none",
      };
    case "UNCERTAIN":
      return {
        intent,
        mode: "ASK",
        requiredGrant: "READ",
        contextLevel: "NONE",
        capability: "chat",
        toolName: null,
        providerAction: "chat",
      };
  }
}
