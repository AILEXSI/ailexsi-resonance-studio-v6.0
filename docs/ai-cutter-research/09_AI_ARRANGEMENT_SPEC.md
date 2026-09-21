# 09 — AI arrangement spec

**Status:** Proposal. The canonical project stays `Session.project`. An arrangement is not a second undo stack.

## Why a separate document

**FACT.** P1 architecture: the only WRITE into the project is `EditorCommand` through history. An AI edit of a one-hour interview is hundreds of ranges. Putting those into the live project before a human looks would either explode history or bypass it.

**INFERENCE.** Store the proposal beside the project. The human compares, edits, discards, or promotes. Promote is out of v0.1 implementation. The spec only reserves the verb.

## MAIN vs AI EDIT n

| | MAIN | AI EDIT n |
| --- | --- | --- |
| What | The open Resonance project | A proposal |
| Identity | `Project.id`, `schemaVersion` 5 | `arrangementId`, monotonic `n` per project |
| Media | `assets[]` | **Same `assetId` values.** No copied media. No new blob |
| Mutation | `EditorCommand` | None, until a future promote |
| Undo | `HistoryStack` | The arrangement is immutable. A new `n` supersedes. Old `n` stays |
| Playable | Yes, today | **HYPOTHESIS:** playable by a reader that walks KEEP ranges. Not built |
| Compare | The baseline of the diff | The other side of the diff |

`n` starts at 1. There is no AI EDIT 0. Discard does not renumber.

## v0.1 shape

```text
Arrangement
  id
  projectId
  n
  label                  # "AI EDIT 1"
  policyId
  decisionIds[]          # ordered KEEP/CUT from file 08
  segments[]             # derived, redundant with decisions, stored so a player need not re-derive
      assetId
      sourceInMs
      sourceOutMs
      recordInMs         # position on the proposal timeline
      rate               # 1 in v0.1
  createdFromEvidenceIds
  status: proposal
```

**Derivation rule.** Walk KEEP decisions in `order`. `recordInMs` is the running sum of source durations. CUT decisions do not advance `recordInMs`. They remain in `decisionIds` so the diff can see removals. Rate is 1. No transition objects.

**Gaps.** OTIO would insert a `Gap` if the proposal needed black between keeps. v0.1 jump-cuts do not. A gap of zero is "the next keep starts immediately". If a later policy wants air between lines, that is a new verb, not a silent gap.

**Same media.** `assetId` must exist on the project. A missing asset is represented, not dropped (OTIO `MissingReference` lesson). The segment stays; playback is UNKNOWN.

## Human actions (specified, not built)

| Action | Effect |
| --- | --- |
| Compare | Timeline diff against MAIN or against a previous `n` ([10](./10_TIMELINE_DIFF_RESEARCH.md)) |
| Edit | Writes AI EDIT `n+1` or a human arrangement `H`. Does not mutate `n` in place |
| Discard | Marks `n` discarded. Project unchanged |
| Export | Out of v0.1. No FCP XML, no OTIO writer |
| Promote | Out of v0.1. Reserved: one transaction of existing commands (split, trim, delete, ripple) into `HistoryStack`, or a single documented compound if AI-9 ever exists. The map says N commands are N undos. A promote that wants one undo is a future compound, not a backdoor write |

**FACT (implementation map).** "AI-9 Compound / multi-tool Apply" is proposed because N `applyCommand` calls are N undos. Promote of a whole cut is that problem. v0.1 does not solve it by writing the project directly.

## What was borrowed from OTIO

Source range versus record time. Explicit missing media. Immutability of a published cut (a new version, not a silent edit).

## What was refused

Stacks, effects, vendor metadata, rational-only storage, using OTIO JSON as the arrangement file. The arrangement can later be *rendered to* OTIO. It is not an OTIO timeline.

## Playable alternative

**HYPOTHESIS.** A reviewer can hear the proposal by playing each KEEP's source range in order, with the project's existing audio path, without committing clips. **UNKNOWN** whether the current engine can do that without temporary clips. This audit does not inspect the audio engine to answer it. If it cannot, the PoC still works: the PoC compares range lists, it does not have to play them inside Resonance.

## Discard and provenance

Discarded arrangements remain readable. Experience ([11](./11_EXPERIENCE_VAULT_SPEC.md)) may cite them. Deleting the bytes would destroy the correction history the vault needs.
