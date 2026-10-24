# AI Director decisions

Conservative choices taken where the brief and `AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md` do not say the same thing. The map stays authoritative for safety. The brief's phase names (AI-1 … AI-6) are the commit labels.

| # | Decision | Why |
| --- | --- | --- |
| D1 | AI-3 builds proposal JSON only. Live `applyCommand` starts in AI-4, after an `AITransaction` exists. | Map §11 and §28: a first mutation without a transaction is unsafe. The brief still requires every live mutation to go through `EditorCommand` → `applyCommand` → `withHistory`. |
| D2 | No `projectRevision` field on `Project`. Stale Apply compares a JSON stand-in of the project plus `history.past.length`. | Map §12. `schemaVersion` stays 5. `updatedAt` is not a revision. |
| D3 | One accepted proposal is one undo step. A multi-step plan is replayed with `applyCommand` on a scratch session, then committed with the existing `withHistory` once. | Map law 7. Looping `applyCommand` on the live session would push N undo entries. |
| D4 | Exact moves use `{ type: "moveClips", deltaMs }`. They do not use `applyMove` or `nudgeClip`. | Those paths snap when `Project.snap` is true. |
| D5 | `timeline.nudge` maps to the existing `nudgeClip` command and the proposal says that snap can change the delta. | The brief names nudge. The map says nudge is not the exact +2.000 s path. |
| D6 | Superseded by D19. Originally: beat cuts use marker times only, with no onset pass. | The Director must not claim it heard audio it did not measure. |
| D7 | Superseded by D20. Originally: same-track audio splits do not add fades. | V6 `Transition` objects are still overlapping video edit pairs. |
| D8 | Default provider is an in-process mock. A cloud request is sent only after the user picks that provider, types a runtime key, and clicks Send. | No keys in the repo or bundle. No telemetry. No automatic upload. |
| D9 | `resonance-studio-v6-0-ai-prefs` may store provider id, base URL, and model name. It never stores an API key. | Map §17 allows a base URL there. Keys stay in component memory. |
| D10 | Superseded by D21 for names. Paths, object URLs, PCM, and frames stay out. | Map §25 still forbids media. The owner later allowed names. |
| D11 | Move without an explicit `clipId` requires exactly one selected clip. | Map §22 fail-closed. |
| D12 | Tool ids that are display names (`"Vocals"`, label `"A3"`) are rejected. | `isTrackId("A3")` can be true, but a missing track id is "Track not found". Labels are not resolved. |
| D13 | Director chat state is React state in the panel, the same class of state as the media-bin selection. It is not in `Project` and not a second store library. | Map §4 and §21. Undo snapshots stay `Project` only. |
| D14 | In-process tool functions, not a network MCP server. | Map: external MCP is AI-14+. |
| D15 | The Director is attached inside `#inspector-body`. The flag button is `AI` on the inspector chrome. | Map §21 preferred attach point. |
| D16 | Branch name is `cursor/ai-director-d706`. | Cloud agent branch template. The brief's example name is the descriptive part. |
| D17 | `history.undo` is not an AI tool. | Map §19: do not undo a human edit silently. The human uses the existing Undo button. |
| D18 | A move that the core would clamp below 0 ms is rejected instead of clamped. | Clamping would not be an exact move. |
| D19 | `audio.detect_beats` measures onsets from the selected clip's decoded PCM (10 ms hop, 20 ms RMS window). Markers are proposed only at those times. Confidence is the share of gaps within 15% of the median gap. Gaps outside 250–1500 ms, or fewer than three regular onsets, stay labeled Onset. No 120 BPM fallback. No audio loaded means no proposal. | Owner: beats must come from the project's audio, and confidence must be labeled. Model-supplied times are rejected. |
| D20 | A transition request on an audio split adds same-track fades with the existing `setClipFades` command (200 ms, then the existing normalizer). Clip ids are resolved when the step replays, because split mints new ids. Video `Transition` objects are still added only for a real overlapping video pair. | Owner: audio fades count as transitions. |
| D21 | Send context includes the project name, track names, and marker labels. Asset file names, `sourcePath`, object URLs, and media bytes stay out. A path-like name is replaced with `(name withheld)`. The panel shows the JSON. The mock provider still receives `context: null`. | Owner answer 1. |
| D22 | The cloud key stays in memory. An opt-in checkbox writes it through Tauri `keyring` (`com.ailexsi.resonance-studio-v6-0` / `ai-director-api-key`) when that command succeeds. It is never written to localStorage or the bundle. The browser build disables the checkbox. | Owner answer 4. This app is Tauri, not Electron. |
| D23 | Detected marker times are written with `addMarker` on a scratch session whose snap is turned off for that replay and restored before commit. | `addMarker` snaps. Snapping would move a measured onset. |
| D24 | AI-4, AI-5, and AI-6 share commit `cb988ed`. The history was not rewritten. | Owner: splitting that commit is not required, but it must be documented. |
