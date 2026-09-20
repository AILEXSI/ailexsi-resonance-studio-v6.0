/**
 * DirectorPlan. How to invoke the existing pipeline.
 * Tool requirement metadata is the source of truth for grant / context.
 * No Project mutation. No tool execution. No second command engine.
 */
import type { ContextLevel } from "../context/types";
import type { DirectorMode, Grant } from "../permissions/policy";
import { toolRequirementOf } from "../tools/requirements";
import { classifyDirectorIntent, type DirectorIntent } from "./intent";

export const DIRECTOR_RUNTIME_MODES = ["AUTO", "MANUAL"] as const;
export type DirectorRuntimeMode = (typeof DIRECTOR_RUNTIME_MODES)[number];

export const DIRECTOR_CAPABILITIES = [
  "chat",
  "timeline.get_selection",
  "timeline.get_clip",
  "audio.get_analysis",
  "timeline.move_clip",
  "project.describe",
  "timeline.describe",
  "none",
] as const;

export type DirectorCapability = (typeof DIRECTOR_CAPABILITIES)[number];

export interface DirectorPlan {
  intent: DirectorIntent;
  /** Execution mode for the existing permission pipeline. Not the Advanced dropdown. */
  mode: DirectorMode;
  /** Same value as requiredPermission. Kept for existing AUTO tests. */
  requiredGrant: Grant;
  /** Tool metadata required permission. AUTO may derive this. AUTO must not grant it. */
  requiredPermission: Grant;
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

/** Compact plan triple. Effective AUTO chrome uses effectiveRequestStatus. */
export function directorPlanStatus(plan: DirectorPlan): string {
  return `${plan.mode} · ${plan.contextLevel} · ${plan.requiredPermission}`;
}

function planFromTool(
  intent: DirectorIntent,
  toolName: string | null,
  mode: DirectorMode,
  providerAction: DirectorPlan["providerAction"],
  fallbackContext: ContextLevel = "NONE",
): DirectorPlan {
  const requirement = toolRequirementOf(toolName);
  const requiredPermission = requirement?.requiredPermission ?? "READ";
  return {
    intent,
    mode,
    requiredGrant: requiredPermission,
    requiredPermission,
    contextLevel: requirement?.requiredContext ?? fallbackContext,
    capability: (toolName && DIRECTOR_CAPABILITIES.includes(toolName as DirectorCapability)
      ? toolName
      : toolName
        ? "none"
        : providerAction === "chat"
          ? "chat"
          : "none") as DirectorCapability,
    toolName,
    providerAction,
  };
}

/**
 * Request-scoped plan. Manual ASK / READ / NONE never write this.
 * Selected/markierter clip → SELECTION via tool metadata.
 * Project-track questions → PROJECT. Greeting / capability / unsupported → NONE.
 */
export function planDirectorTurn(text: string): DirectorPlan {
  const intent = classifyDirectorIntent(text);
  return sealDirectorPlan(planForIntent(intent));
}

function planForIntent(intent: DirectorIntent): DirectorPlan {
  switch (intent.kind) {
    case "ASK_SELECTION":
      return planFromTool(intent, "timeline.get_selection", "ASK", "read-tool");
    case "READ_CLIP":
      return planFromTool(intent, "timeline.get_clip", "ASK", "read-tool");
    case "READ_PROJECT":
      return planFromTool(intent, "project.describe", "ASK", "read-tool");
    case "MOVE_CLIP":
      return planFromTool(intent, "timeline.move_clip", "AGENT", "chat");
    case "DRAFT_CUT":
      return planFromTool(intent, null, "DRAFT", "none");
    case "ASK_CAPABILITY":
      return planFromTool(intent, null, "ASK", "none");
    case "CHAT":
      return planFromTool(intent, null, "ASK", "none");
    case "UNSUPPORTED":
      return planFromTool(intent, null, "ASK", "none");
    case "UNCERTAIN":
      return planFromTool(intent, null, "ASK", "chat", "NONE");
  }
}
