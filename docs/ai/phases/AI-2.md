# AI-2 — Read-only tools

Status: complete.

## What landed

In-process read tools. They return ids, counts, and times. They do not call `applyCommand`.

- `get_project_summary`
- `get_selection`
- `get_playhead`
- `get_clips_on_track`
- `get_markers`
- `list_audio_tracks`

`get_clips_on_track` rejects a missing id and a display name. `"A3"` is not resolved to the third audio lane. Marker labels, track names, asset names, and `sourcePath` are omitted.

## What did not land

No mutation tools, no transaction, no provider, no chat wiring. The shell still cannot call these tools.

## Tests

- `tests/ai/read-tools.test.ts`

## Next

AI-3: proposal-only mutation plans. They do not commit.
