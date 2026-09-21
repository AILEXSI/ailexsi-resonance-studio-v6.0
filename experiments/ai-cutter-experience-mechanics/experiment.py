"""Synthetic MECHANICS experiment. Not product code. Not a hypothesis pass.

Run from this directory:

    python3 experiment.py
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

from constants import (
    AUTHORED_H_MS,
    BASELINE_POLICY_ID,
    FILE_DURATION_MS,
    INTERVIEW_IDS,
    LEARNED_POLICY_ID,
    MARGIN_DISTANCE_MIN_MS,
    MUSIC_IDS,
    P0_MARGIN_START_MS,
    PASS_SENTENCE,
    PERMITTED_CONCLUSION,
    REAL_WORLD_TRAINING_IDS,
    SAMPLE_MIN,
    SEED,
    SUCCESS_BAND,
    SUPPORT_MIN,
    assert_frozen_constants,
)
from corpus import (
    CorpusItem,
    ItemView,
    LeakageError,
    build_corpus,
    corpus_hashes,
    manifest_dict,
)
from learn import fit_margin, median_half_away, scored_activation
from metrics import agreement, decimal_text, fraction_text, reduction, score
from policy import (
    PolicyError,
    assert_only_margins_differ,
    baseline_policy,
    cut,
    pack_ranges,
    with_margins,
)

EXP_ROOT = Path(__file__).resolve().parent


@dataclass(frozen=True)
class RunSpec:
    run_id: str
    role: str
    test_id: str
    train_ids: tuple[str, ...]
    scope: str
    scored: bool


def scored_matrix() -> tuple[RunSpec, ...]:
    specs: list[RunSpec] = []
    for index, test_id in enumerate(INTERVIEW_IDS, start=1):
        train = tuple(item_id for item_id in INTERVIEW_IDS if item_id != test_id)
        specs.append(
            RunSpec(
                run_id=f"R{index:02d}",
                role="in-distribution",
                test_id=test_id,
                train_ids=train,
                scope="interview",
                scored=True,
            )
        )
    for index, test_id in enumerate(MUSIC_IDS, start=7):
        specs.append(
            RunSpec(
                run_id=f"R{index:02d}",
                role="out-of-distribution",
                test_id=test_id,
                train_ids=INTERVIEW_IDS,
                scope="interview",
                scored=True,
            )
        )
    return tuple(specs)


def g0_spec() -> RunSpec:
    return RunSpec(
        run_id="G0",
        role="diagnostic",
        test_id="I06",
        train_ids=INTERVIEW_IDS[:5] + MUSIC_IDS,
        scope="global",
        scored=False,
    )


def _views(items: tuple[CorpusItem, ...], sealed_id: str) -> dict[str, ItemView]:
    return {
        item.item_id: ItemView(item=item, sealed=item.item_id == sealed_id)
        for item in items
    }


def _by_id(items: tuple[CorpusItem, ...]) -> dict[str, CorpusItem]:
    return {item.item_id: item for item in items}


def _assert_support_isolated(support_ids: tuple[str, ...]) -> None:
    allowed = set(INTERVIEW_IDS)
    if any(item_id not in allowed for item_id in support_ids):
        raise LeakageError(f"support id outside synthetic interviews: {support_ids}")
    if REAL_WORLD_TRAINING_IDS:
        raise LeakageError("synthetic support copied into real-world training ids")


def _jsonable(value):
    if isinstance(value, Decimal):
        return decimal_text(value)
    if isinstance(value, dict):
        return {key: _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    return value


def execute_run(items: tuple[CorpusItem, ...], spec: RunSpec) -> dict:
    assert_frozen_constants()
    if spec.test_id in spec.train_ids:
        raise LeakageError(f"{spec.run_id}: test_id is in train_ids")
    if spec.scored and any(item_id.startswith("M") for item_id in spec.train_ids):
        raise LeakageError(f"{spec.run_id}: music-bed id in scored training")

    views = _views(items, spec.test_id)
    train_views = [views[item_id] for item_id in spec.train_ids]
    fit = fit_margin(train_views)
    sample_ids = {sample.item_id for sample in fit.samples}
    if not sample_ids <= set(spec.train_ids):
        raise LeakageError(f"{spec.run_id}: sample from outside train_ids")
    if spec.test_id in sample_ids:
        raise LeakageError(f"{spec.run_id}: test item contributed a sample")
    if views[spec.test_id].h_reads != 0:
        raise LeakageError(f"{spec.run_id}: held-out H read during fit")
    music_sample_count = sum(
        1 for sample in fit.samples if sample.item_id.startswith("M")
    )
    if spec.scored and music_sample_count != 0:
        raise LeakageError(f"{spec.run_id}: music-bed sample in interview preference")
    if spec.run_id == "G0" and music_sample_count != 0:
        raise LeakageError("G0 admitted music-bed margin samples")
    _assert_support_isolated(fit.support_ids)

    test_view = views[spec.test_id]
    p0 = baseline_policy()
    a0_keeps, a0_decisions = cut(test_view.peaks, p0, spec.test_id)
    apply_margin = False
    policy_id = BASELINE_POLICY_ID
    margin_ms = fit.margin_ms
    inert = True
    if spec.scored and scored_activation(spec.scope, fit):
        apply_margin = True
    elif (
        spec.run_id == "G0"
        and fit.margin_ms is not None
        and fit.support_count >= SUPPORT_MIN
        and fit.sample_count >= SAMPLE_MIN
        and abs(fit.margin_ms - P0_MARGIN_START_MS) > MARGIN_DISTANCE_MIN_MS
    ):
        # Section 7: evaluate the fitted global margin on I06.
        # Section 13 bars global activation inside the scored matrix. G0 is not scored.
        apply_margin = True
    if apply_margin:
        if margin_ms is None:
            raise LeakageError(f"{spec.run_id}: activation without a margin")
        p1 = with_margins(margin_ms)
        assert_only_margins_differ(p0, p1)
        a1_keeps, a1_decisions = cut(test_view.peaks, p1, spec.test_id)
        policy_id = LEARNED_POLICY_ID
        inert = False
    else:
        p1 = p0
        a1_keeps, a1_decisions = a0_keeps, a0_decisions
        assert_only_margins_differ(p0, p1)

    a1_serialized = json.dumps(_jsonable({"keeps": a1_keeps}), sort_keys=True)
    if test_view.h_reads != 0:
        raise LeakageError(f"{spec.run_id}: held-out H read before A1 serialization")
    if not a1_serialized:
        raise LeakageError(f"{spec.run_id}: A1 was not serialized")
    test_view.unseal()
    human_ranges = test_view.read_h()
    human_keeps = pack_ranges(human_ranges, spec.test_id)

    margin_after = fit.margin_ms
    if margin_after != margin_ms:
        raise LeakageError(f"{spec.run_id}: M changed after the arrangement")

    baseline = score(a0_keeps, human_keeps, FILE_DURATION_MS)
    learned = score(a1_keeps, human_keeps, FILE_DURATION_MS)
    red, excluded = reduction(baseline["cost"], learned["cost"])
    agree, disagree = agreement(
        baseline["op_count"],
        learned["op_count"],
        baseline["unmatched_ms"],
        learned["unmatched_ms"],
    )
    if inert:
        # Section 13: an inert scored run publishes reduction 0.
        if spec.scored:
            red = Decimal(0)
            excluded = False
            agree = False
            disagree = False

    non_margin_equal = p0.non_margin_tuple() == (
        p1.non_margin_tuple() if apply_margin or p1 is p0 else p0.non_margin_tuple()
    )
    if p0.non_margin_tuple() != (p1 if apply_margin else p0).non_margin_tuple():
        raise PolicyError(f"{spec.run_id}: non-margin mutation")

    return {
        "run_id": spec.run_id,
        "role": spec.role,
        "test_id": spec.test_id,
        "train_ids": list(spec.train_ids),
        "scope": spec.scope,
        "scored": spec.scored,
        "supportCount": fit.support_count,
        "sample_count": fit.sample_count,
        "sample_distances_ms": [sample.distance_ms for sample in fit.samples],
        "sample_item_ids": [sample.item_id for sample in fit.samples],
        "music_bed_sample_count": music_sample_count,
        "support_ids": list(fit.support_ids),
        "M": margin_ms,
        "inert": inert,
        "policy_id": policy_id,
        "status": "hypothesis",
        "confidence": fit.confidence,
        "counterexampleCount": fit.counterexample_count,
        "statement": None
        if margin_ms is None
        else f"margin.start.ms = {margin_ms}; margin.end.ms = {margin_ms}",
        "non_margin_equals_p0": non_margin_equal,
        "p0": {
            "policy_id": p0.policy_id,
            "threshold": decimal_text(p0.threshold),
            "margin_start_ms": p0.margin_start_ms,
            "margin_end_ms": p0.margin_end_ms,
            "min_cut_ms": p0.min_cut_ms,
            "min_clip_ms": p0.min_clip_ms,
            "hop_ms": p0.hop_ms,
            "order": list(p0.order),
            "comparison": ">=",
        },
        "p1": {
            "policy_id": policy_id,
            "threshold": decimal_text(p0.threshold),
            "margin_start_ms": p1.margin_start_ms,
            "margin_end_ms": p1.margin_end_ms,
            "min_cut_ms": p1.min_cut_ms,
            "min_clip_ms": p1.min_clip_ms,
            "hop_ms": p1.hop_ms,
            "order": list(p1.order),
            "comparison": ">=",
        },
        "A0_keeps": a0_keeps,
        "A1_keeps": a1_keeps,
        "A0_decisions": a0_decisions,
        "A1_decisions": a1_decisions,
        "baseline": _public_score(baseline),
        "learned": _public_score(learned),
        "cost_a0": baseline["cost"],
        "cost_a1": learned["cost"],
        "reduction": red,
        "excluded": excluded,
        "agree": agree,
        "disagreement": disagree,
        "leakage_check": True,
        "held_out_h_reads_before_a1": 0,
        "g0_scored_matrix_would_activate": False if spec.run_id == "G0" else None,
    }


def _public_score(result: dict) -> dict:
    return {
        "op_count": result["op_count"],
        "unmatched_ms": result["unmatched_ms"],
        "cost_decimal": result["cost_decimal"],
        "cost_fraction": result["cost_fraction"],
        "unmatched_fraction": result["unmatched_fraction"],
        "boundary_ms": result["boundary_ms"],
        "duration_error": result["duration_error"],
        "recut_rate": result["recut_rate"],
        "diff_records": result["diff_records"],
        "session_ms": "unknown",
        "command_count": "unknown",
    }


def _median_reductions(values: list[Decimal]) -> Decimal:
    return median_half_away(values)


def _comparable(run: dict) -> dict:
    return {
        "run_id": run["run_id"],
        "A0_keeps": run["A0_keeps"],
        "A1_keeps": run["A1_keeps"],
        "baseline": run["baseline"],
        "learned": run["learned"],
        "reduction": None if run["reduction"] is None else decimal_text(run["reduction"]),
        "M": run["M"],
        "agree": run["agree"],
        "excluded": run["excluded"],
        "supportCount": run["supportCount"],
        "sample_count": run["sample_count"],
    }


def execute_once(items: tuple[CorpusItem, ...]) -> dict:
    assert_frozen_constants()
    runs = [execute_run(items, spec) for spec in scored_matrix()]
    if len(runs) != 12:
        raise LeakageError("fewer than twelve scored rows")
    g0 = execute_run(items, g0_spec())
    id_runs = [run for run in runs if run["role"] == "in-distribution"]
    ood_runs = [run for run in runs if run["role"] == "out-of-distribution"]
    if any(run["run_id"] == "G0" for run in runs):
        raise LeakageError("G0 entered the scored list")
    id_reductions = [run["reduction"] for run in id_runs]
    ood_reductions = [run["reduction"] for run in ood_runs]
    if any(value is None for value in id_reductions + ood_reductions):
        median_id = None
        median_ood = None
    else:
        median_id = _median_reductions(id_reductions)
        median_ood = _median_reductions(ood_reductions)
    r06 = next(run for run in runs if run["run_id"] == "R06")
    return {
        "runs": runs,
        "g0": g0,
        "median_ID": median_id,
        "median_OOD": median_ood,
        "id_reductions": id_reductions,
        "ood_reductions": ood_reductions,
        "r06_margin": r06["M"],
        "r06_reduction": r06["reduction"],
    }


def _leakage_checklist(
    bundle_a: dict,
    bundle_b: dict,
    hop_hash: str,
    h_hash: str,
    hop_hash_b: str,
    h_hash_b: str,
    items: tuple[CorpusItem, ...],
) -> dict:
    runs = bundle_a["runs"]
    g0 = bundle_a["g0"]
    checks = {
        "test_id_not_in_train_ids": all(run["test_id"] not in run["train_ids"] for run in runs + [g0]),
        "held_out_h_not_read_before_a1": all(run["held_out_h_reads_before_a1"] == 0 for run in runs + [g0]),
        "samples_only_from_train_ids": all(
            set(run["sample_item_ids"]) <= set(run["train_ids"]) for run in runs + [g0]
        ),
        "scored_reductions_not_learning_inputs": all(
            run["M"] == run["M"] and "reduction" not in fit_margin.__code__.co_varnames
            for run in runs
        ),
        "music_bed_not_train_interview_pref": all(
            all(not item_id.startswith("M") for item_id in run["train_ids"])
            and run["music_bed_sample_count"] == 0
            for run in runs
        ),
        "training_item_costs_not_in_medians": len(bundle_a["id_reductions"]) == 6
        and len(bundle_a["ood_reductions"]) == 6
        and len(bundle_a["runs"]) == 12,
        "g0_not_in_either_median": g0["run_id"] not in {run["run_id"] for run in runs},
        "synthetic_support_isolated_from_real_world": REAL_WORLD_TRAINING_IDS == ()
        and all(set(run["support_ids"]) <= set(INTERVIEW_IDS) for run in runs + [g0]),
        "constants_unmodified": True,
        "h_is_section_3_table": all(item.h_ranges == AUTHORED_H_MS for item in items),
        "deterministic_same_seed": hop_hash == hop_hash_b
        and h_hash == h_hash_b
        and [_comparable(run) for run in bundle_a["runs"]]
        == [_comparable(run) for run in bundle_b["runs"]]
        and _comparable(bundle_a["g0"]) == _comparable(bundle_b["g0"])
        and decimal_text(bundle_a["median_ID"]) == decimal_text(bundle_b["median_ID"])
        and decimal_text(bundle_a["median_OOD"]) == decimal_text(bundle_b["median_OOD"]),
    }
    try:
        assert_frozen_constants()
    except RuntimeError:
        checks["constants_unmodified"] = False
    return checks


def _section_18(bundle: dict, checks: dict) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    if not all(checks.values()):
        reasons.append("section 12 leakage check failed")
    for run in bundle["runs"]:
        if run["test_id"] in run["train_ids"]:
            reasons.append(f"{run['run_id']} test id in training")
        if not run["non_margin_equals_p0"]:
            reasons.append(f"{run['run_id']} non-margin mutation")
        if run["role"] == "in-distribution" and run["disagreement"]:
            reasons.append(f"{run['run_id']} metrics moved in opposite directions")
        if run["role"] == "out-of-distribution" and run["reduction"] is not None and run["reduction"] < -SUCCESS_BAND:
            reasons.append(f"{run['run_id']} music-bed reduction < -0.10")
    g0 = bundle["g0"]
    if g0["music_bed_sample_count"] > 0 and bundle["r06_reduction"] is not None and g0["reduction"] is not None:
        if abs(g0["reduction"] - bundle["r06_reduction"]) > SUCCESS_BAND:
            reasons.append("G0 admitted music-bed samples and missed R06")
    if not checks["deterministic_same_seed"]:
        reasons.append("same seed and corpus hash disagreed")
    return (len(reasons) > 0), reasons


def _section_16(bundle: dict) -> tuple[bool, list[str]]:
    reasons: list[str] = []
    median_id = bundle["median_ID"]
    median_ood = bundle["median_OOD"]
    if median_id is None or median_id <= SUCCESS_BAND:
        reasons.append("median_ID <= 0.10")
    for run in bundle["runs"]:
        if run["role"] == "in-distribution" and (run["excluded"] or not run["agree"]):
            reasons.append(f"{run['run_id']} excluded or agree false")
        if run["role"] == "out-of-distribution" and run["reduction"] is not None and run["reduction"] < -SUCCESS_BAND:
            reasons.append(f"{run['run_id']} reduction < -0.10")
    if median_ood is None or median_ood < -SUCCESS_BAND:
        reasons.append("median_OOD < -0.10")
    if len(bundle["runs"]) < 12:
        reasons.append("fewer than twelve scored rows")
    return (len(reasons) > 0), reasons


def _section_15(bundle: dict, checks: dict, include_sentence: bool) -> bool:
    median_id = bundle["median_ID"]
    median_ood = bundle["median_OOD"]
    if median_id is None or median_ood is None:
        return False
    if not (median_id > SUCCESS_BAND):
        return False
    if any(run["role"] == "in-distribution" and (not run["agree"] or run["excluded"]) for run in bundle["runs"]):
        return False
    if median_ood < -SUCCESS_BAND:
        return False
    if any(
        run["role"] == "out-of-distribution" and run["reduction"] is not None and run["reduction"] < -SUCCESS_BAND
        for run in bundle["runs"]
    ):
        return False
    if any(not run["non_margin_equals_p0"] for run in bundle["runs"]):
        return False
    if not all(checks.values()):
        return False
    if len(bundle["runs"]) != 12:
        return False
    if not include_sentence:
        return False
    return True


def render_report(summary: dict) -> str:
    lines = [
        "# EXPERIMENTAL / NON-PRODUCT / MECHANICS VALIDATION",
        "",
        "Synthetic mechanics experiment for contract `17_EXPERIENCE_POC_CONTRACT.md`.",
        "Values below are measured from this runner. The later real-world result name is not awarded here.",
        "Music-bed reduction 0 is the null band. It is not evidence that the margin helped that material.",
        "Out-of-distribution agree is false because neither op_count nor unmatched_ms moved. That zero change is not a disagreement.",
        "",
        "Placement: artifacts live in `experiments/ai-cutter-experience-mechanics/artifacts/`.",
        "The contract's runner was specified before this directory existed. This bundle is not under `src/` and does not modify the research contract.",
        "",
        "G0 reading: section 7 says fit a global margin and evaluate I06. Section 13 bars global activation in the scored matrix. G0 is not scored, so the fitted margin is applied and then kept out of both medians. `scored_matrix_would_activate` is false.",
        "",
        "| Run | Role | Test ID | Train IDs | Support Count | Sample Count | Learned Margin | Baseline op_count | Baseline unmatched_ms | Baseline Cost | Learned op_count | Learned unmatched_ms | Learned Cost | Reduction | Agree | Excluded | Leakage Check |",
        "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |",
    ]
    for run in summary["runs"]:
        train = ",".join(run["train_ids"])
        red = "excluded" if run["excluded"] else run["reduction"]
        lines.append(
            "| {run_id} | {role} | {test_id} | {train} | {support} | {samples} | {margin} | {b_op} | {b_un} | {b_cost} | {l_op} | {l_un} | {l_cost} | {red} | {agree} | {excluded} | {leak} |".format(
                run_id=run["run_id"],
                role=run["role"],
                test_id=run["test_id"],
                train=train,
                support=run["supportCount"],
                samples=run["sample_count"],
                margin=run["M"],
                b_op=run["baseline_op_count"],
                b_un=run["baseline_unmatched_ms"],
                b_cost=run["baseline_cost"],
                l_op=run["learned_op_count"],
                l_un=run["learned_unmatched_ms"],
                l_cost=run["learned_cost"],
                red=red,
                agree=str(run["agree"]).lower(),
                excluded=str(run["excluded"]).lower(),
                leak="PASS" if run["leakage_check"] else "FAIL",
            )
        )
    lines.extend(
        [
            "",
            f"median_ID: {summary['median_ID']}",
            f"median_OOD: {summary['median_OOD']}",
            "",
            "## Measured reductions",
            "",
        ]
    )
    for run in summary["runs"]:
        lines.append(f"- {run['run_id']}: {run['reduction']}")
    det = summary["deterministic_rerun"]
    lines.extend(
        [
            "",
            "## Deterministic-run comparison",
            "",
            f"seed: {summary['seed']}",
            f"corpus hash run A: {det['corpus_hash_a']}",
            f"corpus hash run B: {det['corpus_hash_b']}",
            f"H hash run A: {det['h_hash_a']}",
            f"H hash run B: {det['h_hash_b']}",
            f"corpus hash equal: {str(det['corpus_hash_equal']).lower()}",
            f"H hash equal: {str(det['h_hash_equal']).lower()}",
            f"A0 equal: {str(det['a0_equal']).lower()}",
            f"A1 equal: {str(det['a1_equal']).lower()}",
            f"diffs equal: {str(det['diffs_equal']).lower()}",
            f"metrics equal: {str(det['metrics_equal']).lower()}",
            f"medians equal: {str(det['medians_equal']).lower()}",
            f"reductions run A: {', '.join(det['reductions_a'])}",
            f"reductions run B: {', '.join(det['reductions_b'])}",
            "",
            "## Diagnostic G0",
            "",
            f"scored: false",
            f"M: {summary['g0']['M']}",
            f"R06 M: {summary['g0']['r06_M']}",
            f"supportCount: {summary['g0']['supportCount']}",
            f"sample_count: {summary['g0']['sample_count']}",
            f"music_bed_sample_count: {summary['g0']['music_bed_sample_count']}",
            f"reduction: {summary['g0']['reduction']}",
            f"in medians: false",
            "",
            "## Integrity",
            "",
            f"seed: {summary['seed']}",
            f"corpus hash: {summary['corpus_hash']}",
            f"H hash: {summary['h_hash']}",
            f"leakage checks: {json.dumps(summary['leakage_checks'], sort_keys=True)}",
            f"non-margin unchanged: {str(summary['non_margin_unchanged']).lower()}",
            f"section_15_pass: {str(summary['section_15_pass']).lower()}",
            f"section_16_fail: {str(summary['section_16_fail']).lower()}",
            f"section_18_stop: {str(summary['section_18_stop']).lower()}",
            "",
        ]
    )
    if summary["section_15_pass"]:
        lines.extend(
            [
                PASS_SENTENCE,
                "",
                PERMITTED_CONCLUSION,
                "",
            ]
        )
    else:
        lines.extend(
            [
                "MECHANICS FAIL.",
                "",
                "The human preference-learning hypothesis remains untested.",
                "",
            ]
        )
    return "\n".join(lines)


def _summary_run(run: dict) -> dict:
    return {
        "run_id": run["run_id"],
        "role": run["role"],
        "test_id": run["test_id"],
        "train_ids": run["train_ids"],
        "supportCount": run["supportCount"],
        "sample_count": run["sample_count"],
        "M": run["M"],
        "inert": run["inert"],
        "policy_id": run["policy_id"],
        "baseline_op_count": run["baseline"]["op_count"],
        "baseline_unmatched_ms": run["baseline"]["unmatched_ms"],
        "baseline_cost": run["baseline"]["cost_decimal"],
        "learned_op_count": run["learned"]["op_count"],
        "learned_unmatched_ms": run["learned"]["unmatched_ms"],
        "learned_cost": run["learned"]["cost_decimal"],
        "reduction": None if run["reduction"] is None else decimal_text(run["reduction"]),
        "excluded": run["excluded"],
        "agree": run["agree"],
        "disagreement": run["disagreement"],
        "leakage_check": run["leakage_check"],
        "non_margin_equals_p0": run["non_margin_equals_p0"],
    }


def run_experiment() -> dict:
    assert_frozen_constants()
    items_a = build_corpus()
    items_b = build_corpus()
    hop_a, h_a = corpus_hashes(items_a)
    hop_b, h_b = corpus_hashes(items_b)
    bundle_a = execute_once(items_a)
    bundle_b = execute_once(items_b)
    checks = _leakage_checklist(bundle_a, bundle_b, hop_a, h_a, hop_b, h_b, items_a)
    stop, stop_reasons = _section_18(bundle_a, checks)
    fail, fail_reasons = _section_16(bundle_a)
    numeric_ready = (not stop) and (not fail) and all(checks.values())
    section_15 = _section_15(bundle_a, checks, include_sentence=numeric_ready)
    if section_15 and (stop or fail):
        section_15 = False

    reductions_a = [
        "excluded" if run["reduction"] is None else decimal_text(run["reduction"])
        for run in bundle_a["runs"]
    ]
    reductions_b = [
        "excluded" if run["reduction"] is None else decimal_text(run["reduction"])
        for run in bundle_b["runs"]
    ]
    comp_a = [_comparable(run) for run in bundle_a["runs"]]
    comp_b = [_comparable(run) for run in bundle_b["runs"]]
    deterministic = {
        "seed": SEED,
        "corpus_hash_a": hop_a,
        "corpus_hash_b": hop_b,
        "h_hash_a": h_a,
        "h_hash_b": h_b,
        "corpus_hash_equal": hop_a == hop_b,
        "h_hash_equal": h_a == h_b,
        "a0_equal": [run["A0_keeps"] for run in bundle_a["runs"]]
        == [run["A0_keeps"] for run in bundle_b["runs"]],
        "a1_equal": [run["A1_keeps"] for run in bundle_a["runs"]]
        == [run["A1_keeps"] for run in bundle_b["runs"]],
        "diffs_equal": [run["baseline"]["diff_records"] for run in bundle_a["runs"]]
        == [run["baseline"]["diff_records"] for run in bundle_b["runs"]]
        and [run["learned"]["diff_records"] for run in bundle_a["runs"]]
        == [run["learned"]["diff_records"] for run in bundle_b["runs"]],
        "metrics_equal": comp_a == comp_b,
        "medians_equal": decimal_text(bundle_a["median_ID"]) == decimal_text(bundle_b["median_ID"])
        and decimal_text(bundle_a["median_OOD"]) == decimal_text(bundle_b["median_OOD"]),
        "reductions_a": reductions_a,
        "reductions_b": reductions_b,
    }
    summary_runs = [_summary_run(run) for run in bundle_a["runs"]]
    summary = {
        "seed": SEED,
        "label": "EXPERIMENTAL / NON-PRODUCT / MECHANICS VALIDATION",
        "corpus_hash": hop_a,
        "h_hash": h_a,
        "median_ID": None if bundle_a["median_ID"] is None else decimal_text(bundle_a["median_ID"]),
        "median_OOD": None if bundle_a["median_OOD"] is None else decimal_text(bundle_a["median_OOD"]),
        "absolute_costs": [
            {
                "run_id": run["run_id"],
                "cost_a0": run["baseline"]["cost_decimal"],
                "cost_a0_fraction": run["baseline"]["cost_fraction"],
                "cost_a1": run["learned"]["cost_decimal"],
                "cost_a1_fraction": run["learned"]["cost_fraction"],
                "op_count_a0": run["baseline"]["op_count"],
                "op_count_a1": run["learned"]["op_count"],
                "unmatched_ms_a0": run["baseline"]["unmatched_ms"],
                "unmatched_ms_a1": run["learned"]["unmatched_ms"],
            }
            for run in bundle_a["runs"]
        ],
        "reductions": reductions_a,
        "runs": summary_runs,
        "g0": {
            "M": bundle_a["g0"]["M"],
            "r06_M": bundle_a["r06_margin"],
            "supportCount": bundle_a["g0"]["supportCount"],
            "sample_count": bundle_a["g0"]["sample_count"],
            "music_bed_sample_count": bundle_a["g0"]["music_bed_sample_count"],
            "reduction": None
            if bundle_a["g0"]["reduction"] is None
            else decimal_text(bundle_a["g0"]["reduction"]),
            "scored": False,
            "in_medians": False,
        },
        "leakage_checks": checks,
        "section_15_pass": section_15,
        "section_16_fail": fail,
        "section_16_reasons": fail_reasons,
        "section_18_stop": stop,
        "section_18_reasons": stop_reasons,
        "deterministic_rerun": deterministic,
        "non_margin_unchanged": all(run["non_margin_equals_p0"] for run in bundle_a["runs"]),
        "pass_sentence_included": section_15,
    }
    report = render_report(summary)
    if section_15 and PASS_SENTENCE not in report:
        summary["section_15_pass"] = False
        summary["pass_sentence_included"] = False
        report = render_report(summary)
    if (not summary["section_15_pass"]) and PASS_SENTENCE in report:
        raise LeakageError("PASS sentence written on a failing bundle")
    return {
        "items": items_a,
        "manifest": manifest_dict(items_a),
        "bundle": bundle_a,
        "summary": summary,
        "report": report,
    }


def _run_file(run: dict) -> dict:
    payload = {
        "run_id": run["run_id"],
        "train_ids": run["train_ids"],
        "test_id": run["test_id"],
        "scope": run["scope"],
        "supportCount": run["supportCount"],
        "sample_count": run["sample_count"],
        "M": run["M"],
        "inert": run["inert"],
        "policy_id": run["policy_id"],
        "status": run["status"],
        "confidence": run["confidence"],
        "counterexampleCount": run["counterexampleCount"],
        "statement": run["statement"],
        "A0_keeps": run["A0_keeps"],
        "A1_keeps": run["A1_keeps"],
        "A0_decisions": run["A0_decisions"],
        "A1_decisions": run["A1_decisions"],
        "baseline_diff_records": run["baseline"]["diff_records"],
        "learned_diff_records": run["learned"]["diff_records"],
        "baseline_op_count": run["baseline"]["op_count"],
        "learned_op_count": run["learned"]["op_count"],
        "baseline_unmatched_ms": run["baseline"]["unmatched_ms"],
        "learned_unmatched_ms": run["learned"]["unmatched_ms"],
        "baseline_boundary_ms": run["baseline"]["boundary_ms"],
        "learned_boundary_ms": run["learned"]["boundary_ms"],
        "baseline_duration_error": run["baseline"]["duration_error"],
        "learned_duration_error": run["learned"]["duration_error"],
        "baseline_recut_rate": run["baseline"]["recut_rate"],
        "learned_recut_rate": run["learned"]["recut_rate"],
        "baseline_cost": run["baseline"]["cost_decimal"],
        "baseline_cost_fraction": run["baseline"]["cost_fraction"],
        "baseline_unmatched_fraction": run["baseline"]["unmatched_fraction"],
        "learned_cost": run["learned"]["cost_decimal"],
        "learned_cost_fraction": run["learned"]["cost_fraction"],
        "learned_unmatched_fraction": run["learned"]["unmatched_fraction"],
        "reduction": None if run["reduction"] is None else decimal_text(run["reduction"]),
        "reduction_fraction": None
        if run["reduction"] is None
        else fraction_text(run["reduction"]),
        "excluded": run["excluded"],
        "agree": run["agree"],
        "disagreement": run["disagreement"],
        "session_ms": "unknown",
        "command_count": "unknown",
        "seed": SEED,
        "non_margin_equals_p0": run["non_margin_equals_p0"],
        "p0": run["p0"],
        "p1": run["p1"],
        "sample_distances_ms": run["sample_distances_ms"],
        "music_bed_sample_count": run["music_bed_sample_count"],
    }
    if not run["scored"]:
        payload["scored"] = False
        payload["g0_scored_matrix_would_activate"] = False
    return payload


def assert_safe_output(path: Path) -> None:
    resolved = path.resolve()
    parts = resolved.parts
    if "src" in parts or "src-tauri" in parts:
        raise LeakageError("refusing to write into product source")
    if "docs" in parts and "ai-cutter-research" in parts:
        raise LeakageError("refusing to write into the research baseline")
    if EXP_ROOT not in resolved.parents and resolved != EXP_ROOT:
        raise LeakageError("refusing to write outside the experiment directory")


def write_artifacts(result: dict, out_dir: Path) -> None:
    assert_safe_output(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "corpus_manifest.json").write_text(
        json.dumps(result["manifest"], indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    for run in result["bundle"]["runs"]:
        (out_dir / f"run_{run['run_id']}.json").write_text(
            json.dumps(_run_file(run), indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    g0_payload = _run_file(result["bundle"]["g0"])
    g0_payload["scored"] = False
    (out_dir / "diagnostic_G0.json").write_text(
        json.dumps(g0_payload, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (out_dir / "summary.json").write_text(
        json.dumps(result["summary"], indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    (out_dir / "REPORT.md").write_text(result["report"], encoding="utf-8")


def main() -> int:
    out = EXP_ROOT / "artifacts"
    result = run_experiment()
    write_artifacts(result, out)
    return 0 if result["summary"]["section_15_pass"] else 2


if __name__ == "__main__":
    sys.exit(main())
