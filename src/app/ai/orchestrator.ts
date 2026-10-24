import type { Session } from "../session";
import { assertToolAllowed } from "./permissions";
import { proposeTransaction, type AITransaction } from "./transactions";
import { isMutationToolName, planMutation } from "./tools/mutate";
import { callReadTool } from "./tools/registry";
import type { ToolResult } from "./tools/result";

export type ToolDispatch =
  | { kind: "read"; result: ToolResult<unknown> }
  | { kind: "proposal"; transaction: AITransaction }
  | { kind: "error"; code: string; error: string };

/**
 * Run one tool call. Reads return data. Mutations become a proposed
 * transaction and do not assign the live session.
 */
export function dispatchTool(
  session: Session,
  name: string,
  args: unknown,
  prompt: string,
  allow?: readonly string[],
): ToolDispatch {
  const grant = assertToolAllowed(name, allow);
  if (!grant.ok) return { kind: "error", code: grant.code, error: grant.error };
  if (isMutationToolName(name)) {
    const planned = planMutation(session, name, args);
    if (!planned.ok) return { kind: "error", code: planned.code, error: planned.error };
    return { kind: "proposal", transaction: proposeTransaction(session, planned.data, prompt) };
  }
  return { kind: "read", result: callReadTool(session, name, args) };
}
