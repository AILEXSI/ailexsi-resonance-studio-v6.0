# V6 AI Director — documentation index

AI-0 remains the authoritative map. Later rows are implementation notes. They do not replace the map.

| File | Role |
| --- | --- |
| [`AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md`](./AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md) | Authoritative V6 map (sections 1–31) |
| [`DECISIONS.md`](./DECISIONS.md) | Conservative choices where the brief and the map differ |
| [`OPEN_QUESTIONS.md`](./OPEN_QUESTIONS.md) | Unresolved questions |
| [`phases/AI-1.md`](./phases/AI-1.md) | Director shell, flag default off |

V5.6 AI-0 recon (`docs/ai-director/` on unmerged branch `cursor/ai-0-recon-architecture-freeze-45e4`, V5.6 PR **#36**) is **non-authoritative reference**. Do not merge it into V6 `main`. Re-verify every claim against this tree.

`schemaVersion` stays 5. `src/core/frame-engine/` is off limits. The Director does not add a second state store, undo stack, or command bus.
