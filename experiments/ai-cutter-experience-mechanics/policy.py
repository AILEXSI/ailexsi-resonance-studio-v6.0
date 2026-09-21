"""ae-default-v0 cutter: threshold, then margin, then min durations.

A run flips only when its length is strictly shorter than the minimum.
No parameter other than the two margins may change between P0 and P1.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from constants import (
    BASELINE_POLICY_ID,
    FILE_DURATION_MS,
    HOP_MS,
    LEARNED_POLICY_ID,
    MIN_CLIP_MS,
    MIN_CUT_MS,
    P0_MARGIN_END_MS,
    P0_MARGIN_START_MS,
    PEAK_THRESHOLD,
    POLICY_ORDER,
)


class PolicyError(RuntimeError):
    pass


@dataclass(frozen=True)
class Policy:
    policy_id: str
    threshold: Decimal
    margin_start_ms: int
    margin_end_ms: int
    min_cut_ms: int
    min_clip_ms: int
    hop_ms: int
    order: tuple[str, ...]

    def non_margin_tuple(self) -> tuple:
        return (
            str(self.threshold),
            self.min_cut_ms,
            self.min_clip_ms,
            self.hop_ms,
            self.order,
            ">=",
        )


def baseline_policy() -> Policy:
    return Policy(
        policy_id=BASELINE_POLICY_ID,
        threshold=PEAK_THRESHOLD,
        margin_start_ms=P0_MARGIN_START_MS,
        margin_end_ms=P0_MARGIN_END_MS,
        min_cut_ms=MIN_CUT_MS,
        min_clip_ms=MIN_CLIP_MS,
        hop_ms=HOP_MS,
        order=POLICY_ORDER,
    )


def with_margins(margin_ms: int) -> Policy:
    base = baseline_policy()
    if margin_ms % base.hop_ms != 0:
        raise PolicyError(
            f"margin {margin_ms} ms is not divisible by hop {base.hop_ms}; refusing to round"
        )
    return Policy(
        policy_id=LEARNED_POLICY_ID,
        threshold=base.threshold,
        margin_start_ms=margin_ms,
        margin_end_ms=margin_ms,
        min_cut_ms=base.min_cut_ms,
        min_clip_ms=base.min_clip_ms,
        hop_ms=base.hop_ms,
        order=base.order,
    )


def assert_only_margins_differ(left: Policy, right: Policy) -> None:
    if left.non_margin_tuple() != right.non_margin_tuple():
        raise PolicyError("non-margin parameter differs between P0 and P1")
    if left.margin_start_ms != left.margin_end_ms:
        raise PolicyError("P0 margins are not equal")
    if right.margin_start_ms != right.margin_end_ms:
        raise PolicyError("P1 margins are not a single integer")


def _hops(ms: int, hop_ms: int) -> int:
    if ms % hop_ms != 0:
        raise PolicyError(f"{ms} ms is not divisible by hop {hop_ms}; refusing to round")
    return ms // hop_ms


def threshold_mask(peaks: tuple[Decimal, ...], threshold: Decimal) -> list[bool]:
    return [peak >= threshold for peak in peaks]


def bool_runs(mask: list[bool]) -> list[tuple[bool, int, int]]:
    if not mask:
        return []
    runs: list[tuple[bool, int, int]] = []
    start = 0
    current = mask[0]
    for index in range(1, len(mask)):
        if mask[index] != current:
            runs.append((current, start, index))
            start = index
            current = mask[index]
    runs.append((current, start, len(mask)))
    return runs


def apply_margin(mask: list[bool], margin_start_hops: int, margin_end_hops: int) -> list[bool]:
    expanded = [False] * len(mask)
    for active, start, end in bool_runs(mask):
        if not active:
            continue
        left = max(0, start - margin_start_hops)
        right = min(len(mask), end + margin_end_hops)
        for index in range(left, right):
            expanded[index] = True
    return expanded


def smooth(mask: list[bool], min_cut_hops: int, min_clip_hops: int) -> list[bool]:
    """Flip a run only when its length is strictly shorter than the minimum.

    Repeat until stable. If a state repeats, stop (two-step cycle break).
    """
    current = list(mask)
    seen: set[tuple[bool, ...]] = set()
    while True:
        state = tuple(current)
        if state in seen:
            break
        seen.add(state)
        updated = list(current)
        changed = False
        for active, start, end in bool_runs(current):
            length = end - start
            if not active and length < min_cut_hops:
                for index in range(start, end):
                    updated[index] = True
                changed = True
            elif active and length < min_clip_hops:
                for index in range(start, end):
                    updated[index] = False
                changed = True
        if not changed:
            break
        current = updated
    return current


def apply_policy(peaks: tuple[Decimal, ...], policy: Policy) -> list[bool]:
    if policy.order != POLICY_ORDER:
        raise PolicyError("policy order is not threshold, margin, min durations")
    if len(peaks) != _hops(FILE_DURATION_MS, policy.hop_ms):
        raise PolicyError("peak series length does not match file duration")
    mask = threshold_mask(peaks, policy.threshold)
    mask = apply_margin(
        mask,
        _hops(policy.margin_start_ms, policy.hop_ms),
        _hops(policy.margin_end_ms, policy.hop_ms),
    )
    mask = smooth(
        mask,
        _hops(policy.min_cut_ms, policy.hop_ms),
        _hops(policy.min_clip_ms, policy.hop_ms),
    )
    return mask


def arrangement_from_mask(
    mask: list[bool], asset_id: str, hop_ms: int
) -> tuple[list[dict], list[dict]]:
    """Packed KEEP segments, plus KEEP/CUT decisions.

    CUT decisions do not advance record time. Section 11 pairs the KEEP list.
    The contract's cost oracle counts three retimed KEEP records, so CUT
    decisions are retained and are not a second pairing input.
    """
    keeps: list[dict] = []
    decisions: list[dict] = []
    record_ms = 0
    for active, start, end in bool_runs(mask):
        source_in = start * hop_ms
        source_out = end * hop_ms
        decisions.append(
            {
                "kind": "KEEP" if active else "CUT",
                "sourceInMs": source_in,
                "sourceOutMs": source_out,
            }
        )
        if not active:
            continue
        duration = source_out - source_in
        keeps.append(
            {
                "assetId": asset_id,
                "sourceInMs": source_in,
                "sourceOutMs": source_out,
                "recordInMs": record_ms,
                "order": len(keeps),
                "rate": 1,
            }
        )
        record_ms += duration
    return keeps, decisions


def cut(peaks: tuple[Decimal, ...], policy: Policy, asset_id: str) -> tuple[list[dict], list[dict]]:
    mask = apply_policy(peaks, policy)
    return arrangement_from_mask(mask, asset_id, policy.hop_ms)


def pack_ranges(ranges: tuple[tuple[int, int], ...] | list[tuple[int, int]], asset_id: str) -> list[dict]:
    keeps: list[dict] = []
    record_ms = 0
    for source_in, source_out in ranges:
        keeps.append(
            {
                "assetId": asset_id,
                "sourceInMs": source_in,
                "sourceOutMs": source_out,
                "recordInMs": record_ms,
                "order": len(keeps),
                "rate": 1,
            }
        )
        record_ms += source_out - source_in
    return keeps
