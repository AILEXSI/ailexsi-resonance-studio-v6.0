# 12 — Metrics and correction cost

**Question the metrics exist to answer:** did the AI reduce human work?

A lower model loss, a higher F1 on ClipShots, or a fluent paragraph does not answer it. QuickCut published authoring minutes because that was the quantity that mattered. This spec uses quantities that can be computed from two arrangements when a stopwatch is not available.

## Definitions

Let `A` be the AI arrangement and `H` the human arrangement after they stopped editing. Diff classes are from [10](./10_TIMELINE_DIFF_RESEARCH.md).

| Metric | Formula | Unit | Notes |
| --- | --- | --- | --- |
| `op_count` | Number of diff records that are not `unchanged` and not `shifted` | count | Shift is ripple, not work. Counting it inflates cost |
| `boundary_ms` | Median absolute source-edge delta over matched `retimed` pairs. Unmatched adds/removes count as the full duration of that range, and are included in the median only if the pre-registered rule says so | ms | Pre-register: unmatched ranges contribute their duration to a **separate** `unmatched_ms` sum, not to the median |
| `unmatched_ms` | Sum of durations of `added` and `removed` | ms | Restores and extra cuts |
| `duration_error` | `abs(dur(A) - dur(H)) / dur(source)` | ratio | Easy to game if both cut everything. Always publish beside `op_count` |
| `recut_rate` | (AI KEEP ranges whose overlap with H is < 50% of the AI range) / (AI KEEP count) | ratio | "The human threw this keep away" |
| `session_ms` | Wall time from first view of A to commit of H | ms | UNKNOWN if nobody was timed. Do not estimate |
| `command_count` | `EditorCommand`s issued during the session | count | Only when a host records them. UNKNOWN in the offline PoC |

## Correction cost

```text
cost(A, H) = op_count + unmatched_ms / 1000
```

The divisor makes one second of unmatched media equal to one structural op, so a tiny boundary nip does not equal deleting a minute. **This weight is a hypothesis.** The PoC reports `op_count` and `unmatched_ms` separately, and reports `cost` as a convenience. If the two disagree about which policy won, the result is "no decision", not a silent preference for `cost`.

## Did AI reduce work?

Need a baseline `A0` (frozen policy, no vault) and a memory policy `A1` on the **same** held-out source, against the **same** human cut `H`.

```text
reduction = (cost(A0, H) - cost(A1, H)) / cost(A0, H)
```

| Result | Meaning |
| --- | --- |
| reduction > 0.10 and both raw metrics move the same way | Supports "the memory helped" on this item |
| abs(reduction) ≤ 0.10 | No decision. Noise band, pre-registered |
| reduction < −0.10 | Memory made work worse. Counterexample |
| cost(A0, H) = 0 | Excluded. The baseline was already the human cut. There is nothing to reduce |

**A single item is not a result.** The PoC aggregates with a paired comparison across held-out items (file 16). Median reduction, not mean, so one bad file does not dominate.

## What is not a metric

- ASR word error rate, unless the decision cuts on words. v0.1 silence policy does not.  
- Shot-boundary F1. Out of v0.1.  
- LLM preference scores.  
- "Looks professional."  
- Time saved, unless `session_ms` was actually measured.

## Human work the metrics miss

Listening, thinking, and rejected plays do not show up in `op_count`. **UNKNOWN** how large that is. `session_ms` is the only hook, and it is optional. The PoC must not claim "minutes saved" from `op_count` alone.

## Reporting

Every report row: source id, policy ids, `op_count`, `unmatched_ms`, `boundary_ms`, `duration_error`, `recut_rate`, `cost`, `reduction` or "excluded". No row without the raw counts.
