"""Synthetic corpus. Hop peaks and authored H are literal contract inputs.

The fitter must not rebuild H from a target margin. H is the table in
contract section 3, copied onto every item.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import Decimal

from constants import (
    AUTHORED_H_MS,
    FILE_DURATION_MS,
    HOP_MS,
    HOP_SAMPLES,
    INTERVIEW_IDS,
    MUSIC_IDS,
    SAMPLE_RATE_HZ,
    SEED,
)

# Contract section 3 burst schedule. Music-bed replaces the 0.00 spans with 0.08.
_INTERVIEW_BURSTS = (
    (0, 1000, "0.00"),
    (1000, 3000, "0.50"),
    (3000, 4000, "0.00"),
    (4000, 6000, "0.50"),
    (6000, 7000, "0.00"),
    (7000, 9000, "0.50"),
    (9000, 10000, "0.00"),
)
_MUSIC_BURSTS = (
    (0, 1000, "0.08"),
    (1000, 3000, "0.50"),
    (3000, 4000, "0.08"),
    (4000, 6000, "0.50"),
    (6000, 7000, "0.08"),
    (7000, 9000, "0.50"),
    (9000, 10000, "0.08"),
)


class LeakageError(RuntimeError):
    """Anti-leakage rule failed. This is a stop, not a warning."""


@dataclass(frozen=True)
class CorpusItem:
    item_id: str
    tag: str
    peaks: tuple[Decimal, ...]
    h_ranges: tuple[tuple[int, int], ...]


@dataclass
class ItemView:
    """Peaks are visible. Held-out H stays sealed until A1 is serialized."""

    item: CorpusItem
    sealed: bool
    h_reads: int = 0

    @property
    def item_id(self) -> str:
        return self.item.item_id

    @property
    def tag(self) -> str:
        return self.item.tag

    @property
    def peaks(self) -> tuple[Decimal, ...]:
        return self.item.peaks

    def read_h(self) -> tuple[tuple[int, int], ...]:
        if self.sealed:
            raise LeakageError(
                f"held-out H read before A1 serialization: {self.item_id}"
            )
        self.h_reads += 1
        return self.item.h_ranges

    def unseal(self) -> None:
        self.sealed = False


def _peaks_for(bursts: tuple[tuple[int, int, str], ...]) -> tuple[Decimal, ...]:
    if FILE_DURATION_MS % HOP_MS != 0:
        raise LeakageError("duration is not divisible by hop; refusing to round")
    n_hops = FILE_DURATION_MS // HOP_MS
    peaks: list[Decimal] = []
    for hop in range(n_hops):
        start = hop * HOP_MS
        end = start + HOP_MS
        match = None
        for b0, b1, value in bursts:
            if b0 <= start and end <= b1:
                match = value
                break
        if match is None:
            raise LeakageError(f"hop {hop} is not covered by the burst table")
        peaks.append(Decimal(match))
    return tuple(peaks)


def build_corpus() -> tuple[CorpusItem, ...]:
    """Twelve items. Interview copies share peaks. Music-bed copies share peaks.

    seed is recorded by the caller. It is not an entropy source.
    """
    interview_peaks = _peaks_for(_INTERVIEW_BURSTS)
    music_peaks = _peaks_for(_MUSIC_BURSTS)
    items: list[CorpusItem] = []
    for item_id in INTERVIEW_IDS:
        items.append(
            CorpusItem(
                item_id=item_id,
                tag="interview",
                peaks=interview_peaks,
                h_ranges=AUTHORED_H_MS,
            )
        )
    for item_id in MUSIC_IDS:
        items.append(
            CorpusItem(
                item_id=item_id,
                tag="music_bed",
                peaks=music_peaks,
                h_ranges=AUTHORED_H_MS,
            )
        )
    return tuple(items)


def canonical_hop_peak_bytes(items: tuple[CorpusItem, ...]) -> bytes:
    """Canonical hop-peak bytes.

    Encoding (contract does not specify a byte layout; this layout is fixed
    so both executions hash the same bytes): UTF-8, lines
    `v1`, then for each item in corpus order `id`, `hop_count`, then one
    peak per line with two decimal places.
    """
    lines = ["v1"]
    for item in items:
        lines.append(item.item_id)
        lines.append(str(len(item.peaks)))
        for peak in item.peaks:
            lines.append(format(peak, ".2f"))
    return ("\n".join(lines) + "\n").encode("utf-8")


def canonical_h_bytes(items: tuple[CorpusItem, ...]) -> bytes:
    """Canonical authored-H bytes. Same versioning note as the hop peaks."""
    lines = ["v1"]
    for item in items:
        lines.append(item.item_id)
        lines.append(str(len(item.h_ranges)))
        for start, end in item.h_ranges:
            lines.append(f"{start} {end}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def corpus_hashes(items: tuple[CorpusItem, ...]) -> tuple[str, str]:
    return (
        sha256_hex(canonical_hop_peak_bytes(items)),
        sha256_hex(canonical_h_bytes(items)),
    )


def manifest_dict(items: tuple[CorpusItem, ...]) -> dict:
    hop_hash, h_hash = corpus_hashes(items)
    return {
        "seed": SEED,
        "sample_rate_hz": SAMPLE_RATE_HZ,
        "hop_ms": HOP_MS,
        "hop_samples": HOP_SAMPLES,
        "channels": 1,
        "file_duration_ms": FILE_DURATION_MS,
        "ids": [item.item_id for item in items],
        "tags": {item.item_id: item.tag for item in items},
        "burst_table": {
            "interview": [
                {"start_ms": a, "end_ms": b, "peak": c} for a, b, c in _INTERVIEW_BURSTS
            ],
            "music_bed": [
                {"start_ms": a, "end_ms": b, "peak": c} for a, b, c in _MUSIC_BURSTS
            ],
        },
        "H_table_ms": [{"sourceInMs": a, "sourceOutMs": b} for a, b in AUTHORED_H_MS],
        "canonical_encoding": (
            "utf-8 lines: v1, then per item id, count, then either "
            "two-decimal peaks or 'start end' ranges"
        ),
        "sha256_hop_peak_bytes": hop_hash,
        "sha256_h_bytes": h_hash,
        "seed_is_entropy_source": False,
    }
