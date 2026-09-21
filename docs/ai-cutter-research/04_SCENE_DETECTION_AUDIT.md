# 04 — Scene detection audit

PySceneDetect and TransNet V2, compared. Neither is a v0.1 dependency.

**Inspected:** 2026-09-21. Source read. Benchmarks not re-run. Weights not loaded (TransNet weights are git-lfs; this clone did not pull them).

---

# A. PySceneDetect

**Repo:** https://github.com/Breakthrough/PySceneDetect  
**Commit:** `81c414cb4b706e58648f98efd381024790b1565f` (2026-09-21)  
**Version:** `0.7.1` (`scenedetect/__init__.py`)

## 01–26

### 01 Repo

**FACT.** Breakthrough/PySceneDetect. Python. 5193 stars. Not archived. Commit on the inspection date.

### 02 License

**FACT.** BSD-3-Clause, copyright Brandon Castellano. OpenCV is imported and required; the project supports both `opencv-python` and `opencv-python-headless` (comment in `__init__.py`). Those wheels are Apache-2.0. **INFERENCE.** Linking OpenCV into Resonance is a dependency decision, not required to copy the math.

### 03 Maintenance

**FACT.** Tip commit 2026-09-21 ("VideoStreamCv2 workaround"). In-repo tests (`tests/test_scene_manager.py`, `tests/release/test_vfr.py`, …) and a benchmark package. Release scripts exist. **INFERENCE.** This is a maintained library, unlike TransNet's frozen `master`.

### 04 Problem

Find shot boundaries: hard cuts and, with a different detector, fades to a brightness level. Downstream: scene list, images, optional ffmpeg/mkvmerge splits.

### 05 Input / output

**Input.** A video via a backend (OpenCV, PyAV, MoviePy). A detector. Optional crop, stats file, min scene length.  
**Output.** A list of start/end `FrameTimecode` pairs. Metrics can be written per frame (`content_val`, `adaptive_ratio`). Not an edit decision.

### 06 Algorithm

**ContentDetector** (`detectors/content_detector.py`). Convert the frame to HSV. Mean absolute pixel difference per channel between this frame and the previous (`_mean_pixel_distance`: sum of abs diffs over pixel count). Optional edge channel. Weighted sum. Default weights: hue 1, sat 1, luma 1, edges 0 (`Components` defaults). Default threshold **27.0**. If the score exceeds the threshold, `FlashFilter` emits a cut only when `min_scene_len` has passed (default **15** frames). Kernel size for edges, when edges are on, is estimated from resolution (`4 + round(sqrt(width*height)/192)`, forced odd). The source comment says that estimate is manual.

**AdaptiveDetector** subclasses ContentDetector. It does **not** use threshold 27. It sets the parent threshold to 255 so the parent does not cut, buffers `window_width` frames on each side (default **2**), and cuts when `target_score / mean(other scores in the window) ≥ adaptive_threshold` (default **3.0**) and `target_score ≥ min_content_val` (default **15.0**), and min scene length has passed. Division by zero yields ratio 255.

**ThresholdDetector.** Average pixel intensity versus a level (default **12**). `FLOOR`: fade toward black when the average falls below the level. `CEILING`: the opposite. Holds the fade until the image crosses back, subject to `min_scene_len`. This is the fade tool. ContentDetector is the hard-cut tool.

**HistogramDetector.** Correlation of histograms; default threshold argument `0.20`, stored internally as `1 - threshold`.  
**HashDetector.** Downscale, lowpass, median binary hash, normalized Hamming distance, default `0.35`.

**TransnetV2Detector** (`detectors/transnet_v2.py`). Optional wrapper. Threshold default `0.5` on the network's scores, then the same flash filter. The network itself is not reimplemented in the sections read; it calls a predictor.

**SceneManager** drives `process_frame` and `post_process`. Backends yield frames. VFR tests exist (`test_vfr.py`): swing, PTS gaps, B-frames, cross-backend parity.

### 07 State

Previous HSV frame (content). Ring buffer of scores (adaptive). Last cut timecode. Flash-filter queue. Stats manager if enabled. No learning.

### 08 Parameters

| Detector | Defaults at this commit |
| --- | --- |
| Content | threshold 27.0, min_scene_len 15 frames, weights (1,1,1,0) |
| Adaptive | adaptive_threshold 3.0, window_width 2, min_content_val 15.0, min_scene_len 15 |
| Threshold | threshold 12, min_scene_len 15, method floor or ceiling |
| Hash | 0.35 |
| Histogram | 0.20 |
| TransNet wrapper | 0.5 |

`min_scene_len` accepts frames (int), seconds (float), or a timecode string.

### 09 Dependencies

OpenCV required. NumPy. Optional PyAV, MoviePy, ffmpeg, mkvmerge. TransNet path pulls that model.

### 10 Models

None on the classical detectors. TransNet is optional and is a model.

### 11 Hardware

CPU. Frame decode dominates. **UNKNOWN** throughput here (not run).

### 12 Performance

Not measured. **INFERENCE:** one frame in, a few HSV conversions, a mean of abs diff. Cheap beside a neural SBD. Adaptive needs a short buffer (`event_buffer_length` = `window_width`), so the reported cut lags the current frame.

### 13 Deterministic vs model

Classical path is deterministic given identical decoded frames. Backend and colorspace conversion can change the score. VFR tests are evidence the authors treat timestamps as part of correctness.

### 14 Failures

From the in-repo sweep `benchmark/SWEEP_REPORT.md` (hard cuts, F1 as percent, tolerance 1 frame). These numbers are the file's report, not a re-run.

**Content, best cell per dataset (F1@1):**

| Dataset | F1@1 | Precision@1 | Recall@1 | Params |
| --- | ---: | ---: | ---: | --- |
| BBC | 88.34 | 90.00 | 86.75 | min_scene_len=0.8, threshold=25 |
| AutoShot | 73.44 | 79.54 | 68.21 | min_scene_len=0.4, threshold=29 |
| ClipShots | 66.74 | 58.93 | 76.95 | min_scene_len=0.8, threshold=35 |

Best average content cell in that file: mean F1@1 **73.39** at min_scene_len=0.6, threshold=31.

**Adaptive, best cell:** BBC 94.57, AutoShot 77.19, ClipShots 65.53. Best average mean F1@1 **76.34** at adaptive_threshold=3.5, min_scene_len=0.6, window_width=3.

**INFERENCE.** Default threshold 27 is not the sweep's best cell. A single global threshold does not travel from BBC documentary to ClipShots. False positives and false negatives both remain large on ClipShots (precision 59 at the best content cell means many false cuts).

Dissolves and speed ramps are not what ContentDetector is for. Flashes are why `min_scene_len` exists; a real cut faster than the minimum is a false negative by policy.

### 15 Edge cases

First frame has no score. Crop. Letterbox (global mean hides a cut in a small window). Fade to white versus fade to black (method flag). Duplicate frames. VFR. 15-frame minimum at 24 fps is 0.625 s; at 60 fps it is 0.25 s. The default is frames, so it is not a constant duration.

### 16 Tests

**FACT.** Unit tests for scene lists, adaptive callback, crop, bounds, and VFR accuracy/parity exist. Golden generation script `scripts/generate_goldens.py` exists. This audit did not execute pytest.

### 17 Architecture decisions

Detectors are strategies behind `SceneDetector`. Metrics are named so a stats file can be retuned without re-decoding. Backends are swappable. Splitting the media file is a separate output step (ffmpeg), not part of detection.

### 18 Commodity vs clever

**Commodity:** mean abs frame difference and a threshold. HSV weighting and the adaptive ratio are small refinements.  
**Clever:** flash filter, VFR-aware timecodes, stats-driven retune, optional neural detector behind the same interface.

### 19 Useful for AILEXSI

- A shot boundary is an **observation** with a score, a threshold, and a method id. It is not a cut decision.  
- Keep luma-only and HSV as different measurements.  
- `min_scene_len` must be duration, not "15", because AILEXSI time is milliseconds (`FRAME_MS = 1000/30` is a UI constant in `models.ts`, not the media rate).  
- Publish the score series so a human can retune. PySceneDetect already does this via stats.

### 20 Avoid

- Importing the library or OpenCV for v0.1.  
- Using ClipShots-tuned thresholds on a talking head and calling them universal.  
- Letting a detector delete timeline ranges by itself.

### 21 Legal

BSD-3-Clause is permissive. Do not copy the module. OpenCV's Apache-2.0 is fine legally and still a stack AILEXSI does not need yet. Benchmark datasets (BBC Planet Earth, ClipShots, AutoShot) have their own terms. **UNKNOWN** and not for redistribution.

### 22 Easiest independent approach

When a fixture needs it: grayscale (or luma) mean abs diff, threshold, minimum gap in ms. Ten lines of logic on raw frames. No OpenCV required if the fixture is already decoded to bytes.

### 23 Difficulty

**LOW** for a luma score on raw frames. **MEDIUM** for real decode and VFR. **HIGH** for matching PySceneDetect's HSV numbers exactly (not a goal).

### 24 Benchmark cases

1. Two solid frames, RGB jump. Score must exceed any reasonable threshold.  
2. Two frames that differ by 1 gray level. Score is small. Exact-equality motion (Auto-Editor) would score them as fully different if any byte changes; mean abs diff would not. That contrast is the test.  
3. A 3-frame white flash inside one shot. Minimum length must suppress it.  
4. A fade to black over 12 frames. ContentDetector may miss it. ThresholdDetector is the one that should see it.  
5. Do not use BBC/ClipShots media in-repo.

### 25–26

Provenance: detector modules and `SWEEP_REPORT.md`. Open: exact HSV conversion range (OpenCV 0–255 vs 0–180 hue). **UNKNOWN** without reading the conversion call. It matters if AILEXSI ever tries to match their score. Matching it is not the goal.

---

# B. TransNet V2

**Repo:** https://github.com/soCzech/TransNetV2  
**Commit:** `85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed` (2021-07-28, "minor fix")  
**Paper:** https://arxiv.org/abs/2008.04838

## 01–26 (compressed where the answer is "do not adopt")

### 01–03

**FACT.** soCzech/TransNetV2. 1043 stars. Not archived, but `master` has not moved since 2021-07-28. GitHub `pushed_at` 2023-12-04 did not change that commit. MIT license, copyright 2020 Tomáš Souček.

### 04–06

Shot transition detection. README table, which attributes the reevaluation to the project:

| Model | ClipShots | BBC Planet Earth | RAI |
| --- | ---: | ---: | ---: |
| TransNet V2 | 77.9 | 96.2 | 93.9 |
| TransNet | 73.5 | 92.9 | 94.3 |
| Hassanien et al. | 75.9 | 92.6 | 93.9 |
| Tang et al. ResNet baseline | 76.1 | 89.3 | 92.8 |

**Label:** README/paper claim. Not recomputed.

**FACT (PyTorch inference module).** Input tensor shape ends in `[27, 48, 3]`, dtype `uint8`. The network is a stack of dilated dense 3D conv blocks (`F=16, L=3, S=2, D=1024` defaults), plus a frame-similarity branch (lookup window 101) and a color-histogram branch (lookup window 101). Two heads when `use_many_hot_targets` is true: `cls_layer1` and `cls_layer2`. Some constructor flags raise `NotImplemented` in the PyTorch port. TensorFlow inference README pins `tensorflow==2.1` and uses ffmpeg. Weights are git-lfs under `inference/transnetv2-weights`.

**INFERENCE.** Predictions are per frame inside a temporal window, at a fixed tiny resolution. Gradual transitions are why a second (many-hot) head exists. A 0.5 threshold in PySceneDetect's wrapper is a later binarization, not the network.

### 07–13

State is the weights plus a sliding window. GPU is the intended path (Docker `--gpus`). CPU is **UNKNOWN**. Not deterministic in the sense of "no model": the same weights and the same frames should repeat; this audit did not check. Training code and gin configs are in-repo. The README says training sets are tens to hundreds of gigabytes and "you do not need to train".

### 14–16

False negatives on unusual transitions and false positives on fast motion are the usual SBD failure modes. **UNKNOWN** on talking-head specifically. No project test suite was found comparable to PySceneDetect's `tests/`. Evaluation is `training/evaluate.py` against prepared datasets.

### 17–22

They published weights so users would not retrain. That is the right lesson and the wrong artifact to own. MIT on the code does not automatically settle dataset rights for ClipShots, BBC, and RAI. **UNKNOWN** whether the weight file's MIT umbrella (it sits in the MIT repo) is enough for commercial redistribution. Do not redistribute it.

Easiest independent approach: none, until a narrative-film benchmark exists. Then call a provider. Do not retrain.

### 23 Difficulty

**RESEARCH** to beat classical detectors on film. **HIGH** to operate the 2021 stack (TensorFlow 2.1 or a PyTorch port plus LFS weights). **OUT** of v0.1.

### 24 Benchmark

If ever: one hard cut, one 10-frame dissolve, one whip pan, scored against human shot labels. Not ClipShots media inside the product repo.

## Comparison

| Question | Classical (PySceneDetect) | TransNet V2 |
| --- | --- | --- |
| Hard cut, stable camera | Mean abs diff is enough | Heavier, often better F1 on film sets |
| Dissolve / fade | Threshold detector for fades to a level; content misses slow blends | Many-hot head is the point of the paper |
| Talking-head v0.1 | Still unnecessary | Unnecessary |
| Maintenance | Active | Frozen since 2021 |
| False cuts | Sweep says ClipShots precision can sit near 60 | README F1 77.9 still leaves errors |
| AILEXSI v0.1 | Do not integrate | Do not integrate |

**HYPOTHESIS.** A later perception profile `shot.luma.mad` (mean absolute difference) plus a separate `shot.neural` provider is the honest split. v0.1 ships neither.
