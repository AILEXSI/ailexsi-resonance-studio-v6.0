# EXPERIMENTAL / NON-PRODUCT / MECHANICS VALIDATION

Synthetic mechanics experiment for contract `17_EXPERIENCE_POC_CONTRACT.md`.
Values below are measured from this runner. The later real-world result name is not awarded here.
Music-bed reduction 0 is the null band. It is not evidence that the margin helped that material.
Out-of-distribution agree is false because neither op_count nor unmatched_ms moved. That zero change is not a disagreement.

Placement: artifacts live in `experiments/ai-cutter-experience-mechanics/artifacts/`.
The contract's runner was specified before this directory existed. This bundle is not under `src/` and does not modify the research contract.

G0 reading: section 7 says fit a global margin and evaluate I06. Section 13 bars global activation in the scored matrix. G0 is not scored, so the fitted margin is applied and then kept out of both medians. `scored_matrix_would_activate` is false.

| Run | Role | Test ID | Train IDs | Support Count | Sample Count | Learned Margin | Baseline op_count | Baseline unmatched_ms | Baseline Cost | Learned op_count | Learned unmatched_ms | Learned Cost | Reduction | Agree | Excluded | Leakage Check |
| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |
| R01 | in-distribution | I01 | I02,I03,I04,I05,I06 | 5 | 30 | 400 | 3 | 0 | 3 | 0 | 0 | 0 | 1 | true | false | PASS |
| R02 | in-distribution | I02 | I01,I03,I04,I05,I06 | 5 | 30 | 400 | 3 | 0 | 3 | 0 | 0 | 0 | 1 | true | false | PASS |
| R03 | in-distribution | I03 | I01,I02,I04,I05,I06 | 5 | 30 | 400 | 3 | 0 | 3 | 0 | 0 | 0 | 1 | true | false | PASS |
| R04 | in-distribution | I04 | I01,I02,I03,I05,I06 | 5 | 30 | 400 | 3 | 0 | 3 | 0 | 0 | 0 | 1 | true | false | PASS |
| R05 | in-distribution | I05 | I01,I02,I03,I04,I06 | 5 | 30 | 400 | 3 | 0 | 3 | 0 | 0 | 0 | 1 | true | false | PASS |
| R06 | in-distribution | I06 | I01,I02,I03,I04,I05 | 5 | 30 | 400 | 3 | 0 | 3 | 0 | 0 | 0 | 1 | true | false | PASS |
| R07 | out-of-distribution | M01 | I01,I02,I03,I04,I05,I06 | 6 | 36 | 400 | 4 | 18400 | 22.4 | 4 | 18400 | 22.4 | 0 | false | false | PASS |
| R08 | out-of-distribution | M02 | I01,I02,I03,I04,I05,I06 | 6 | 36 | 400 | 4 | 18400 | 22.4 | 4 | 18400 | 22.4 | 0 | false | false | PASS |
| R09 | out-of-distribution | M03 | I01,I02,I03,I04,I05,I06 | 6 | 36 | 400 | 4 | 18400 | 22.4 | 4 | 18400 | 22.4 | 0 | false | false | PASS |
| R10 | out-of-distribution | M04 | I01,I02,I03,I04,I05,I06 | 6 | 36 | 400 | 4 | 18400 | 22.4 | 4 | 18400 | 22.4 | 0 | false | false | PASS |
| R11 | out-of-distribution | M05 | I01,I02,I03,I04,I05,I06 | 6 | 36 | 400 | 4 | 18400 | 22.4 | 4 | 18400 | 22.4 | 0 | false | false | PASS |
| R12 | out-of-distribution | M06 | I01,I02,I03,I04,I05,I06 | 6 | 36 | 400 | 4 | 18400 | 22.4 | 4 | 18400 | 22.4 | 0 | false | false | PASS |

median_ID: 1
median_OOD: 0

## Measured reductions

- R01: 1
- R02: 1
- R03: 1
- R04: 1
- R05: 1
- R06: 1
- R07: 0
- R08: 0
- R09: 0
- R10: 0
- R11: 0
- R12: 0

## Deterministic-run comparison

seed: 20260921
corpus hash run A: 18ada5714ee24262f5e42736a7e42064033e4c8244c4dd82b98a4b265330665b
corpus hash run B: 18ada5714ee24262f5e42736a7e42064033e4c8244c4dd82b98a4b265330665b
H hash run A: 269dd75a73bc4344385f281d75ed9c46097c4c899f8e90a9f378815c371e2202
H hash run B: 269dd75a73bc4344385f281d75ed9c46097c4c899f8e90a9f378815c371e2202
corpus hash equal: true
H hash equal: true
A0 equal: true
A1 equal: true
diffs equal: true
metrics equal: true
medians equal: true
reductions run A: 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0
reductions run B: 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0

## Diagnostic G0

scored: false
M: 400
R06 M: 400
supportCount: 5
sample_count: 30
music_bed_sample_count: 0
reduction: 1
in medians: false

## Integrity

seed: 20260921
corpus hash: 18ada5714ee24262f5e42736a7e42064033e4c8244c4dd82b98a4b265330665b
H hash: 269dd75a73bc4344385f281d75ed9c46097c4c899f8e90a9f378815c371e2202
leakage checks: {"constants_unmodified": true, "deterministic_same_seed": true, "g0_not_in_either_median": true, "h_is_section_3_table": true, "held_out_h_not_read_before_a1": true, "music_bed_not_train_interview_pref": true, "samples_only_from_train_ids": true, "scored_reductions_not_learning_inputs": true, "synthetic_support_isolated_from_real_world": true, "test_id_not_in_train_ids": true, "training_item_costs_not_in_medians": true}
non-margin unchanged: true
section_15_pass: true
section_16_fail: false
section_18_stop: false

MECHANICS PASS. Not evidence that human editing preferences generalize.

Mechanics validated. Human preference-learning hypothesis remains untested.
