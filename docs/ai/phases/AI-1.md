# AI-1 — Director shell

Status: complete.

## What landed

- Feature flag `resonance-studio-v6-0-ai-director`. Missing storage means off. Only the value `1` turns it on.
- `AI` toggle on the inspector chrome. The panel mounts inside `#inspector-body` under the existing Inspector.
- Chat and proposal placeholders. Send appends the text and a reply that no model is connected.
- The shell component does not receive the session. It cannot call `applyCommand`.

## What did not land

- No model, no tools, no network, no project writes.

## Tests

- `tests/ai/flag.test.ts`
- `tests/ai/director-shell.test.tsx`

## Next

AI-2: in-process read-only tools.
