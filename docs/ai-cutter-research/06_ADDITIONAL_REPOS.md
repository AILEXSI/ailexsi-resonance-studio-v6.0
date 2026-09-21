# 06 — Additional repositories

Short audits for projects that are real but not primary. Same labels. None of these are adopted.

## Silero VAD — snakers4/silero-vad

| # | Note |
| --- | --- |
| 01 | https://github.com/snakers4/silero-vad. Not cloned. Metadata 2026-09-17. ~10271 stars. |
| 02 | MIT (LICENSE via GitHub API). |
| 03 | Active. ONNX and community ports (Rust, C++, browser). |
| 04 | Speech present / absent. Not loudness. |
| 05 | PCM in. Speech timestamps and a probability out. |
| 06 | Small neural net. Typical windows are tens of milliseconds. Exact current defaults were not read from source. **UNKNOWN** numeric defaults at today's tip. |
| 07 | Weights. |
| 08 | Threshold, min speech, min silence, speech pad. Names from the project's examples; exact signatures **not** re-read. |
| 09 | ONNX Runtime or PyTorch. Far smaller than WhisperX. |
| 10 | Published weights. MIT repo. Confirm the weight file's license before redistribution. **INFERENCE:** the repo LICENSE covers the software; treat weight redistribution as still needing a glance at that file's header. |
| 11 | CPU-class. |
| 12 | README claims real-time on CPU. Not measured. |
| 13 | Model. |
| 14 | Music and laughter can score as speech or not. **UNKNOWN** without fixtures. |
| 15 | Overlap, noise, 8 kHz telephony versus 16 kHz. |
| 16 | The project publishes quality notes. Not run. |
| 17 | One job, one model, portable runtime. |
| 18 | The model is the product. The idea "speech probability over time" is commodity. |
| 19 | First neural edge **if** room-tone fixtures defeat a peak/RMS threshold. |
| 20 | Do not call its output silence. Do not import it in v0.1. |
| 21 | MIT code. Low risk if used as an external process later. |
| 22 | Provider profile `vad.speech.probability`. |
| 23 | **LOW** to call. **OUT** of the PoC. |
| 24 | Tone, digital silence, room tone, isolated words. |

## pyannote.audio

Code MIT, active, ~10579 stars. WhisperX uses it for diarization and can use it for VAD. Default pipeline in WhisperX is community-1, **CC-BY-4.0**, gated. See [03](./03_WHISPERX_AUDIT.md). **Difficulty: HIGH** to operate, **OUT** of v0.1. Precision-2 on the community-1 card is a paid/hosted pyannoteAI path. Do not point the core at it.

## faster-whisper / openai-whisper

MIT. The ASR edge. Word times from vanilla Whisper are the problem WhisperX exists to fix (README claim). **Difficulty: HIGH** operationally, **LOW** as a contract. Do not reproduce training.

## whisper-timestamped (linto-ai)

**AGPL-3.0** (GitHub SPDX). Pushed 2026-08-17. ~2845 stars. **Avoid.** A network call or a subprocess that is a separate work can still create a distribution question. Do not copy and do not link.

## stable-ts

MIT, **archived**, last push 2026-05-30. Do not depend on an archived alignment fork.

## py-webrtcvad

MIT text in LICENSE (GitHub SPDX field was `NOASSERTION`; the file itself is MIT). Tip commit 2021-02-15. 10/20/30 ms frames, aggressiveness 0–3. Classical. Useful as a known-bad control in a future VAD bake-off, not as the product.

## TalkNet / Light-ASD / LR-ASD

MIT code. TalkNet last push 2023-10-23. Light-ASD and LR-ASD last push 2025-03-23. They answer "is this face track speaking?" Papers: ACM MM 2021 (TalkNet), CVPR 2023 (Light-ASD), IJCV 2025 (LR-ASD). **OUT** until the benchmark has more than one visible person and a reason to cut picture separately from audio. Dataset licenses for training **UNKNOWN**. Do not train.

## trsdn/autocut

MIT, 3 stars, pushed 2026-08-27. Not cloned. Public README describes: word timestamps → fillers, pauses, redundant sentences → `cut_plan.json` → ffmpeg. Optional OpenAI-compatible LLM. **Useful idea:** the plan is a file a human can read before render. **Not evidence** the heuristics are good. **Difficulty: LOW** to copy the idea of a plan file, which AILEXSI should specify itself ([08](./08_EDIT_DECISION_SPEC.md)).

## diginatu/nagare-clip

MIT, 0 stars, pushed 2026-09-19. Not cloned. README distinguishes ffmpeg `silencedetect` spans (editable text) from WhisperX word-gap silence. **That distinction is the finding.** The repo is not a component to track.

## PreenCut

MIT, 418 stars, pushed 2025-08-22. Whisper plus an LLM that returns timestamped segments for a natural-language query. It is a retrieval UI, not an arrangement, not a diff, not a memory. **OUT.**

## chaoz23/otio-diff

Apache-2.0, 2 stars, pushed 2026-07-21. Not cloned. README (fetched via search): match clips by `(media url, source in-point)`, multiset for duplicates, classify added / removed / retimed / moved / shifted, name fallback when media is offline, effects and transitions out of scope. **This is prior art for the diff shape.** It is not a library to depend on. Two stars and a 2026-07 push are not maintenance evidence. See [10](./10_TIMELINE_DIFF_RESEARCH.md).

## OTIO adapter repos

`OpenTimelineIO/otio-aaf-adapter` (pushed 2026-09-21, Apache-2.0, 23 stars) and `otio-fcp-adapter` (pushed 2026-04-08, Apache-2.0, 10 stars). Not cloned. **INFERENCE:** NLE I/O is alive and small and outside core, which supports option C later and rejects option B now.

## GPL NLEs

Shotcut, Kdenlive, OpenShot, Olive, and similar are hosts a human might use. Their GPL (or equivalent) code is not a source of modules. MLT is the engine under several of them and is an interchange target Auto-Editor already writes. AILEXSI does not need MLT to express a keep range.

## Papers that are not repos

| Work | Lesson | Limit |
| --- | --- | --- |
| QuickCut, UIST 2016 | Constraints plus dynamic programming. They measured authoring time (14–52 min for results under 2 min). | Not a correction learner. Footage not redistributable as a benchmark. |
| Dialogue idioms (Stanford / Adobe) | Style as an explicit HMM, not a hidden taste. | Requires a script and multiple takes. Out of v0.1. |
| arXiv:2411.04942 | RL can imitate edit sequences on a movie dataset and a lecture-switch task. | Training a policy net is a stop condition. |

## What was searched and not promoted

Auto rough cut, highlight extraction, video summarization, active speaker, keyframe extractors, multimodal video LLMs, EDL diff, editing-behavior datasets. The pattern: either a single measurement done well (Silero, PySceneDetect, Auto-Editor's peak gate) or a demo that calls an LLM on a transcript. No maintained project owns the chain "evidence → decision → alternative arrangement → human diff → scoped hypothesis".

**UNKNOWN.** Private products may do this. That does not put an implementation in this repository.
