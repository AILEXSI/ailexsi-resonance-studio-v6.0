# AI Director open questions

The owner was not available. These are unresolved. Work continued with the conservative option in `DECISIONS.md`.

1. **Provider context and names.** Should project name, marker labels, and track display names be included when the user clicks Send? They are omitted (`SEND_STRUCTURE` does not list names). The Director cannot refer to a marker by its label.
2. **Audio transitions.** When someone asks to cut a song and add transitions, should clip fades be offered? They are not offered. V6 `Transition` objects require an overlapping video edit pair.
3. **`projectRevision`.** The map proposes an optional numeric field later, incremented only inside `withHistory`. It is not added. The stand-in compare can false-conflict if a non-AI path clones the project without an undo step, and it can miss a change that restores an identical document at the same history length only if the JSON also matches (then there is nothing to conflict with).
4. **Secret storage.** A session-only password field is used for cloud keys. An OS keychain plugin does not exist. Is that field acceptable until a plugin exists?
5. **Nudge meaning.** The brief lists `timeline.nudge` next to exact move. It is wired to snapping `nudgeClip`. Exact deltas stay on `timeline.move_clip`.
6. **Phase order.** The brief puts mutations (AI-3) before the transaction object (AI-4) and the provider (AI-5). The map puts the provider and the transaction before the first mutation. Execution waits for AI-4. The provider waits for AI-5. Read tools in AI-2 do not call a model.
7. **Marker versus beat.** Markers are the only beat-like data used. A marker is not proof of a musical beat. The reply says that, and does not relabel markers as detected beats.
8. **Selection changes while a proposal is open.** A selection change does not by itself stale the proposal, because the command already captured clip ids. A project change does. Is that the intended rule?
