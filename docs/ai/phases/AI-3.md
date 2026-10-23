# AI-3 — Proposal-only mutations

Status: complete.

## What landed

Planners for `timeline.move_clip`, `timeline.split_at_playhead`, `timeline.lift_delete`, and `timeline.nudge`. Each planner validates arguments, dry-runs `applyCommand` on a cloned session, and returns a proposal. The live session is not assigned and history is not pushed.

`timeline.move_clip` emits `{ type: "moveClips", deltaMs }`. With snap on and a nearby marker, +2.000 s stays +2000 ms. `timeline.nudge` emits `nudgeClip` and says that snap can change the delta.

A move that would start before 0 ms is rejected. The core would clamp it; clamping is not an exact move.

## What did not land

Accept and Reject are not wired. A proposal cannot change the project yet. That waits for the transaction object (map: no first mutation without a transaction).

## Tests

- `tests/ai/mutate-tools.test.ts`

## Next

AI-4: transaction, permissions, and one `applyCommand` / `withHistory` on Accept.
