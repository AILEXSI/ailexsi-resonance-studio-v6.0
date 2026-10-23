# AI-6 — Multi-step proposals

Status: complete.

## What landed

- A beat request reads project markers. It does not read audio, FFT, onset, or the synthetic 120 BPM fallback.
- No markers: the reply says so, and nothing is proposed.
- Markers: one proposal seeks to each marker that falls inside the single selected clip and splits with the existing `split` command. Marker times outside the clip, or closer than the 50 ms split guard, are skipped and named.
- Accept replays those steps on a scratch session and commits them with one `commitPreparedProject` → `withHistory`. One editor Undo restores the whole cut.
- A request for transitions does not invent a transition. V6 transitions need an overlapping video edit pair. An audio-only song gets an explicit note instead.
- Several selected clips, a locked clip, or a missing clip fail closed.

## What did not land

- No claim that the Director heard the song.
- No same-track audio crossfade. That remains an open product question.
- `projectRevision` is still not on the document.
- Cloud send still happens only after the user picks that provider, supplies a runtime key, and clicks Send.

## Tests

- `tests/ai/marker-plan.test.ts`
- The beat refusal in `tests/ai/provider.test.ts`

## Next

Nothing in AI-1 … AI-6 is left open inside this branch. Later map phases (automation write, render preview, a network MCP server) are out of scope.
