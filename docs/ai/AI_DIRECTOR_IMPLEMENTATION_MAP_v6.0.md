# AILEXSI Resonance Studio V6.0 — AI Director Implementation Map

**Document:** `docs/ai/AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md`  
**Phase:** AI-0 — architecture mapping only  
**Date:** 2026-09-18  
**Status:** Evidence map. No implementation.

Labels used throughout:

| Label | Meaning |
| --- | --- |
| **FACT** | Verified in this V6 tree at the cited path/symbol |
| **PROPOSAL** | Recommended later-phase design. Not present. Do not treat as shipped |
| **GAP** | Missing capability. Classified G0–G4 in §20 |

**Core principle (binding):**

```text
AI / LLM
  → Provider Adapter
  → Orchestrator
  → Context + Permissions
  → MCP Tool Layer
  → Schema / Semantic Validation
  → AI Transaction
  → Adapter to EXISTING Resonance mechanisms
  → Existing V6 state / commands / undo / engine
```

Resonance owns project, media, timeline, selection, IDs, validation, permissions, transactions, undo, persistence, rendering, and auditability.  
AI is an untrusted probabilistic client of deterministic Resonance capabilities.

**Do not invent** a Command Bus, a second state manager, a second undo engine, an event bus, a new ID scheme, or a persistence store if equivalents already exist. They do.

---

## 1. Executive Summary

**FACT.** V6.0 `main` at tag `v6.0.0-baseline` (`2e39a151c5e260930d3605a2a561f0b9c061d1c7`) is a side-by-side identity continuation of frozen V5.6. Product version **6.0.0**. JSON `schemaVersion` **5** (do not bump). Frame Engine **AILEXSI**. This baseline contains **no** AI Director, **no** MCP, **no** providers, **no** `projectRevision`, **no** AI transaction object.

What already exists and must be reused:

| Capability | Symbol | Path |
| --- | --- | --- |
| Canonical document | `Session.project: Project` | `src/app/session.ts`, `src/core/models.ts` |
| React owner | `useState<Session>` | `src/app/App.tsx` |
| Named commands | `EditorCommand` + `applyCommand` | `src/app/commands.ts` |
| Core mutations | `moveClip`, `trimClip`, `splitAtPlayhead`, … | `src/core/timeline.ts` |
| Undo | `HistoryStack` + `withHistory` + `pushHistory` | `src/core/timeline.ts`, `src/app/session.ts` |
| Stable IDs | `createId(prefix)` | `src/core/ids.ts` |
| Human preview ≠ commit | `dragBaseRef` + live `applyCommand` on empty history | `src/app/App.tsx` |

What does **not** exist (do not pretend otherwise):

- Command Bus object, event bus, `baseRevision` / `currentRevision`
- MCP server, provider SDK, Director UI, credential store
- `effectId`, `automationLaneId`, VIS cue ids, AI transaction / conversation ids
- Settings panel, OS keychain, workers, sidecar process

**First mutation target (PROPOSAL, AI-7):** German prompt *„Verschiebe den markierten Clip exakt zwei Sekunden nach rechts“* → `timeline.move_clip` adapter → `applyCommand({ type: "moveClips", clipIds, deltaMs: 2000 })` → `applyMoveClips` → `moveClip` / `moveClipsByDelta`. **Do not** use `applyMove` or `nudgeClip` for the golden +2.000 s path (those snap when `Project.snap` is true).

**AI-1 entry point (PROPOSAL):** feature-gated Director **shell** only (no model, no tools). Attach to `#inspector-body` or a `ShortcutsOverlay`-style overlay. Mutations later go through `App.runCommand` → `applyCommand`.

V5.6 AI-0 recon (unmerged PR **#36**, branch `cursor/ai-0-recon-architecture-freeze-45e4`) was read as **non-authoritative** reference. Every claim below was re-verified against this V6 tree. That PR is **not** cherry-picked here. Type-only V5.6 contracts are **not** copied into this repo.

---

## 2. Baseline Verification (Phase A)

**FACT.** Working tree at mapping start was clean on `main`.

| Field | Value | Evidence |
| --- | --- | --- |
| Repository | https://github.com/AILEXSI/ailexsi-resonance-studio-v6.0 | `git remote` |
| Branch at start | `main` (this map is on `cursor/ai-0-architecture-mapping-v6-a186`) | `git rev-parse --abbrev-ref HEAD` |
| HEAD / expected | `2e39a151c5e260930d3605a2a561f0b9c061d1c7` | `git rev-parse HEAD` |
| Tag | `v6.0.0-baseline` (annotated tag object `e29af8fb…` → commit `2e39a15`) | `git rev-parse v6.0.0-baseline^{commit}` |
| Reachable | Yes. `origin/main` == HEAD | `git show-ref` |
| Working tree | Clean before docs | `git status --porcelain` |
| productVersion | **6.0.0** | `package.json`, `src/core/build-info.ts` `AILEXSI_PRODUCT_VERSION`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` |
| schemaVersion | **5** | `src/core/project.ts` `PROJECT_SCHEMA_VERSION = 5`; `Project.schemaVersion: 5` in `src/core/models.ts` |
| Frame Engine | **AILEXSI** | `src/core/build-info.ts` `AILEXSI_FRAME_ENGINE`; `getFrameSourceBackend() === "ailexsi"` |
| npm | `@ailexsi/resonance-studio-v6.0` **6.0.0** | `package.json` |
| Tauri | productName `AILEXSI Resonance Studio V6.0`, identifier `com.ailexsi.resonance-studio-v6-0` | `src-tauri/tauri.conf.json` |
| Cargo | `ailexsi-resonance-studio-v6-0` **6.0.0**, lib `ailexsi_resonance_studio_v6_0_lib` | `src-tauri/Cargo.toml` |
| Source freeze | V5.6 `v5.6.0-final` @ `69f4b307fc9b5142a35fe096a814a43e3a07c6b3` | `docs/V6.0-BASELINE.md` |
| V6 identity commit | `37a2cb929469f22658418973f0dae61787aae66e` | `docs/V6.0-BASELINE.md` |
| AI / MCP on baseline | **None** | `docs/V6.0-BASELINE.md`; grep of `src/` |

### Bundle / AppData identity (FACT — V6 side-by-side with frozen V5.6)

| | Frozen V5.6 (untouched) | Active V6.0 |
| --- | --- | --- |
| Tauri identifier / AppData folder | `com.ailexsi.resonance-studio-v5-5` | `com.ailexsi.resonance-studio-v6-0` |
| localStorage / IndexedDB prefix | `resonance-studio-v5-5*` | `resonance-studio-v6-0*` |

V6 does **not** migrate or overwrite V5.6 prefs. Project JSON `schemaVersion` **5** still opens.

Identity tests: `tests/v55/identity.test.ts`.

---

## 3. Repository Topology (Phase B)

**FACT.** Responsibility map, not a file dump.

```text
src/main.tsx                 Vite/React boot → App
src/app/                     Session owner, command dispatch, keyboard, screens
  App.tsx                    useState<Session>, RAF transport, live-drag commits, UI wiring
  session.ts                 Session type, apply* wrappers, withHistory, dirty, import/open
  commands.ts                EditorCommand union + applyCommand
  keys.ts                    Keyboard → EditorCommand (playhead seeks are the documented exception)
  screens.ts                 Arrange vs Cutter visibility
src/core/                    Deterministic domain. No React. No provider SDKs.
  models.ts                  Project / Track / Clip / Marker / VIS types + getters
  project.ts                 create / serialize / deserialize (schema 5, no migrations)
  ids.ts                     createId(prefix)
  timeline.ts                Clip/marker/mix mutations + HistoryStack
  playback.ts                advancePlayhead, shuttle, bounds
  persistence.ts             IndexedDB blobs (resonance-studio-v6-0)
  project-file*.ts           FSA save/open + handle memory
  tauri-project-io.ts        Desktop save/open + last-project + allow_media_paths
  last-project.ts            last-project.json path memory
  media.ts / stem-import.ts  Import + multi-stem place
  audio-tracks.ts            Dynamic A-tracks (min 2, max 64, new ids a_*)
  track-groups.ts            Chapter groups (collapse is UI-only)
  volume.ts / volume-automation.ts / volume-write.ts
  fades.ts / fade-handles.ts / transition.ts / link.ts
  visualizer.ts + visualz/*  VIS scenes, FFT, onset, preview/export parity
  clip-preview.ts            Peak mipmaps (not FFT)
  layout-prefs.ts            localStorage chrome keys (v6-0 prefix)
  exporter/*                 job plan, WebCodecs encode, in-memory mux
  frame-engine/*             AILEXSI demux / decode / stall (OFF-LIMITS for AI)
src/ui/                      Presentation. Calls session/commands via props.
  timeline/  preview/  mixer/  inspector/  transport/  toolbar/
  cutter/    export/   media-browser/  project-file/  screens/  shortcuts/
src-tauri/                   Dialog + scoped FS only. No encode. No shell.
  src/lib.rs                 allow_media_paths + last-project scope grant
  capabilities/default.json  dialog + $APPDATA fs
docs/                        Product stamps, compliance, this AI-0 map
tests/                       vitest/jsdom (see §18)
```

**FACT — absences**

| Expected-by-spec folder | Present? |
| --- | --- |
| `src/ai/` | **No** |
| `src/mcp/` | **No** |
| `src/app/ai/` | **No** |
| Command Bus / event bus module | **No** |

**PROPOSAL** for later placement is in §21. Do not create these folders in AI-0.

---

## 4. Project State (Phase C)

### Canonical owner (FACT)

Runtime owner is **`Session`** (`src/app/session.ts`), held by **`App`** via `useState<Session>` plus `sessionRef` (`src/app/App.tsx`).

Canonical document is **`Session.project: Project`** (`src/core/models.ts`).

There is no Redux, Zustand, MobX, event-sourced store, or Command Bus.

### `Project` fields (FACT — `src/core/models.ts`)

| Field | Type / notes |
| --- | --- |
| `schemaVersion` | literal `5` |
| `id` | `proj_*` |
| `name`, `createdAt`, `updatedAt` | ISO strings; `updatedAt` is a clock stamp, **not** a revision |
| `assets` | `MediaAsset[]` |
| `tracks` | `Track[]` (V1/V2 + audio collection) |
| `groups?` | `TrackGroup[]` |
| `clips` | `Clip[]` (flat; `trackId` FK) |
| `markers` | `Marker[]` |
| `transitions` | `Transition[]` (`src/core/transition.ts`) |
| `playheadMs`, `inPointMs`, `outPointMs`, `loop`, `snap`, `zoomPxPerSec`, `scrollMs` | persisted view/transport fields |
| `visualizer` | `VisualizerState` (events + cues; VIS is **not** a `TrackId`) |
| `frontVideoTrackId` | `"V1"` \| `"V2"` |
| `masterVolume` | linear |

### Tracks / clips / automation / effects / markers / media (FACT)

| Entity | Storage | Notes |
| --- | --- | --- |
| Tracks | `Project.tracks` | `kind` video/audio; mute/solo/volume/pan; optional `groupId`, `volumeAutomation` |
| Clips | `Project.clips` | `startMs`, `durationMs`, `sourceInMs`/`sourceOutMs`, `gain`, fades, `rate`, optional `linkId`/`enabled`/`locked` |
| Volume automation | `Track.volumeAutomation` | `{ enabled, points: [{ timeMs, value }] }`. Linear gain. No lane id |
| Legacy automation | `Track.automationLanes` | D stub; hydrated into G on deserialize |
| Effects rack | **Absent** | Transitions are the only structured “effect-like” objects |
| Markers | `Project.markers` | `{ id, timeMs, label }` |
| Media | `Project.assets` + IndexedDB `blobId` | `objectUrl` session-only; `sourcePath` optional disk |
| Groups | `Project.groups` + `Track.groupId` | Collapse in localStorage, not the document |
| VIS | `Project.visualizer` | events have ids; cues do **not** |
| Transitions | `Project.transitions` | `tr_*`; pair of clip ids |

### Schema / serialize / load / save (FACT)

| Step | Symbol | Path |
| --- | --- | --- |
| Schema constant | `PROJECT_SCHEMA_VERSION = 5` | `src/core/project.ts` |
| Create | `createEmptyProject` | `src/core/project.ts` → `createId("proj")`, `defaultTracks()` |
| Session wrap | `createSession` | `src/app/session.ts` |
| Serialize | `serializeProject` / `projectJson` | strips `objectUrl`, marks assets `missing: true`, stamps `updatedAt` |
| Deserialize | `deserializeProject` | **throws** `ProjectFormatError` if `schemaVersion !== 5` |
| Open session | `openSerialized` | resets history + selection + volume-write |
| Hydrate blobs | `hydrateProject` / `hydrateSession` | `src/core/persistence.ts` |
| Browser save/open | `runSave` / `runSaveAs` / `runOpen` | `src/core/project-file.ts` |
| Handle memory | `createIndexedDbProjectFileStore` | DB `resonance-studio-v6-0-project-file` |
| Tauri save/open | `tauriSaveProject` / `tauriOpenProject` | `src/core/tauri-project-io.ts` |
| Last path | `last-project.json` | AppData `com.ailexsi.resonance-studio-v6-0` |
| Dirty | `isProjectDirty` | history lengths vs `savedPastLength` / `savedFutureLength` |

**Migrations: none (FACT).** Load-time sanitization only: legacy `automationLanes` → G; missing `groups` → `[]`; missing marker ids → `createId("mk")`; unknown-track clips dropped after `ensureAudioTracksForIds`; `blob:` URLs stripped.

### Legal mutations (FACT)

Pure project transforms live in `src/core/*` and return a new `Project` (or `{ project, error? }`). Session wrappers in `src/app/session.ts` call `withHistory` when the edit is undoable. Named dispatch is `applyCommand` in `src/app/commands.ts`.

Primary core mutation modules:

- `src/core/timeline.ts` — move/trim/split/delete/paste/markers/mix/snap/IN-OUT
- `src/core/volume-automation.ts` — G envelope
- `src/core/volume-write.ts` — W punch (commit only)
- `src/core/visualizer.ts` — VIS events/cues/split
- `src/core/transition.ts` — `upsertTransition`
- `src/core/audio-tracks.ts` / `src/core/track-groups.ts`
- `src/core/link.ts` — A/V link remap
- `src/core/fades.ts` — fade normalize

---

## 5. Identity Model (Phase D)

**FACT.** Generator: `createId(prefix)` in `src/core/ids.ts` → `` `${prefix}_${crypto.randomUUID()}` `` (fallback time+rand).

**PROPOSAL:** reuse these IDs. Do not invent a parallel scheme. Tools reject display names (`"Vocals"`, label `"A3"`).

| Object | Field | Type | Created by | Persisted? | Stable save/load/undo? | Copy/paste | AI-safe? | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Project | `Project.id` | `proj_*` | `createEmptyProject` | Yes | Yes | N/A | Yes | — |
| Video track | `Track.id` | `"V1"` / `"V2"` | `defaultTracks` | Yes | Yes | N/A | Yes | Fixed two picture lanes |
| Audio track (legacy) | `Track.id` | `"A1"` / `"A2"` | `defaultTracks` | Yes | Yes | N/A | Yes | Do not confuse with label |
| Audio track (new) | `Track.id` | `a_*` | `createAudioTrack` → `createId("a")` | Yes | Yes | N/A | Yes | Label `A3+` **≠** id |
| Clip | `Clip.id` | `clip_*` | `placeAsset`, `splitClipAt`, `pasteClips` | Yes | Yes | **New** ids on paste | **Yes — primary target** | — |
| Media asset | `MediaAsset.id` | `asset_*` | `importMediaFile` | Yes | Yes | Clipboard refs existing assets | Yes | — |
| Blob | `MediaAsset.blobId` | usually = asset id | import | Yes | Yes | N/A | Yes | Never a `blob:` URL |
| Object URL | `objectUrl` | session URL | hydrate | **No** | No | N/A | **No** | Not an identity |
| Link pair | `Clip.linkId` | `link_*` | `placeAsset` / split / `remapPastedLinkIds` | Yes | Yes | Remapped if pair intact | Yes | Locking one side does not lock mate |
| Marker | `Marker.id` | `mk_*` | `addMarker`; deserialize may mint if missing | Yes | Yes if present | N/A | Yes if present | Missing id regenerated on load |
| Transition | `Transition.id` | `tr_*` | `upsertTransition` | Yes | Yes | N/A | Yes | Also implied by clip pair |
| Track group | `TrackGroup.id` | `g_*` or stem prefix | `createTrackGroup` / `inferStemGroupId` | Yes | Yes | N/A | Yes with care | Stem prefix may collide with `g_*` |
| VIS event | `VisualizerEvent.id` | `ve_*` | `insertVisualizerEvent` / rematerialize | Yes | Yes with care | New id on paste | Yes with care | Rematerialize may reuse id |
| VIS cue | **none** | `startMs` + `sceneId` | `upsertCueList` | Yes (array) | Positional | Scene+duration only | **No** as a tool target | **GAP** |
| VIS scene | `sceneId` | catalog string | catalog | Yes | Yes as type | N/A | Yes as type, not instance | `SceneParams` not in Project |
| Automation lane | **none** | track-owned envelope | — | Envelope on track | N/A | N/A | Use `trackId` + volume | Spec `automationLaneId` does not exist |
| Automation point | **none** | `timeMs` | `addVolumeAutomationPoint` | Yes | Time is the key | N/A | Use `trackId`+`timeMs` | Move changes identity |
| Effect | **none** | — | — | — | — | — | — | **Does not exist** |
| Export job | `ExportJob.id` | `job_*` | `jobFromProject` | **No** | No | N/A | Session-only | Not addressable across runs |
| History entry | none | snapshot | `pushHistory` | No | N/A | N/A | No | Not a command id |
| AI transaction / conversation | none | — | — | — | — | — | — | **GAP G3/G4** |

`isTrackId("VIS")` and `isTrackId("master")` are **false** (`src/core/models.ts`).

---

## 6. Timeline Mutation Paths (Phase E)

**FACT.** Two production patterns:

1. **Named command:** UI / keys → `App.runCommand` / `dispatchEditorKey` → `applyCommand` → `apply*` → core → `withHistory`.
2. **Live drag:** `dragBaseRef` holds pre-gesture `Session`; live frames call `applyCommand` on a session with **empty** history; pointer-up pushes `structuredClone(base.project)` onto `history.past`.

`EditorCommand` is **used in production**, not reserved. Comment at `src/app/commands.ts`:

> Named editor commands. UI keys/toolbar and a future AI path share this dispatch.

### Operation table (FACT)

| Operation | UI | Dispatch | Core | Validation | Undo | Persist JSON | Playback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Move (keyboard) | `,` `.` / `nudgeClip` | `{ type: "nudgeClip", deltaMs }` → `applyNudge` | `moveClipsByDelta` | locked / none | `withHistory` | Yes | Re-render |
| Move (command) | — | `{ type: "moveClips", clipIds, deltaMs }` → `applyMoveClips` | `moveClip` / `moveClipsByDelta` | locked, kind, clamp ≥0 | `withHistory` | Yes | Re-render |
| Move (absolute helper) | unused by keys | `applyMove` (**not** in `EditorCommand`) | `moveClip` after optional **snap** | same | `withHistory` | Yes | Re-render |
| Move (drag) | `Timeline.onClipPointerDown` → `onMoveLive` / `onMoveCommit` | live `moveClips` on empty history | `moveClip` | snap in App before preview | **manual** push on commit | On commit | Re-render |
| Split | S / Transport Split / context | `{ type: "split" }` → `applySplit` | `splitAtPlayhead` / VIS split | playhead strictly inside; `activeEditTrackIds` | `withHistory` | Yes | Re-render |
| Trim (lift) | edge drag | live `{ type: "liftTrim" }`; commit manual | `trimClip` | locked, 50 ms guard, source bounds; snap if `Project.snap` | commit | On commit | Re-render |
| Ripple trim | Shift-edge; Q / Alt+W | `{ type: "rippleTrim" }` / `rippleTrimToPlayhead` | `rippleTrimClip` | disabled refuse; locked wall | `withHistory` / commit | Yes | Re-render |
| Delete | Delete / Backspace | `{ type: "liftDelete" }` → `applyDelete` | `deleteClips` / VIS / marker / range | selection fallbacks | `withHistory` | Yes | Re-render |
| Copy | Ctrl+C | `{ type: "copy" }` | session `clipboard` only | — | No | No | — |
| Cut | Ctrl+X | `{ type: "cut" }` | copy + `deleteClips` | — | **one** `withHistory` | Yes | Re-render |
| Paste | Ctrl+V | `{ type: "paste" }` | `pasteClips` | empty clipboard; VIS vs clip | `withHistory` | Yes | Re-render |
| Gain | Inspector | `applyUpdateClip` (**not** `EditorCommand`) | `updateClip` (gain 0–4) | clamp | `withHistory` | Yes | `Preview.gainAtClipTime` |
| Fades | handles / Inspector | `{ type: "setClipFades" }` | `setClipFades` | normalize | drag-commit / `withHistory` | Yes | Re-render |
| Mute / solo | M / S | `{ type: "toggleMute" \| "toggleSolo" }` | `toggleTrackMute` / `toggleTrackSolo` | track exists | **No** | Yes | audible flags |
| Static volume | Mixer fader | `applyMixerVolume` (not command) | `setTrackVolume` | write-arm may divert | **No** (unless W commit) | Yes | live gains |
| Pan | Mixer | `{ type: "setTrackPan" }` | `setTrackPan` | clamp −1..1 | **No** | Yes | tap pans |
| Markers | M / drag | add/rename/delete commands; live `applyMoveMarker` | `addMarker` / `moveMarker` | snap on move | add/rename/delete yes; **live move no** until commit | Yes | seek on select |
| Transitions | Cutter / Inspector / overlap handles | `setTransition*` | `upsertTransition` | edit pair | mixed | Yes | `compositeVideoAt` |
| VIS events | VIS lane | `insertVisEvent` / live move/stretch | `visualizer.ts` | — | insert yes; drag on commit | Yes | Re-render |
| Place asset | bin / drop | `applyPlaceAsset` (not command) | `placeAsset` | snap | `withHistory` | Yes | seek to start |
| Stem import | multi audio Import | `importFiles` → `importStemAudioFiles` | `placeAsset` + `addAudioTrack` | cap 64 | one `withHistory` | Yes | seek stem start |

`moveClip` errors (reuse as semantic validation — do not rewrite): `"Clip not found"`, `"Clip is locked"`, `"Cannot move clip to a different kind of track"`. Linked mate moves by the same delta unless `skipLink`.

### UI-direct / incomplete command coverage (FACT — flags)

| Path | Issue for AI reuse |
| --- | --- |
| `applyMove` | Snaps when `Project.snap`. **Not** in `EditorCommand` |
| `applyNudge` | Snaps toward next target. Keyboard uses `FRAME_MS` (1000/30), not 2000 |
| Drag live | Bypasses `withHistory` until commit (correct for humans; AI needs a transaction object) |
| `applyUpdateClip` (gain/timing) | Undoable but **not** an `EditorCommand` |
| Mixer static volume / mute / solo / pan / master | Persist, **not** undoable |
| VIS scene pick / cycle | Often no history |
| Loop IN/OUT live drag | Direct `setInPoint` / `setOutPoint` / `moveInOut` |
| Playhead / scroll / zoom / follow | View; no history |

**GAP G2:** extract `setClipGain` (or wrap `applyUpdateClip`) **before** exposing `audio.set_gain`. Do not have the tool call Inspector state.

---

## 7. Selection Model (Phase F)

**FACT.** Selection is **session view state**, not project JSON (except playhead / IN-OUT / loop / snap / zoom / scroll, which **are** on `Project`).

| Concern | Storage | Read | Set |
| --- | --- | --- | --- |
| Selected clips | `Session.selectedClipIds` (source of truth), `selectedClipId` (primary) | `selectionOf` | `applySelect` / `applySelectClips` / `{ type: "select" \| "selectClips" \| "selectAll" }` |
| Shift-range anchor | `Session.selectionAnchorClipId` | — | plain click |
| Selected tracks | `Session.selectedTrackIds`; fallback `targetTrackId` | `activeEditTrackIds` | `applySelectTracks`; clip click sets track |
| Active / focused track | `Session.targetTrackId` | — | last lane/mixer/clip/vol-point |
| Playhead | `Project.playheadMs` | — | `applyPlayhead` → `setPlayhead` |
| Time selection | `Project.inPointMs` / `outPointMs` / `loop` | — | `applyIn` / `applyOut` / overlay drag |
| Viewport | `Project.scrollMs`, `Project.zoomPxPerSec` | — | `applyScroll` / `applyZoom` / `applyFit` |
| Follow / width | `Session.followPlayhead`, `timelineWidthPx`, `timelineLaneLabelPx` | — | `applyToggleFollow` / `applyTimelineViewport` |
| Marker | `Session.selectedMarkerId` | — | `applySelectMarker` (seeks) |
| VIS | `selectedVis`, `selectedVisEventId(s)` | — | `applySelectVis*` |
| Vol point | `Session.selectedVolumeAutomation { trackId, timeMs }` | — | `applySelectVolumeAutomationPoint` |
| Marquee | Timeline React state | — | pointer |
| Media bin asset | `App` React `selectedAssetId` | — | `setSelectedAssetId` |
| Layout chrome | localStorage `resonance-studio-v6-0-*` | `layout-prefs.ts` | fold/split handlers |

Selecting clips clears VIS / vol-point (via `withClipSelection`). Selecting VIS clears tracks.

**PROPOSAL:** `timeline.get_selection` reads `selectionOf(session)` + VIS/marker/vol-point fields. Do not persist selection into `schemaVersion` 5.

---

## 8. Playhead and Transport (Phase G)

**FACT.**

| Item | Owner | Path |
| --- | --- | --- |
| Playhead time | `Project.playheadMs` | `src/core/models.ts` |
| Playing / shuttle | `Session.playing`, `Session.shuttleRate` | `src/app/session.ts` |
| Advance | `advancePlayhead(project, deltaMs)` | `src/core/playback.ts` |
| RAF owner | `App.tsx` (not `Preview.tsx`) | `src/app/App.tsx` |
| Play/pause/stop | `{ type: "play" \| "pause" \| "playPause" \| "stop" }` | `applyPlay` / `applyPause` / `applyStop` |
| Space | `keys.ts` → `playPause` | — |
| J/K/L | `applyShuttle` + `nextShuttleRate` | `src/core/playback.ts` |
| Frame step | `FRAME_MS = 1000/30` | `src/core/models.ts` |
| Seek | `applyPlayhead` (keys Home/End, ruler, timecode, cutter ticks) | **not** an `EditorCommand` |
| Snap seek | `snapPlayheadSeek` | `src/core/timeline.ts` |
| Follow | `Session.followPlayhead` (default true) | pins ~65%, then `scrollMs` |
| Loop | `Project.loop`; wrap OUT→IN when on; OUT is a marker when off | `advancePlayhead` |
| Preview RAF | mixer peaks + VIS paint only | `src/ui/preview/Preview.tsx` |

**FACT.** The transport RAF path has **no** `fetch` / `invoke`. Preserve this. Playhead must never automatically cause network traffic.

`Preview.tsx` may `fetch(blob:…)` once to decode PCM for VIS — local, not a provider call.

---

## 9. Audio Analysis Capabilities (Phase H)

**FACT.** Analysis is for VIS + meters. Nothing is persisted into the project file.

| Capability | Symbol | Path | Live vs offline |
| --- | --- | --- | --- |
| First audible clip at t | `analysisAudioClipAt` | `src/core/models.ts` | deterministic |
| Live tap | `createPlaybackTap` | `src/core/visualz/playback-tap.ts` | AnalyserNode — **non-deterministic** |
| Live extractor | `createFeatureExtractor` | `src/core/visualz/feature-extractor.ts` | live |
| Offline extractor | `createOfflineFeatureExtractor` / `offlineExtractorFor` | same | deterministic PCM |
| Shared assemble | `assembleAudioFeatures` | same | both |
| Presentation | `applyVisResponse` / `presentVisualizerFeatures` | `vis-response.ts`, `visualizer.ts` | both |
| FFT | `src/core/visualz/fft.ts` | 2048 FFT → 1024 bins | offline matches Analyser mapping |
| Queryable | `rms`, `bass`, `mid`, `treble`, `spectrum`, `onset`, `beatPulse`; presented `energy`/`high` | `src/core/visualz/types.ts` | — |
| Tempo | `tempoBpm` null on real audio; **120** only in synthetic fallback `featuresAt` | `visualizer.ts` | not a beat grid |
| Clip waveform | `buildPeakMipmap` / `envelopeForWidth` | `src/core/clip-preview.ts` | peaks, not FFT |
| Mixer peaks | `playback-tap.peaks()` | live 512-sample | not stored |

Silence gate: `rms < 0.02 && bass < 0.03` (VIS / CURRENT.md). Onset: energy delta `0.12`, refractory 120 ms. Not a DAW tempo lock.

**PROPOSAL:** `audio.get_analysis` must use the **offline** extractor. Omit raw `spectrum` and PCM by default (see §25). Do not send live AnalyserNode values to a provider.

---

## 10. Automation (Phase I)

**FACT.** Volume only. HUMAN-PROVEN G/H inherited from V5.6. Schema stays 5.

| Item | Symbol | Path |
| --- | --- | --- |
| Model | `Track.volumeAutomation?: VolumeAutomation` | `src/core/models.ts` |
| Points | `{ timeMs, value }` linear, `1 = 0 dB` | — |
| Interp | `automationValueAt` — linear between points; hold before first / after last; disabled/empty → unity | `src/core/volume-automation.ts` |
| Effective mix | `clipGain × staticTrackVolume × automationValueAt(t)` (+ master / mute / fades) | `volume.ts`, Preview, export |
| Point edit | `add` / `move` / `delete` / `setVolumeAutomationEnabled` | commands + core |
| Write W | `volume-write.ts` gesture buffer; punch on idle/up/stop | session-only arm |
| Mixer fader | static `Track.volume` unless W gesture | **not** undoable |
| Pan / EQ / FX automation | **Absent** | `Track.pan` is static |

**PROPOSAL:** `automation.read` → `volumeAutomationOf` + optional time filter. Address by `trackId` (audio only). Do not invent `automationLaneId`. Write tools are **not** the first slice (AI-10).

---

## 11. Undo / Redo / History (Phase J)

**FACT.**

```text
HistoryStack { past: Project[]; future: Project[] }     src/core/timeline.ts
pushHistory  = structuredClone(current project) onto past; clear future
withHistory  = push current, then assign nextProject     src/app/session.ts (private)
applyUndo / applyRedo                                    abort volume-write first
```

What is snapshotted: the **entire `Project`**.  
What is **not**: selection, clipboard, playing, follow, W arm/gesture, layout prefs.

Compound grouping today:

| Pattern | One undo? |
| --- | --- |
| Single `withHistory` / single `applyCommand` that uses it | Yes |
| `applyCut` (copy+delete) | Yes (intentional) |
| Stem import / place-many | Yes (one push at end) |
| Drag commit | Yes (one manual push of **base**) |
| W punch | Yes (one gesture) |
| N sequential `applyCommand` / `runCommand` | **N undo steps** |

**GAP G2:** no `applyCommandBatch` / transaction flag.  
**PROPOSAL:** an AI transaction becomes one semantic undo by applying N **core** mutations to a working `Project`, then **one** `withHistory(session, finalProject, "AI — …")`. Do **not** loop `runCommand`. Do not ship multi-command Apply on N history entries and call it a transaction.

No max history depth. `revertToLastSave` walks undo with a 10_000-iteration guard.

---

## 12. Project Revision / Concurrency (Phase K)

**FACT.**

| Field | Exists? | May it be used as revision? |
| --- | --- | --- |
| `baseRevision` / `currentRevision` / `etag` | **No** | — |
| `schemaVersion` | Yes, **5** | **No** — document format |
| `updatedAt` | Yes, ISO on many mutations | **No** — clock, not monotonic edit counter |
| Dirty | history lengths vs save checkpoint | Not a revision |

Single in-memory `Session`. Save overwrites the remembered path. No merge, no multi-writer, no optimistic lock.

**GAP G3** for stale Apply: without `projectRevision`, `TRANSACTION_CONFLICT` cannot be implemented honestly.

**PROPOSAL (later, AI-6):** add `projectRevision: number` incremented **only** inside `withHistory` / drag-commit / W-commit (the same moments a snapshot is pushed). Store `baseRevision` on the AI transaction. On Apply, reject if `session.project` revision ≠ base. **Do not** bump schema to do this if the field can be additive and optional (missing = 0). If a schema bump is ever required, that is a **separate** product decision — **not** AI-0 and **not** silently in AI-1.

Until that field exists, AI Apply must fail closed on any concurrent human edit detected by identity of the pre-preview `Project` snapshot (compare `structuredClone` base vs current), or simply deny Apply if `history.past.length` changed. Snapshot compare is a **temporary** stand-in, not a revision API.

---

## 13. Preview / Temporary State (Phase L)

**FACT.** Ranked existing mechanisms (reuse; do not build a shadow engine):

| Rank | Mechanism | Path | Canonical mutated? |
| --- | --- | --- | --- |
| 1 | `dragBaseRef` + live `applyCommand` on empty history | `App.tsx` `onMoveLive` / `onMoveCommit` | Live frames write `session.project` **without** history; commit uses **base** |
| 2 | Cloned project for vol-point drag | `previewMoveVolumeAutomationPoint` | Live write; commit history |
| 3 | W gesture buffer | `Session.volumeWriteGesture` | **Must not** clone/push/persist until `applyCommitVolumeWrite` |
| 4 | Simulate `applyCommand` on `structuredClone(session)` | mechanically free | No named API |
| 5 | Second media engine / worker graph | **Absent** | Do not build |

**Honest limitation (FACT):** human clip-drag **does** assign preview positions onto `session.project` during the gesture (playback/timeline show the live position). History is the commit boundary, not a shadow document. Mute / scene pick / static fader commit immediately — **unsuitable** as the AI preview model.

**PROPOSAL (AI-6/7):** AI preview holds a **draft `Project`** (clone + `moveClip`) and paints it with the drag-overlay pattern **without** assigning `session.project` until Apply. If the first slice must reuse drag-base literally, document that playback will show the draft — still one undo on Apply, and Reject restores `dragBaseRef` / drops the draft.

Cutter `CutStrip` is read-only ticks + seek. Marquee is selection-only.

---

## 14. Render / Export (Phase M)

**FACT.** In-process WebCodecs + AILEXSI Frame Engine. Tauri does **not** encode.

| Stage | Where |
| --- | --- |
| Plan | `jobFromProject` → ephemeral `createId("job")` | `src/core/exporter/job.ts` |
| Video decode | AFE `VideoDecoder` | `src/core/frame-engine/*` |
| Video encode | `VideoEncoder` AVC | `src/core/exporter/webcodecs.ts` |
| VIS | Canvas2D `renderVisualizerScene` | `src/core/visualizer.ts` |
| Audio mix / AAC | `OfflineAudioContext` + `AudioEncoder` | `src/core/exporter/audio.ts` |
| Mux | `muxAvcToMp4` full file in memory | `src/core/exporter/mp4.ts` |
| Extra copy | `new Uint8Array(bytes.byteLength)` | `webcodecs.ts` ~860 |
| Write | Tauri fs / FSA / download | destination helpers |

`getFrameSourceBackend()` production default `"ailexsi"`. Mediabunny removed. `htmlvideo` is test-only.

### Inherited limitations — document, do **not** silently fix (FACT)

| Item | Status |
| --- | --- |
| **~160 min mux ArrayBuffer allocation failure** | **NOT HUMAN-PROVEN fixed.** In-memory mux + `Uint8Array` copy can fail to allocate for a very large MP4. Do not invent 120/160 min HUMAN-PROVEN. |
| **AUDIO-02 / 2 h streaming** | **NOT IMPLEMENTED.** 120 min mix PCM remains RED in AUDIO-01 notes (~2.4 GiB Float32). |
| HUMAN-PROVEN long-form (do not invent new figures) | **~34:18**, **~64 min**, **~90 min (01:30:30)** VIDEO+VIS+AAC; ENC-01 1080p24/25/30; AUDIO-01 **~29:11** |
| STRESS-04 | Fixed **argument-count** overflow in mux helpers — **not** streaming, **not** allocation ceiling |

**AI-0 rule:** do not modify render/media behavior. `render.preview` (AI-13) may later read `jobFromProject` only. It must not enter AFE internals, must not block the UI thread as chat, and must not claim mux/streaming fixes.

---

## 15. Process Boundaries (Phase N)

**FACT.**

```text
One JS heap (Vite :1421 or WebView2)
  React UI          src/ui, src/app/App.tsx
  Session/commands  src/app
  Domain            src/core
  Preview media     HTMLMediaElement + AudioContext tap
  Export/AFE        WebCodecs on the same thread
IndexedDB           media blobs + FSA memory
localStorage        layout prefs
Tauri Rust          dialog + scoped $APPDATA + allow_media_paths
Workers / WASM / sidecar / child processes     ABSENT
Shell plugin                                   ABSENT
```

**PROPOSAL — where future AI components should live (repo conventions, not a blind `src/ai/` assumption):**

V5.6 ADR-003 proposed a new top-level `src/ai/`. This V6 tree has **no** such folder. The existing mutation entry is `src/app/commands.ts`. UI panels live under `src/ui/*`. Core is reserved for deterministic media/timeline.

| Component | Proposed home | Why |
| --- | --- | --- |
| Director panel | `src/ui/director/` | Matches `inspector/`, `shortcuts/` |
| Feature flag + host wiring | `src/app/ai/` (next to `commands.ts` / `session.ts`) | Shares `EditorCommand` without a second bus |
| Tool handlers | `src/app/ai/tools/` | Thin adapters → `applyCommand` / getters |
| Provider adapters | `src/app/ai/providers/` | **Never** imported by `src/core` |
| Permissions / transactions | `src/app/ai/transactions/` | Wrap `withHistory`; do not fork timeline |
| Isolation alternative | top-level `src/ai/` | Acceptable later if a process boundary is added; **not** required for AI-1–7 |

**Forbidden imports:** provider SDKs inside `src/core/timeline.ts`, `playback.ts`, `frame-engine/*`, `exporter/*`.  
**Do not** create `src/mcp/server.ts` in early phases (in-process function table first).

Tauri stays FS/dialog unless a later secret plugin is added (§17).

---

## 16. Network Capabilities (Phase O)

**FACT.**

| Mechanism | Production use |
| --- | --- |
| `fetch(` | `src/core/frame-engine/backend.ts` (media bytes), `src/core/exporter/media.ts` (blob/object URLs) |
| `invoke(` | **One** call: `allow_media_paths` in `src/core/tauri-project-io.ts` |
| WebSocket | **Absent** in `src/` |
| MCP / OpenAI / Ollama / llama.cpp client | **Absent** in `src/` |
| Playhead RAF | **No** network |

**PROPOSAL:** provider HTTP (cloud or localhost OpenAI-compatible) is added only inside `src/app/ai/providers/`, gated, never on the RAF path. CSP is currently `null` in `tauri.conf.json` — do not treat that as permission to open arbitrary nets from core.

---

## 17. Credential Storage Recommendation (Phase P)

**FACT.** No Settings UI. No OS keychain. No `apiKey` fields in `src/`.

Existing stores (all unsuitable for secrets):

| Store | Contents |
| --- | --- |
| localStorage `resonance-studio-v6-0-*` | layout |
| localStorage `ailexsi.vis-browser-pos` | VIS browser chrome (prefix mismatch; not secrets) |
| IndexedDB `resonance-studio-v6-0` | media blobs |
| IndexedDB `resonance-studio-v6-0-project-file` | FSA handles / last path memory |
| AppData `last-project.json` | `{ path, name }` only |
| Project JSON | `schemaVersion` 5 document |

**PROPOSAL (do not implement in AI-0):**

1. **LAW-11:** secrets never enter project JSON, undo snapshots, stall dumps, export-fail text, prompts, Git, or `Session.status`.
2. Prefer OS credential storage via a **new** Tauri plugin + capability (narrow, not wholesale FS).
3. Until a plugin exists, **deny** cloud-provider enablement (fail closed) rather than writing keys to `$APPDATA` plaintext — unless a later ADR explicitly accepts an encrypted local file **outside** the project document.
4. Local OpenAI-compatible endpoints (Ollama / LM Studio / llama.cpp) typically need a **base URL**, not a secret. Store that in a dedicated AI prefs key (`resonance-studio-v6-0-ai-prefs`), never in `Project`.
5. Do not reuse V5.6 AppData.

---

## 18. Test Architecture (Phase Q)

**FACT.**

| Item | Value |
| --- | --- |
| Runner | vitest via `npm test` (`vitest run`) |
| Config | `vite.config.ts` — `environment: "jsdom"`, `include: tests/**/*.test.ts(x)`, `setupFiles: tests/setup.ts` |
| Typecheck | `npx tsc --noEmit` (`tsconfig.json`) |
| Bundle | `npx vite build` |

`tests/` layout: `app/` (commands, keys, dirty, write-runtime), `core/`, `timeline/`, `layout/`, `media/`, `mixer/`, `persistence/`, `preview/`, `inspector/`, `ui/`, `visualizer/`, `export/` (AFE/STRESS/ENC/AUDIO), `v55/` (V6 identity), `foundation/`, `helpers/`, `fixtures/`.

### Future AI / MCP test hooks (PROPOSAL)

Reuse, do not invent a parallel harness:

| Hook | Why |
| --- | --- |
| `applyCommand(session, command)` | Pure; already covered by `tests/app/commands.test.ts` |
| `moveClip` / `moveClipsByDelta` | `tests/timeline/*` |
| `selectionOf` + `withClipSelection` | selection tests |
| `isProjectDirty` / `withHistory` | `tests/app/project-dirty.test.tsx` |
| `createOfflineFeatureExtractor` | visualizer / VIS-SYNC tests |
| Identity | `tests/v55/identity.test.ts` — must stay green; schema stays 5 |

**PROPOSAL golden tests (AI-7, not now):** 12 consecutive `moveClips` +2000 ms with `snap: true` still yields **exact** +2000 (adapter must not call `applyMove`/`applyNudge`). Undo once restores `startMs`. Reject leaves history unchanged.

### Inherited failing tests (FACT — recorded on V6 baseline)

From `docs/V6.0-BASELINE.md` at identity tip: full suite **1389 passed / 6 failed / 1395**.

| Failures | Cause |
| --- | --- |
| `tests/export/afe-15-exact-pts-tail-ownership.test.ts` A + N | Dump-ban regex `/VIS\|BLACK\|null/` trips on ledger `visFrames` / `blackFrames` |
| `tests/export/stress-03-physical-source.test.ts` H–K | Operator clip not in this VM (`STRESS03_CLIP`) |

AI-0 must not “fix” these. Re-record the live suite in §30.

---

## 19. MCP Tool Reuse Matrix (Phase R)

**FACT.** No MCP server. Data/functions below **exist**. Tools do **not**.

**PROPOSAL:** in-process function table first (same schemas later used by MCP). Handlers translate; they do not reimplement `moveClip` or AFE.

### Read tools

| Tool | Grant | Current source | Function | ID requirements | Output available? | Missing | Risk | Gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `project.describe` | READ | `Session.project` | `Project.id/name`, `projectDurationMs`, `trackIdsOf` | none | Partial — no revision | `ProjectSummary` DTO | Low | G1 |
| `timeline.describe` | READ | `tracks` / `clips` | `orderedTracks`, `clipsOnTrack` | optional range ms | Yes as arrays | Compact DTO | Over-share if unscoped | G1 |
| `timeline.get_selection` | READ | `Session` | `selectionOf`, VIS/marker/vol-point | none | Yes | Map to a snapshot type | Selection not in JSON | G1 |
| `timeline.get_clip` | READ | `Project.clips` | `clipById` | stable `clipId` | Yes (`Clip`) | Reject unknown / display name | Hallucinated id | G1 |
| `audio.get_analysis` | READ | extractors | `analysisAudioClipAt`, offline `AudioFeatures` | `clipId` and/or `timeMs` | Yes | Summary DTO; omit spectrum/PCM | Live tap non-deterministic | G1 |
| `automation.read` | READ | `Track.volumeAutomation` | `volumeAutomationOf`, `automationValueAt` | `trackId` + optional ms | Yes | No lane id | Video track / wrong kind | G1 |

### Mutation tools (phased)

| Tool | Phase | Maps to | Ready to wrap? | Notes |
| --- | --- | --- | --- | --- |
| `timeline.move_clip` | **AI-7 first mutation** | `applyMoveClips` / `moveClip` **without snap** | **Yes** (core + command) | Golden +2.000 s. Seconds→ms at boundary |
| `timeline.split_clip` | later | `{ type: "split" }` → `splitAtPlayhead` | Yes | Needs playhead or explicit ms |
| `timeline.delete_clip` | later | `{ type: "liftDelete" }` | Yes | Selection vs explicit id policy |
| `timeline.set_fade` | later | `{ type: "setClipFades" }` | Yes | — |
| `audio.set_gain` | later | `applyUpdateClip` today | **No** — extract command first | MIG-style |
| `automation.write` | AI-10 | point commands / not W | Partial | Volume only |
| `history.undo` / `redo` | later | `{ type: "undo" \| "redo" }` | Yes | Must not undo a human edit silently |
| `render.preview` | AI-13 | `jobFromProject` only | Partial | Do not call AFE; inherited mux/AUDIO-02 limits |

**PROPOSAL units:** tool JSON may use seconds; Resonance is **milliseconds**. Adapter: `targetStartMs = Math.round(targetStartSeconds * 1000)`.

---

## 20. Gap Classification G0–G4 (Phase S)

| Class | Meaning |
| --- | --- |
| **G0** | Exists. Reuse as-is. Inventing a parallel layer is the risk |
| **G1** | Exists. Thin typed adapter / DTO only |
| **G2** | Partial. Small missing API on top of a proven pattern |
| **G3** | Missing and required before a safe first mutation / stale-Apply |
| **G4** | Missing, high-risk, or later-phase. Do not invent in AI-1–7 |

| Capability | Class | Current | Later work |
| --- | --- | --- | --- |
| Canonical `Session.project` | **G0** | `session.ts` / `App.tsx` | None |
| `EditorCommand` + `applyCommand` | **G0** | `commands.ts` | Do not add a bus |
| Snapshot undo/redo | **G0** | `HistoryStack` | None for single commands |
| Stable clip/track/project ids | **G0** | `createId` | Reject display names |
| `moveClip` / `applyMoveClips` | **G0** | timeline + session | Golden path uses these |
| Playhead RAF isolation | **G0** | `App.tsx` + `playback.ts` | Guard: no network |
| Layout attach points | **G0** | `#inspector-body`, `ShortcutsOverlay` | No dock framework |
| Offline audio analysis | **G0** | feature-extractor | Wrap as read tool |
| Volume automation model | **G0** | G envelope | No lane id |
| Read-tool data sources | **G1** | getters exist | DTOs + privacy class |
| Clip-gain as command | **G2** | `applyUpdateClip` | Extract before `audio.set_gain` |
| Compound `withHistory` API | **G2** | ad hoc (`applyCut`) | `applyCommandBatch` or txn wrapper |
| Preview draft object | **G2** | drag-base / clone | Named AI preview that does not commit |
| Human Apply confirm | **G2** | dirty new/open/export confirms | Transaction card |
| Director UI | **G3** | none | AI-1 shell |
| Conversation store | **G3** | none | Resonance-owned; not in schema 5 |
| Context snapshot engine | **G3** | data on Session | AI-4; no playhead network |
| In-process tool table | **G3** | none | AI-5 |
| Permissions / grants | **G3** | human UI unrestricted | AI-6; AI-only policy |
| Project revision | **G3** | none | AI-6; do not misuse `updatedAt` |
| Audit log | **G3** | `status`/`error` strings | AI-6; redact secrets |
| Provider abstraction | **G3** | none | AI-2; local AI-3 |
| Secure secrets | **G4** | none | Plugin; fail closed until then |
| Event bus | **G4** | React `setSession` | Optional wrap; do not poll playhead |
| MCP network server | **G4** | none | After in-process table (AI-14) |
| `automationLaneId` / `effectId` / cue ids | **G4** | absent | Do not invent for first slice |
| AFE/mux/AUDIO-02 fixes | **G4** | inherited limits | **Out of AI scope** |
| Filesystem agent / shell / plugins / multi-agent | **G4** | absent | **Forbidden** |

---

## 21. Proposed V6 AI Module Map (Phase T)

**PROPOSAL.** Feature-gated. Empty until AI-1+. Do not create in AI-0.

```text
src/app/commands.ts          KEEP — the command abstraction
src/app/session.ts           KEEP — withHistory / apply*
src/app/ai/                  NEW (AI-1+)
  flag.ts                    feature gate (default OFF)
  host.ts                    wires Director → orchestrator (no core SDK)
  tools/                     handlers → applyCommand / getters
  providers/                 OpenAI-compatible + later cloud; never imported by core
  context/                   ContextSnapshot builder
  permissions/               grants (AI-only)
  transactions/              draft Project + one withHistory
src/ui/director/             NEW (AI-1) — panel section or overlay
src/core/                    FORBIDDEN for provider / MCP / chat
src/core/frame-engine/       FORBIDDEN
src/core/exporter/           read-only jobFromProject much later; no AFE edits
docs/ai/                     this map (AI-0)
```

Attach (AI-1):

1. **Preferred:** section inside `#inspector-body` (`App.tsx`) under `Inspector` — reuses `INSPECTOR_COLLAPSED_KEY` + `H_SPLIT_RATIO_KEY`.
2. **Acceptable:** overlay sibling of `ShortcutsOverlay` (`open` boolean).
3. **Avoid:** new width-ratio store, second Tauri window, embedding in `Preview.tsx` or Export dialog.

Director writes mutations **only** via `runCommand(EditorCommand)` once tools exist. AI-1 writes nothing to `Project`.

---

## 22. First Vertical Slice Design (Phase U)

**Do not implement.** Prompt:

> Verschiebe den markierten Clip exakt zwei Sekunden nach rechts.

### Real V6 symbols (FACT)

```text
selectionOf(session)                                src/app/session.ts
  → clipIds: string[]
clipById(project, clipId)                           src/core/models.ts
  → Clip.startMs
desiredStartMs = clip.startMs + 2000                milliseconds
moveClip(project, clipId, desiredStartMs)           src/core/timeline.ts
  OR applyCommand(session, {
       type: "moveClips",
       clipIds: [clipId],
       deltaMs: 2000
     })                                             src/app/commands.ts
       → applyMoveClips                             src/app/session.ts
           → moveClip / moveClipsByDelta            (NO snap)
withHistory → HistoryStack.past structuredClone
serializeProject includes new startMs
applyUndo restores the snapshot
```

### Paths that must **not** be used for +2.000 s (FACT)

| Path | Why it fails “exakt” |
| --- | --- |
| `applyMove(session, id, startMs)` | Snaps when `Project.snap` (`session.ts`) |
| `applyNudge` / `{ type: "nudgeClip" }` | Snaps; keyboard delta is `FRAME_MS` |
| Human drag `onMoveLive` | App applies snap before preview (`App.tsx`) |
| Repeat `,` / `.` | Not 2000 ms |

`moveClip` itself does **not** snap; it `clampStartMs` (≥ 0) and moves a linked mate.

### Future AI path (PROPOSAL — missing layers marked)

```text
User prompt (DE)
  → Director UI                                      MISSING (AI-1)
  → ContextSnapshot { selectedClipIds, playheadMs, projectId }
                                                     MISSING engine (AI-4); data EXISTS
  → Provider Adapter                                 MISSING (AI-2/3)
  → timeline.get_selection                           MISSING tool; data EXISTS
  → timeline.get_clip                                MISSING tool; clipById EXISTS
  → timeline.move_clip {
        clipId,
        targetStartSeconds: (startMs + 2000) / 1000
      }                                              MISSING tool
  → schema validate                                  MISSING
  → permission CONFIRM                               MISSING (AI-6)
  → semantic: clipById, !locked, start>=0            EXISTS (moveClip)
  → draft = moveClip(structuredClone(project), …)    EXISTS mechanically
  → preview overlay                                  PARTIAL (drag-base)
  → Human Apply
  → revision / snapshot conflict                     MISSING (AI-6)
  → applyCommand moveClips deltaMs:2000              EXISTS
  → one withHistory                                  EXISTS
  → audit                                            MISSING
```

Ambiguous selection (0 clips, or >1 without an explicit target policy) → **FAIL CLOSED**. Do not guess the “front” clip unless product policy later says “primary `selectedClipId` only” (recommended: primary only, reject multi-select).

Linked mate: `moveClip` moves the editable mate by the same delta. Document that in the tool result. Do not split the pair unless `skipLink` is an explicit grant (default: keep V6 link behavior).

---

## 23. Golden Path Acceptance Plan (Phase V)

**PROPOSAL.** Binding for AI-7. Not run in AI-0.

### Setup

1. New project. Import or place one unlocked clip. Record `clipId` and `startMs` (example: `30000`).
2. Select that clip only (`selectedClipIds = [clipId]`).
3. Leave `Project.snap === true` (default from `createEmptyProject`). This is the hostile case.
4. Feature-flag AI on. Provider may be mock.

### Action

Prompt: *„Verschiebe den markierten Clip exakt zwei Sekunden nach rechts.“*

Expected deterministic result:

```text
startMs_before + 2000 === startMs_after
example: 30000 → 32000
adapter: targetStartSeconds 32.000 → moveClip(..., 32000)
OR deltaMs: 2000 via applyMoveClips
```

### 12 consecutive runs

Repeat Apply (or the same tool+commit) **12 times** on the same project without undo between runs (or reset to a fixture each run — declare which). Each run must move **exactly +2000 ms** from that run’s base, not “about two seconds,” not snap-quantized.

Recommended: **reset fixture each run** (same `startMs`) so drift cannot hide. Also run one **chained** series (12× +2000 from the previous result) as a second pack.

### Pass / fail

| Check | Pass |
| --- | --- |
| Exact ms | `startMs_after - startMs_before === 2000` |
| Id stability | same `clipId` |
| Linked mate | mate delta === 2000 or documented skip |
| One undo | restores exact pre-Apply `Project` snapshot (clip start + mate) |
| Redo | restores post-Apply |
| Reject | no history push; startMs unchanged |
| Locked clip | error `"Clip is locked"`; no mutation |
| Missing id | `"Clip not found"`; no mutation |
| No selection | reject; no guess |
| Snap on | still exact +2000 |
| Playhead RAF | no provider/network call |
| Schema | still `5` |
| AFE/export | untouched |

Do not start a second mutation tool until this gate passes.

---

## 24. Failure / Threat Analysis — FAIL CLOSED (Phase W)

**PROPOSAL** policy. Resonance must reject rather than guess.

| Threat | Fail-closed behavior | Existing core hook |
| --- | --- | --- |
| Hallucinated `clipId` | Reject; do not resolve by name/color/nearest | `clipById` → `"Clip not found"` |
| Display name / label `A3` as id | Reject | `a_*` ≠ label |
| Ambiguous multi-select | Reject (first slice) | `selectionOf` length ≠ 1 |
| Locked clip | Reject | `"Clip is locked"` |
| Track kind change | Reject | `"Cannot move clip to a different kind of track"` |
| Negative time | Clamp is core `clampStartMs`; tool should still send ≥0 or reject | `moveClip` |
| Stale preview / human edited underneath | Reject Apply | **GAP G3** revision |
| Provider crash / timeout / empty tool call | No mutation; project unchanged | LAW-12 |
| Schema-invalid tool JSON | Reject before handlers | MISSING validator |
| Missing grant / Agent mode off | Deny | MISSING permissions |
| Tool asks for PCM / file bytes | Deny (`SEND_RAW_MEDIA`) | §25 |
| Tool asks to write project JSON / filesystem / shell | Deny | No such tools; Tauri has no shell |
| Preview treated as commit | Reject design | Use draft + one `withHistory` |
| Snap drift on golden path | Treat as product fail | Use `applyMoveClips` / `moveClip` |
| Sequential `runCommand` as a “transaction” | Forbidden | N undo steps |
| Provider SDK in `frame-engine` / `timeline` | Forbidden | import boundary |
| Secret in prompt / dump / project | Forbidden | LAW-11 |

Normalized errors should **reuse** V6 strings where they exist, plus later codes (`CLIP_LOCKED`, `TRACK_KIND_MISMATCH`, `TRANSACTION_CONFLICT`, `AMBIGUOUS_SELECTION`). Do not invent a second validator that can drift from `moveClip`.

---

## 25. AI Data Privacy Boundary — `SEND_*` (Phase X)

**PROPOSAL.** Context sent to a provider is classified. Default is the narrowest class that still makes the tool possible.

| Class | May include | Must not include | First-slice default |
| --- | --- | --- | --- |
| `SEND_NONE` | “a project is open” | everything else | Provider-down / ASK with no context |
| `SEND_IDS` | `projectId`, `clipId`, `trackId`, selected ids | names, paths, media | Tool-id round-trip |
| `SEND_STRUCTURE` | counts, kinds, `startMs`/`durationMs`, selection, playhead ms | asset paths, PCM, frames, secrets | **Default for move_clip** |
| `SEND_ANALYSIS` | summarized `rms/bass/mid/treble/onset/beatPulse` | raw `spectrum`, PCM, file bytes | Opt-in later |
| `SEND_MEDIA_METADATA` | filename, mime, duration, missing flag | `sourcePath` full disk, `objectUrl`, blob bytes | Opt-in; redact paths to basename |
| `SEND_RAW_MEDIA` | samples / frames / blobs | — | **Forbidden** until an explicit grant exists |

**FACT.** `sourcePath` on assets can be a user disk path. Stall dumps already front-load `productVersion` / `gitSha`. Neither may enter a provider prompt.

Conversation is Resonance-owned (LAW-10). Persist **beside** the project (later), never inside `schemaVersion` 5 until a versioned additive field is a conscious product change.

---

## 26. Local AI Readiness (Phase Y)

**FACT.** This tree has no Ollama, LM Studio, llama.cpp, or OpenAI client. No localhost chat port. No model download. V5-EVIDENCE lists Ollama as a **non-goal** of the media product.

**PROPOSAL (AI-3, after AI-2 adapter interface):**

| Runtime | Integration | Secret? | Notes |
| --- | --- | --- | --- |
| Ollama | OpenAI-compatible HTTP `http://127.0.0.1:11434/v1` | usually none | Fail closed if unreachable |
| LM Studio | OpenAI-compatible local server | usually none | Same adapter |
| llama.cpp server | OpenAI-compatible `--api` | usually none | Same adapter |
| Cloud OpenAI-compatible | HTTPS | **yes** — §17 | Disabled until SecretStore exists |

One `AIProvider` interface (request/response/tool-calls). Cloud vs local is an adapter, not a fork of tools or of `applyCommand`. Local does **not** relax LAW-02 (still untrusted).

AI-1 must work **offline** with a mock conversation and no network.

---

## 27. Trust Boundary Map

**FACT / PROPOSAL overlay.**

```text
UNTRUSTED / PROBABILISTIC
  Human prompt
  Provider / Model (cloud or local)
  Orchestrator tool *requests*
════════════════════════════════════════════════
                    TRUST BOUNDARY
  attach here, in this order, BEFORE existing mutations:
    1. Schema validation          MISSING
    2. Permission / grant         MISSING (human UI has none)
    3. Semantic validation        REUSE moveClip / clipById / locked / kind
    4. Revision / conflict        MISSING (do not fake with schemaVersion)
    5. AI Transaction (draft)     MISSING object; clone+moveClip EXISTS
════════════════════════════════════════════════
TRUSTED / DETERMINISTIC
    applyCommand / applyMoveClips / apply*
    moveClip / timeline / volume-* / visualizer
    HistoryStack / serializeProject / hydrateProject
    playback / AFE / exporter     (AI must not enter)
```

Human UI remains unrestricted. Grants are **AI-only**. That is not a license to bypass core errors.

---

## 28. AI-0 … AI-13 Sequence Validation

Expected sequence vs **this** architecture. Reorder only with evidence. **Verdict: keep order.**

| Phase | Intent | Evidence it belongs here | Reorder? |
| --- | --- | --- | --- |
| **AI-0** | Map only (this document) | Baseline has no AI surface | — |
| **AI-1** | Director shell, mock chat, flag OFF-safe | `#inspector-body` / overlay exist; no dock | **No.** Need a place to talk before a model |
| **AI-2** | Provider abstraction + one chat path | No SDK exists; keep out of `src/core` | **No.** Interface before local/cloud variants |
| **AI-3** | Local OpenAI-compatible | Same adapter; no extra core | **No.** Swapping with AI-2 would skip the interface. Local-first product policy can still implement the AI-2 interface using only localhost |
| **AI-4** | Context engine | Data on `Session`; no bus; playhead must not network | **No.** Tools need a snapshot builder |
| **AI-5** | Read tools (in-process table) | Getters exist; no server | **No.** Read before mutate |
| **AI-6** | Permissions, transaction object, revision, audit, Apply card | `withHistory` exists; revision does not; sequential commands ≠ txn | **No.** First mutation without this is unsafe |
| **AI-7** | `timeline.move_clip` golden +2.000 s × 12 | `applyMoveClips` / `moveClip` are clean | **No.** First mutation |
| **AI-8** | Additional single undoable clip tools (split/delete/fade) as separate grants | Commands exist | Keep after golden gate |
| **AI-9** | Compound / multi-tool Apply | Ad hoc one-snapshot pattern only | **No.** Evidence: N `applyCommand` = N undos |
| **AI-10** | Automation write | G APIs exist; not first slice | **No.** Volume-only; W is gesture chrome |
| **AI-11** | A/B preview | `Preview.tsx` can take a project prop later | After preview object exists |
| **AI-12** | Conversation persist / richer ASK modes | LAW-10; not in schema 5 | After shell + provider |
| **AI-13** | `render.preview` job read | `jobFromProject` ephemeral; AFE off-limits; mux/AUDIO-02 inherited | **Last.** High risk if it touches encode |

External MCP socket = **AI-14+** (not in 0–13). In-process table remains the only mutation path.

**V6-specific correction vs V5.6 recon:** host modules as `src/app/ai/` + `src/ui/director/`, not a blind new `src/ai/` tree. Sequence unchanged.

---

## 29. Inherited Limitations (do not fix in AI-*)

Copied as **FACT** from `docs/V6.0-BASELINE.md` / `CURRENT.md`. AI work must not silently “improve” them.

| Item | Status |
| --- | --- |
| ~160 min mux ArrayBuffer allocation | **NOT HUMAN-PROVEN** fixed |
| AUDIO-02 / 2 h streaming mux | **NOT IMPLEMENTED** |
| Production Pass I–N | **PLANNED / NOT IMPLEMENTED** |
| Licensing / MPL FREE | **Not HUMAN-PROVEN** (no LICENSE / THIRD_PARTY_NOTICES) |
| AFE-15 dump-ban tests | Inherited failures |
| STRESS-03 physical clip | Inherited failures (clip absent in VM) |

AI-0 did not modify `src/core/exporter/*` or `src/core/frame-engine/*`.

---

## 30. Evidence / Gates

**FACT — AI-0 allowed edits:** `docs/ai/**` only. No `src/` production behavior. No schema bump.

### Commands to run (and re-record)

```bash
npx tsc --noEmit
npx vitest run
npx vite build
```

Focused (optional, should be green):  
`tests/v55/identity.test.ts`, `tests/app/commands.test.ts`, `tests/app/project-dirty.test.tsx`, `tests/core/volume-write.test.ts`, `tests/core/volume-automation.test.ts`.

Live results for this branch tip are recorded in the PR body / follow-up stamp after the gate run. Expected inherited failures: AFE-15 A/N dump-ban (2) + STRESS-03 H–K missing clip (4).

Windows EXE is **not** produced in this Linux VM.

---

## 31. AI-0 Exit Gate

| Check | Verdict |
| --- | --- |
| Baseline SHA verified `2e39a15` / tag `v6.0.0-baseline` | **YES** |
| Canonical owner, commands, undo, IDs, first-slice symbols cited | **YES** |
| FACT vs PROPOSAL vs GAP distinguished | **YES** |
| Schema remains 5; no src/ behavior change | **YES** (docs only) |
| V5.6 AI-0 PR **#36** not merged / not cherry-picked | **YES** |
| AI Director / MCP / providers **not** implemented | **YES** |
| Render/media behavior unchanged | **YES** |
| AI-1 entry point named | **YES** — feature-gated `src/ui/director/` shell + `src/app/ai/flag.ts`; attach `#inspector-body` or Shortcuts-style overlay; no model |
| Ready to start AI-1? | **YES**, after §30 gates are recorded on this SHA — Director **shell only** |
| Ready to start AI-2+ / AI-7? | **NO** — revision, grants, tool table, preview txn still G2/G3 |

**STOP after AI-0. Do not start AI-1 in this change.**

---

## Appendix A — `EditorCommand` catalogue (FACT)

Source: `src/app/commands.ts`.

`undo`, `redo`, `revertToLastSave`, `copy`, `cut`, `paste`, `duplicate`, `split`, `addMarker`, `renameMarker`, `renameProject`, `clearInOut`, `markIn`, `markOut`, `liftDelete`, `rippleDelete`, `closeGap`, `rippleTrimToPlayhead`, `nudgeClip`, `nudgePlayhead`, `gotoNextEdit`, `gotoPrevEdit`, `play`, `pause`, `playPause`, `stop`, `shuttle`, `toggleMute`, `toggleSolo`, `addAudioTrack`, `removeAudioTrack`, `createTrackGroup`, `assignTracksToGroup`, `renameTrackGroup`, `toggleVolumeWriteArm`, `setVolumeAutomationEnabled`, `addVolumeAutomationPoint`, `deleteVolumeAutomationPoint`, `moveVolumeAutomationPoint`, `selectVolumeAutomationPoint`, `clearVolumeAutomationPoint`, `liftTrim`, `rippleTrim`, `rollEdit`, `select`, `selectClips`, `selectAll`, `selectAllOnTrack`, `setClipsEnabled`, `setClipsLocked`, `moveClips`, `slip`, `slideClip`, `liftRange`, `extractRange`, `setClipFades`, `setClipRate`, `setTrackPan`, `unlinkClips`, `relinkClips`, `setTransition`, `setTransitionSource`, `setTransitionAudio`, `setTransitionAudioDuration`, `setFrontVideoTrack`, `insertVisEvent`, `selectVisEvent`, `moveVisEvent`, `stretchVisEvent`.

**Not in the union (FACT):** `applyPlayhead`, `applyMove` (absolute+snap), `applyUpdateClip` (gain/timing), `applyPlaceAsset`, `applyMixerVolume` / `applyTrackVolume`, `applySetVisualizer` / scene pick, import/open/save, scroll/zoom/fit.

---

## Appendix B — Architectural laws (binding)

1. **Own the Core.** Provider-independent, deterministic Resonance.
2. **AI is untrusted** — including local models.
3. **No direct mutation** of timeline/clip/track/automation/mixer/serialization/media files by AI code.
4. **MCP/tools are adapters**, not a second engine.
5. **Stable IDs** define identity. Display names are not ids.
6. **Fail closed.**
7. **Mutation is transactional** — one `withHistory` per AI Apply.
8. **Preview is not commit.**
9. **Human approval is policy-controlled.**
10. **Conversation belongs to Resonance.**
11. **Secrets never enter project data.**
12. **Provider failure must not endanger media state.**

---

## Appendix C — V5.6 AI-0 reference (non-authoritative)

Read-only: V5.6 repo PR **#36** / branch `cursor/ai-0-recon-architecture-freeze-45e4` (`docs/ai-director/`). That freeze targeted product **5.6.0** @ `35b6503`, layout keys `resonance-studio-v5-5*`, and proposed `src/ai/` + type-only contracts.

V6 differences that matter:

| Topic | V5.6 recon | V6 this tree |
| --- | --- | --- |
| Product | 5.6.0 | **6.0.0** |
| SHA | `35b6503` | **`2e39a15`** (`v6.0.0-baseline`) |
| AppData / keys | `v5-5` | **`v6-0`** (side-by-side) |
| Host folder | `src/ai/` | **`src/app/ai/` + `src/ui/director/`** (convention) |
| Contracts in tsconfig | yes on that PR | **not copied** (docs only) |
| `EditorCommand` / `moveClip` / snapshot undo | same lineage | **re-verified present** |

Do not merge PR #36 into V6 `main`.
