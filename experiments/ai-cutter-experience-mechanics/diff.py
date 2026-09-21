"""Identity diff. Contract section 11, in order. Tolerance is 0 ms.

Pure ripple (class shifted) is not an operation. One pair is one record.
"""

from __future__ import annotations

from collections import defaultdict


def _duration(clip: dict) -> int:
    return int(clip["sourceOutMs"]) - int(clip["sourceInMs"])


def _record(
    klass: str,
    policy: dict | None,
    human: dict | None,
) -> dict:
    asset = None
    if policy is not None:
        asset = policy["assetId"]
    elif human is not None:
        asset = human["assetId"]
    return {
        "class": klass,
        "assetId": asset,
        "policy": _public_clip(policy),
        "human": _public_clip(human),
    }


def _public_clip(clip: dict | None) -> dict | None:
    if clip is None:
        return None
    return {
        "assetId": clip["assetId"],
        "sourceInMs": clip["sourceInMs"],
        "sourceOutMs": clip["sourceOutMs"],
        "recordInMs": clip["recordInMs"],
        "order": clip["order"],
    }


def _full_key(clip: dict) -> tuple:
    return (clip["assetId"], clip["sourceInMs"], clip["sourceOutMs"])


def _in_key(clip: dict) -> tuple:
    return (clip["assetId"], clip["sourceInMs"])


def _duration_delta(record: dict) -> int:
    if record["policy"] is None and record["human"] is not None:
        return _duration(record["human"])
    if record["human"] is None and record["policy"] is not None:
        return -_duration(record["policy"])
    if record["policy"] is not None and record["human"] is not None:
        return _duration(record["human"]) - _duration(record["policy"])
    return 0


def _is_earlier(other: dict, this: dict) -> bool:
    if other["assetId"] != this["assetId"]:
        return False
    if other["policy"] is not None and this["policy"] is not None:
        return other["policy"]["recordInMs"] < this["policy"]["recordInMs"]
    if other["policy"] is None and other["human"] is not None and this["human"] is not None:
        return other["human"]["recordInMs"] < this["human"]["recordInMs"]
    return False


def _net_earlier(record: dict, records: list[dict]) -> int:
    net = 0
    for other in records:
        if other is record:
            continue
        if _is_earlier(other, record):
            net += _duration_delta(other)
    return net


def _resolve_equal_source(records: list[dict]) -> None:
    for record in records:
        if record["class"] != "equal_source":
            continue
        policy = record["policy"]
        human = record["human"]
        assert policy is not None and human is not None
        same_record = policy["recordInMs"] == human["recordInMs"]
        same_order = policy["order"] == human["order"]
        if same_record and same_order:
            record["class"] = "unchanged"
            continue
        delta = human["recordInMs"] - policy["recordInMs"]
        net = _net_earlier(record, records)
        if delta == net and not same_record:
            record["class"] = "shifted"
        else:
            record["class"] = "moved"


def diff_keeps(policy_keeps: list[dict], human_keeps: list[dict]) -> list[dict]:
    """Pair KEEP segments. clipId is omitted on this corpus and refused if present."""
    for clip in policy_keeps + human_keeps:
        if "clipId" in clip:
            raise RuntimeError("corpus must not carry clipId")

    used_p: set[int] = set()
    used_h: set[int] = set()
    records: list[dict] = []

    policy_by_full: dict[tuple, list[int]] = defaultdict(list)
    human_by_full: dict[tuple, list[int]] = defaultdict(list)
    for index, clip in enumerate(policy_keeps):
        policy_by_full[_full_key(clip)].append(index)
    for index, clip in enumerate(human_keeps):
        human_by_full[_full_key(clip)].append(index)

    for key, policy_indexes in policy_by_full.items():
        human_indexes = human_by_full.get(key, [])
        for policy_index, human_index in zip(policy_indexes, human_indexes):
            records.append(
                _record(
                    "equal_source",
                    policy_keeps[policy_index],
                    human_keeps[human_index],
                )
            )
            used_p.add(policy_index)
            used_h.add(human_index)

    policy_by_in: dict[tuple, list[int]] = defaultdict(list)
    human_by_in: dict[tuple, list[int]] = defaultdict(list)
    for index, clip in enumerate(policy_keeps):
        if index not in used_p:
            policy_by_in[_in_key(clip)].append(index)
    for index, clip in enumerate(human_keeps):
        if index not in used_h:
            human_by_in[_in_key(clip)].append(index)

    for key, policy_indexes in policy_by_in.items():
        human_indexes = human_by_in.get(key, [])
        for policy_index, human_index in zip(policy_indexes, human_indexes):
            records.append(
                _record(
                    "retimed",
                    policy_keeps[policy_index],
                    human_keeps[human_index],
                )
            )
            used_p.add(policy_index)
            used_h.add(human_index)

    remaining_p: dict[str, list[int]] = defaultdict(list)
    remaining_h: dict[str, list[int]] = defaultdict(list)
    for index, clip in enumerate(policy_keeps):
        if index not in used_p:
            remaining_p[clip["assetId"]].append(index)
    for index, clip in enumerate(human_keeps):
        if index not in used_h:
            remaining_h[clip["assetId"]].append(index)

    for asset_id in sorted(set(remaining_p) | set(remaining_h)):
        policy_indexes = sorted(
            remaining_p[asset_id],
            key=lambda index: (policy_keeps[index]["sourceInMs"], policy_keeps[index]["order"]),
        )
        human_indexes = sorted(
            remaining_h[asset_id],
            key=lambda index: (human_keeps[index]["sourceInMs"], human_keeps[index]["order"]),
        )
        if not policy_indexes or not human_indexes:
            continue
        if len(policy_indexes) != len(human_indexes):
            continue
        policy_orders = [policy_keeps[index]["order"] for index in policy_indexes]
        human_orders = [human_keeps[index]["order"] for index in human_indexes]
        order_unchanged = policy_orders == sorted(policy_orders) and human_orders == sorted(
            human_orders
        )
        for policy_index, human_index in zip(policy_indexes, human_indexes):
            policy_clip = policy_keeps[policy_index]
            human_clip = human_keeps[human_index]
            source_differs = (
                policy_clip["sourceInMs"] != human_clip["sourceInMs"]
                or policy_clip["sourceOutMs"] != human_clip["sourceOutMs"]
            )
            if source_differs and order_unchanged:
                klass = "retimed"
            elif not source_differs:
                klass = "equal_source"
            else:
                klass = "moved"
            records.append(_record(klass, policy_clip, human_clip))
            used_p.add(policy_index)
            used_h.add(human_index)

    for index, clip in enumerate(policy_keeps):
        if index not in used_p:
            records.append(_record("removed", clip, None))
    for index, clip in enumerate(human_keeps):
        if index not in used_h:
            records.append(_record("added", None, clip))

    _resolve_equal_source(records)
    return records
