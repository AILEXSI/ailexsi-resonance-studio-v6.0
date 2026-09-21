# 15 — Editing intelligence core v0.1 architecture

**Status:** Architecture proposal caused by the audit. Not an implementation plan with tasks in the product tree.  
**Hosts later, not now:** Resonance as the reference host, then Premiere, Resolve, CapCut. No adapters in v0.1.

## What already exists (FACT)

From `docs/ai/AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md` and the P1 status, at `856044a`:

- Canonical document `Project`, schema 5, millisecond clips, source in/out, rate, tracks, markers, transitions, history.
- The only AI write that exists is `timeline.move_clip` → `applyCommand` → history.
- The only perception that exists is `timeline.inspect_range`: facts about the **document**, returned as a DTO, hashed, isolated from live objects. Provider prose is untrusted.
- Explicitly not started: PCM, STT, memory, vision, new writes.

v0.1 of the cutter **adds documents beside that**, on paper. It does not add tools.

## Shape

```text
assets (existing)
    │
    ▼
measurements          facts: peak, rms     deterministic, keyed by asset + range
    │
    ▼
observations          hypotheses: words    provider JSON, optional, unused by the silence policy
    │
    ▼
interpretations       inferences: active?  named policy id
    │
    ▼
decisions             inferences: KEEP/CUT evidence ids required
    │
    ▼
arrangement n         proposal timeline    same asset ids, record time derived
    │
    ▼
human arrangement     fact once committed  may be another arrangement, not Project
    │
    ▼
diff → correction events                   facts
    │
    ▼
preference hypotheses                      scoped, inert until the numeric rule says otherwise
```

MAIN (`Project`) is compared as an arrangement view: today's clips are KEEP segments. Building that view is a pure function. It is not a migration.

## Module boundaries (logical)

| Module | Depends on | Must not depend on |
| --- | --- | --- |
| Evidence | Time types | React, providers, OTIO |
| Policy | Evidence | Project mutation |
| Arrangement | Decisions, asset ids | HistoryStack |
| Diff | Two arrangements | NLEs |
| Vault | Correction events | LLMs |
| Provider edge | Files on disk | Evidence internals beyond the schema |
| Host | Project, commands | Provider SDKs |

The host is the only place that knows `EditorCommand`. The vault is the only place that knows scopes. The policy is the only place that knows `0.04`.

## Clocks and ids

- Working unit: milliseconds, half-open ranges.  
- Every asset range that is frame-quantized also stores `rateNum/rateDen` or is marked UNKNOWN.  
- Evidence ids are content hashes. Arrangement ids are new ids (`createId` exists; this audit does not call it).  
- Project `schemaVersion` stays 5. Arrangements are not project JSON. Putting them in `Project` would be a schema change. **Do not.**

## Fail closed

| Situation | Behavior |
| --- | --- |
| No PCM | No decisions. Not an all-cut |
| Policy id unknown | No decisions |
| Evidence id cited but missing | Decision invalid, dropped from the arrangement, recorded as an error on the proposal |
| Diff cannot match because asset id is null | Those items stay unmatched. Cost includes them. No name fallback |
| Hypothesis support < 4 | `inert`. Policy unchanged |
| Provider returns prose | Ignored, as in P1 |

## What the audit removed from the architecture

| Earlier temptation | Evidence against |
| --- | --- |
| OTIO as the internal timeline | No evidence model, no diff in core, vendor effects in real OTIO files, adapters split out of core |
| WhisperX as the perception core | Stack, CC-BY-4.0 default diarizer, word times are hypotheses, tests do not lock a corpus |
| One "silence" score | Peak ≠ RMS ≠ VAD ≠ word gap |
| Motion like Auto-Editor | Exact gray equality |
| Neural shots in v0.1 | Frozen TransNet, classical F1 already shows genre dependence, talking head does not need it |
| Train an editor | arXiv:2411.04942 and similar. Stop condition |
| Good/Bad buttons | Diff classes are the label |
| Second undo stack | P1 and the implementation map |

## What the audit added

- Rational rate beside milliseconds.  
- RMS stored even though Auto-Editor ignores it.  
- `shifted` excluded from correction cost.  
- Inert hypotheses and counterexamples.  
- A pre-registered noise band (±10% cost) and a minimum support of 4.  
- D1 music-bed case whose job is to **fail** margin learning.

## Sequence, after a human approves

This audit does not authorize the sequence. It orders it so a later approval can be small.

1. D0 PCM fixtures and the cost function, outside the app.  
2. Diff classes on those fixtures, including the ripple case.  
3. Vault median on D0-2 and the negative result on D1-M.  
4. Only if (3) holds, discuss a Resonance read-only evidence cache. Still no WRITE.  
5. Adapters and hosts after the arrangement is boring.

## Non-goals

CapCut export. Premiere panels. Real-time preview. Emotion. Highlight reels. Automatic promote. Merging this branch to `main`.
