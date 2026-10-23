# AI-4 — Transactions, permissions, orchestrator

Status: complete.

## What landed

- `AITransaction` with status `proposed`, `accepted`, `rejected`, or `executed`. A successful Accept records `proposed → accepted → executed`.
- Accept of a one-command proposal calls `applyCommand` once. That is one `withHistory` step. Reject does not.
- Stale Apply fails closed when the project JSON or `history.past.length` differs from the proposal. No `projectRevision` field was added. `schemaVersion` stays 5.
- Permissions: the default grant is the read tools plus the four mutation tools. `history.undo` stays denied even if a caller lists it. Reads run. Mutations only propose.
- The panel shows Accept and Reject. Undo is the existing editor undo.

## What did not land

- No provider. Send still answers that no model is connected.
- Multi-step plans return `MULTI_STEP_UNSUPPORTED` and do not commit. One undo for several steps is AI-6.

## Tests

- `tests/ai/transactions.test.ts` — exact +2000 ms, 12 fresh runs, 12 chained runs, undo, redo, reject, conflict, locked clip, denied undo. `fetch` is not called.
- `tests/ai/director-accept.test.tsx` — panel Accept, then editor Undo.

## Next

AI-5: provider adapter, deterministic mock, explicit Send.
