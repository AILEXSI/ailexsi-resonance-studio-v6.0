# 08 — Edit decision spec

**Status:** Proposal for v0.1 fields only. Not an `EditorCommand`. Not implemented.

A decision is an instruction to an arrangement. It is not a measurement and not a project mutation. The human can accept, edit, or discard the arrangement. Only a later promote path, which this audit does not build, may call `applyCommand`.

## v0.1 verbs

| Verb | Meaning | v0.1 |
| --- | --- | --- |
| KEEP | This source range should appear, in this order | Yes |
| CUT | This source range should not appear | Yes |

**OUT of v0.1:** SPEED, DISSOLVE, GAIN, SLIP, ROLL, caption, multicam switch. Auto-Editor has them. They are real and they are not required to falsify correction cost on a silence policy. Adding them early makes the diff compare effects it cannot round-trip (OTIO lesson).

CUT and "remove" are one verb. A second name would split metrics.

## Record

```text
EditDecision
  id
  arrangementId
  verb: keep | cut
  assetId
  sourceRange: { startMs, endMs }   # half-open, source clock
  order: integer                     # sequence among KEEP decisions
  evidenceIds: [id]                  # required, at least one
  policyId
  status: inference                  # a rule said this. Not a fact about taste
  confidence: 0..1 | unknown
  reasonCode                         # short token, not a paragraph
```

`reasonCode` values for v0.1:

| Code | When |
| --- | --- |
| `activity.inactive` | Interpretation said inactive and min durations agreed |
| `activity.active` | The complement, a KEEP |
| `policy.margin` | The range exists only because margin padded a neighbor |
| `policy.min_duration` | A short run was flipped |
| `human.override` | Reserved for a decision born from a correction. Not emitted by the first policy |

If `evidenceIds` is empty, the decision is invalid. If confidence is unknown, write `unknown`. Do not write `1`.

## How a silence policy produces decisions

1. Read `audio.peak.ratio` facts.  
2. Write `audio.activity` interpretations under `policyId`.  
3. Apply margin, then minimum durations.  
   **FACT.** Auto-Editor's `conductor.nim` calls `mutMargin` and then `smoothing` on the boolean activity mask, after `interpretEdit` has applied the threshold. The comment there says both operate on the keep/cut boundary.  
   **Proposal order, matching that call order:** threshold → margin → minclip/mincut. Named policy `ae-default-v0` uses this order so the name is not a different algorithm. A test vector locks it.  
4. Run-length encode into CUT and KEEP over the source.  
5. Every decision cites the interpretation ids that cover its range.

## What a decision must not do

- Change `Project`, `playheadMs`, or history.  
- Drop the measurement it used.  
- Include a rendered path.  
- Speak in track indexes of the host. Placement is the arrangement's job ([09](./09_AI_ARRANGEMENT_SPEC.md)).  
- Mark itself FACT. The peaks are facts. The cut is an inference.

## Conflict with a human

A human KEEP over a policy CUT is not a contradiction to delete. It is a correction event ([10](./10_TIMELINE_DIFF_RESEARCH.md)). Both decisions remain, in different arrangements (AI proposal vs accepted human cut).

## Test vectors

| # | Peaks | Policy | Expected |
| --- | --- | --- | --- |
| 1 | 1 s of 0.0, 1 s of 1.0, 1 s of 0.0 | threshold 0.04, no margin, no mins | CUT, KEEP, CUT |
| 2 | KEEP of 50 ms between silence | minClip 100 ms | that KEEP becomes CUT, reason `policy.min_duration` |
| 3 | CUT of 50 ms between loud | minCut 100 ms | that CUT becomes KEEP, reason `policy.min_duration` |
| 4 | KEEP starting at 200 ms, marginStart 200 | — | a KEEP (or a margin-tagged range) from 0 |
| 5 | No peak series | — | no decisions. UNKNOWN, not an empty cut of the whole file |

Vector 5 is the fail-closed case. An absent measurement is not silence.
