# AI-5 — Provider adapter

Status: complete.

## What landed

- `AIProvider` with streaming events and tool calls.
- Deterministic mock. It is the default. It does not receive project context and does not call `fetch`.
- OpenAI-compatible adapter. A cloud call needs a runtime key and https. A local call may use `http://127.0.0.1` or `localhost` without a key. Invalid targets return before `fetch`.
- Prefs key `resonance-studio-v6-0-ai-prefs` stores provider, base URL, and model. An `apiKey` field in that JSON is ignored and never written back.
- Send is the only path into the tool loop. One mutation becomes one proposal. Reads can run. Two mutations in one turn are refused.
- The German sentence “Verschiebe den markierten Clip exakt zwei Sekunden nach rechts” proposes `moveClips` with `deltaMs: 2000`.

## What did not land

- No key in the repo, the bundle, or localStorage.
- No telemetry endpoint.
- Beat cuts are refused by the mock. Marker multi-step is AI-6.
- The adapter is not called from playback.

## Tests

- `tests/ai/provider.test.ts`
- `tests/ai/director-flow.test.tsx` — Send, Accept, editor Undo. `fetch` is not called.

## Next

AI-6: one-undo multi-step plans that use marker times only.
