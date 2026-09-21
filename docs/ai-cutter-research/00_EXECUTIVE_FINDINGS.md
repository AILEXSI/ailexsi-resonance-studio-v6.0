# 00 — Executive findings

**Status:** Research audit v0.1. Docs only. No AI Cutter implementation.  
**Base:** `ai/ai-director-foundation-v6` @ `856044a` (merge of PR #18, Perception P1). Verified.  
**Inspected:** 2026-09-21. Trace: [SOURCES.md](./SOURCES.md).

Labels: **FACT** verified in a cited tree or page. **INFERENCE** a conclusion from those facts. **HYPOTHESIS** a design bet this audit does not prove. **UNKNOWN** not established.

## Verdict

**GO WITH CHANGES.**

The product direction holds: an editing-intelligence core that keeps evidence, decisions, arrangements, diffs, and experience, and treats models and NLEs as replaceable edges. The evidence changes the shape of v0.1. It does not justify building WhisperX, TransNet, or OpenTimelineIO into Resonance.

## What the evidence changed

1. **The closest working cutter is a peak detector, not a model.** Auto-Editor's default "audio" method is the maximum absolute sample in each timeline chunk, normalized by full scale, compared with `0.04`. The README calls this loudness. The implementation is peak amplitude. dB input is `10^(dB/20)` on that same 0..1 scale, and out-of-range values are rejected. **FACT** (`src/analyze/audio.nim`, `src/edit.nim`, `src/util/fun.nim`). **INFERENCE:** AILEXSI must not store that number as "loudness" or as "speech".

2. **Silence, speech, word gaps, motion, and shot cuts are different measurements.** Collapsing them is the Visualz failure mode (observation presented as perception). WhisperX itself is four stages: VAD, ASR, wav2vec forced alignment, optional diarization assignment. **FACT**.

3. **OTIO is the wrong source of truth and the right interchange lesson.** Core 0.19.0 (Apache-2.0) has clips, gaps, tracks, stacks, ranges, transitions, markers, untyped metadata, and JSON. NLE adapters are no longer in core. Issue #26 (timeline comparison) is still open. No `*diff*` file exists in the inspected commit. Auto-Editor's `.otio` writer embeds Premiere effect IDs. **FACT**. **INFERENCE:** (A) an independent arrangement document, with (C) a later editorial-only OTIO adapter. Not (B) an owned reimplementation of OTIO.

4. **A usable timeline diff already has a prior-art shape, and it is not positional.** OTIO PR #2030 and `chaoz23/otio-diff` match clips by media identity plus source in-point, then classify added / removed / retimed / moved / shifted. Ripple must not be reported as N retimes. **FACT** as design of those unmerged / tiny projects. They are not runtime evidence that the algorithm is correct on AILEXSI projects. AILEXSI already has stable clip IDs on the canonical Project (`src/core/models.ts`). An AI arrangement that mints new clips cannot use those IDs to match the human cut. **INFERENCE:** match on `(assetId, sourceInMs, sourceOutMs)` as a multiset, and keep clip id when the human edit preserves it.

5. **No mature OSS experience vault for editing was found.** Papers (QuickCut, dialogue-idiom HMMs, a 2024 RL editor) either ask the user for constraints or train a model. Agent-memory libraries are not editing memory. **FACT** of this search. **HYPOTHESIS:** a store that separates historical correction facts from scoped preference hypotheses is differentiated. It is unproven until the PoC in [16_POC_PLAN.md](./16_POC_PLAN.md) fails or holds.

6. **WhisperX is a dependency stack, not a core.** `pyproject.toml` at the inspected commit pulls torch, torchaudio, torchvision, ctranslate2, faster-whisper, pyannote-audio ≥ 4, transformers, nltk, pandas, huggingface-hub. Default diarization id is `pyannote/speaker-diarization-community-1`, whose model card says **CC-BY-4.0** and is gated. The older 3.1 card says MIT. Those are different objects. **FACT**. Do not vendor this stack.

7. **Neural shot detection is not required to falsify the product.** TransNet V2's own README reports higher F1 than classical methods on ClipShots / BBC / RAI. The repo's `master` tip is 2021-07-28. PySceneDetect 0.7.1's own sweep still shows classical detectors failing hard on ClipShots (content F1@1 about 67 even at a tuned cell). Talking-head v0.1 is one camera and few hard cuts. **INFERENCE:** shot boundaries, optical-flow motion, keyframes, active-speaker nets, and diarization stay out of the minimum core. Audio activity is in. Word-timed transcript is the first optional provider, behind a contract, not a library import.

8. **P1 already drew the line this core must not cross.** Director READ is trusted structured evidence. Provider text is untrusted. The only WRITE is `EditorCommand` into `HistoryStack`. P1 status forbids starting audio perception, STT, or memory as implementation. **FACT** (`docs/ai/AI_DIRECTOR_IMPLEMENTATION_STATUS_v6.0.md`). This audit does not start them.

## Minimum v0.1 (perception)

| Capability | v0.1 | Why |
| --- | --- | --- |
| Peak / RMS audio activity over a declared window | Required measurement | This is what jump-cut tools actually compute. Keep peak and RMS as separate series. |
| Word transcript with start, end, score | Provider contract, not required to falsify the PoC | Needed for retakes and fillers. Not needed to test "corrections reduce cost" on silence policy. |
| Neural VAD | Out until room-tone fixtures fail the level threshold | A second observation, not a synonym for silence. |
| Shot boundaries | Out | Justified when the benchmark leaves single-camera talking head. |
| Basic motion | Out | Auto-Editor motion is exact gray-pixel inequality. Brittle, and static talking head barely needs it. |
| Keyframes | Out of decisions | Useful later as review thumbnails. They are not an edit decision. |
| Diarization, active speaker | Out | License, stack, and overlap failure. Interview v0.1 can label speaker as UNKNOWN. |

## Smallest PoC

A throwaway experiment, not a Resonance feature: frozen silence policy versus a policy whose margin and threshold were taken from prior human cut lists, scored by boundary error and operation count on held-out clips, including one case where a global preference is wrong and a project-type preference is right. Details: [16_POC_PLAN.md](./16_POC_PLAN.md).

## Stop conditions checked

| Condition | Result |
| --- | --- |
| Repo inaccessible | No. All five primary clones succeeded. |
| Serious license ambiguity that blocks reading | No. Community-1 weights are CC-BY-4.0 (attribution, gated), not a mystery copyleft. AGPL timestamped-Whisper is identified and avoided. |
| Assumed capability missing | Yes, and recorded: OTIO core has no diff; Auto-Editor "loudness" is peak; TransNet is unmaintained. |
| Would require training a foundation model | Not for v0.1. The RL-editor paper is explicitly out. |
| Evidence contradicts the architecture | Yes, in the OTIO-as-core and "one perception score" directions. Those are the changes above. |
| Experience vault already mature in OSS | Not found. Search is not a proof of absence. |
| Task became implementation | No. |

## Read next

[15_AILEXSI_AI_CUTTER_V01_ARCHITECTURE.md](./15_AILEXSI_AI_CUTTER_V01_ARCHITECTURE.md) · [14_OWN_THE_CORE_BOUNDARY.md](./14_OWN_THE_CORE_BOUNDARY.md) · [16_POC_PLAN.md](./16_POC_PLAN.md)
