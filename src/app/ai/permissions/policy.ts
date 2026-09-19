export const GRANTS = ["READ", "DRAFT", "EDIT"] as const;
export type Grant = (typeof GRANTS)[number];

/** Reserved. Unused in AI-1–7. */
export const UNUSED_GRANTS = ["EXPORT"] as const;

export const DIRECTOR_MODES = ["ASK", "DRAFT", "AGENT"] as const;
export type DirectorMode = (typeof DIRECTOR_MODES)[number];

export function isGrant(value: unknown): value is Grant {
  return value === "READ" || value === "DRAFT" || value === "EDIT";
}

/** Rank for negotiation only. Higher is more authority. Never auto-applied. */
export const GRANT_RANK: Record<Grant, number> = { READ: 0, DRAFT: 1, EDIT: 2 };

export function grantRank(grant: Grant): number {
  return GRANT_RANK[grant];
}

/** True when required is strictly above current. READ→EDIT is escalation. */
export function grantExceeds(required: Grant, current: Grant): boolean {
  return grantRank(required) > grantRank(current);
}

export function canRead(grant: Grant): boolean {
  return grant === "READ" || grant === "DRAFT" || grant === "EDIT";
}

export function canDraft(grant: Grant, mode: DirectorMode): boolean {
  if (!canRead(grant)) return false;
  if (grant === "READ") return false;
  if (mode === "ASK") return false;
  return grant === "DRAFT" || grant === "EDIT";
}

/**
 * Commit requires EDIT + explicit approval.
 * AGENT does not bypass approval on the first slice.
 */
export function canCommit(grant: Grant, mode: DirectorMode, approval: boolean): boolean {
  if (!approval) return false;
  if (grant !== "EDIT") return false;
  if (mode === "ASK" || mode === "DRAFT") return false;
  return mode === "AGENT";
}

export function denyReason(opts: {
  grant: unknown;
  mode: DirectorMode;
  action: "read" | "draft" | "commit";
  approval?: boolean;
}): string | null {
  if (!isGrant(opts.grant)) return "INVALID_GRANT";
  if (opts.action === "read" && !canRead(opts.grant)) return "GRANT_DENIED";
  if (opts.action === "draft" && !canDraft(opts.grant, opts.mode)) return "GRANT_DENIED";
  if (opts.action === "commit") {
    if (!isGrant(opts.grant) || opts.grant !== "EDIT") return "GRANT_DENIED";
    if (opts.approval !== true) return "APPROVAL_REQUIRED";
    if (opts.mode !== "AGENT") return "GRANT_DENIED";
  }
  return null;
}
