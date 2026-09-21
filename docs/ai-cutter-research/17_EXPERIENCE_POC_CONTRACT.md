# 17 — Experience PoC contract

**Status:** Falsifiable test contract. Not a result. Not permission to write the runner.  
**Inherits:** [16_POC_PLAN.md](./16_POC_PLAN.md), [11_EXPERIENCE_VAULT_SPEC.md](./11_EXPERIENCE_VAULT_SPEC.md), [12_METRICS_AND_CORRECTION_COST.md](./12_METRICS_AND_CORRECTION_COST.md), [10_TIMELINE_DIFF_RESEARCH.md](./10_TIMELINE_DIFF_RESEARCH.md), [08_EDIT_DECISION_SPEC.md](./08_EDIT_DECISION_SPEC.md), [13_BENCHMARK_PLAN.md](./13_BENCHMARK_PLAN.md).  
**Labels:** **FACT** is inherited from those docs or from the Auto-Editor call order they cite. **HYPOTHESIS** is a claim this contract does not treat as true. **LOCK** is a disambiguation this contract adds so a number can be computed. A LOCK is not evidence that the vault idea is correct.

This document does not implement a script, a Resonance feature, a UI, or a model. A future runner, if a human asks for one, stays outside this repository.

## Prohibitions

The scored experiment has none of the following:

- an LLM
- Whisper or any other speech recognizer
- any external AI model, including VAD, diarization, and shot detectors
- Resonance Studio integration, `Project` mutation, or `EditorCommand`
- a UI
- production code in this repository
- a Good/Bad label
- a claim that a synthetic MECHANICS PASS shows real editing preferences generalize

The vault hypothesis is **HYPOTHESIS**. A MECHANICS PASS of sections 15 and 17 authorizes only planning the next experiment at the bottom of this file. It does not authorize product code. It is not a HYPOTHESIS PASS.

## Epistemic status

The synthetic corpus is constructed so that the hidden generating rule matches the candidate learned margin rule. Interview `H` is the pre-margin activity runs expanded by exactly 400 ms on each side. The learner is only allowed to estimate that same margin. Recovering 400 ms shows that the runner obeyed this construction.

A synthetic **MECHANICS PASS** validates only:

- runner correctness
- deterministic reproduction
- diff mechanics
- correction-cost calculation
- leave-one-out mechanics
- scope isolation
- leakage protection

A synthetic MECHANICS PASS does **not** validate:

- real human preference learning
- generalization to real editors
- commercial differentiation
- usefulness of the Experience Vault

**HYPOTHESIS PASS** is reserved for the next real-world held-out experiment that uses human-authored KEEP ranges. The synthetic matrix cannot award it.

## Corpus constants

These are the only inputs. No random draw is allowed. `seed = 20260921` is recorded in every artifact and is not an entropy source. A runner that uses `seed` to jitter amplitudes, boundaries, or the median is non-conforming.

| Name | Value | Origin |
| --- | --- | --- |
| Sample rate | 48000 Hz | file 13 |
| Hop | 10 ms = 480 samples | file 13 |
| Channels | 1 | LOCK |
| Sample domain | float in [-1, 1], no dither, no int16 quantization | LOCK. These fixtures sit far from 0.04, so Unlicense Auto-Editor's `Unorm16` rounding is not part of the oracle |
| Active test | hop peak `>= 0.04` | **FACT** in Auto-Editor `orWithThreshold` (`>=`), as already used by file 02 |
| `P0` id | `ae-default-v0` | file 16 |
| Peak threshold | 0.04 | file 16 |
| `marginStartMs`, `marginEndMs` | 200, 200 | file 16 |
| `minCutMs`, `minClipMs` | 200, 100 | file 16 |
| Order | threshold, then margin, then min durations | **FACT** of Auto-Editor call order cited in file 08 (`mutMargin` then `smoothing`) |
| Smooth predicate | a run is flipped only when its length is **strictly shorter** than the minimum | file 02 wording "shorter than" |
| Equality tolerance | 0 ms | file 10: integer fixtures use 0 ms, not the 20 ms proposal |
| Support minimum | 4 | files 10 and 11 |
| Margin-delta minimum | 40 ms | file 10 |
| Noise band | 0.10 | file 12 |
| Item duration | 10000 ms | LOCK, below |
| Interview human pad | 400 ms each side | file 16 "about 400 ms", locked to exactly 400 |
| Music-bed floor | peak 0.08 on every hop | file 13 / file 16 |

---

## 1. Hypothesis

**HYPOTHESIS, not a fact.** On interview-tagged synthetic items whose authored human keeps sit exactly 400 ms outside the pre-margin activity runs, a margin that is the median of those distances, estimated only from other interview items, reduces held-out Correction Cost against `ae-default-v0` by more than the 0.10 band, and applying that same margin to music-bed items does not raise their Correction Cost by more than 0.10.

The hypothesis in this section is the mechanics claim for this constructed corpus. Satisfying it is a MECHANICS PASS candidate. It is not a HYPOTHESIS PASS and it is not a claim about real people.

## 2. Null hypothesis

**HYPOTHESIS under test, stated so it can survive.** Either the interview-scoped median margin does not lower held-out Correction Cost by more than 0.10 relative to `ae-default-v0`, or that change raises Correction Cost by more than 0.10 on at least one music-bed item.

"No difference" includes every median relative improvement in [-0.10, +0.10]. File 12 calls that band "no decision". In this contract that band accepts the null. It is not a soft pass.

## 3. Dataset construction

Twelve items. Six `project_type=interview` (`I01`–`I06`). Six `project_type=music_bed` (`M01`–`M06`). One asset id per item, equal to the item id. No pictures. No shared `clipId` across the policy arrangement and the human arrangement.

**Burst schedule** (half-open milliseconds), identical for every item:

| Interval | Interview peak | Music-bed peak |
| --- | ---: | ---: |
| [0, 1000) | 0 | 0.08 |
| [1000, 3000) | 0.50 | 0.50 |
| [3000, 4000) | 0 | 0.08 |
| [4000, 6000) | 0.50 | 0.50 |
| [6000, 7000) | 0 | 0.08 |
| [7000, 9000) | 0.50 | 0.50 |
| [9000, 10000) | 0 | 0.08 |

Every sample inside a hop is that constant, so the hop peak equals the constant. `I01`–`I06` are copies. `M01`–`M06` are copies. Copying is deliberate: this corpus checks the rule, not the variety of human taste.

**Authored human arrangement `H`**, both tags, packed end to end, rate 1, not produced by the policy:

| Order | Source range |
| --- | --- |
| 1 | [600, 3400) |
| 2 | [3600, 6400) |
| 3 | [6600, 9400) |

Those ranges are the three 0.50-runs expanded by 400 ms and clamped to [0, 10000). They do not overlap: the gap between expanded runs is 200 ms. `H` is an input file. The fitter is not allowed to recompute `H` from a target margin.

**Pre-margin activity** (peak `>= 0.04`, before margin and before smoothing):

- Interview: [1000, 3000), [4000, 6000), [7000, 9000).
- Music-bed: [0, 10000), because 0.08 `>= 0.04` on every hop.

## 4. Training examples

A training example is one item's pair `(peak series, H)` plus its `project_type` tag. It is eligible for a scope only when the tag equals that scope. An untagged item counts for no scope (file 11).

For a scored run, the training set is exactly the `train_ids` in section 14. The median is computed from those items and from no others. Music-bed items are never training examples for the policy that is scored on interview items. Interview items are never training examples for a music-bed-scoped policy in this contract (no such policy is scored).

`supportCount` is the number of distinct training items that contribute at least one margin sample (section 9). It is not the number of samples, and it is not the number of test items.

## 5. Held-out examples

The held-out example of a run is the single `test_id` in section 14. Its peak series is visible to the policy, because a cutter may measure the file it is about to cut. Its `H`, its diff, and its cost are not visible until the arrangement has been written.

Held-out `H` is never a support id for that run. A held-out failure is not written back into that run's hypothesis. Pooling the twelve held-out costs into the median is allowed only after every run's arrangement exists. That pool is an aggregate, not a new training set.

## 6. In-distribution test

Runs `R01`–`R06`. Leave-one-out inside `I01`–`I06`. Each interview item is the test exactly once. Train on the other five. Scope `project_type=interview`.

This is the in-distribution mechanics check. It does not support real human preference learning: the keeps were generated by the same margin rule the learner estimates. Six copies of one waveform are still in-distribution relative to each other. They are not a sample of interviews.

## 7. Out-of-distribution test

Runs `R07`–`R12`. For each music-bed item, fit the margin on `I01`–`I06` only, then cut that music-bed item. Scope of the hypothesis remains `project_type=interview`. The test tag is `music_bed`. No music-bed `H` enters the median.

**Unscored diagnostic `G0`, not a 13th run.** Fit a `scope=global` margin on `I01`–`I05` plus `M01`–`M06`, then evaluate only `I06`. `G0` is not part of `median_ID` or `median_OOD`. It exists because file 16 asks to see a global pool. Its number cannot produce a MECHANICS PASS. If `G0` changes a parameter other than margin, or if its interview reduction is worse than `R06` by more than 0.10 because music-bed samples entered the median, the extractor is wrong (section 18). With the sample rule in section 9, music-bed items emit no samples, so the contract prediction is that `G0`'s margin equals `R06`'s margin.

## 8. Baseline policy

`P0` = `ae-default-v0`.

- threshold 0.04 on hop peak, comparison `>=`
- margin 200 ms, 200 ms
- minCut 200 ms, minClip 100 ms
- order: threshold → margin → min durations
- a run flips only when `length < minimum`
- no other parameter exists

`A0` is the packed KEEP list from `P0`. CUT spans are retained as decisions so the diff can see them, and they do not advance record time (file 09).

**Contract prediction for `A0`, not a measurement.** Interview, after margin 200 and with gaps of 600 ms and 800 ms left unfilled (all `>= 200`): keeps [800, 3200), [3800, 6200), [6800, 9200). Music-bed: one keep [0, 10000), because the mask is entirely active and margin has nowhere to grow.

## 9. Learned policy

`P1` may change only `marginStartMs` and `marginEndMs`, and only by setting both to the same integer median. Threshold, hop, minCut, minClip, and order stay at `P0`. If any other field differs, the run is invalid (section 18).

**Margin sample (LOCK, reconciling file 10 and file 16).** File 10 measures from the activity edge to the human cut. File 16 says "P0 activity edge". This contract takes that to mean the pre-margin threshold edge, not the keep edge after the 200 ms pad. Measuring the residual against the padded edge would center the samples on 200 ms, the `|median − 200| > 40` rule would fail closed, and the experiment could not speak. That interpretation is a LOCK, not a finding.

A sample is emitted for one side of one human KEEP only when all of these hold:

1. The training item's pre-margin mask contains at least one inactive hop. A fully active mask emits nothing. Music-bed items therefore contribute zero samples and do not increase `supportCount`.
2. That side's human edge lies in an inactive region of the pre-margin mask.
3. The nearest pre-margin active run is within 2000 ms of that edge.
4. The edge is not on the file boundary `0` or `10000` (a clamp hides the unconstrained margin).

`distanceMs = abs(humanEdgeMs − activityEdgeMs)`.

The median is the median of those integers. Sort ascending. If the count is odd, take the middle value. If the count is even, take the arithmetic mean of the two middle values; if that mean is not an integer, round half away from zero. This corpus predicts every interview distance is 400 and every median in section 14 is 400.

`supportCount` and the eligible-boundary count are defined in section 13. The learned statement is the token `margin.start.ms = M; margin.end.ms = M`. Status remains `hypothesis` even if confidence is 1 (file 11). Confidence is `supportCount / (supportCount + counterexampleCount)` only when the denominator is `>= 4`; otherwise `unknown`. This fit has `counterexampleCount = 0`. Confidence is not a MECHANICS PASS.

Predicted policy id when activation succeeds: `interview-margin-v1`. Predicted `M = 400`.

## 10. Exact Correction Cost formula

Inherited from file 12. `A` is the policy arrangement. `H` is the authored human arrangement.

```text
op_count     = number of diff records whose class is not unchanged and not shifted
unmatched_ms = sum of source durations of records whose class is added or removed
cost(A, H)   = op_count + unmatched_ms / 1000
```

`unmatched_ms` is an integer. The division is exact decimal arithmetic, not binary-float rounding in the published table (publish the fraction `unmatched_ms/1000` as well as the decimal).

```text
reduction(A0, A1, H) = (cost(A0, H) - cost(A1, H)) / cost(A0, H)
```

If `cost(A0, H) = 0`, the item is `excluded` and has no reduction (file 12). An excluded scored run fails section 15, because this corpus was built so `A0` is not already `H`.

**Agreement (LOCK).** File 12 says `op_count` and `unmatched_ms` must "move the same way", and file 13 says the interview case is retimes only, so `unmatched_ms` can stay 0 on both sides. Opposite signs are a disagreement. A zero change is not a disagreement.

```text
d_op = op_count(A0) - op_count(A1)
d_un = unmatched_ms(A0) - unmatched_ms(A1)
agree = (d_op >= 0) and (d_un >= 0) and (d_op > 0 or d_un > 0)
```

If `agree` is false, that run does not meet the MECHANICS PASS agreement rule, even if `reduction > 0.10`.

Also publish, and do not fold into `cost`: `boundary_ms` (median of absolute source-in and source-out deltas over retimed pairs; unmatched ranges stay out of that median), `duration_error = abs(dur(A) - dur(H)) / 10000`, `recut_rate` as in file 12. `session_ms` and `command_count` are `unknown`. Do not invent them.

**Contract predictions for the published costs.**

Interview `A0` versus `H`, after the pairing in section 11: three `retimed` records, `op_count = 3`, `unmatched_ms = 0`, `cost = 3`. `A1` at margin 400 matches `H`: `op_count = 0`, `unmatched_ms = 0`, `cost = 0`, `reduction = 1`, `agree` because `d_op = 3` and `d_un = 0`.

Music-bed `A0` versus `H`: one `removed` of 10000 ms and three `added` of 2800 ms. `op_count = 4`, `unmatched_ms = 18400`, `cost = 4 + 18400/1000 = 22.4`. `A1` stays equal to `A0` because a fully active mask does not move when only the margin changes. `reduction = 0`. That is inside the null band on that item. It is not a regression.

These predictions are oracles for a conforming runner. They are not experimental results. If a conforming reading of sections 8–11 cannot produce them, stop and correct this contract. Do not retune 0.10, 4, or 40.

## 11. Identity matching rules

Apply in order. Tolerance is 0 ms. No display-name fallback (file 10 rule 6).

1. If both sides carry the same `clipId`, pair them. This corpus must not do that. Omit `clipId` on both sides.
2. Pair the multiset `(assetId, sourceInMs, sourceOutMs)`. Identical ranges are `unchanged` only when record order is the same and record start is equal; otherwise classify with rules 5–6.
3. For still-unpaired items, pair `(assetId, sourceInMs)` when `sourceOutMs` differs. Class: `retimed`. This is file 10 rule 3. It does not fire when `sourceInMs` also moved.
4. **LOCK, required by file 13's "retimes only" on a both-edge margin change.** File 10 does not state this case. Remaining unpaired items that share an `assetId` are sorted by `sourceInMs`. If the two sides have the same count, pair them in that order and class each pair `retimed` when the source range differs and the order is unchanged. If the counts differ, do not pair; leftovers are `added` (human only) or `removed` (policy only). Interview 3-vs-3 uses this rule. Music-bed 1-vs-3 does not.
5. `shifted` only when the source range is equal, the order is unchanged, and the record start differs. A source-range change is `retimed` even if the record start also moved. Do not also emit `shifted` for that pair.
6. Ripple check, file 10: among pairs whose source range is equal, if the record-start delta equals the net duration inserted or removed earlier on that asset, the class is `shifted`, not `moved`.

`op_count` ignores `unchanged` and `shifted`. One pair is one record.

## 12. Anti-data-leakage rules

1. For every scored run, `test_id` is not a member of `train_ids`.
2. The test item's `H` is not read before that run's `A1` is serialized.
3. Margin samples come only from `train_ids`.
4. Held-out reductions are not features, not support ids, and not a reason to change `M`.
5. `R01`–`R06` do not include any `M*` id in training. `R07`–`R12` do not include any `M*` id in training.
6. Costs on training items are not in `median_ID` or `median_OOD`.
7. `G0` does not contribute to either median.
8. Synthetic support ids must not be copied into a later real-audio experiment.
9. The constants 0.10, 4, and 40 ms are fixed before the run. Publishing a different band after seeing the table is leakage.
10. No model output, transcript, or hand edit made with knowledge of `A1` is part of `H`. `H` is the table in section 3.

## 13. Preference activation rule

`P1` is applied only when every line below is true. Otherwise `inert = true`, the arrangement equals `A0`, and `reduction = 0` for that run. An inert run is a real run, not a missing run.

1. Scope is `project_type=interview`. `global`, `music_bed`, `user`, `project`, and `scene_type` do not activate in the scored matrix.
2. `supportCount >= 4`.
3. Eligible boundary count (the sample count in section 9) `>= 4`.
4. `abs(M - 200) > 40`.
5. The only edited fields are the two margins.
6. `inert` becomes false and the policy id is `interview-margin-v1`.

Predicted activation: true on all twelve scored runs (`supportCount` is 5 on `R01`–`R06` and 6 on `R07`–`R12`; sample count is 30 or 36; `abs(400-200) = 200 > 40`). The MECHANICS PASS can still fail if those arrangements do not move the held-out costs as section 10 predicts. Activation is not a MECHANICS PASS.

Confidence stays a hypothesis field. It is not the activation rule.

## 14. 12-run deterministic test matrix

`train(Ik)` means the five interview ids other than `Ik`. Interview train sets have size 5. Music-bed runs train on all six interview ids and are not leave-one-out of the test item.

| Run | Role | Test | Train | Scope | Predicted `M` | Predicted `cost(A0,H)` | Predicted `cost(A1,H)` | Predicted reduction |
| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |
| R01 | in-distribution | I01 | I02–I06 | interview | 400 | 3 | 0 | 1 |
| R02 | in-distribution | I02 | I01, I03–I06 | interview | 400 | 3 | 0 | 1 |
| R03 | in-distribution | I03 | I01–I02, I04–I06 | interview | 400 | 3 | 0 | 1 |
| R04 | in-distribution | I04 | I01–I03, I05–I06 | interview | 400 | 3 | 0 | 1 |
| R05 | in-distribution | I05 | I01–I04, I06 | interview | 400 | 3 | 0 | 1 |
| R06 | in-distribution | I06 | I01–I05 | interview | 400 | 3 | 0 | 1 |
| R07 | out-of-distribution | M01 | I01–I06 | interview | 400 | 22.4 | 22.4 | 0 |
| R08 | out-of-distribution | M02 | I01–I06 | interview | 400 | 22.4 | 22.4 | 0 |
| R09 | out-of-distribution | M03 | I01–I06 | interview | 400 | 22.4 | 22.4 | 0 |
| R10 | out-of-distribution | M04 | I01–I06 | interview | 400 | 22.4 | 22.4 | 0 |
| R11 | out-of-distribution | M05 | I01–I06 | interview | 400 | 22.4 | 22.4 | 0 |
| R12 | out-of-distribution | M06 | I01–I06 | interview | 400 | 22.4 | 22.4 | 0 |

`median_ID` is the median of the six in-distribution reductions, with the even-count rule from section 9. `median_OOD` is the median of the six out-of-distribution reductions. Predicted values: `median_ID = 1`, `median_OOD = 0`.

Each run's published row also contains absolute `op_count` and `unmatched_ms` for `A0` and for `A1`, both absolute costs, and the reduction. A row that has only a percentage is non-conforming.

## 15. MECHANICS PASS threshold

This section is the synthetic MECHANICS PASS bar. It is not a HYPOTHESIS PASS. The corpus was built so the hidden generating rule and the candidate margin rule are the same 400 ms pad, so clearing this bar does not show that a preference was learned from unknown behavior.

Meeting every line below validates only runner correctness, deterministic reproduction, diff mechanics, correction-cost calculation, leave-one-out mechanics, scope isolation, and leakage protection.

It does not validate real human preference learning, generalization to real editors, commercial differentiation, or usefulness of the Experience Vault.

All of the following, on one artifact bundle:

1. `median_ID > 0.10`
2. Every in-distribution run has `agree = true` and is not `excluded`
3. `median_OOD >= -0.10` and every out-of-distribution reduction is `>= -0.10`
4. Every scored run's non-margin parameters equal `P0`
5. The leakage checks in section 12 pass
6. A second execution with `seed = 20260921` and the same corpus bytes reproduces the twelve reductions exactly
7. The report's conclusion sentence is the sentence in section 17, including the refusal to generalize

Predicted scores meet (1)–(3) if the oracles in section 10 are what the runner prints. Meeting (1)–(7) is a MECHANICS PASS for this generator only.

## 16. Failure threshold

Any one of these accepts the null. The vault claim is then unsupported. Do not loosen the band.

1. `median_ID <= 0.10`
2. Any in-distribution run is `excluded`, or has `agree = false`
3. `median_OOD < -0.10`, or any single out-of-distribution reduction is `< -0.10`
4. Fewer than twelve scored rows

`reduction = 0` on music-bed is not a failure. It is the null band. It is a failure only if the write-up calls it evidence that the margin helped that material.

## 17. Evidence required for MECHANICS PASS

A MECHANICS PASS means: a human may plan the next experiment in the following section. A MECHANICS PASS does not mean merge, product code, a vault in Resonance, or a HYPOTHESIS PASS.

Required evidence, all present:

- The twelve rows with absolute `cost(A0,H)`, absolute `cost(A1,H)`, `op_count`, `unmatched_ms`, and `reduction`
- `median_ID`, `median_OOD`, and the six train/test id lists
- `supportCount`, sample count, `M`, `inert`, and policy id per run
- A corpus hash of the twelve hop-peak series and of the twelve `H` lists
- `seed = 20260921`
- Section 15 satisfied
- This sentence, verbatim, in the report: `MECHANICS PASS. Not evidence that human editing preferences generalize.`

Without that sentence, there is no MECHANICS PASS. A report that calls this result a HYPOTHESIS PASS, or that claims real human preference learning, generalization to real editors, commercial differentiation, or usefulness of the Experience Vault, does not satisfy this section.

## 18. Evidence requiring STOP / redesign

Stop the experiment and redesign the contract or the extractor before any rerun that changes a constant. Do not "fix" a miss by editing 0.10, 4, or 40 after the table exists.

- A test id appears in that run's training ids
- Threshold, minCut, minClip, hop, or order differs between `P0` and `P1`
- `op_count` and `unmatched_ms` move in opposite directions on an in-distribution run
- Any music-bed reduction `< -0.10`
- Two executions with the same seed and corpus hash disagree
- An LLM, Whisper, another model, Resonance, or a UI was on the path that produced `A0`, `A1`, or `H`
- The report treats `median_ID > 0.10` as evidence about real editors
- `G0` admits music-bed margin samples and then misses `R06`'s interview reduction by more than 0.10
- The runner is committed under `src/` or wired to `EditorCommand`

A STOP is not a quiet pass. The null remains in force until a new pre-registered contract is reviewed.

## 19. Exact output artifacts

A conforming run writes these files next to each other, outside this git repository. Names are exact.

| File | Contents |
| --- | --- |
| `corpus_manifest.json` | `seed`, sample rate, hop, the twelve ids, tags, the burst table, the `H` table, sha256 of the canonical hop-peak bytes, sha256 of the canonical `H` bytes |
| `run_R01.json` … `run_R12.json` | `train_ids`, `test_id`, scope, `supportCount`, sample count, `M`, `inert`, policy id, `A0` keeps, `A1` keeps, diff records with classes, `op_count`, `unmatched_ms`, `boundary_ms`, `duration_error`, `recut_rate`, absolute costs, `reduction` or `excluded`, `agree` |
| `diagnostic_G0.json` | Same fields, plus `scored: false` |
| `summary.json` | `median_ID`, `median_OOD`, twelve absolute costs, twelve reductions, leakage checklist booleans, `section_15_pass`, `section_16_fail`, `section_18_stop` |
| `REPORT.md` | The table in section 14 filled with measured numbers, and the verbatim sentence from section 17 when `section_15_pass` is true. `section_15_pass` records a MECHANICS PASS. It does not record a HYPOTHESIS PASS |

No waveform binaries are required. No model files. No screenshots. `summary.json` without the absolute costs is not an artifact.

---

## Next real-world experiment

Run this only after a MECHANICS PASS under section 17. Do not start it from this pull request. A MECHANICS PASS does not count as evidence for this experiment. The name for a pass here is **HYPOTHESIS PASS**. The synthetic matrix cannot award that name.

**Purpose.** Ask whether a margin estimated from real human keep-lists lowers Correction Cost on a later real file. Synthetic `supportCount` does not carry over. `I*` and `M*` are not training items.

**Materials.** At least five rights-cleared interview recordings the operator may use, plus one further interview held out, and at least one rights-cleared music-bed or other out-of-scope recording. Audio and the human lists stay outside the git repository. One recording is not enough: training and testing on it is leakage, and `supportCount >= 4` cannot be met by holding that one file out.

**Human `H`.** A person writes the KEEP ranges by listening. `H` is not a formula of 400 ms, not a transcript, and not Whisper. The person does not see `A1` before the list is frozen. They may see the uncut recording.

**Protocol.** The same `P0`, the same cost formula, the same identity rules, the same activation rule, the same 0.10 band, and the same prohibitions. Fit `project_type=interview` by leave-one-out on the real interview lists only. Score the held-out interview as in-distribution. Score the music-bed file with that interview margin as out-of-distribution. A regression worse than 0.10 on the music-bed file is a failure even if the interview median improves.

**What a HYPOTHESIS PASS would mean.** Only that this margin rule moved cost in the predicted direction on those human-authored files. It still would not mean a global preference, a user model, commercial differentiation, or a Resonance feature. It is the first result that is allowed to speak to real keep-lists. It is still not a product decision.

**What it must not become.** A product integration, a UI study, an ASR benchmark, or a retraining loop that adds the held-out file after a miss.
