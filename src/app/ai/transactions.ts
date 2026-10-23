import { applyCommand, type EditorCommand } from "../commands";
import { createId } from "../../core/ids";
import { commitPreparedProject, type Session } from "../session";
import { previewPlan, type PlanStep, type PreviewOptions } from "./preview";
import { projectStandIn } from "./stand-in";
import type { MutationProposal } from "./tools/mutate";

export type AiTxnStatus = "proposed" | "accepted" | "rejected" | "executed";

export interface AITransaction {
  id: string;
  status: AiTxnStatus;
  /** Statuses this transaction has passed through, including `accepted` before `executed`. */
  statuses: AiTxnStatus[];
  tool: string;
  summary: string;
  steps: PlanStep[];
  command: EditorCommand;
  exactMarkerTimes?: boolean;
  preserveSelection?: boolean;
  baseStandIn: string;
  basePastLength: number;
  prompt: string;
  error?: string;
}

export interface TransactionOutcome {
  session: Session;
  transaction: AITransaction;
  error?: string;
}

export function proposeTransaction(session: Session, proposal: MutationProposal, prompt: string): AITransaction {
  return {
    id: createId("aitx"),
    status: "proposed",
    statuses: ["proposed"],
    tool: proposal.tool,
    summary: proposal.summary,
    steps: proposal.steps,
    command: proposal.command,
    exactMarkerTimes: proposal.exactMarkerTimes,
    preserveSelection: proposal.preserveSelection,
    baseStandIn: projectStandIn(session.project),
    basePastLength: session.history.past.length,
    prompt,
  };
}

function withStatus(txn: AITransaction, status: AiTxnStatus, error?: string): AITransaction {
  return {
    ...txn,
    status,
    statuses: [...txn.statuses, status],
    error,
  };
}

/**
 * Human Accept. A single command calls `applyCommand` once.
 * A multi-step plan is replayed on a scratch session, then committed
 * with one `withHistory` entry.
 */
export function acceptTransaction(session: Session, txn: AITransaction): TransactionOutcome {
  if (txn.status !== "proposed") {
    return { session, transaction: txn, error: "Proposal is not open" };
  }
  if (
    session.history.past.length !== txn.basePastLength ||
    projectStandIn(session.project) !== txn.baseStandIn
  ) {
    return { session, transaction: txn, error: "TRANSACTION_CONFLICT" };
  }
  const single = txn.steps.length === 1 && txn.steps[0]?.kind === "command" ? txn.steps[0].command : null;
  const previewOptions: PreviewOptions | undefined = txn.exactMarkerTimes ? { exactMarkerTimes: true } : undefined;
  const preview = previewPlan(session, txn.steps, previewOptions);
  if (!preview.ok) {
    return { session, transaction: txn, error: preview.error };
  }
  const accepted = withStatus(txn, "accepted");
  let next = single
    ? applyCommand(session, single)
    : commitPreparedProject(session, preview.session, `AI — ${txn.tool}`);
  if (next.history.past.length !== session.history.past.length + 1) {
    return { session, transaction: txn, error: next.error ?? "No change" };
  }
  if (txn.preserveSelection) {
    next = {
      ...next,
      selectedClipId: session.selectedClipId,
      selectedClipIds: [...session.selectedClipIds],
      selectionAnchorClipId: session.selectionAnchorClipId,
    };
  }
  return {
    session: next,
    transaction: withStatus(accepted, "executed"),
  };
}

/** Human Reject. The session is not modified. */
export function rejectTransaction(session: Session, txn: AITransaction): TransactionOutcome {
  if (txn.status !== "proposed") {
    return { session, transaction: txn, error: "Proposal is not open" };
  }
  return { session, transaction: withStatus(txn, "rejected") };
}
