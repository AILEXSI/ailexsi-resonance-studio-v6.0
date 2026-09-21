# 03 — WhisperX audit

**Repo:** https://github.com/m-bain/whisperX  
**Commit:** `2cfd7b7c5c7bba144954364db747319b50e8232b` (2026-07-13)  
**Package:** `3.8.7rc1` (`pyproject.toml`)  
**Paper:** https://arxiv.org/abs/2303.00747 (INTERSPEECH 2023)  
**Inspected:** 2026-09-21, source read, not executed. This audit does not restate Whisper.

## 01–26

### 01 Repo

**FACT.** m-bain/whisperX. Python. 24171 stars. Not archived. Latest inspected commit message concerns NLTK `punkt_tab` download failure.

### 02 License

**FACT.** `LICENSE` is BSD-2-Clause, copyright 2024 Max Bain.  
**FACT.** Direct dependencies in `pyproject.toml` include `ctranslate2`, `faster-whisper`, `nltk`, `numpy`, `omegaconf`, `pandas`, `pyannote-audio>=4.0.0`, `huggingface-hub`, `torch~=2.8.0`, `torchaudio`, `torchvision`, `transformers`, and platform-specific `torchcodec` and `triton`.  
**FACT.** `whisperx/diarize.py` default model string is `pyannote/speaker-diarization-community-1`.  
**FACT.** That model's Hugging Face card, read 2026-09-21, contains `license: cc-by-4.0` and a gated prompt.  
**FACT.** `pyannote/speaker-diarization-3.1` card says MIT. WhisperX 3.8 does not default to it.  
**INFERENCE.** Shipping WhisperX into Resonance would pull a CUDA-sized stack and a CC-BY-4.0 weight set that requires attribution and an accepted HF gate. BSD-2-Clause on the Python files does not license those weights.

### 03 Maintenance

**FACT.** Commit 2026-07-13. GitHub `pushed_at` 2026-08-30. Workflows exist for tests and Python compatibility (files under `.github/workflows/`). **UNKNOWN** whether CI is green. Not run.

### 04 Problem

**FACT (README).** Whisper's own timestamps are utterance-level and can be off by seconds. WhisperX adds VAD batching, wav2vec2 forced alignment for word times, and optional speaker labels. README claims "70x realtime" with large-v2 and "<8GB" GPU for that model at `beam_size=5`.  
**Label on the speed claim:** README claim, not a measurement from this audit.

### 05 Input / output

**Input.** Audio path or array. Language optional. Batch size, VAD onset/offset, chunk size. Alignment model optional. Diarization token optional.  
**Output.** `TranscriptionResult`: segments `{start, end, text, optional avg_logprob}`, language. After align: `AlignedTranscriptionResult` adds `words[{word, start, end, score}]`, optional `chars`, and `word_segments`. Diarization writes a `speaker` field onto segments and words by overlap. Schema: `whisperx/schema.py`.  
**FACT.** Times are floating seconds. There is no media-rate rational and no source-id. Score is a float on the word. Missing times exist (assignment skips words with no `start`).

### 06 Algorithm

**Stage A — VAD and chunking** (`asr.py` `FasterWhisperPipeline.transcribe`). Audio is loaded at the module sample rate (`audio.py`, named `SAMPLE_RATE`). The VAD backend (`silero.py` or `pyannote.py`) returns speech segments. `merge_chunks` packs them into windows of `chunk_size` (pipeline default argument 30, meaning 30 seconds in the call signature). Pyannote VAD defaults in `load_vad_model`: onset `0.500`, offset `0.363`.

**Stage B — ASR.** Each chunk is a log-mel spectrogram (80 mels unless the model says otherwise) and is batched through faster-whisper `generate_segment_batched`. Language can be detected if unset. `suppress_numerals` adds numeral tokens to the suppress list. This stage returns segment text and coarse times.

**Stage C — alignment** (`alignment.py` `align`). For each ASR segment, characters outside the wav2vec dictionary are dropped or treated as wildcards. Spaces become `|` for languages that use spaces. NLTK `punkt_tab` splits sentences; if the data is missing, the code tries to download it and otherwise raises the error fixed in this commit. A trellis (`get_trellis`) and `backtrack` produce a CTC path. `merge_repeats` and `merge_words` turn the path into word spans. `interpolate_nans` (default method `"nearest"`) fills holes.  
**INFERENCE.** Word times are an alignment of the ASR string to a phoneme model, not the ASR decoder's own timestamps. If the ASR string is wrong, the alignment will still place those wrong words.

**Stage D — diarization assign** (`assign_word_speakers`). Speaker turns become intervals. Each word or segment gets the speaker with the largest time overlap. `fill_nearest` assigns the nearest speaker when there is no overlap. The comment claims a large speedup versus a linear scan. That speedup was not remeasured here.  
**FACT.** This does not re-decode speech. It labels existing times. Overlap is resolved by duration, not by a confidence.

Default English aligner: torchaudio bundle `WAV2VEC2_ASR_BASE_960H`. Other languages map to VoxPopuli bundles or named Hugging Face wav2vec2 checkpoints (`DEFAULT_ALIGN_MODELS_TORCH`, `DEFAULT_ALIGN_MODELS_HF`). Languages with no entry raise.

### 07 State

Model weights on disk via Hugging Face or torchaudio. Tokenizer cached on the pipeline object. No project memory. Diarization speaker ids are local to the file (`SPEAKER_00` style from the pipeline, not a global person id).

### 08 Parameters

VAD onset/offset, chunk size (30 s default at the `transcribe` signature), batch size, language, task, `suppress_numerals`, `interpolate_method`, `return_char_alignments`, align model override, diarization model name and HF token, `min_speakers` / `max_speakers` / `num_speakers` (passed through to pyannote; not re-audited parameter-by-parameter), `fill_nearest`.

### 09 Dependencies

See §02. CUDA 12.8 is the README's GPU setup. CPU is allowed (`device` negative → CPU in `FasterWhisperPipeline`). `triton` is Linux x86_64 only.

### 10 Models

Replaceable by design of *this audit*, not by the repository: any ASR that emits segments, any aligner that emits word times, any diarizer that emits speaker turns. The repository hard-wires faster-whisper and a wav2vec CTC aligner.

**Weight licenses inspected:**

| Object | License evidence |
| --- | --- |
| WhisperX Python | BSD-2-Clause |
| faster-whisper, openai/whisper repos | MIT (GitHub SPDX) |
| pyannote.audio code | MIT |
| `speaker-diarization-community-1` weights | CC-BY-4.0, gated |
| `speaker-diarization-3.1` | MIT on its card; not the default |
| `WAV2VEC2_ASR_BASE_960H` and per-language HF aligners | **UNKNOWN** per checkpoint. Do not assume MIT. |
| Silero VAD code | MIT |

### 11 Hardware

GPU is the documented fast path. CPU works and is slower. **UNKNOWN** memory for community-1 on CPU. README "<8GB" applies to large-v2 ASR, not to the sum of ASR + aligner + diarizer.

### 12 Performance

README: large-v2 about 70× realtime with batching, and a paper claim of 60–70×. **Not remeasured.** Alignment is per ASR segment, so cost grows with speech duration, not with silence the VAD dropped. Diarization is a separate full pass.

### 13 Deterministic vs model

**Model.** Beam search, VAD thresholds, and floating-point kernels move times. **INFERENCE.** Do not hash a WhisperX JSON as a golden project fact across machines. A fixture may pin one output as an example, labeled non-canonical.

### 14 Failures

- ASR hallucination in non-speech if VAD misses it (the README's reason for VAD).  
- Wrong language → wrong aligner dictionary → dropped characters.  
- No aligner for the language → hard error.  
- `punkt_tab` missing and download blocked → hard error (this commit).  
- Numerals and punctuation stripped from the aligner dictionary become wildcards or disappear; word boundaries move.  
- Overlapping speech: one speaker wins by overlap duration.  
- `fill_nearest` will invent a speaker rather than leave UNKNOWN.  
- HF token missing → diarization cannot download.  
- cuDNN / CUDA mismatch: `CUDNN_TROUBLESHOOTING.md` exists. Not read line by line. **FACT** that the file exists.

### 15 Edge cases

Languages without spaces (`LANGUAGES_WITHOUT_SPACES`). Empty segment after character cleaning (alignment skipped). Words with no `start` left unlabeled. Very long files: chunked ASR, then a global diarization assign. Music, laughter, applause: VAD-dependent, **UNKNOWN** without a fixture.

### 16 Tests

**FACT.** `tests/` contains `test_word_timestamp_interpolation.py` only (one test file at this tip). **INFERENCE.** The repository does not, in-tree, lock word-time behavior against a corpus. The paper's benchmarks are paper evidence, not this checkout's test run.

### 17 Architecture decisions

- VAD before ASR to batch and to drop non-speech.  
- Alignment model is not the ASR model.  
- Diarization is a label join, not a joint decoder.  
- Schema is a TypedDict, not a versioned evidence record.

### 18 Commodity vs clever

**Commodity:** "run ASR, then force-align the transcript".  
**Clever:** batching Whisper, the specific CTC trellis, exclusive-speaker reconciliation in community-1 (a model-card feature, not AILEXSI logic).  
**Commodity AILEXSI should copy conceptually:** the four-stage split and the word schema fields `start`, `end`, `score`.

### 19 Useful for AILEXSI

A provider result, process-isolated:

```text
SpeechObservation
  provider, modelId, language
  segments[]: startMs, endMs, text, score?
  words[]: text, startMs, endMs, score, speaker?
  unknowns[]: text spans with no time
```

Times converted to integer milliseconds only at the boundary, with the provider's native seconds retained in provenance so rounding is visible. Speaker omitted in v0.1 (UNKNOWN), even if the provider has one.

### 20 Avoid

- Importing whisperx, torch, or pyannote into `src/`.  
- Treating word times as frame-accurate facts.  
- `fill_nearest` as a default. UNKNOWN is the honest output.  
- Using diarization embeddings as a person database.  
- AGPL `whisper-timestamped`.

### 21 Legal

BSD-2-Clause on the glue is acceptable to read. CC-BY-4.0 community-1 weights require attribution if those weights are redistributed or if their output is a copyright derivative. **UNKNOWN** whether a diarization label is a derivative work. Do not redistribute the weights inside AILEXSI. Gated HF terms are a contract with Hugging Face, separate from the code license. Align-model cards must be read before any provider is blessed. This is not a clearance.

### 22 Easiest independent approach

Define the observation schema and a fake provider that returns a hand-timed transcript for fixtures. A real provider, later, can be a subprocess that prints that JSON. The core never imports the model.

### 23 Difficulty

**LOW** to specify the schema. **MEDIUM** to convert times and refuse missing scores. **HIGH** to operate a local ASR well. **RESEARCH** to know when a word time is good enough to cut on. v0.1 does not cut on word times until a fixture says the silence policy is the wrong tool (retakes, fillers).

### 24 Benchmark cases

1. Hand-timed "hello" / silence / "hello" against a fake provider. The core must not call a model.  
2. A word with `score` missing → observation, not a decision.  
3. Two overlapping speaker turns → v0.1 stores no speaker, or stores both as hypotheses. It does not pick one silently.  
4. ASR text that does not match the audio (injected). Alignment must not be promoted to fact.  
5. 30.5 s of speech across the 30 s chunk boundary. Times must stay on one clock.

### 25 Provenance

`schema.py`, `asr.py`, `alignment.py`, `diarize.py`, `vads/*.py`, `pyproject.toml`, README, community-1 card. Paper not re-read in full.

### 26 Open questions

- Exact license of `WAV2VEC2_ASR_BASE_960H` weights. **UNKNOWN**.  
- Whether community-1's CC-BY-4.0 applies to outputs or only to weights. **UNKNOWN**. A conservative product stance: do not bundle weights; attribute if a provider is later selected.  
- Word-time error on interview audio versus the paper's benchmarks. **UNKNOWN** here.

## Mechanism — speech observation

**PROBLEM.** Place words in time without believing the ASR decoder's own clock, and without believing the words.  
**INPUT.** Audio plus, internally, a transcript hypothesis.  
**EXPECTED OUTPUT.** Words with start, end, and score, or an explicit gap where alignment failed.  
**GENERAL ALGORITHM.** Find speech regions → transcribe chunks → align the resulting text with a phoneme model → optionally label speakers by overlap.  
**STATE.** None inside AILEXSI. The provider is stateless per call. Cached outputs are observations with a content hash of the audio range, not facts.  
**PARAMETERS.** Belong to the provider profile, recorded in provenance, not hard-coded in the core.  
**FAILURE MODES.** §14.  
**TEST VECTORS.** §24.  
**MINIMAL AILEXSI DESIGN.** One observation type. No diarization in v0.1. No torch.
