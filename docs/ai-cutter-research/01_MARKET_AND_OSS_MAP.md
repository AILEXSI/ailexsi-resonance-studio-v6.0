# 01 — Market and OSS map

**Inspected:** 2026-09-21. Quality over quantity. Star counts are GitHub metadata, not a ranking of correctness. Deep audits of the five primary targets are files 02–05.

## How to read this map

A repository can be excellent at one measurement and still be the wrong thing to own. The question for each row is: does AILEXSI need this **mechanism**, and is the **artifact** a replaceable edge?

## 1. Jump-cut / silence engines

| Project | What it actually is | Maintenance | License | Take |
| --- | --- | --- | --- | --- |
| [WyattBlue/auto-editor](https://github.com/WyattBlue/auto-editor) | Peak-per-chunk audio, exact-pixel motion, margin, min-cut/min-clip, timeline, many exporters | Active (2026-09-19), Nim, Unlicense, 5313 stars | Unlicense; binary depends on FFmpeg/libav | **Study. Do not vendor.** Best public description of a first-pass cutter. See [02](./02_AUTO_EDITOR_AUDIT.md). |
| [trsdn/autocut](https://github.com/trsdn/autocut) | Transcribe → silence/filler/restart plan → `cut_plan.json` → ffmpeg render. Optional LLM | Pushed 2026-08-27, 3 stars | MIT | Interesting **plan file**. Too small to treat as evidence of a solved product. |
| [diginatu/nagare-clip](https://github.com/diginatu/nagare-clip) | Japanese long-form → editable silence list → Blender rough cut. Explicitly separates ffmpeg `silencedetect` from WhisperX word-gap silence | Pushed 2026-09-19, 0 stars | MIT | The separation is the lesson. The repo is not a dependency. |

**INFERENCE:** the commodity algorithm is "activity mask → margin → drop short runs → keep ranges". The clever part that still fails in public tools is naming the mask honestly and letting a human edit the list before render.

## 2. Speech time

| Project | Role | License trap | Take |
| --- | --- | --- | --- |
| openai/whisper | ASR. Utterance times, not reliable word times | MIT code | Edge. Do not reproduce the model. |
| SYSTRAN/faster-whisper | CTranslate2 runtime for Whisper | MIT | Edge. |
| m-bain/whisperX | VAD + batched ASR + wav2vec alignment + diarization assign | BSD-2-Clause code; torch stack; community-1 weights **CC-BY-4.0** | Contract lesson only. See [03](./03_WHISPERX_AUDIT.md). |
| jianfch/stable-ts | Alignment tweaks on Whisper | MIT, **archived** | Do not build on an archived tree. |
| linto-ai/whisper-timestamped | Word times inside Whisper | **AGPL-3.0** | Avoid linking. |

**What any speech provider must return** (independent of Whisper): language, segments `{start, end, text, optional avg score}`, words `{text, start, end, score}`, optional speaker id, and an explicit UNKNOWN when a word has no time. Provenance names the provider and model id. Confidence is the provider's score, not a boolean.

## 3. Voice activity (not silence)

| Project | Measurement | License | Take |
| --- | --- | --- | --- |
| snakers4/silero-vad | Speech probability, ONNX, MIT, active | MIT | Best current **edge** if a neural VAD is justified later. |
| wiseman/py-webrtcvad | 10/20/30 ms speech/non-speech, classical | MIT; last commit 2021 | Historical. Known to false-positive speech on noise. |
| pyannote segmentation | Neural speech / overlap, inside a diarization pipeline | Code MIT; weights per card | Heavier than Silero for "is someone talking?". |

**FACT:** Silero's own comparison note (issue discussion mirrored in search) treats WebRTC as better at silence than at speech, and Silero as a speech detector. **INFERENCE:** room tone can be "not silent" and "not speech" at the same time. v0.1 stores both only after a fixture shows the level threshold is wrong. It does not pick a winner in this audit.

## 4. Shot boundaries

| Project | Method | State | Take |
| --- | --- | --- | --- |
| PySceneDetect 0.7.1 | Content (HSV mean abs diff), Adaptive (ratio to a local window), Threshold (fade to level), Histogram, Hash, optional TransNet | Active, BSD-3-Clause, tested, benchmark sweep in-repo | Own a **small** luma/HSV score later if needed. Do not import OpenCV into Resonance for v0.1. See [04](./04_SCENE_DETECTION_AUDIT.md). |
| TransNet V2 | 3D conv net, 27×48 RGB, single-frame and many-hot heads | MIT code, `master` frozen 2021, weights via git-lfs | Paper evidence that neural SBD wins on film datasets. Not a v0.1 dependency. |
| AutoShot | Dataset used by PySceneDetect's sweep | Not cloned | A benchmark name, not an algorithm we audited. |

Classical F1 on ClipShots in PySceneDetect's own sweep stays well below TransNet's README numbers. **INFERENCE:** if AILEXSI later cuts narrative film, neural SBD is a provider. For interview v0.1 it is unused weight.

## 5. Active speaker

TalkNet (MIT, stale 2023), Light-ASD and LR-ASD (MIT, last push 2025-03-23) detect whether a **face** is speaking. They need a face track. Interview v0.1 does not. **OUT.** Legal: code licenses look permissive; dataset licenses (AVA, VoxCeleb) are **UNKNOWN** for any future training and are not a reason to vendor weights.

## 6. Timeline interchange

| Artifact | What it solves | What it does not |
| --- | --- | --- |
| OpenTimelineIO 0.19 core | Versioned editorial objects, rational time, JSON, plugin adapters | Diff, playback, undo, evidence layers, preference |
| OTIO AAF / FCP adapter repos | NLE read/write, uneven | A source of truth |
| CMX 3600 EDL | Ancient cut list | Rates, multiple video layers, metadata |
| Auto-Editor exporters (FCP7 XML, FCP11/Resolve, MLT, Kdenlive, Shotcut, OTIO, JSON) | "Open this cut in an NLE" | A neutral timeline. OTIO export carries Premiere effect ids |

GPL host applications (Shotcut, Kdenlive, OpenShot, Olive) are **hosts**, not libraries. Do not copy them. MLT and GStreamer Editing Services are LGPL editing engines. AILEXSI already has a timeline and an undo stack. Importing a second one violates the Director map.

Full audit: [05_OPENTIMELINEIO_AUDIT.md](./05_OPENTIMELINEIO_AUDIT.md).

## 7. Timeline diff (prior art is thin)

| Artifact | Status | Idea worth keeping |
| --- | --- | --- |
| OTIO issue #26 | Open since 2016, still open 2025-08-15 | Diff is an unsolved core feature even for the interchange project. |
| OTIO PR #1922 `otiodiff` | Draft, not in 0.19.0 | Visual two-timeline annotation. |
| OTIO PR #2030 `cut_diff.py` | Not in inspected tip | Match by media + source in, not by record time. Separate shift from retime. |
| chaoz23/otio-diff | Apache-2.0, 2 stars, 2026 | Same idea, plus a JSON report. Not mature. |

No maintained library was found that diffs an **AI proposal** against a **human correction** and emits preference evidence. That gap is [10_TIMELINE_DIFF_RESEARCH.md](./10_TIMELINE_DIFF_RESEARCH.md).

## 8. Summaries, highlights, "AI edits"

PreenCut (MIT, 418 stars) and similar LLM-over-transcript tools retrieve spans from text. They do not own a timeline, a diff, or a correction memory. Highlight scoring ("viral potential") is a preference someone else invented. **OUT of v0.1.** AILEXSI should not ship a hidden taste model.

## 9. Computational editing research (not OSS)

| Work | What it optimizes | Why it is not the vault |
| --- | --- | --- |
| QuickCut (UIST 2016) | Narration ↔ footage constraints, then dynamic programming. User time 14–52 min for videos under 2 min | The user states constraints. It does not learn from later trims. |
| Dialogue rough cut (Stanford / Adobe) | Hand-specified idioms as HMMs over script-aligned takes | Style is authored, not inferred from corrections. |
| arXiv:2411.04942 | RL over a vision-language state, trained to imitate edits | That is model training. Stop condition: do not train a foundation or an editor policy net for v0.1. |

**INFERENCE:** the literature either (a) optimizes a cut under rules the user typed or (b) trains on finished edits. Path (a) is closer to a policy with explicit parameters. Path (b) is out. Neither is a vault of scoped hypotheses with counterexamples.

## 10. Absent

Searched for, not found as a maintained tested project: an editing-specific experience store that keeps human corrections as historical facts and derived tastes as hypotheses with scope and confidence. General vector databases and chat-memory frameworks (not audited line by line) store text embeddings. They do not know a ripple from a retime. **UNKNOWN** whether a private commercial tool does this. **HYPOTHESIS:** the differentiation is real if, and only if, the PoC shows a measurable drop in correction cost.
