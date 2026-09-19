import { createId } from "../../../core/ids";
import { applyCommand, type EditorCommand } from "../../commands";
import { projectRevisionOf, type Session } from "../../session";
import { clipById, clipIsLocked } from "../../../core/models";
import type { Project } from "../../../core/models";
import {
  canCommit,
  canDraft,
  denyReason,
  isGrant,
  type DirectorMode,
} from "../permissions/policy";
import { recordAudit } from "./audit";

export type TransactionStatus = "draft" | "applied" | "rejected";

export interface TransactionPreview {
  clipId?: string;
  beforeStartMs?: number;
  afterStartMs?: number;
  commandType: string;
}

export interface AITransaction {
  id: string;
  toolName: string;
  command: EditorCommand;
  /** Session-lifetime document identity. Required with baseRevision. */
  projectId: string;
  baseRevision: number;
  draftProject: Project | null;
  preview: TransactionPreview;
  status: TransactionStatus;
  createdAt: number;
}

export type TransactionErrorCode =
  | "GRANT_DENIED"
  | "INVALID_GRANT"
  | "APPROVAL_REQUIRED"
  | "TRANSACTION_CONFLICT"
  | "SEMANTIC"
  | "NO_DRAFT";

export interface TransactionFail {
  ok: false;
  code: TransactionErrorCode;
  message: string;
  transaction?: AITransaction;
}

export interface TransactionOk {
  ok: true;
  transaction: AITransaction;
  session: Session;
}

function clipStart(project: Project, clipId: string | undefined): number | undefined {
  if (!clipId) return undefined;
  return clipById(project, clipId)?.startMs;
}

function clipIdOfCommand(command: EditorCommand): string | undefined {
  if (command.type === "moveClips") return command.clipIds[0];
  return undefined;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) deepFreeze(child);
  }
  return value;
}

function sealCommand(command: EditorCommand): EditorCommand {
  return deepFreeze(structuredClone(command));
}

function safeAudit(partial: Parameters<typeof recordAudit>[0]): void {
  try {
    recordAudit(partial);
  } catch {
    // Audit must never corrupt or roll back a Project mutation.
  }
}

function commandMatchesPreview(txn: AITransaction): boolean {
  if (txn.command.type !== "moveClips") return txn.preview.commandType === txn.command.type;
  const clipId = txn.command.clipIds[0];
  if (!clipId || txn.preview.clipId !== clipId) return false;
  if (txn.preview.beforeStartMs == null || txn.preview.afterStartMs == null) return false;
  return txn.preview.beforeStartMs + txn.command.deltaMs === txn.preview.afterStartMs;
}

function revalidateAtCommit(session: Session, txn: AITransaction): TransactionFail | null {
  if (session.project.id !== txn.projectId || projectRevisionOf(session) !== txn.baseRevision) {
    return { ok: false, code: "TRANSACTION_CONFLICT", message: "Stale revision", transaction: txn };
  }
  if (!commandMatchesPreview(txn)) {
    return { ok: false, code: "TRANSACTION_CONFLICT", message: "Command mutated after draft", transaction: txn };
  }
  const clipId = clipIdOfCommand(txn.command);
  if (clipId) {
    const clip = clipById(session.project, clipId);
    if (!clip) {
      return { ok: false, code: "SEMANTIC", message: "Clip not found", transaction: txn };
    }
    if (clipIsLocked(clip)) {
      return { ok: false, code: "SEMANTIC", message: "Clip is locked", transaction: txn };
    }
    if (txn.preview.beforeStartMs != null && clip.startMs !== txn.preview.beforeStartMs) {
      return { ok: false, code: "TRANSACTION_CONFLICT", message: "Clip moved since draft", transaction: txn };
    }
  }
  return null;
}

/**
 * Schema → grant → semantic → revision → draft (structuredClone + applyCommand on a copy).
 * Canonical Session.project is not assigned.
 */
export function draftCommandTransaction(opts: {
  session: Session;
  command: EditorCommand;
  grant: unknown;
  mode: DirectorMode;
  toolName: string;
}): TransactionOk | TransactionFail {
  const denied = denyReason({ grant: opts.grant, mode: opts.mode, action: "draft" });
  if (denied === "INVALID_GRANT" || !isGrant(opts.grant)) {
    safeAudit({ action: "draft", toolName: opts.toolName, result: "denied", detail: "INVALID_GRANT" });
    return { ok: false, code: "INVALID_GRANT", message: "Invalid grant" };
  }
  if (denied || !canDraft(opts.grant, opts.mode)) {
    safeAudit({ action: "draft", toolName: opts.toolName, result: "denied", detail: "GRANT_DENIED" });
    return { ok: false, code: "GRANT_DENIED", message: "Draft denied" };
  }
  const sealed = sealCommand(opts.command);
  const working: Session = {
    ...opts.session,
    project: structuredClone(opts.session.project),
    history: { past: [], future: [] },
  };
  const drafted = applyCommand(working, sealed);
  if (drafted.error && drafted.project === working.project) {
    safeAudit({
      action: "draft",
      toolName: opts.toolName,
      result: "error",
      detail: drafted.error,
    });
    return { ok: false, code: "SEMANTIC", message: drafted.error };
  }
  const clipId = clipIdOfCommand(sealed);
  const txn: AITransaction = {
    id: createId("txn"),
    toolName: opts.toolName,
    command: sealed,
    projectId: opts.session.project.id,
    baseRevision: projectRevisionOf(opts.session),
    draftProject: drafted.project,
    preview: deepFreeze({
      clipId,
      beforeStartMs: clipStart(opts.session.project, clipId),
      afterStartMs: clipStart(drafted.project, clipId),
      commandType: sealed.type,
    }),
    status: "draft",
    createdAt: Date.now(),
  };
  safeAudit({ action: "draft", toolName: opts.toolName, result: "ok", detail: txn.id });
  return { ok: true, transaction: txn, session: opts.session };
}

/**
 * Apply: revision check → ONE applyCommand → one withHistory.
 * Never assigns txn.draftProject onto Session.project.
 */
export function applyCommandTransaction(opts: {
  session: Session;
  transaction: AITransaction;
  grant: unknown;
  mode: DirectorMode;
  approval: boolean;
}): TransactionOk | TransactionFail {
  const txn = opts.transaction;
  if (txn.status !== "draft" || !txn.draftProject) {
    return { ok: false, code: "NO_DRAFT", message: "No draft to apply", transaction: txn };
  }
  if (!isGrant(opts.grant)) {
    safeAudit({ action: "apply", toolName: txn.toolName, result: "denied", detail: "INVALID_GRANT" });
    return { ok: false, code: "INVALID_GRANT", message: "Invalid grant", transaction: txn };
  }
  if (!opts.approval) {
    safeAudit({ action: "apply", toolName: txn.toolName, result: "denied", detail: "APPROVAL_REQUIRED" });
    return { ok: false, code: "APPROVAL_REQUIRED", message: "EDIT without approval denied", transaction: txn };
  }
  if (!canCommit(opts.grant, opts.mode, opts.approval)) {
    safeAudit({ action: "apply", toolName: txn.toolName, result: "denied", detail: "GRANT_DENIED" });
    return { ok: false, code: "GRANT_DENIED", message: "Commit denied", transaction: txn };
  }
  const stale = revalidateAtCommit(opts.session, txn);
  if (stale) {
    safeAudit({ action: "apply", toolName: txn.toolName, result: "denied", detail: stale.code });
    return stale;
  }
  const next = applyCommand(opts.session, txn.command);
  if (next.error && next.history.past.length === opts.session.history.past.length) {
    safeAudit({ action: "apply", toolName: txn.toolName, result: "error", detail: next.error });
    return { ok: false, code: "SEMANTIC", message: next.error, transaction: txn };
  }
  const applied: AITransaction = { ...txn, status: "applied", draftProject: null };
  safeAudit({ action: "apply", toolName: txn.toolName, result: "ok", detail: applied.id });
  return { ok: true, transaction: applied, session: next };
}

export function rejectTransaction(txn: AITransaction): AITransaction {
  safeAudit({ action: "reject", toolName: txn.toolName, result: "ok", detail: txn.id });
  return { ...txn, status: "rejected", draftProject: null };
}
