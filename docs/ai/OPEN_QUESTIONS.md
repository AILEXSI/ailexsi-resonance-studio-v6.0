# AI Director open questions

The owner answered the first eight questions on 23 October 2026. The choices are recorded in `DECISIONS.md` (D19–D24) and `phases/OWNER_FOLLOWUP.md`.

1. **Names in Send.** Yes. Project, track, and marker names are included. File paths and media stay out unless the user explicitly attaches them. The panel shows the payload.
2. **Audio fades.** Yes. They are proposed with `setClipFades`. Video `Transition` objects still require an overlapping video edit pair.
3. **`projectRevision`.** Not added. `schemaVersion` stays 5. Stale Apply uses the JSON stand-in plus `history.past.length`.
4. **Secret storage.** Session memory is the fallback. The desktop build can store the key in the OS keychain when the user opts in.
5. **Nudge.** Accepted: `timeline.nudge` snaps; exact moves stay on `timeline.move_clip`.
6. **Phase order.** Accepted: planners do not commit until Accept.
7. **Marker versus beat.** A marker is a beat only when `audio.detect_beats` measured a regular onset grid and labeled the confidence. Other markers stay markers.
8. **Selection while a proposal is open.** Accepted: a selection change does not stale a proposal. A project change does.

Nothing in this list is still waiting on the owner.
