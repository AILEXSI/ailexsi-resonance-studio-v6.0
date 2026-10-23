# AI Director decisions

Conservative choices taken where the brief and `AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md` do not say the same thing. The map stays authoritative for safety. The brief's phase names (AI-1 … AI-6) are the commit labels.

| # | Decision | Why |
| --- | --- | --- |
| D1 | AI-3 builds proposal JSON only. Live `applyCommand` starts in AI-4, after an `AITransaction` exists. | Map §11 and §28: a first mutation without a transaction is unsafe. The brief still requires every live mutation to go through `EditorCommand` → `applyCommand` → `withHistory`. |
| D2 | No `projectRevision` field on `Project`. Stale Apply compares a JSON stand-in of the project plus `history.past.length`. | Map §12. `schemaVersion` stays 5. `updatedAt` is not a revision. |
| D3 | One accepted proposal is one undo step. A multi-step plan is replayed with `applyCommand` on a scratch session, then committed with the existing `withHistory` once. | Map law 7. Looping `applyCommand` on the live session would push N undo entries. |
| D4 | Exact moves use `{ type: "moveClips", deltaMs }`. They do not use `applyMove` or `nudgeClip`. | Those paths snap when `Project.snap` is true. |
| D5 | `timeline.nudge` maps to the existing `nudgeClip` command and the proposal says that snap can change the delta. | The brief names nudge. The map says nudge is not the exact +2.000 s path. |
| D6 | Beat cuts use marker `timeMs` values that are already on the project. No FFT, no onset, no 120 BPM fallback. | The Director must not claim it heard audio. `tempoBpm` is not a beat grid. |
| D7 | Same-track audio splits do not invent transitions. | V6 transitions are overlapping video edit pairs (`resolveEditPair`). |
| D8 | Default provider is an in-process mock. A cloud request is sent only after the user picks that provider, types a runtime key, and clicks Send. | No keys in the repo or bundle. No telemetry. No automatic upload. |
| D9 | `resonance-studio-v6-0-ai-prefs` may store provider id, base URL, and model name. It never stores an API key. | Map §17 allows a base URL there. Keys stay in component memory. |
| D10 | Provider context is `SEND_STRUCTURE`: ids, counts, kinds, start/duration, selection, playhead, marker times. No asset names, track names, marker labels, `sourcePath`, `objectUrl`, PCM, or frames. | Map §25. |
| D11 | Move without an explicit `clipId` requires exactly one selected clip. | Map §22 fail-closed. |
| D12 | Tool ids that are display names (`"Vocals"`, label `"A3"`) are rejected. | `isTrackId("A3")` can be true, but a missing track id is "Track not found". Labels are not resolved. |
| D13 | Director chat state is React state in the panel, the same class of state as the media-bin selection. It is not in `Project` and not a second store library. | Map §4 and §21. Undo snapshots stay `Project` only. |
| D14 | In-process tool functions, not a network MCP server. | Map: external MCP is AI-14+. |
| D15 | The Director is attached inside `#inspector-body`. The flag button is `AI` on the inspector chrome. | Map §21 preferred attach point. |
| D16 | Branch name is `cursor/ai-director-d706`. | Cloud agent branch template. The brief's example name is the descriptive part. |
| D17 | `history.undo` is not an AI tool. | Map §19: do not undo a human edit silently. The human uses the existing Undo button. |
| D18 | A move that the core would clamp below 0 ms is rejected instead of clamped. | Clamping would not be an exact move. |
