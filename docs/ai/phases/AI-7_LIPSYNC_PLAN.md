# AI-7 — Lyrics, lipsync, and matching imagery

Status: **plan only**. This document does not add a tool, a command, a model, or a schema field.

This AI-7 is Martin's phase name. It is not map §28's AI-7. That row was the golden `moveClips` of +2.000 s, and that path already exists. Do not reopen it.

The reference Martin gave is https://x.com/Sohrab/status/2113691960620056847. He described it as characters singing with lipsync, made with a generative video model, and he wants that kind of picture for his own songs, which carry a lot of lyrics. The post was not opened from this session (the public lookup returned client-not-enrolled). Nothing below describes frames from that post. The target is his description, not a claim that Resonance can reproduce that video.

## What stays fixed

- `schemaVersion` stays **5** for every slice in this plan. `deserializeProject` throws when the version is not 5, and it rebuilds the document from known fields, so an extra JSON key would be dropped on the next save.
- `src/core/frame-engine/` stays untouched. Export, mux, and the AFE tests are out of scope.
- One human Accept is one undo. Multi-step work is replayed on a scratch session and committed with the existing `commitPreparedProject` → `withHistory`. Reject changes nothing. A project change after the proposal still returns `TRANSACTION_CONFLICT`.
- The Director flag `resonance-studio-v6-0-ai-director` stays default off. Only `"1"` turns the panel on. Flag off means none of these tools run and the layout does not change.
- No second undo stack, no second command bus, no `projectRevision`.
- The model does not mutate the live session. It proposes. Local weights are untrusted the same way a cloud model is.
- No API key, weight file, or song bytes in the repo or the web bundle. Cloud keys stay out of localStorage. The current keychain entry is one secret: service `com.ailexsi.resonance-studio-v6-0`, user `ai-director-api-key`. A video-provider key must not be written with that same user name, or it replaces the chat key.
- The Director must not claim it heard, transcribed, or watched anything it did not measure. It must not invent a tempo, a 120 BPM grid, a lyric, or a beat time.

## What the tree can already do

Facts the later slices have to live with:

- Beats are `audio.detect_beats` in `src/app/ai/audio/beats.ts`. It reads the selected clip's decoded PCM, measures RMS onsets (10 ms hop, 20 ms window), and stops at 64 events or 180 seconds. A gap is called a beat only when at least three gaps sit between 250 ms and 1500 ms and enough of them are within 15% of the median. Otherwise the events stay labeled onset. Confidence is that regularity share, repeated on every event. There is no downbeat, bar, verse, or chorus.
- Markers are `{ id, timeMs, label }`. A label can be renamed. There is no word, line, language, or confidence field.
- VIS events are `{ id, sceneId, startMs, durationMs }` on `Project.visualizer`. They are not track clips. `sceneId` is a closed catalog in `src/core/visualz/scene-catalog.ts` (spectrum bars, pulse orb, aurora, the Lexi family, and the other Canvas2D scenes). Those scenes are abstract visuals driven by the existing audio features. They are not a character, a mouth, or a generated shot.
- `insertVisEvent` inserts one event at the snapped playhead, using the project's current `sceneId`, with duration until the next event or `DEFAULT_VIS_EVENT_MS` (4000). Picking a scene on a selected event goes through `applyPickVisualizerScene` and does **not** call `withHistory`. A lyric-timed scene plan cannot Accept through today's commands and still be one undo step.
- Picture clips live on V1 or V2 only. `placeAsset` exists and is **not** an `EditorCommand`. Human stem import (`importStemAudioFiles`) already places audio files on free audio tracks, adds tracks up to the cap of 64, and records one history step. The model must not call that function on the live session.
- Send context is `SEND_STRUCTURE` plus names the owner allowed (project, tracks, marker labels). Paths, object URLs, PCM, and frames stay out. `SEND_RAW_MEDIA` is forbidden until an explicit grant. The mock provider still receives no context.

## 1. Local vocal and stem separation

Goal: from one selected song clip, produce a vocal stem and the remaining accompaniment, on disk, then offer them as a timeline proposal. The song Martin hears in the mix is not a vocal stem. Transcription and lipsync both want the vocal, and the plan must not pretend the mix is the vocal.

Candidate: Demucs (HTDemucs and the same family). Checked while writing this plan:

- The code license on `facebookresearch/demucs` `main` is MIT.
- The maintainer has said the pretrained weights are not covered by that MIT license. They are research artifacts, for personal or research use, because the training set (MusDB) is research-only. The repository is archived.
- Third-party copies that label the same weights MIT do not change that statement.

So Resonance must not vendor, auto-download, or ship those weights inside the EXE. A separator Martin already runs himself, on files he chooses, is a different decision from shipping the weights. That decision is his. Other separators (UVR, MDX, BS-RoFormer, and similar) are not chosen here. Each checkpoint has its own license and has to be read before use.

How it would run, when someone builds it:

- Not inside the page bundle and not inside the Frame Engine. An optional local process, pointed at by Martin, started only after he asks. If the process is missing, the reply says so and the project is unchanged.
- The worker writes WAV files outside the project JSON. The Director then proposes an import through the existing stem-import path: vocal on its own audio track, accompaniment on another, grouped, names taken from the stem role rather than a disk path. Accept is one history step. Undo removes the new clips and tracks the import added.
- The proposal shows method, source clip id, and the time range that was actually read. It does not claim a clean vocal. Bleed, reverb, and stacked doubles are expected failure modes and are not given a number here.

Uncertain: which build runs on his Windows PC (CPU only, NVIDIA CUDA, AMD, or Intel), how long a full song takes, and whether a commercially usable weight exists that he is willing to run. This plan records no speed and no quality score.

## 2. Lyrics with word times

Goal: a transcript of the vocal (or of the song, if no stem exists yet) with word times, in German and in English, that Martin can edit before anything is written to the project. He can also paste his own lyric text and have those words aligned, instead of trusting the recognizer's spelling.

Candidates, checked as code licenses only:

- `ggml-org/whisper.cpp` is MIT. Its README documents word-level timestamps as experimental (`-ml 1`). It has a Windows build path and can run on CPU. GPU backends exist; this plan does not pick one.
- `SYSTRAN/faster-whisper` is MIT, and its API exposes `word_timestamps`. It is a Python process. CTranslate2 is MIT. OpenAI's Whisper weight card is published as MIT; the exact ggml or CTranslate2 file still has to be re-read before anyone copies it into a release.
- Use a multilingual checkpoint. The English-only checkpoints are the wrong tool for his German songs. Language is a hint (`de` or `en`) or a detection the tool reports back. The transcript stays in the sung language. It is not translated unless he asks, and a translation is a separate proposal.

The recognizer is a speech model. Sung lyrics are a different problem: held vowels, pitch, stacked voices, and German phonemes. Published work on classical singing reports worse transcription on the sung recording than on a spoken reading of the same words. This plan does not copy that paper's figure and does not claim a rate for Martin's songs. He has to read the words against the recording.

Forced alignment, when he pastes his own text: the aligner may only place times on the words he supplied. It must not replace his spelling, drop a line silently, or invent a word to fill a gap. If a line cannot be aligned, that line comes back with no times and the proposal says which line failed. Montreal Forced Aligner is a known GPL tool. It is not selected. A GPL binary is a license decision for the product, which still has no settled third-party notice in this repo (map §29). Do not vendor it while that is open.

What Accept is allowed to write while schemaVersion stays 5:

- Line-level markers, one per line, label = the edited line text, `timeMs` = the line start that was measured. Word text does not fit on `Marker`. Stuffing words into the label would be unreadable and still would not store confidence.
- The word list (text, start, end, confidence, language, source `asr` | `import` | `edited`) lives in a sidecar next to the project file, not inside `Project`. The sidecar is not undo history and does not travel if he copies only the project JSON. Losing it leaves the markers. That split is a proposal, not a decision he has accepted yet.

The card is editable. He changes words, then Accept. Reject writes neither markers nor the sidecar. Times the model made up, or times copied from a previous song, are rejected. No audio loaded means no transcript and no invented lyric.

Cloud transcription of the vocal is `SEND_RAW_MEDIA`. It does not run on ordinary Send. It needs its own confirm that shows the clip id, the time range, and the provider. Default is local.

## 3. Song structure, using the beats that exist

Goal: verse / chorus / other spans, drawn on top of beat or onset times that were actually measured.

The current beat tool is not a structure detector. A regular onset every half second is not a chorus. This slice may read those events. It may not relabel an onset as a downbeat, and it may not invent bars when the tool returned onset or when the clip was truncated at 180 seconds or 64 events.

A structure pass is a separate local measurement (self-similarity or a dedicated model). No model is chosen here. MSAF, all-in-one, and similar projects need the same license read as Demucs before they are candidates. The card must name the method and list the measured times it used. If the only input was RMS onsets, the label says onset, not beat, and the section names stay tentative. A heuristic that only sees "louder here" is not called a chorus.

Accept, while schemaVersion stays 5, writes section markers (`Verse`, `Chorus`, or a name he edits) at the measured starts, in the same one-undo proposal shape as AI-6. A section with no measured boundary is not written. Confidence is shown as the method's own score when the method has one, and omitted when it does not. No fake score.

Uncertain: whether a local structure model is worth running before he has simply marked chorus by ear. His ear is the check. The tool is a draft.

## 4. Lyric-driven scenes and prompts

Two different outputs. They must not be mixed up.

**Builtin VIS.** For each edited line or section, propose one catalog `sceneId` and a start/duration taken from that line's measured times. The reason is a short note ("night / water / crowd") tied to words that are actually in the line. Unknown scene ids are rejected. The catalog cannot show a person singing. The card has to say that, so a Lexi scene is not presented as the music video.

This needs a new `EditorCommand` before Accept can be one undo step. Today's insert uses the current scene and a default duration, and scene pick does not push history. The command to design later is a single history-backed insert or replace: scene id, start, duration. Several lines in one Accept are several of those commands on the scratch session, then one `commitPreparedProject`. Overlapping an existing VIS event fails closed and names the event, rather than deleting it.

**Image and video prompts.** A second block on the same card: prompt text for a still or a shot, written from the line, plus the line's time range. Accept of the VIS command does not generate media and does not store the prompt inside the project. The prompt stays on the proposal card (session UI state, same class as the chat) unless he later asks for the schema migration below. Sending the prompt, the lyric, or a face to a cloud image model is a separate confirm. It is not implied by Accept.

No shot is generated in this slice.

## 5. Lipsync and singing video

The cited style is a generated character performing the song. The local models below are mouth or portrait drivers. They take a face (a still or a short clip he supplies) plus audio, and they move a mouth. They do not stage a new character in a new shot. Saying otherwise would oversell them. Closing that gap means a generative video model, which today is a cloud API or a local model this repo does not contain. He has to watch a short result and decide. This plan has no quality score.

Local candidates, licenses as checked for this plan, hardware left open:

| Candidate | What was verified | What was not | Honest limit |
| --- | --- | --- | --- |
| Wav2Lip (`Rudrabha/Wav2Lip`) | The README says results are for research, academic, or personal use, and that commercial use is prohibited because the weights were trained on LRS2. | Nothing about his songs. | Do not ship it in the product. A personal experiment on his machine is his call. It is a speech mouth model. Singing is unproven here. |
| SadTalker | The repo LICENSE is Apache-2.0 except listed third-party components. | Whether those components (face reconstruction, and anything inherited from Wav2Lip) are actually separable. | Do not treat the whole download as Apache. Portrait talking-head, not a full-frame music video. |
| LatentSync (ByteDance) | The GitHub LICENSE file on `main` is Apache-2.0. | The weight license. A secondary page claimed OpenRAIL++; that page is not the license file. Also unproven: VRAM, DirectML, and singing. | Do not download weights until the weight card is read. Third-party notes mention a discrete NVIDIA GPU. This plan does not adopt their memory figures. |

None of these are wired to the Windows EXE today. The EXE is the Tauri shell plus the web UI. It has no Python, no CUDA, and no PyTorch. Putting that stack into the NSIS installer is a later product decision, after he says what GPU and how much RAM the PC has. Until then the worker is optional and external, same as the separator. If it is not installed, the Director says so. It does not fall back to a cloud render.

Cloud APIs (a generative video or lipsync host) are allowed only under all of these:

- A confirm that is not the chat Send button. The confirm shows provider, model, the exact audio range, the exact still or clip, and that the bytes will leave the machine. Cancel sends nothing.
- One confirm, one request. A standing "always upload" toggle is out.
- The key is typed at runtime or read from a **new** keychain user name. It is never the chat key's user name, never localStorage, never the bundle.
- Failure leaves the timeline alone. A returned file is not placed until the placement proposal in section 6 is accepted.
- The panel must not say the clip was heard or the mouth was checked. He watches it.

Identity: he attaches the face or character still. The tool does not search the web for a face and does not train on him. A generated person who is not that still has to be labeled as generated, not as a match.

## 6. Placing picture on V1

Generated or imported picture becomes an ordinary video or image asset, then a clip on V1, starting at a time that already exists: a section marker, a beat marker, or a line start from section 2. If none of those exist, nothing is placed and the reply says which measurement is missing. Snap-to-grid and a 120 BPM assumption are not used. Exact placement uses the same idea as D4 and D23: the measured time is the time that is written, not a snapped substitute. `Project.snap` must not move it.

V1 already occupied in that span: fail closed and name the clip. Do not lift or ripple his song picture unless he accepts a separate proposal that says so. V2 is available only if he picks it. There is no V3.

`placeAsset` is not a command today. The slice needs one history-backed place command (asset already imported, track, start, source in/out) so Accept goes `EditorCommand` → `applyCommand` → `withHistory`. A batch of shots is N of those commands on the scratch session and one `commitPreparedProject`, so one Undo removes the whole batch. One shot per Accept is the same path with N = 1. The card shows the lyric line beside the timeline range. Undo does not require a second AI call.

Audio of a generated clip is not mixed in unless he asks. A lipsync render often has its own audio. Default is picture only, muted or without the embedded track, so his song stays the soundtrack. How the current importer treats `hasAudio` on a video file has to be checked when the command is written. Until that check, the proposal must not assume the new clip is silent.

## 7. Data model

Stay on schemaVersion 5 for AI-7a through AI-7e.

Fits in the current document, through commands that already exist or the two commands this plan says are missing (history-backed VIS span, history-backed place):

- Line and section markers.
- VIS events whose `sceneId` is in the catalog.
- New audio assets and tracks from stem import.
- New picture assets and V1/V2 clips.

Does not fit, and must not be stuffed into `Marker.label` or a fake extra JSON field (the loader would drop it):

- Words, word times, per-word confidence, language, and whether the text was recognized, pasted, or edited.
- A prompt linked to a line.
- Stem role as data rather than a track name.
- A receipt: which model, local or cloud, what was sent, when he consented.

Those live in the sidecar until he asks for a migration. Suggested later migration, not part of this plan and not a version bump now:

- `schemaVersion` 6, loader still opens 5 and writes 6 only after an explicit save-as or a migration he confirms.
- Additive `lyrics` document: lines with id, text, startMs, endMs, source, and words `{ text, startMs, endMs, confidence }`.
- Additive `sections`: id, label, startMs, endMs, method, optional confidence.
- Optional provenance on a clip or asset id, in that same document, not a secret and not a file path. Paths stay out, as they do today.

Frame Engine structs do not gain lyrics fields. Preview and export keep reading clips and VIS events only.

A second feature flag is worth deciding before AI-7a. Recommendation: keep the Director flag as the panel switch, and add `resonance-studio-v6-0-ai-lyrics` default off, so opening the Director does not offer separation or a model download. Both missing means off. Only `"1"` means on. Layout prefs stay layout prefs. Neither key goes into the project.

## 8. Slices, tests, and what Martin has to judge

Each slice is proposal-only, flag-gated, and covered by Vitest with a fake worker. CI does not download weights, does not call the network, and does not need his songs. `tsc`, full `vitest`, and `vite build` stay the gates. The six inherited failures (AFE-15 A and N, STRESS-03 H–K) stay inherited. Frame Engine stays unread by these tests except the suite that already fails.

| Slice | Builds | Tests, when it is built | Martin, on the EXE, with his own song |
| --- | --- | --- | --- |
| **AI-7a** Separation | Optional local worker. Proposal imports stems with the existing stem importer. One undo. No weights in git. | Fake worker returns two tiny buffers. Missing worker changes nothing. Flag off and lyrics-pref off do not start it. Undo restores the track list. | Listen. Vocal bleed, swallowed words, reverb, doubles. Say whether the stem is usable. Say what the PC is (CPU, RAM, GPU). |
| **AI-7b** Lyrics | Local whisper.cpp or faster-whisper, multilingual. Editable card. Pasted text is aligned, not rewritten. Accept writes line markers plus the sidecar. | Fixture with known words. Edit before Accept. Reject writes nothing. A failed line has no invented time. German and English fixtures both run. No network. | Read every line against the recording, in both languages he cares about. Fix words. Decide whether the times sit on the syllables. |
| **AI-7c** Structure | A local section pass that may only cite measured beat or onset times. Markers for section starts. | Synthetic onsets. Truncation at the existing 180 s / 64-event caps is labeled. No 120 BPM. An onset is not stored as a beat. | Hear the boundaries. Move or reject the ones that are early or late. |
| **AI-7d** VIS and prompts | New history-backed VIS command. Catalog ids only. Prompt text stays on the card. No image is generated. | Unknown scene id rejected. Overlap fails closed. One Accept, one undo, project stand-in still conflicts. Flag off does not insert an event. | Look. The scenes are abstract. Keep or reject. Edit the prompt text. Do not expect a singer. |
| **AI-7e** Lipsync and V1 | Only after he picks a license-cleared local tool or a cloud provider. Per-request consent for cloud. New keychain user name. New place command. Picture on V1 at a measured time. One undo per Accept, including a batch. | Fake generator returns a tiny fixture. No consent means no request is attempted. Key strings do not appear in the bundle test. Occupied V1 fails closed. Undo removes the clips. | Watch and listen on a short span first, speech and then singing, front face and then whatever angle he uses. Identity drift and late mouths are his call. The full song is not the first Accept. |

Order is a then b then c then d then e. b can start on the mix if a is blocked on the weight license, and the card must say the transcript was made from the mix, not from a vocal stem. e does not start in parallel. d does not generate video.

## Open points

These are unresolved. They are not silent defaults.

1. Whether he will accept a personal/research Demucs weight on his own machine, or whether AI-7a waits for a weight he considers distributable. Shipping the official weights in Resonance is not acceptable on the maintainer's statement.
2. whisper.cpp versus faster-whisper. The first fits a Windows EXE more naturally. The second is the one with a straightforward word-timestamp API. Singing quality is unknown either way.
3. Sidecar plus line markers, versus waiting for schema 6 before any lyric is stored. This plan recommends the sidecar so schemaVersion stays 5. He can reject that split.
4. The second flag versus reusing the Director flag alone.
5. His GPU, RAM, and whether a CUDA build is even relevant. No hardware number belongs in the plan until he reports the machine.
6. LatentSync weight license, and SadTalker's third-party components. Wav2Lip is already a no for a shipped product.
7. Which cloud video API, if any. Not chosen. Cost is not estimated here.
8. Whether generated video audio is dropped, muted, or mixed. Needs a read of the importer at implementation time.
9. GPL tools (forced aligners, some MIR code) while the product's third-party notice is still unsettled.
10. The X post's actual pictures. They were not reviewed. If the target depends on a specific look in that post, he needs to point at a still he wants matched. This plan will not infer one.
