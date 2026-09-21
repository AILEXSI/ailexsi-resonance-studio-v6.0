"""Experiment-only tests. They do not touch Resonance product suites."""

from __future__ import annotations

import ast
import copy
import sys
import unittest
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import constants  # noqa: E402
import corpus  # noqa: E402
import diff  # noqa: E402
import experiment  # noqa: E402
import learn  # noqa: E402
import metrics  # noqa: E402
import policy  # noqa: E402


def _clip(asset, source_in, source_out, record_in, order):
    return {
        "assetId": asset,
        "sourceInMs": source_in,
        "sourceOutMs": source_out,
        "recordInMs": record_in,
        "order": order,
        "rate": 1,
    }


class CorpusTests(unittest.TestCase):
    def test_deterministic_corpus_and_hashes(self):
        first = corpus.build_corpus()
        second = corpus.build_corpus()
        self.assertEqual(corpus.corpus_hashes(first), corpus.corpus_hashes(second))
        self.assertEqual(corpus.canonical_hop_peak_bytes(first), corpus.canonical_hop_peak_bytes(second))
        self.assertEqual(corpus.canonical_h_bytes(first), corpus.canonical_h_bytes(second))
        self.assertEqual(len(first), 12)
        self.assertEqual(first[0].h_ranges, constants.AUTHORED_H_MS)
        self.assertEqual(first[0].peaks, first[5].peaks)
        self.assertEqual(first[6].peaks, first[11].peaks)
        self.assertNotEqual(first[0].peaks, first[6].peaks)

    def test_authored_h_is_literal_not_refit(self):
        self.assertEqual(
            constants.AUTHORED_H_MS,
            ((600, 3400), (3600, 6400), (6600, 9400)),
        )


class MedianTests(unittest.TestCase):
    def test_odd_even_and_half_away_from_zero(self):
        self.assertEqual(learn.median_half_away([Decimal(3), Decimal(1), Decimal(2)]), Decimal(2))
        self.assertEqual(learn.median_half_away([Decimal(1), Decimal(2)]), Decimal(2))
        self.assertEqual(learn.median_half_away([Decimal(1), Decimal(4)]), Decimal(3))
        self.assertEqual(learn.median_half_away([Decimal(-3), Decimal(-2)]), Decimal(-3))
        self.assertEqual(learn.median_half_away([Decimal(400)] * 30), Decimal(400))


class ActivationTests(unittest.TestCase):
    def _fit(self, support, samples, margin):
        rows = tuple(
            learn.Sample(item_id=f"I0{index}", distance_ms=margin)
            for index in range(1, support + 1)
        )
        # sample_count is len(samples tuple); pad to the requested count
        if samples > len(rows):
            extra = tuple(
                learn.Sample(item_id="I01", distance_ms=margin)
                for _ in range(samples - len(rows))
            )
            rows = rows + extra
        else:
            rows = rows[:samples]
        return learn.Fit(
            margin_ms=margin,
            support_count=support,
            sample_count=len(rows),
            support_ids=tuple(f"I0{index}" for index in range(1, support + 1)),
            samples=rows,
        )

    def test_activation_requires_support_and_samples_at_least_4(self):
        self.assertTrue(learn.scored_activation("interview", self._fit(4, 4, 241)))
        self.assertFalse(learn.scored_activation("interview", self._fit(3, 30, 400)))
        self.assertFalse(learn.scored_activation("interview", self._fit(4, 3, 400)))

    def test_inert_below_support(self):
        self.assertFalse(learn.scored_activation("interview", self._fit(0, 0, None)))
        self.assertFalse(learn.scored_activation("interview", self._fit(3, 18, 400)))

    def test_margin_distance_boundary_is_strict(self):
        self.assertFalse(learn.scored_activation("interview", self._fit(4, 4, 240)))
        self.assertFalse(learn.scored_activation("interview", self._fit(4, 4, 160)))
        self.assertTrue(learn.scored_activation("interview", self._fit(4, 4, 241)))
        self.assertTrue(learn.scored_activation("interview", self._fit(4, 4, 159)))
        self.assertFalse(learn.scored_activation("global", self._fit(6, 36, 400)))


class PolicyTests(unittest.TestCase):
    def test_baseline_interview_and_music_oracles(self):
        items = {item.item_id: item for item in corpus.build_corpus()}
        p0 = policy.baseline_policy()
        interview, _ = policy.cut(items["I01"].peaks, p0, "I01")
        music, _ = policy.cut(items["M01"].peaks, p0, "M01")
        self.assertEqual(
            [(clip["sourceInMs"], clip["sourceOutMs"]) for clip in interview],
            [(800, 3200), (3800, 6200), (6800, 9200)],
        )
        self.assertEqual(
            [(clip["sourceInMs"], clip["sourceOutMs"]) for clip in music],
            [(0, 10000)],
        )

    def test_margin_400_matches_authored_h(self):
        item = corpus.build_corpus()[0]
        learned, _ = policy.cut(item.peaks, policy.with_margins(400), "I01")
        self.assertEqual(
            [(clip["sourceInMs"], clip["sourceOutMs"]) for clip in learned],
            list(constants.AUTHORED_H_MS),
        )

    def test_music_margin_does_not_move(self):
        item = corpus.build_corpus()[6]
        base, _ = policy.cut(item.peaks, policy.baseline_policy(), "M01")
        learned, _ = policy.cut(item.peaks, policy.with_margins(400), "M01")
        self.assertEqual(base, learned)

    def test_min_duration_is_strictly_shorter(self):
        hop = constants.HOP_MS
        mask = [False] * 100
        # 20 hops = 200 ms inactive inside an active field: not strictly shorter than min cut.
        mask[0:10] = [True] * 10
        mask[30:40] = [True] * 10
        smoothed = policy.smooth(mask, min_cut_hops=20, min_clip_hops=10)
        self.assertFalse(any(smoothed[10:30]))
        short = [False] * 100
        short[0:10] = [True] * 10
        short[29:40] = [True] * 10
        filled = policy.smooth(short, min_cut_hops=20, min_clip_hops=10)
        self.assertTrue(all(filled[10:29]))
        self.assertEqual(hop, 10)


class DiffTests(unittest.TestCase):
    def test_identity_unchanged(self):
        keeps = [
            _clip("I01", 600, 3400, 0, 0),
            _clip("I01", 3600, 6400, 2800, 1),
            _clip("I01", 6600, 9400, 5600, 2),
        ]
        records = diff.diff_keeps(keeps, copy.deepcopy(keeps))
        self.assertTrue(all(record["class"] == "unchanged" for record in records))
        scored = metrics.score(keeps, keeps, 10000)
        self.assertEqual(scored["op_count"], 0)
        self.assertEqual(scored["unmatched_ms"], 0)
        self.assertEqual(scored["cost"], Decimal(0))

    def test_retime_and_op_count(self):
        items = {item.item_id: item for item in corpus.build_corpus()}
        a0, _ = policy.cut(items["I01"].peaks, policy.baseline_policy(), "I01")
        human = policy.pack_ranges(items["I01"].h_ranges, "I01")
        scored = metrics.score(a0, human, 10000)
        self.assertEqual([record["class"] for record in scored["diff_records"]], ["retimed"] * 3)
        self.assertEqual(scored["op_count"], 3)
        self.assertEqual(scored["unmatched_ms"], 0)
        self.assertEqual(scored["cost"], Decimal(3))
        self.assertEqual(scored["boundary_ms"], "200")

    def test_unmatched_ms_and_correction_cost_music(self):
        items = {item.item_id: item for item in corpus.build_corpus()}
        a0, _ = policy.cut(items["M01"].peaks, policy.baseline_policy(), "M01")
        human = policy.pack_ranges(items["M01"].h_ranges, "M01")
        scored = metrics.score(a0, human, 10000)
        classes = sorted(record["class"] for record in scored["diff_records"])
        self.assertEqual(classes, ["added", "added", "added", "removed"])
        self.assertEqual(scored["op_count"], 4)
        self.assertEqual(scored["unmatched_ms"], 18400)
        self.assertEqual(scored["cost"], Decimal("22.4"))

    def test_ripple_exclusion_does_not_inflate_cost(self):
        policy_keeps = [
            _clip("A", 0, 1000, 0, 0),
            _clip("A", 2000, 3000, 1000, 1),
        ]
        human_keeps = [
            _clip("A", 9000, 10000, 0, 0),
            _clip("A", 0, 1000, 1000, 1),
            _clip("A", 2000, 3000, 2000, 2),
        ]
        scored = metrics.score(policy_keeps, human_keeps, 10000)
        classes = [record["class"] for record in scored["diff_records"]]
        self.assertIn("added", classes)
        self.assertEqual(classes.count("shifted"), 2)
        self.assertNotIn("retimed", classes)
        self.assertEqual(scored["op_count"], 1)
        self.assertEqual(scored["unmatched_ms"], 1000)
        self.assertEqual(scored["cost"], Decimal(2))

    def test_retime_ripple_is_not_a_second_op(self):
        policy_keeps = [
            _clip("A", 0, 1000, 0, 0),
            _clip("A", 2000, 3000, 1000, 1),
        ]
        human_keeps = [
            _clip("A", 0, 1400, 0, 0),
            _clip("A", 2000, 3000, 1400, 1),
        ]
        scored = metrics.score(policy_keeps, human_keeps, 10000)
        classes = [record["class"] for record in scored["diff_records"]]
        self.assertEqual(classes.count("retimed"), 1)
        self.assertEqual(classes.count("shifted"), 1)
        self.assertEqual(scored["op_count"], 1)
        self.assertEqual(scored["unmatched_ms"], 0)


class LeakageAndMatrixTests(unittest.TestCase):
    def test_train_test_isolation_and_ood_and_g0(self):
        result = experiment.run_experiment()
        runs = result["bundle"]["runs"]
        self.assertEqual(len(runs), 12)
        for run in runs:
            self.assertNotIn(run["test_id"], run["train_ids"])
            self.assertTrue(set(run["sample_item_ids"]) <= set(run["train_ids"]))
            self.assertNotIn(run["test_id"], run["sample_item_ids"])
            self.assertTrue(all(not item_id.startswith("M") for item_id in run["train_ids"]))
            self.assertEqual(run["music_bed_sample_count"], 0)
            self.assertEqual(run["held_out_h_reads_before_a1"], 0)
        id_runs = [run for run in runs if run["role"] == "in-distribution"]
        ood_runs = [run for run in runs if run["role"] == "out-of-distribution"]
        self.assertEqual(len(id_runs), 6)
        self.assertEqual(len(ood_runs), 6)
        self.assertTrue(all(run["supportCount"] == 5 for run in id_runs))
        self.assertTrue(all(run["sample_count"] == 30 for run in id_runs))
        self.assertTrue(all(run["supportCount"] == 6 for run in ood_runs))
        self.assertTrue(all(run["sample_count"] == 36 for run in ood_runs))
        self.assertTrue(all(run["train_ids"] == list(constants.INTERVIEW_IDS) for run in ood_runs))
        g0 = result["bundle"]["g0"]
        self.assertFalse(g0["scored"])
        self.assertEqual(g0["music_bed_sample_count"], 0)
        self.assertEqual(g0["M"], result["bundle"]["r06_margin"])
        self.assertNotIn(g0["run_id"], {run["run_id"] for run in runs})
        self.assertEqual(result["summary"]["g0"]["in_medians"], False)
        reductions = [Decimal(run["reduction"]) for run in result["summary"]["runs"]]
        self.assertEqual(len(reductions), 12)
        self.assertEqual(result["summary"]["median_ID"], "1")
        self.assertEqual(result["summary"]["median_OOD"], "0")

    def test_same_seed_reproducibility(self):
        first = experiment.run_experiment()
        second = experiment.run_experiment()
        self.assertEqual(first["summary"]["corpus_hash"], second["summary"]["corpus_hash"])
        self.assertEqual(first["summary"]["h_hash"], second["summary"]["h_hash"])
        self.assertEqual(first["summary"]["reductions"], second["summary"]["reductions"])
        self.assertTrue(first["summary"]["deterministic_rerun"]["medians_equal"])
        self.assertTrue(first["summary"]["deterministic_rerun"]["metrics_equal"])
        self.assertEqual(first["summary"]["seed"], 20260921)

    def test_music_bed_does_not_read_h_when_fully_active(self):
        item = corpus.build_corpus()[6]
        view = corpus.ItemView(item=item, sealed=True)
        samples = learn.samples_for(view)
        self.assertEqual(samples, [])
        self.assertEqual(view.h_reads, 0)

    def test_sealed_h_raises(self):
        item = corpus.build_corpus()[0]
        view = corpus.ItemView(item=item, sealed=True)
        with self.assertRaises(corpus.LeakageError):
            view.read_h()

    def test_fit_signature_has_no_reduction(self):
        self.assertNotIn("reduction", learn.fit_margin.__code__.co_varnames)

    def test_constants_match_contract(self):
        constants.assert_frozen_constants()
        self.assertEqual(constants.SEED, 20260921)
        self.assertEqual(constants.SUCCESS_BAND, Decimal("0.10"))
        self.assertEqual(constants.SUPPORT_MIN, 4)
        self.assertEqual(constants.MARGIN_DISTANCE_MIN_MS, 40)
        self.assertEqual(constants.BASELINE_POLICY_ID, "ae-default-v0")

    def test_no_product_or_model_imports(self):
        banned = {
            "whisper",
            "whisperx",
            "torch",
            "tensorflow",
            "openai",
            "anthropic",
            "otio",
            "opentimelineio",
            "scenedetect",
            "transnet",
        }
        for path in ROOT.glob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    names = [alias.name.split(".")[0] for alias in node.names]
                elif isinstance(node, ast.ImportFrom):
                    names = [(node.module or "").split(".")[0]]
                else:
                    continue
                self.assertTrue(set(names).isdisjoint(banned), path.name)
        self.assertFalse((ROOT / "src").exists())


class ReportTests(unittest.TestCase):
    def test_pass_sentence_and_medians(self):
        result = experiment.run_experiment()
        summary = result["summary"]
        self.assertTrue(summary["section_15_pass"])
        self.assertFalse(summary["section_16_fail"])
        self.assertFalse(summary["section_18_stop"])
        self.assertIn(constants.PASS_SENTENCE, result["report"])
        self.assertIn(constants.PERMITTED_CONCLUSION, result["report"])
        self.assertNotIn("HYPOTHESIS PASS", result["report"])
        self.assertEqual(summary["median_ID"], "1")
        self.assertEqual(summary["median_OOD"], "0")
        self.assertEqual(summary["reductions"][:6], ["1"] * 6)
        self.assertEqual(summary["reductions"][6:], ["0"] * 6)
        self.assertTrue(all(not run["excluded"] for run in summary["runs"]))
        self.assertTrue(all(not run["disagreement"] for run in summary["runs"]))
        self.assertTrue(all(run["agree"] for run in summary["runs"][:6]))


if __name__ == "__main__":
    unittest.main()
