import type { Session } from "../../session";
import { projectRevisionOf } from "../../session";
import { invokeTool } from "../tools/registry";
import type { ToolResult } from "../tools/types";
import { canRead, isGrant, type DirectorMode, type Grant } from "../permissions/policy";
import { recordAudit } from "./audit";

/**
 * Trusted read path: schema → grant → semantic (handler) → revision stamp (no write).
 */
export function invokeTrustedRead(
  name: string,
  args: unknown,
  opts: { session: Session; grant: unknown; mode: DirectorMode },
): ToolResult & { projectRevision: number } {
  const projectId = opts.session.project.id;
  const projectRevision = projectRevisionOf(opts.session);
  if (!isGrant(opts.grant) || !canRead(opts.grant as Grant)) {
    recordAudit({
      action: "tool",
      toolName: name,
      result: "denied",
      detail: "GRANT_DENIED",
      projectId,
      projectRevision,
    });
    return {
      ok: false,
      code: "GRANT_DENIED",
      message: "READ grant required",
      projectRevision,
    };
  }
  const result = invokeTool(name, args, { session: opts.session, grant: opts.grant as Grant });
  recordAudit({
    action: "tool",
    toolName: name,
    result: result.ok ? "ok" : "error",
    detail: result.ok ? undefined : result.code,
    projectId,
    projectRevision,
  });
  return { ...result, projectRevision };
}
