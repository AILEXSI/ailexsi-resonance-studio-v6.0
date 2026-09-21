"""Interview-margin fit. Median of pre-margin edge distances. No other learner."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

from constants import (
    FILE_BOUNDARY_END_MS,
    FILE_BOUNDARY_START_MS,
    FILE_DURATION_MS,
    HOP_MS,
    MARGIN_DISTANCE_MIN_MS,
    P0_MARGIN_START_MS,
    PEAK_THRESHOLD,
    SAMPLE_MIN,
    SAMPLE_NEAR_MS,
    SUPPORT_MIN,
)
from corpus import ItemView, LeakageError
from policy import threshold_mask


@dataclass(frozen=True)
class Sample:
    item_id: str
    distance_ms: int


@dataclass(frozen=True)
class Fit:
    margin_ms: int | None
    support_count: int
    sample_count: int
    support_ids: tuple[str, ...]
    samples: tuple[Sample, ...]
    counterexample_count: int = 0

    @property
    def confidence(self) -> str:
        denominator = self.support_count + self.counterexample_count
        if denominator < SUPPORT_MIN:
            return "unknown"
        if denominator == 0:
            return "unknown"
        value = Decimal(self.support_count) / Decimal(denominator)
        return format(value, "f")


def median_half_away(values: list[Decimal]) -> Decimal:
    """Section 9 median. Even count: mean, then half away from zero if not integral."""
    if not values:
        raise LeakageError("median of an empty sample list")
    ordered = sorted(values)
    count = len(ordered)
    if count % 2 == 1:
        return ordered[count // 2]
    mean = (ordered[count // 2 - 1] + ordered[count // 2]) / Decimal(2)
    if mean == mean.to_integral_value():
        return mean
    return mean.to_integral_value(rounding=ROUND_HALF_UP)


def _active_runs_ms(mask: list[bool], hop_ms: int) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    start = None
    for index, active in enumerate(mask):
        if active and start is None:
            start = index
        elif not active and start is not None:
            runs.append((start * hop_ms, index * hop_ms))
            start = None
    if start is not None:
        runs.append((start * hop_ms, len(mask) * hop_ms))
    return runs


def _nearest(edge_ms: int, runs: list[tuple[int, int]]) -> tuple[int, int] | None:
    best: tuple[int, int] | None = None
    for start, end in runs:
        if edge_ms < start:
            distance = start - edge_ms
            activity_edge = start
        elif edge_ms >= end:
            distance = edge_ms - end
            activity_edge = end
        else:
            distance = 0
            activity_edge = edge_ms
        if best is None or distance < best[0] or (
            distance == best[0] and activity_edge < best[1]
        ):
            best = (distance, activity_edge)
    return best


def samples_for(view: ItemView) -> list[Sample]:
    """Section 9. A fully active mask emits nothing and does not read H."""
    mask = threshold_mask(view.peaks, PEAK_THRESHOLD)
    if not any(not hop for hop in mask):
        return []
    ranges = view.read_h()
    runs = _active_runs_ms(mask, HOP_MS)
    samples: list[Sample] = []
    for source_in, source_out in ranges:
        for edge in (source_in, source_out):
            if edge == FILE_BOUNDARY_START_MS or edge == FILE_BOUNDARY_END_MS:
                continue
            if edge < 0 or edge >= FILE_DURATION_MS:
                continue
            hop = edge // HOP_MS
            if hop < 0 or hop >= len(mask) or mask[hop]:
                continue
            nearest = _nearest(edge, runs)
            if nearest is None:
                continue
            distance, activity_edge = nearest
            if distance > SAMPLE_NEAR_MS:
                continue
            samples.append(
                Sample(item_id=view.item_id, distance_ms=abs(edge - activity_edge))
            )
    return samples


def fit_margin(train_views: list[ItemView]) -> Fit:
    """Fit from train views only. The signature takes no reduction and no test H."""
    samples: list[Sample] = []
    support: list[str] = []
    for view in train_views:
        item_samples = samples_for(view)
        if item_samples:
            support.append(view.item_id)
            samples.extend(item_samples)
    margin = None
    if samples:
        margin = int(median_half_away([Decimal(sample.distance_ms) for sample in samples]))
    return Fit(
        margin_ms=margin,
        support_count=len(support),
        sample_count=len(samples),
        support_ids=tuple(support),
        samples=tuple(samples),
    )


def scored_activation(scope: str, fit: Fit) -> bool:
    """Section 13. Global and other scopes do not activate in the scored matrix."""
    if scope != "interview":
        return False
    if fit.support_count < SUPPORT_MIN:
        return False
    if fit.sample_count < SAMPLE_MIN:
        return False
    if fit.margin_ms is None:
        return False
    if abs(fit.margin_ms - P0_MARGIN_START_MS) <= MARGIN_DISTANCE_MIN_MS:
        return False
    return True
