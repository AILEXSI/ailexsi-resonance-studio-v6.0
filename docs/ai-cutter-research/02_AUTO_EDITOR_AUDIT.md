# 02 — Auto-Editor audit

**Repo:** https://github.com/WyattBlue/auto-editor  
**Commit:** `7796222139b5d87fe32247f8a60a931b02006db5` (2026-09-19)  
**Inspected:** 2026-09-21, source read, not executed.

## 01–26

### 01 Repo

**FACT.** WyattBlue/auto-editor. Language at this tip: Nim (`src/*.nim`). CLI application. Default branch tip message: "ffmpeg 9.0.2". About 5313 stars. Not archived.

### 02 License

**FACT.** Root `LICENSE` is the Unlicense (public domain dedication).  
**FACT.** Vendored `src/vendor/tinyre/LICENSE` is MIT. `src/vendor/libp2p/LICENSE` is MIT (Status Research, 2018). `src/vendor/csort/LICENSE` is Unlicense.  
**INFERENCE.** The Nim sources are not a copyleft trap. A practical binary still links FFmpeg/libav (LGPL or GPL depending on the FFmpeg build). That is a distribution issue for Auto-Editor, and a reason for AILEXSI not to shell out to this binary as a hidden dependency.  
**UNKNOWN.** Patent status. Unlicense is not a patent grant.

### 03 Maintenance

**FACT.** Commit date 2026-09-19. CI workflow `.github/workflows/smoke.yml` checks out `WyattBlue/auto-editor-tests` and runs `nimble test` plus `python3 tests/test.py` on macOS, Ubuntu, and Windows.  
**INFERENCE.** Actively maintained, with tests outside this tree. This audit did not run them.

### 04 Problem

**FACT (README).** First-pass removal of "dead space", "most notably audio loudness", before a human edits.  
**FACT (implementation).** The default detector is not a loudness meter. See §06.

### 05 Input / output

**Input.** A media path. Optional edit expression, margin, smooth lengths, explicit cut/keep ranges, speed actions, export format.  
**Output.** A rendered media file and/or a timeline export: JSON, FCP7 XML (Premiere and Resolve paths), FCP11 XML, MLT, Kdenlive, Shotcut, OTIO.  
**FACT.** `src/exports/` contains those writers. `src/exports/otio.nim` header comment says the OTIO is "compatible with Adobe Premiere Pro" and writes the Premiere invert effect id `AE.ADBE Invert` so an invert action survives that round-trip.

### 06 Algorithm

Timebase `tb` is an `AVRational`. Analysis arrays are one value per timeline tick.

**Audio (default).** `src/analyze/audio.nim` resamples to signed 16-bit, splits the stream into chunks whose length tracks `chunkDuration` (the timeline tick) with accumulated rounding error, and emits the **maximum absolute sample** in the chunk divided by 32767. A named channel can be selected; `"all"` scans every channel. SIMD paths (NEON, WASM, SSE) compute the same peak. Mono is treated as left, right, and center.  
**FACT.** This is peak amplitude, not RMS, not LUFS, not a speech probability.

**Threshold.** `src/edit.nim` defaults: audio `0.04`, motion `0.02`, black `0.98` (as `Unorm16`). `parseThres` in `src/util/fun.nim` accepts a bare 0..1 number, a percent, or dB via `10^(dB/20)`, and errors if the result is outside 0..1.  
**INFERENCE.** `0.04` is about −28 dB peak (`20*log10(0.04)`). That arithmetic is not a measured loudness.

**Motion.** `src/analyze/motion.nim` builds an FFmpeg filter `scale={width}:-1,format=gray,gblur=sigma={blur}`, optional crop, then `countDifferentPixels`: a byte is different when the gray values are **not equal**. The score is `diffCount / totalPixels`. First frame scores 0. Dropped or uneven PTS is filled by repeating the latest value across missing indices.  
**INFERENCE.** Compression noise flips this score. It is not optical flow and not mean absolute difference.

**Black.** A separate analyzer (`blackdetect.nim`, not fully quoted here) with default threshold `0.98`. **FACT** that the symbol and default exist. The exact pixel reduction was not line-audited.

**Boolean mask.** For each tick, level ≥ threshold becomes true (`orWithThreshold`). Edit expressions combine methods with `or` and other functions (`edit.nim`, `editlexer.nim`). Labels are integers 0..255. Label 0 is the inactive class. Higher labels win on overlap. Default action: inactive → cut, active → keep (`cli.nim` help text).

**Smoothing.** `smoothing` in `src/lib/editutil.nim` flips active runs shorter than `minclip` to inactive, and inactive runs shorter than `mincut` to active, repeating until stable, with a two-step cycle break. Defaults from `cli.nim`: mincut `0.2s`, minclip `0.1s`.

**Margin.** `mutMargin` expands or shrinks the edges of active runs by `startM` and `endM` ticks. Default margin `0.2s` (help text). Negative margin eats into the keep.

**Order.** **FACT.** `src/conductor.nim` builds the boolean mask from labels, calls `mutMargin`, then `smoothing`, then writes the mask back onto labels 0 and 1. Threshold happens earlier, inside `interpretEdit`.

**Timeline.** Runs of equal labels become clips (`chunkify` in `src/timeline.nim`). v3 timeline has video, audio, and subtitle layers of `Clip {src, start, dur, offset, stream, effects}`, plus dissolves. Speed is an effect: source span and timeline duration differ. v1/v2 chunk forms still exist.

### 07 State

Per-tick label array, then a linear or layered timeline. Analysis cache keyed by path, timebase, method, and arguments (`cache.nim` usage in `motion`). No user model. No confidence. No provenance beyond the CLI invocation.

### 08 Parameters

| Name | Default (source or help) | Meaning |
| --- | --- | --- |
| `--edit` | `audio` | Expression. Default method audio |
| audio threshold | `0.04` | Peak ratio |
| motion threshold | `0.02` | Fraction of unequal gray pixels |
| `--margin` | `0.2s` | Pad or eat keep edges |
| `--smooth` | `0.2s,0.1s` | mincut, minclip |
| motion `width`, `blur` | required > 0 width; blur ≥ 0 | Analysis resolution and pre-blur |
| `--transition` | off; min removed interval default `1sec` in help | Dissolve |

### 09 Dependencies

Nim, FFmpeg/libav (decode, filter graph, encode), vendored tinyre / csort / a slice of libp2p. Optional whisper path (`src/cmds/whisper.nim`, `src/transcribe.nim`) — a subcommand, not the default cutter. **FACT** that the files exist. The whisper binary and model license were not audited.

### 10 Models

**FACT.** Default cut path has no neural model.  
**INFERENCE.** Deterministic given the same decode and the same FFmpeg filter output. Decode is not bit-stable across FFmpeg builds. **UNKNOWN** whether motion scores match across FFmpeg versions. The cache hides that until inputs change.

### 11 Hardware

CPU. SIMD for the peak and the pixel compare. No GPU requirement on the default path.

### 12 Performance

**UNKNOWN** as a measured number in this audit (not run). **INFERENCE** from the code: one decode pass, one sample peak per tick, cache on disk. Motion costs a full gray decode. Long-form is a streaming FIFO, not a RAM-resident waveform, on the audio path.

### 13 Deterministic vs model

Deterministic threshold logic on top of a decoder. The decoder and `gblur` are the non-portable edges.

### 14 Failures

- Room tone above `0.04` peak is kept forever. Digital silence is cut. Those are different rooms.  
- Music under speech is "active" for the whole bed.  
- Breaths and page turns cross `0.04` or they do not; the tool cannot say which.  
- Motion false positives: any gray byte change, including encoder noise.  
- Mono mapped to left/right/center can analyze the wrong conceptual channel if the user names one.  
- No-decoder audio streams are skipped with a warning (`decodableAudio`).  
- PTS gaps in motion repeat the previous score (`for i in 0 ..< index - prevIndex`).

### 15 Edge cases

Variable frame rate (tick grid is the chosen timebase, not every container timestamp). Leading/trailing margin clamped to the array. All-silent and all-active media (edit expression `0` or `1` is special-cased in the evaluator). Multi-stream `or`. Overlapping labels. Speed changes inside a kept region. Transitions suppressed when the removed interval is shorter than the min-cut.

### 16 Tests

**FACT.** Not in this repo. CI clones `WyattBlue/auto-editor-tests`. **UNKNOWN** coverage of margin sign, 29.97 Hz chunk rounding, and NLE round-trip. The audio iterator comment records a historical bug: truncating chunk size overflowed a 1601-sample buffer at 29.97 fps / 48 kHz. That comment is evidence they hit rational-time rounding. It is not evidence the bug is gone on every rate.

### 17 Architecture decisions

- Analysis result is a per-tick scalar, then a boolean, then a clip list. The scalar is discarded after the decision.  
- One process both decides and renders.  
- Export formats are hand-written XML/JSON, including NLE-private effect names.  
- Cache is an optimization, not a provenance log.

### 18 Commodity vs clever

**Commodity:** peak gate, hysteresis-by-margin, minimum duration, run-length to clips.  
**Clever:** edit expression language, labeled actions (cut vs speed), rational chunk sizing, NLE writers, SIMD peaks.  
**Not clever:** calling the peak a loudness.

### 19 Useful for AILEXSI

- Separate **measurement** (per-tick peak) from **decision** (keep/cut) from **padding** (margin) from **minimum duration**.  
- Store the measurement. Auto-Editor throws it away.  
- Default numbers are a benchmark policy, not a truth: threshold `0.04`, margin `0.2s`, mincut `0.2s`, minclip `0.1s`.  
- Identity of a produced clip: source media, source offset, timeline start, duration, speed.  
- Human override ranges (`--cut-out`, `--add-in`) already exist as a higher-priority mask. That is the seed of "human correction wins".

### 20 Avoid

- Vendoring Nim, the expression language, or the exporters.  
- Exact-equality motion.  
- Writing Premiere effect ids into the internal arrangement.  
- A single boolean "silence" flag.  
- Treating the cache as evidence.

### 21 Legal

Unlicense on the application sources is permissive. Do not copy the vendored trees (they are unnecessary). Do not link libav into Resonance through this project. FFmpeg process invocation, if ever used as a decode edge, stays outside the core and is a later legal review. This audit is not that review.

### 22 Easiest independent approach

Reimplement, in tests first: for a PCM fixture, emit peak per `N` ms; compare to a threshold; apply margin and min durations; emit keep ranges. No FFmpeg required for the fixture. Decode of real files is a provider.

### 23 Difficulty

**LOW** for the mask and the ranges on PCM fixtures. **MEDIUM** for real-file decode, timebase rounding, and A/V linkage. **HIGH** for NLE exports. Exports are out of v0.1.

### 24 Benchmark cases

1. Digital silence / full-scale tone, known sample positions.  
2. Tone at peak `0.03` and `0.05` around the default threshold.  
3. A 50 ms spike that minclip must drop, and a 50 ms hole that mincut must fill.  
4. Margin `0.2s` on a keep that starts at 0 (clamp).  
5. 48 kHz audio against a 30000/1001 tick — chunk sizes must not drift.  
6. Stereo: energy only on one channel.  
7. Steady room tone, no digital zero. Expected: **UNKNOWN** whether a human would cut it. The tool will keep it if the peak exceeds the threshold. That disagreement is the point.

### 25 Provenance

Files named above. No command output from Auto-Editor itself.

### 26 Open questions

- Does the external test repo pin FFmpeg? **UNKNOWN** (not cloned).  
- Is black-detect luma or RGB max? **UNKNOWN** (file not fully read).  
- How often do Premiere/Resolve round-trips survive speed changes? **UNKNOWN** (not run).

## Mechanism — activity mask to keep ranges

**PROBLEM.** Remove inactive spans from a long take without claiming the span is "silence" in the human sense.  
**INPUT.** PCM (or a decoded provider stream), sample rate, tick duration, threshold, margin start/end, mincut, minclip.  
**EXPECTED OUTPUT.** A list of keep ranges in source time, plus the per-tick measurement and the boolean before margin, so a later review can see why.  
**GENERAL ALGORITHM.** Peak (or RMS, stored separately) per tick → compare → expand edges by margin → flip short keeps and short cuts → run-length encode.  
**STATE.** The measurement array and the policy parameters. Not the rendered file.  
**PARAMETERS.** See §08. AILEXSI defaults may copy these numbers as a named policy `ae-default-v0` with provenance, not as unnamed magic.  
**FAILURE MODES.** §14.  
**TEST VECTORS.** §24 items 1–5 can be pure PCM. No media file required.  
**MINIMAL AILEXSI DESIGN.** A `MeasurementSeries` of kind `audio.peak.ratio` and, separately, `audio.rms.ratio`. A `Policy` record. A `Decision` list that references both. See [07](./07_TEMPORAL_EVIDENCE_SPEC.md) and [08](./08_EDIT_DECISION_SPEC.md).
