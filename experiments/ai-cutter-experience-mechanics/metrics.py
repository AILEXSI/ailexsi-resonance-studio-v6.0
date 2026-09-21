"""Correction cost. op_count and unmatched_ms stay separate from cost."""

from __future__ import annotations

from decimal import Decimal
from fractions import Fraction

from diff import diff_keeps
from learn import median_half_away


def _duration(clip: dict) -> int:
    return int(clip["sourceOutMs"]) - int(clip["sourceInMs"])


def decimal_text(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def fraction_text(value: Decimal) -> str:
    frac = Fraction(value)
    return f"{frac.numerator}/{frac.denominator}"


def _overlap(a_in: int, a_out: int, b_in: int, b_out: int) -> int:
    return max(0, min(a_out, b_out) - max(a_in, b_in))


def boundary_ms(records: list[dict]) -> str | None:
    deltas: list[Decimal] = []
    for record in records:
        if record["class"] != "retimed":
            continue
        policy = record["policy"]
        human = record["human"]
        deltas.append(Decimal(abs(policy["sourceInMs"] - human["sourceInMs"])))
        deltas.append(Decimal(abs(policy["sourceOutMs"] - human["sourceOutMs"])))
    if not deltas:
        return None
    return decimal_text(median_half_away(deltas))


def duration_error(policy_keeps: list[dict], human_keeps: list[dict], source_duration_ms: int) -> Decimal:
    policy_dur = sum(_duration(clip) for clip in policy_keeps)
    human_dur = sum(_duration(clip) for clip in human_keeps)
    return Decimal(abs(policy_dur - human_dur)) / Decimal(source_duration_ms)


def recut_rate(policy_keeps: list[dict], human_keeps: list[dict]) -> Decimal | None:
    if not policy_keeps:
        return None
    thrown = 0
    for clip in policy_keeps:
        span = _duration(clip)
        overlap = sum(
            _overlap(
                clip["sourceInMs"],
                clip["sourceOutMs"],
                human["sourceInMs"],
                human["sourceOutMs"],
            )
            for human in human_keeps
        )
        if span == 0 or Decimal(overlap) < Decimal(span) * Decimal("0.5"):
            thrown += 1
    return Decimal(thrown) / Decimal(len(policy_keeps))


def score(policy_keeps: list[dict], human_keeps: list[dict], source_duration_ms: int) -> dict:
    records = diff_keeps(policy_keeps, human_keeps)
    op_count = sum(1 for record in records if record["class"] not in ("unchanged", "shifted"))
    unmatched_ms = 0
    for record in records:
        if record["class"] == "added":
            unmatched_ms += _duration(record["human"])
        elif record["class"] == "removed":
            unmatched_ms += _duration(record["policy"])
    cost = Decimal(op_count) + Decimal(unmatched_ms) / Decimal(1000)
    rate = recut_rate(policy_keeps, human_keeps)
    return {
        "op_count": op_count,
        "unmatched_ms": unmatched_ms,
        "cost": cost,
        "cost_decimal": decimal_text(cost),
        "cost_fraction": fraction_text(cost),
        "unmatched_fraction": f"{unmatched_ms}/1000",
        "boundary_ms": boundary_ms(records),
        "duration_error": decimal_text(duration_error(policy_keeps, human_keeps, source_duration_ms)),
        "recut_rate": None if rate is None else decimal_text(rate),
        "diff_records": records,
        "session_ms": "unknown",
        "command_count": "unknown",
    }


def reduction(cost_a0: Decimal, cost_a1: Decimal) -> tuple[Decimal | None, bool]:
    if cost_a0 == 0:
        return None, True
    return (cost_a0 - cost_a1) / cost_a0, False


def agreement(op_a0: int, op_a1: int, unmatched_a0: int, unmatched_a1: int) -> tuple[bool, bool]:
    d_op = op_a0 - op_a1
    d_un = unmatched_a0 - unmatched_a1
    agree = d_op >= 0 and d_un >= 0 and (d_op > 0 or d_un > 0)
    disagreement = (d_op > 0 and d_un < 0) or (d_op < 0 and d_un > 0)
    return agree, disagreement
