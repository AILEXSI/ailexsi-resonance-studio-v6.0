"""Frozen contract constants for the synthetic mechanics experiment.

These values are the contract. They are not tuned after a result.
A runner that changes 0.10, 4, or 40 ms is non-conforming.
"""

from __future__ import annotations

from decimal import Decimal

SEED = 20260921
BASELINE_POLICY_ID = "ae-default-v0"
LEARNED_POLICY_ID = "interview-margin-v1"

SUCCESS_BAND = Decimal("0.10")
SUPPORT_MIN = 4
SAMPLE_MIN = 4
MARGIN_DISTANCE_MIN_MS = 40

SAMPLE_RATE_HZ = 48000
HOP_MS = 10
HOP_SAMPLES = 480
CHANNELS = 1
FILE_DURATION_MS = 10000

PEAK_THRESHOLD = Decimal("0.04")
P0_MARGIN_START_MS = 200
P0_MARGIN_END_MS = 200
MIN_CUT_MS = 200
MIN_CLIP_MS = 100
POLICY_ORDER = ("threshold", "margin", "min_durations")

SAMPLE_NEAR_MS = 2000
FILE_BOUNDARY_START_MS = 0
FILE_BOUNDARY_END_MS = 10000

PASS_SENTENCE = (
    "MECHANICS PASS. Not evidence that human editing preferences generalize."
)
PERMITTED_CONCLUSION = (
    "Mechanics validated. Human preference-learning hypothesis remains untested."
)

# Synthetic support must not be copied into a later real-audio experiment.
REAL_WORLD_TRAINING_IDS: tuple[str, ...] = ()

INTERVIEW_IDS = ("I01", "I02", "I03", "I04", "I05", "I06")
MUSIC_IDS = ("M01", "M02", "M03", "M04", "M05", "M06")

# Literal authored H from contract section 3. Not a margin function.
AUTHORED_H_MS = (
    (600, 3400),
    (3600, 6400),
    (6600, 9400),
)


def assert_frozen_constants() -> None:
    """Hard-stop if a constant drifted from the pre-registered contract values."""
    if SEED != 20260921:
        raise RuntimeError("seed mutated")
    if BASELINE_POLICY_ID != "ae-default-v0":
        raise RuntimeError("baseline policy id mutated")
    if LEARNED_POLICY_ID != "interview-margin-v1":
        raise RuntimeError("learned policy id mutated")
    if SUCCESS_BAND != Decimal("0.10"):
        raise RuntimeError("success band mutated")
    if SUPPORT_MIN != 4:
        raise RuntimeError("support minimum mutated")
    if SAMPLE_MIN != 4:
        raise RuntimeError("sample minimum mutated")
    if MARGIN_DISTANCE_MIN_MS != 40:
        raise RuntimeError("margin-distance minimum mutated")
    if P0_MARGIN_START_MS != 200 or P0_MARGIN_END_MS != 200:
        raise RuntimeError("baseline margin mutated")
    if PEAK_THRESHOLD != Decimal("0.04"):
        raise RuntimeError("threshold mutated")
    if MIN_CUT_MS != 200 or MIN_CLIP_MS != 100:
        raise RuntimeError("min durations mutated")
    if HOP_MS != 10 or SAMPLE_RATE_HZ != 48000 or HOP_SAMPLES != 480:
        raise RuntimeError("hop or sample rate mutated")
    if FILE_DURATION_MS != 10000:
        raise RuntimeError("duration mutated")
    if SAMPLE_NEAR_MS != 2000:
        raise RuntimeError("sample near-window mutated")
    if POLICY_ORDER != ("threshold", "margin", "min_durations"):
        raise RuntimeError("policy order mutated")
    if REAL_WORLD_TRAINING_IDS != ():
        raise RuntimeError("synthetic support copied into real-world training ids")
    if AUTHORED_H_MS != ((600, 3400), (3600, 6400), (6600, 9400)):
        raise RuntimeError("authored H table mutated")
