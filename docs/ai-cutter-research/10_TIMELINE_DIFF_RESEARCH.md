# 10 — AI → human timeline diff

**Status:** Research. No diff code.  
**Question:** how should a human correction of an AI cut become evidence for a later cut, without a Good/Bad button?

## Prior art

| Source | What exists | Limit |
| --- | --- | --- |
| OTIO issue #26 | Open request since 2016 for semantic compare, custom identity, and move detection. Still open as of the issue's 2025-08-15 update | The interchange project does not ship this in 0.19.0. Confirmed: no `*diff*` path in commit `8ab0cf9`. |
| OTIO PR #1922 | Draft `otiodiff`: classify clip changes, write a color-coded OTIO plus text | Not merged. Not audited line by line. |
| OTIO PR #2030 | Example `cut_diff.py`. Not in the inspected tip | States the identity rule in the PR text |
| chaoz23/otio-diff | Apache-2.0 CLI, 2 stars | README repeats that rule. Not a dependency |
| Auto-Editor | No diff. Overrides are extra CLI ranges | — |
| QuickCut / dialogue papers | Optimize under user constraints or idioms | They do not diff a proposal against a later hand edit |
| Git | Line diff | A one-line insert ripples every later timecode. Positional text diff is the failure mode the OTIO PRs warn about |

**INFERENCE.** The prior art that matters is short: **match by media identity and source in-point, then classify**. Everything else (visual OTIO, MCP servers, line diffs) is optional packaging.

## Identity in AILEXSI

OTIO clips often have no stable id. AILEXSI clips do (`Clip.id`). That id is usable when the human edited the **same** clip objects (a trim of MAIN). It is not usable when AI EDIT n built new segments from the same asset.

v0.1 match key, in order:

1. If both sides carry the same `clipId`, use it.  
2. Else match the multiset of `(assetId, sourceInMs, sourceOutMs)`.  
3. If `sourceOutMs` changed, match `(assetId, sourceInMs)` and classify the out-change as a retime, not as delete+add.  
4. Duplicate keys are paired in order, not collapsed.  
5. Unmatched items are added or removed.  
6. If `assetId` is missing, do not fall back to a display name. Leave them unmatched. OTIO-diff falls back to the clip name for offline media. Names collide. AILEXSI asset ids should not be missing inside a project; if they are, UNKNOWN is safer than a false match.

**INFERENCE.** Matching only on `sourceInMs` will confuse two uses of the same frame (the same slate reused). Including `sourceOutMs` when it is unchanged avoids that. When the human trims the out point, rule 3 still links them.

## Classes

| Class | Meaning | Preference signal |
| --- | --- | --- |
| unchanged | Same identity, same record order, same record start (within tolerance) | None |
| retimed | Same identity, source in or out changed | The human wanted a different source edge |
| shifted | Same identity, source unchanged, record start changed, order unchanged | Usually a ripple from an earlier edit. **Not** a taste signal by itself |
| moved | Same identity, different order or different track | Order is taste. v0.1 has one picture/audio sequence, so track moves are OUT |
| added | In human, not in AI | Human restored something the policy cut |
| removed | In AI, not in human | Human cut something the policy kept |

Tolerance for "same" record start: **proposal 1 frame** at the asset rate, or 20 ms if the rate is UNKNOWN. This number is a hypothesis. The PoC should try 0 ms on integer fixtures first.

**Ripple rule, from the OTIO PR text.** Compute shift as the record-start delta. If a clip's delta equals the net duration inserted or removed before it, label **shifted**, not moved and not retimed. One upstream trim must not count as N corrections.

## Correction event

```text
CorrectionEvent          # HISTORICAL FACT once the human arrangement is committed
  id
  projectId
  fromArrangementId      # AI EDIT n
  toArrangementId        # human, or AI EDIT n+1
  diffClass
  assetId
  before: { sourceInMs, sourceOutMs, recordInMs }
  after:  { ... } | null
  evidenceIds            # what the AI cited, if any
  policyId
```

The event does not say the AI was bad. It says the boundary moved.

## From events to a hypothesis (no Good/Bad)

Do not ask the user to label the edit. The label is the diff class.

v0.1 extractor, deliberately small:

- Collect `retimed` and `added`/`removed` events whose `policyId` is the silence policy. Ignore pure `shifted` events.  
- For each event, the local peak around the boundary is already stored.  
- **HYPOTHESIS features:** the margin the human effectively used (distance from the activity edge to the human cut) and whether they restored ranges the threshold had cut.  
- Aggregate only inside a scope ([11](./11_EXPERIENCE_VAULT_SPEC.md)).  
- A single event can create a hypothesis with confidence near zero and `supportCount = 1`. It must not change the default policy.  
- The PoC's pre-registered rule: update a proposed margin only when `supportCount ≥ 4` inside one scope and the median margin differs from the default by more than 40 ms. Otherwise the hypothesis stays inert.

This is not a model. It is a median. If the median does not reduce held-out cost, the vault stores the counterexample and the policy stays put.

## What the diff does not cover

Effects, dissolves, gain, speed, captions, keyframes, color. OTIO-diff excludes these because they do not survive interchange. v0.1 excludes them because the decision model has no such verbs.

## Test vectors

1. Insert a 1 s KEEP at the head. Every later clip's record time moves by 1 s. Expected: one `added`, the rest `shifted`, zero `retimed`.  
2. Trim source out by 200 ms, no ripple (leave a gap). v0.1 has no gap verb; expected: one `retimed`, and the next clip `shifted` only if record times were packed. The fixture must say whether the human arrangement is packed.  
3. Two segments with the same `sourceInMs` and different `sourceOutMs`. They must not collapse.  
4. Delete an AI KEEP. Expected: `removed`. The cited `evidenceIds` show the human rejected an `activity.active` inference. That is a counterexample to the threshold, not a new fact that the range is silence.  
5. Identical arrangements. Expected: all `unchanged`. Correction cost 0.

## Difficulty

**MEDIUM** for identity, classes, and ripple. **RESEARCH** for whether those events predict the next cut. The second is the PoC, not a library.
