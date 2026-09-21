# 07 — Temporal evidence spec (and minimum perception)

**Status:** Design proposal. Not implemented. Not a schema bump.  
**Fits:** Director rule that a READ result is evidence and provider text is untrusted (`docs/ai/AI_DIRECTOR_IMPLEMENTATION_STATUS_v6.0.md`, P1).

## Layers (do not collapse)

| Layer | Question | Who may create it | Example |
| --- | --- | --- | --- |
| MEASUREMENT | What did the sensor do? | Deterministic reducer over samples or frames | Peak ratio 0.11 in this 33 ms window |
| OBSERVATION | What did a model or heuristic say? | A named provider | Speech probability 0.2; word "hello" at 1.02–1.40 s with score 0.63 |
| INTERPRETATION | What might it mean? | A named rule, still not a cut | "Inactive under policy ae-default-v0" |
| DECISION | What should the arrangement do? | Edit policy, then a human | CUT this source range |

An interpretation that is copied into a later document without its evidence ids becomes a fake fact. The schema forbids that by requiring `evidenceIds` on interpretations and decisions, and by giving every record a `kind` that cannot change in place.

## Epistemic status

Every record is one of:

| Status | Meaning |
| --- | --- |
| FACT | Produced by a deterministic reducer from identified bytes, or a human-committed project state. Re-runnable. |
| INFERENCE | A rule applied to facts or observations. Cites inputs. |
| HYPOTHESIS | A guess, including model output and any "the user prefers X". |
| UNKNOWN | The field is absent on purpose. Not zero, not false, not silence. |

Model output is **HYPOTHESIS** even when the score is 0.99. A repeated run that mismatches is a conflict, not a vote to delete the first.

## Record

Times are integer milliseconds in the evidence clock, plus the media rate when the source has one.

```text
Evidence
  id
  kind: measurement | observation | interpretation
  status: fact | inference | hypothesis | unknown
  sourceId          # asset id, or a content hash if the asset id is not stable yet
  range: { startMs, endMs }   # half-open
  category          # audio.peak.ratio, audio.rms.ratio, speech.word, ...
  value             # number, string, or small struct. Not a free essay
  confidence        # 0..1 or UNKNOWN. Never invent 1.0
  provenance
      producer      # "ailexsi.audio.peak.v0" or "provider:speech"
      producerVersion
      params        # threshold is NOT here unless this record is the interpretation
      inputEvidenceIds
      modelId       # UNKNOWN if none
      generatedAt   # informational. Not part of identity
  evidenceIds       # required for interpretation; empty for raw measurement
```

**Identity.** `id` is content-addressed from `(sourceId, range, category, producer, producerVersion, canonical value)` so a re-scan does not mint a new fact for the same bytes. `generatedAt` is provenance, not identity.

**Supersession.** A new producer version writes a new id. Old ids stay. Decisions point at the ids they used. They do not silently retarget.

**What is not a field.** A boolean `isSilence`. A boolean `isCut`. Natural-language summaries. File paths and secrets (P1 already strips `sourcePath` from inspect DTOs).

## Clocks

**FACT.** `Clip` times in `src/core/models.ts` are milliseconds. `FRAME_MS = 1000/30` is a constant, not the file's rate.

**Proposal.** Evidence also stores:

```text
Timebase
  rateNum
  rateDen
  rounding: nearest | floor | ceil
```

Milliseconds are the working unit. The rate is so a 30000/1001 file is not pretended to be 30. If the rate is unknown, status of any frame-quantized claim is UNKNOWN.

**HYPOTHESIS.** 1 ms resolution is enough for jump-cut boundaries. It is not a promise of NLE sample accuracy.

## Minimum perception v0.1

Only what the PoC and a talking-head jump-cut need.

| Capability | In v0.1? | Category | Status of the value | Notes |
| --- | --- | --- | --- | --- |
| Peak ratio per hop | Yes | `audio.peak.ratio` | FACT if PCM is the input | Hop default 10 ms. Record hop in params. |
| RMS ratio per hop | Yes, beside peak | `audio.rms.ratio` | FACT | Auto-Editor does not compute this. Store it so "loudness" is not a lie. |
| Activity interpretation | Yes | `audio.activity` | INFERENCE | value `active` or `inactive` under a named policy. Cites the series and the threshold. |
| Word times | Contract only | `speech.word` | HYPOTHESIS | Fake provider in tests. No ASR in the product PoC. |
| Neural VAD | No | `speech.vad.probability` | HYPOTHESIS | Add when a room-tone fixture shows peak/RMS cannot separate speech. |
| Shot boundary | No | `video.shot.boundary` | HYPOTHESIS or INFERENCE by method | See [04](./04_SCENE_DETECTION_AUDIT.md). |
| Motion | No | `video.motion.mad` | FACT if ever | Mean abs diff, not Auto-Editor's exact byte compare. |
| Keyframes | No | — | — | Review UI later. Not evidence for a cut. |
| Diarization / active speaker | No | — | — | UNKNOWN speaker is allowed on words. |

Advanced perception stays out. There is no v0.1 category for emotion, viral score, or "good take".

## Policy is not evidence

```text
ActivityPolicy
  id: "ae-default-v0"          # named, not hidden
  peakThreshold: 0.04          # borrowed as a label from Auto-Editor, reimplemented
  rmsThreshold: UNKNOWN        # not in Auto-Editor; do not invent a default and call it theirs
  hopMs: 10
  marginStartMs: 200
  marginEndMs: 200
  minCutMs: 200
  minClipMs: 100
```

The interpretation cites `policyId`. Changing the threshold writes a new interpretation. It does not rewrite the peak series.

## Conflict

Two observations on the same range (peak says active, a future VAD says no speech) are both kept. A decision that needs one of them must name which evidence ids it used. It must not average them into a third number without a named rule.

## Relationship to P1 inspect

`timeline.inspect_range` reports project facts: clips, gaps, markers, overlaps, revision, hash. Those are **FACT** about the document, not about the media. Media evidence is a different store, keyed by asset and source range, so a timeline move does not invalidate a peak series. A source trim does not invalidate it either; the decision's range changes, the measurement does not.

## Non-goals

No embeddings. No vector database. No natural-language evidence. No mutation of `Project`.
