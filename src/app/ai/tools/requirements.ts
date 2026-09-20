/**
 * Deterministic tool requirement metadata.
 * Router source of truth — not Advanced Mode / Grant / Context dropdowns.
 */
import type { ContextLevel } from "../context/types";
import type { Grant } from "../permissions/policy";

export type ToolTargetType = "clip" | "project" | "none";

export interface ToolRequirement {
  readonly name: string;
  readonly mutation: boolean;
  readonly requiredPermission: Grant;
  readonly requiredContext: ContextLevel;
  readonly targetType: ToolTargetType;
  /** False → exactly one compatible target. Multiple is fail-closed. */
  readonly supportsMultipleTargets: boolean;
}

export const MOVE_CLIP_REQUIREMENT: ToolRequirement = {
  name: "timeline.move_clip",
  mutation: true,
  requiredPermission: "EDIT",
  requiredContext: "SELECTION",
  targetType: "clip",
  supportsMultipleTargets: false,
};

export const TOOL_REQUIREMENTS: readonly ToolRequirement[] = [
  MOVE_CLIP_REQUIREMENT,
  {
    name: "timeline.get_selection",
    mutation: false,
    requiredPermission: "READ",
    requiredContext: "SELECTION",
    targetType: "clip",
    supportsMultipleTargets: true,
  },
  {
    name: "timeline.get_clip",
    mutation: false,
    requiredPermission: "READ",
    requiredContext: "SELECTION",
    targetType: "clip",
    supportsMultipleTargets: false,
  },
  {
    name: "audio.get_analysis",
    mutation: false,
    requiredPermission: "READ",
    requiredContext: "SELECTION",
    targetType: "clip",
    supportsMultipleTargets: false,
  },
  {
    name: "project.describe",
    mutation: false,
    requiredPermission: "READ",
    requiredContext: "PROJECT",
    targetType: "project",
    supportsMultipleTargets: false,
  },
  {
    name: "timeline.describe",
    mutation: false,
    requiredPermission: "READ",
    requiredContext: "PROJECT",
    targetType: "project",
    supportsMultipleTargets: false,
  },
  {
    name: "automation.read",
    mutation: false,
    requiredPermission: "READ",
    requiredContext: "TRACK",
    targetType: "none",
    supportsMultipleTargets: false,
  },
];

export function toolRequirementOf(name: string | null | undefined): ToolRequirement | null {
  if (!name) return null;
  return TOOL_REQUIREMENTS.find((tool) => tool.name === name) ?? null;
}

export function toolRequiresSingleClip(requirement: ToolRequirement | null): boolean {
  return Boolean(
    requirement &&
      requirement.requiredContext === "SELECTION" &&
      requirement.targetType === "clip" &&
      !requirement.supportsMultipleTargets,
  );
}
