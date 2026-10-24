import type { Project } from "../../core/models";

/** Temporary stand-in for a project revision. Not `schemaVersion` and not `updatedAt` alone. */
export function projectStandIn(project: Project): string {
  return JSON.stringify(project);
}
