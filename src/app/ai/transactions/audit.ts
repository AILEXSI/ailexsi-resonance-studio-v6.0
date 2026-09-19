import { createId } from "../../../core/ids";

export interface AuditEntry {
  id: string;
  at: number;
  action: string;
  toolName?: string;
  result: "ok" | "denied" | "error";
  detail?: string;
}

const entries: AuditEntry[] = [];
const MAX = 200;

function redact(text: string): string {
  return text
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/apiKey["']?\s*[:=]\s*["']?[^"'\s]+/gi, "apiKey:[redacted]")
    .replace(/sourcePath["']?\s*[:=]\s*["']?[^"'\s]+/gi, "sourcePath:[redacted]")
    .replace(/blob:[^\s"]+/gi, "blob:[redacted]");
}

export function recordAudit(partial: Omit<AuditEntry, "id" | "at">): AuditEntry {
  const entry: AuditEntry = {
    id: createId("aud"),
    at: Date.now(),
    ...partial,
    detail: partial.detail ? redact(partial.detail) : undefined,
  };
  entries.push(entry);
  if (entries.length > MAX) entries.shift();
  return entry;
}

export function listAudit(): readonly AuditEntry[] {
  return entries;
}

export function clearAudit(): void {
  entries.length = 0;
}
