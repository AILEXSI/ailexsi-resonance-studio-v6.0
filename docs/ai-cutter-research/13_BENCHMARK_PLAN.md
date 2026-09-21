# 13 — Benchmark plan

**First genre:** talking head / interview. One voice, one camera, long pauses. Not film, not multicam, not music videos.

**Rule:** deterministic fixtures before any model. A model fixture is allowed only as a frozen JSON observation, never as a live weight inside the product repo.

## Tiers

| Tier | Media | What it can falsify |
| --- | --- | --- |
| D0 | Synthetic PCM. No pictures | Peak, RMS, threshold, margin, min duration, diff, cost |
| D1 | Synthetic PCM with two regimes (close-mic vs room tone) | GLOBAL preference vs `project_type` |
| D2 | One real interview the operator already has rights to, kept **outside** the git repo | Whether D0 margins transfer. Not required to merge this audit |
| D3 | Shot, motion, diarization, highlights | Out. Do not build the set yet |

D2 bytes do not enter `ailexsi-resonance-studio`. The plan names the conditions, not the file.

## D0 cases

| ID | Signal | Human H (authored) | Point |
| --- | --- | --- | --- |
| D0-1 | 0.5 s silence, 2.0 s tone peak 0.5, 0.5 s silence, repeat | Cuts match `ae-default-v0` | cost(A0,H) = 0. Excluded from reduction |
| D0-2 | Same, but human leaves 400 ms of silence on each side | H margin 400 ms vs policy 200 ms | Retimes only. Memory should learn margin if the scope has support |
| D0-3 | 80 ms tone spikes | Policy minclip 100 ms cuts them; human keeps them | Counterexample to minclip. Must not be called a margin change |
| D0-4 | 80 ms holes in a tone | Policy mincut fills them; human keeps the holes | Counterexample to mincut |
| D0-5 | Duplicate source range twice | Two keeps, same in/out | Diff must not collapse the pair |
| D0-6 | No samples | — | No decisions. Fail closed |
| D0-7 | Peak 0.039 and 0.041 around threshold 0.04 | Human cuts only the 0.039 side | Threshold is a knife-edge. One event must stay inert |

Hop 10 ms. Rates: 48000 Hz audio. No video clock.

## D1 cases

Two tags: `project_type=interview` and `project_type=music_bed`.

| ID | Regime | Honest human |
| --- | --- | --- |
| D1-I | Speech-shaped bursts, digital silence between | Margin ~200–400 ms |
| D1-M | Same bursts plus a constant peak-0.08 tone underneath | A peak policy never cuts. A human who wants the pauses removed cannot get them from peak. Expected: memory of margin **does not** fix this. Reduction ≤ 0. That is a successful falsification of "margin memory generalizes", and a reason to add VAD later, not now |

If someone tunes the threshold to 0.09 to "solve" D1-M, they will destroy D1-I (speech peaks vary). The benchmark fails a policy that uses one GLOBAL threshold for both tags.

## Speech contract fixtures (no ASR)

Frozen JSON, hand-written:

| ID | Content | Assert |
| --- | --- | --- |
| S-1 | Two words, scores 0.9 | Stored as HYPOTHESIS observations. No CUT is emitted from them in v0.1 |
| S-2 | A word with no `end` | Status UNKNOWN for the missing edge. No invented end |
| S-3 | Text that says "silence" over a loud range | The word does not override `audio.peak.ratio` |

## Explicitly not in the plan

ClipShots, BBC Planet Earth, RAI, AutoShot media. AVA active-speaker clips. Anything whose license is not cleared for this repo. Viral-highlight scores. Multicam lecture switching.

## Pass / fail for the benchmark itself

The benchmark is useful if D0-2 can show a reduction and D1-M can show a non-reduction, on the metrics in [12](./12_METRICS_AND_CORRECTION_COST.md). A suite that only contains D0-1 cannot support the vault.

## Host

The D0/D1 runner is a throwaway script **not** committed as product code by this audit. It may live in a future experiment branch after approval. It must not import whisperx, scenedetect, or OpenTimelineIO.
