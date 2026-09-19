# AILEXSI Resonance Studio V6.0 — AI Director Implementation Status

**Document:** `docs/ai/AI_DIRECTOR_IMPLEMENTATION_STATUS_v6.0.md`  
**Branch:** `ai/ai-director-foundation-v6`  
**Base:** `7479fcf0fce2f4f0b81e6ec141f855c47cb613ff` (AI-0 merged on `main`)  
**HEAD (AI-7 code):** `3e4def1958584a7c153ffc70ef8cb5f6978ecb31`  
**Reviewed HEAD (this run start):** `d97b10e1a7d650d7c37a989d6184cb6a428c9e57`  
**Map:** [`AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md`](./AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md) (AI-0 evidence; proposals are not shipped facts)

This file records **what this implementation run actually shipped**, per completed gate. It does not rewrite AI-0 evidence as history.

Labels: **SHIPPED** = present on this branch after a passing gate. **PROPOSAL** remains a later-phase design from the AI-0 map.

---

## Highest completed phase

| Field | Value |
| --- | --- |
| Highest gate | **AI-7 GATE PASS** |
| Schema | **5** (unchanged; `projectRevision` is Session-runtime only) |
| Mutation path | `timeline.move_clip` → `applyCommand({ type: "moveClips", clipIds, deltaMs })` → `applyMoveClips` → `moveClip` / `moveClipsByDelta` → `withHistory` |
| Second engine | none (`AIProject` / `AICommandBus` / parallel undo absent) |
| Direct AI project mutation | none (no `session.project.clips[...]` writes in AI modules) |
| RAF provider traffic | none (playhead cache is local only) |
| Secrets in Project / Git | none (API key never persisted; prefs store URL/model only) |
| Stop | No second mutating tool. Do not merge this PR from this run. |

### Sequential phase commits

| Phase | SHA | Message |
| --- | --- | --- |
| AI-1 | `67f245da9bdac3dca5df7474a8dfef5953ce3492` | `feat(ai): add feature-gated Director shell` |
| AI-2 | `08bc5e5e9016dc1a13770e3f1cefd9e20842245e` | `feat(ai): add provider abstraction` |
| AI-3 | `1791cb6f13f501f249b2ffed2f52995659e1687f` | `feat(ai): add local OpenAI-compatible provider` |
| AI-4 | `a571f4b590df7fe7919e4de62cdec547bb0cc8dd` | `feat(ai): add context snapshots` |
| AI-5 | `f7db829b89115b66dd0946552031c9a8a74a6ebe` | `feat(ai): add read-only tool registry` |
| AI-6 | `e9365a94c4d42cce3a5b38976f7202e6c0491e80` | `feat(ai): add permissions and transaction foundation` |
| AI-7 | `3e4def1958584a7c153ffc70ef8cb5f6978ecb31` | `feat(ai): add transactional move-clip tool` |

### Focused AI tests (56 / 56)

| File | Count |
| --- | --- |
| `tests/ai/ai-1-director-shell.test.tsx` | 6 |
| `tests/ai/ai-2-provider.test.ts` | 10 |
| `tests/ai/ai-3-openai-compatible.test.ts` | 10 |
| `tests/ai/ai-4-context.test.ts` | 8 |
| `tests/ai/ai-5-tools.test.ts` | 7 |
| `tests/ai/ai-6-trust.test.ts` | 7 |
| `tests/ai/ai-7-move-clip.test.ts` | 8 |

### AI-7 final gate

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npx vitest run tests/ai/ai-*.test.ts*` | **56 passed** |
| `npx vitest run` | **1445 passed / 6 failed / 1451** (168 files passed / 2 failed / 170) — failures are inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 182 modules) |

### Intermediate full-suite records (same inherited 6)

| After | Result |
| --- | --- |
| AI-1 | 1394 passed / 6 failed / 1400 (164 files) |
| AI-2 | 1405 passed / 6 failed / 1411 |
| AI-4 | 1423 passed / 6 failed / 1429 |
| AI-7 | 1445 passed / 6 failed / 1451 (170 files) |

AI-3 / AI-5 / AI-6 focused suites passed; no new full-suite failures appeared between those commits (counts interpolate as +10 / +7 / +7).

---

## AI-1 — Director shell

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `67f245d` `feat(ai): add feature-gated Director shell` |
| Intent | Feature-gated Director UI: conversation, mock reply, placeholders. No network, tools, or Project mutation. |

### Files

- `src/app/ai/flag.ts` — gate (test override / `?ai=1` / localStorage). Not on `Project`.
- `src/app/ai/conversation.ts` — in-memory conversation only.
- `src/app/ai/host.ts` — Director host state + mock turn.
- `src/ui/director/DirectorPanel.tsx` — inspector-mounted shell.
- `src/app/App.tsx` — mounts panel only when `isDirectorEnabled()`.
- `src/styles.css` — Director chrome.
- `tests/ai/ai-1-director-shell.test.tsx`

### Tests

Hidden when off; renders when on; open/close; message + mock; no Project mutation; schema 5; no `fetch`.

### Limitations

- Offline mock conversation only at this phase (later phases add provider/context/tools).
- No tools, no revision, no grants at this phase.

### Next gate (completed)

AI-2 — provider abstraction + MockProvider.

---

## AI-2 — Provider abstraction

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `08bc5e5` `feat(ai): add provider abstraction` |
| Intent | Provider-neutral `AIProvider` + registry. Only Mock implemented. Director chats through the abstraction. Stale replies ignored. Normalized errors. No Project mutation. |

### Files

- `src/app/ai/providers/types.ts` — interface, capabilities, error codes
- `src/app/ai/providers/registry.ts` — known ids; unknown / unimplemented fail closed
- `src/app/ai/providers/mock.ts` — MockProvider
- `src/app/ai/providers/index.ts`
- `src/app/ai/orchestrator.ts` — requestId + stale gate
- `src/app/ai/host.ts` / `src/ui/director/DirectorPanel.tsx` — Director → abstraction → Mock
- `tests/ai/ai-2-provider.test.ts`

### Tests

Mock conforms; registry reserved ids; unknown provider fail; cancel; stale ignored; provider fail leaves Project unchanged; capabilities ≠ permissions.

### Limitations

- Cloud ids reserved only (OpenAI / Anthropic / xAI / DeepSeek / Ollama / LM Studio / llama.cpp).
- No tools / grants at this phase.

### Next gate (completed)

AI-3 — local OpenAI-compatible provider (CHAT only).

---

## AI-3 — Local OpenAI-compatible provider

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `1791cb6` `feat(ai): add local OpenAI-compatible provider` |
| Intent | First real provider: generic OpenAI-compatible localhost HTTP. CHAT only. No model download, no spawned binaries, no required public Internet. |

### Files

- `src/app/ai/providers/openai-compatible.ts`
- `src/app/ai/providers/prefs.ts` — URL/model only; API key never persisted
- `src/app/ai/host.ts` / `src/ui/director/DirectorPanel.tsx` — config + Test connection
- `tests/ai/ai-3-openai-compatible.test.ts`

### Tests

Injectable `fetchImpl` (in-process mock HTTP, no Ollama in CI): success, fail codes, malformed, timeout, cancel, unavailable, no Project mutation. Prefs have no secrets.

### Limitations

- Streaming not implemented (optional; skipped to keep the adapter clean).
- Cloud providers still unregistered (no secret store).
- Connection test uses `GET /models`.
- Status values: Not configured / Connecting / Connected / Unavailable / Error.

### Next gate (completed)

AI-4 — immutable context snapshots.

---

## AI-4 — Context snapshots

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `a571f4b` `feat(ai): add context snapshots` |
| Intent | Immutable `AIContextSnapshot` captured on intentional submit. Playhead cache is local only. |

### Files

- `src/app/ai/context/types.ts`
- `src/app/ai/context/snapshot.ts`
- `src/app/ai/host.ts` / `src/ui/director/DirectorPanel.tsx` / `src/app/App.tsx` (read-only session for capture)
- `tests/ai/ai-4-context.test.ts`

### Tests

Snapshots, stable ids, no sourcePath/objectUrl/raw media, immutability, SEND_RAW_MEDIA forbidden, Project unchanged, playhead cache does not fetch.

### Limitations

- Snapshot is not persisted in schema 5.
- SEND_ANALYSIS is a clip+time hint only (no PCM/spectrum).

### Next gate (completed)

AI-5 — read-only in-process tool registry.

---

## AI-5 — Read-only in-process tools

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `f7db829` `feat(ai): add read-only tool registry` |
| Intent | MCP-shaped in-process table. READ only. Compact DTOs. |

### Files

- `src/app/ai/tools/types.ts`
- `src/app/ai/tools/validate.ts`
- `src/app/ai/tools/read-tools.ts`
- `src/app/ai/tools/registry.ts`
- `tests/ai/ai-5-tools.test.ts`

### Tests

Valid tools, unknown tool, invalid args, unknown clipId, selection, analysis (NO_PCM + offline PCM), automation, no mutation, no history, schema 5.

### Limitations / gaps

- `audio.get_analysis` needs runtime MixPcm; Project has none (documented `NO_PCM`).
- No network MCP socket.
- Read tools only at this phase.

### Next gate (completed)

AI-6 — grants, revision, transactions, audit.

---

## AI-6 — Permissions and transactions

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `e9365a9` `feat(ai): add permissions and transaction foundation` |
| Intent | Grants READ/DRAFT/EDIT (EXPORT unused). Modes ASK/DRAFT/AGENT. Runtime `projectRevision` on Session (not Project). Draft/Apply/Reject. In-memory audit. |

### Files

- `src/app/session.ts` — `projectRevision` incremented in `withHistory` / undo / redo / open
- `src/app/App.tsx` — live move-commit also bumps revision so human drag conflicts with stale AI drafts
- `src/app/ai/permissions/policy.ts`
- `src/app/ai/transactions/transaction.ts`
- `src/app/ai/transactions/audit.ts`
- `src/app/ai/transactions/invoke.ts`
- `src/app/ai/host.ts` / `src/ui/director/DirectorPanel.tsx`
- `tests/ai/ai-6-trust.test.ts`

### Tests

READ cannot mutate; DRAFT cannot commit; EDIT without approval denied; invalid grant; draft/reject unchanged; stale revision denied; provider fail unchanged; audit; one txn → one history; schema 5.

### Next gate (completed)

AI-7 — `timeline.move_clip` only.

---

## AI-7 — timeline.move_clip

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `3e4def1` `feat(ai): add transactional move-clip tool` |
| Intent | First (and only) mutation tool. Golden DE prompt → `applyCommand({ type: "moveClips", clipIds, deltaMs: 2000 })`. No applyMove / nudge / drag snap. |

### Files

- `src/app/ai/tools/move-clip.ts`
- `src/app/ai/host.ts` — golden prompt drafts a transaction
- `src/ui/director/DirectorPanel.tsx` — transaction card (before/after startMs)
- `tests/ai/ai-7-move-clip.test.ts`

### Hard-gate metrics

| Check | Result |
| --- | --- |
| Golden fixture 12/12 (reset each run, snap true, exact +2000) | **12/12** |
| Chain X→X+2000→…→X+24000 | **12/12** |
| `Project.snap=true` still +2000 (no snap path) | PASS |
| Undo / redo | PASS |
| Reject leaves canonical + history unchanged | PASS |
| Stale revision / invalid id / locked / NaN / Infinity | PASS (fail closed) |
| Missing EDIT / approval | PASS (denied) |
| Provider failure | PASS (no apply) |
| Schema 5 | PASS |
| Visual ghost | skipped (invasive); transaction card is the preview |

### Stop

No second mutating tool. This run stops here.

---

## Architectural deviations (intentional, fail-closed)

1. AI-3 CI uses injectable `fetchImpl` rather than a `node:http` listen socket (`node` types are not in the Vite/tsc app graph). Contract is the same: success / fail / malformed / timeout / cancel / unavailable.
2. Provider streaming is not implemented (optional in AI-2/AI-3).
3. Timeline ghost overlay is not drawn; the transaction card shows before/after `startMs`.
4. Optional API key is accepted at call time only and is never written to prefs / Project / logs.
5. Golden German prompt is exact-string matched (model output is data, not authority).
6. Code lives under `src/app/ai/` + `src/ui/director/` per the AI-0 map (not a top-level `src/ai/`).

---

## Inherited baseline (do not treat as AI regressions)

From AI-0 / V6 baseline — identical on this branch:

- AFE-15 ×2 — `tests/export/afe-15-exact-pts-tail-ownership.test.ts` (A. human stall dump-ban; N. no nearest/VIS/BLACK fallback dump)
- STRESS-03 ×4 — `tests/export/stress-03-physical-source.test.ts` H/I/J/K (`STRESS03_CLIP` absent)

Do not “fix” AFE / exporter / mux / AUDIO-02. `src/core/frame-engine/**` and `src/core/exporter/**` were not modified.

---

## PR #2 ADVERSARIAL REVIEW

**Reviewed HEAD:** `d97b10e1a7d650d7c37a989d6184cb6a428c9e57` (matches expected; no REVIEW_BASE_MISMATCH).  
**Intent:** inspect production code, construct hostile tests, repair proven defects, rerun gates. Do not start AI-8. Do not merge.

### Defects found and repaired

| ID | Risk | Repro | Repair | Test |
| --- | --- | --- | --- | --- |
| ADV-1 | **High** — Project replacement / ABA-adjacent apply | Draft `clip_123` on Project A at revision 0. `openSerialized` / `newProject` reset `projectRevision` to 0. Open Project B that also has `clip_123`. Apply used only `baseRevision`, so the move landed on B. | Bind `AITransaction.projectId` + `baseRevision`. `applyCommandTransaction` requires both. `openSerialized` / `newProject` increment Session-lifetime revision instead of resetting to 0. | `tests/ai/ai-pr2-adversarial.test.ts` — cases 2, 5 |
| ADV-2 | **High** — PREVIEWED !== COMMITTED | `txn.command` was the caller’s object. After draft, `{ ...txn, command: { deltaMs: 99000 } }` applied the forged delta. | `sealCommand` (`structuredClone` + deep freeze). Commit revalidates command vs preview (`before + delta === after`). | case 6 |
| ADV-3 | **High** — TOCTOU / live drag | Live drag in `App.onMoveLive` mutates `startMs` without bumping revision. Apply would still see matching revision and move from the live position. | At commit: revalidate project identity, revision, frozen command, clip existence, lock, and `clip.startMs === preview.beforeStartMs`. | cases 3 (drag-commit), 7 |
| ADV-4 | **Medium** — numeric coerce | `Math.round(2000.4)` became 2000; `0` drafted a no-op apply. | `asExactDeltaMs` requires a positive `Number.isSafeInteger`. Fractional / 0 / negative / NaN / Inf / string / null / undefined → `INVALID_DELTA`. | case 9 |
| ADV-5 | **Medium** — local provider SSRF | `OpenAICompatibleProvider` fetched any `baseUrl`, including `https://api.openai.com`. | `isAllowedLocalProviderUrl` allow-list: `localhost`, `127.0.0.1`, `::1` only. Non-loopback throws `PROVIDER_UNAVAILABLE` before `fetch`. Does not rewrite to cloud. | case 15 |
| ADV-6 | **Low** — stale UI commit | `DirectorPanel` committed an aborted turn’s host state after a newer submit. | Ignore result when `ctl.signal.aborted` or `abortRef.current !== ctl`. | host/orchestrator stale cases in 12 + panel guard |
| ADV-7 | **Low** — ambiguous selection | `selectedClipId` vs `selectedClipIds[0]` disagreement resolved silently to the list. | `AMBIGUOUS_SELECTION` when both are set and disagree. | case 8 |
| ADV-8 | **Low** — audit leak | `recordAudit` redacted `apiKey:"…"` but left `apiKey=x` / unquoted forms. | Redact unquoted `apiKey=` / `sourcePath=` values. | case 14 |

### Proven already closed (no code change)

| Area | Evidence |
| --- | --- |
| ABA undo to visual equivalent | `applyUndo` increments revision (`session.ts` `applyUndo`). Apply stale → `TRANSACTION_CONFLICT`. Case 4. |
| Human move/trim/split/delete/undo/redo | Those commands use `withHistory` / undo-redo revision bumps. Case 3. |
| Snap path | Golden still `moveClips` +2000. `applyMove` / `applyNudge` snap when `Project.snap=true` and playhead is within 80 ms; AI path does not. Case 10. |
| History | One approved apply → one `history.past`. Draft / reject / fail / stale → 0. Case 11. |
| Provider fail / late / malformed | Orchestrator stale-gate + host error path; no `applyCommand`. Case 12. |
| Context / secrets | Snapshot freeze; prefs URL/model only; audit redacts Bearer/apiKey. Cases 13–14. |
| RAF / AI-off | Playhead cache local; `isDirectorEnabled()` default false; no startup `testConnection`. Cases 16–17. |
| Read tools | DTO mutation does not write Project / history / revision. Case 18. |
| Permission matrix | ASK cannot draft/commit; DRAFT cannot commit; AGENT+EDIT+approval only. Case 19. |
| Direct mutation / second engine | Grep of `src/app/ai/**`: no `session.project.clips =`, no `AIProject` / `AICommandBus`. Case 21/22. |
| Frame engine / exporter | `git diff 7479fcf... -- src/core/frame-engine src/core/exporter` empty. Case 23. |

### Residual / accepted for this phase

- Visual ghost overlay still skipped (transaction card remains the preview).
- Provider streaming still unimplemented.
- Negative / zero `deltaMs` now fail closed on `timeline.move_clip` (only exact positive integer deltas). Left-nudge is a later tool if needed.
- Live-drag revision is still committed only on mouse-up (`App.onMoveCommit`); mid-drag is caught by startMs TOCTOU, not by a preview increment.

### Review commits

Do not squash AI-1…AI-7.

| SHA | Message |
| --- | --- |
| `a3044f4` | `fix(ai): bind project identity and fail-closed transaction apply` |
| `60ad979` | `test(ai): add PR #2 adversarial review suite` |
| `d43de6c` | `docs(ai): record PR #2 adversarial review` |
| `d3b9dbf` | `fix(ai): redact unquoted apiKey in audit details` |

### Adversarial gate (this run)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npx vitest run tests/ai/ai-*.test.ts*` | **78 passed** (56 prior + 22 adversarial) |
| `npx vitest run` | **1467 passed / 6 failed / 1473** (169 files passed / 2 failed / 171) — inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 182 modules) |
| Golden fixture 12/12 | PASS |
| Chain 12/12 | PASS |
| New regressions | none |

### Stop

No second mutating tool. PR #2 stays unmerged. Do **not** start AI-8 from this run.

---

## PR #2 HUMAN REVIEW FIX — visible AI Director toggle

**Intent:** Director was gated (`?ai=1` / `?director=1` / localStorage) but not openable from normal chrome. Add a visible **AI** button. Do not start AI-8. Schema stays 5.

### UX / persistence

- Chrome: File | Import | Export | ARRANGE | CUTTER | **AI** (existing toolbar button + `button.active` when open).
- Click closed → enable/open Director in Inspector; click open → close/hide.
- If Inspector is collapsed when opening, it expands so the user never clicks AI and sees nothing.
- Preference key remains `resonance-studio-v6-0-ai-director` (`"1"` / removed). Application UI state only — not Project / JSON / schema / conversation / audit / render.
- React state: `const [directorEnabled, setDirectorEnabled] = useState(() => isDirectorEnabled())`. Render depends on that state, not a live localStorage read. `?ai=1` still enables on mount.

### Files

- `src/app/ai/flag.ts` — `persistDirectorEnabled`
- `src/ui/toolbar/Toolbar.tsx` — visible AI button
- `src/app/App.tsx` — `directorEnabled` state + inspector auto-expand
- `tests/ai/ai-director-ui-toggle.test.tsx`
- `tests/ai/ai-1-director-shell.test.tsx` — button still visible when gate is off

### Tests

Defaults off; click open/close; active state; preference persist + remount restore; inspector auto-expand; AI-off V6 chrome; Project/history/schema 5 unchanged; no provider request on open; `?ai=1` still works.

### Gates after this fix

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| Focused AI + toggle + adversarial | **87 passed** (56 prior + 22 adversarial + 9 toggle) |
| `npx vitest run` | **1476 passed / 6 failed / 1482** (170 files passed / 2 failed / 172) — inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 182 modules) |
| New regressions | none |

### Stop

No AI-8. No new capability. Do not merge from this run.

---

## PR #2 HUMAN REVIEW UI FIX #2 — Director sidebar layout

**Intent:** At 32:9 / 5120×1440 the Director opened but Inspector and Director competed for right-side height; composer/controls were technically present and not usable. Harden the right sidebar only. Do not start AI-8. Schema stays 5.

### Layout

- Right sidebar = Inspector section + Director section (`#inspector-body` grid when Director is open).
- Director gets its own viewport (`min-height: 0`). Status/provider/mode/context stay pinned; Provider/Mode/Grant/Context/conversation/txn scroll in `director-scroll`; composer is sticky at the bottom of the Director viewport.
- Open Director caps Inspector at `minmax(64px, 28%)` / Director `minmax(180px, 1fr)` so Inspector cannot starve Director. Inspector stays mounted (state preserved). INS still collapses/expands the whole sidebar.
- Director Close calls the same disable path as the toolbar **AI** toggle.

### Files

- `src/app/App.tsx` — inspector/director sections + Close sync
- `src/ui/director/DirectorPanel.tsx` — own scroll + sticky composer + `onRequestClose`
- `src/styles.css` — sidebar flex/grid, overflow, sticky composer
- `tests/ai/ai-director-sidebar-layout.test.tsx`
- `tests/ai/ai-director-ui-toggle.test.tsx` — Close/AI sync

### Gates after this fix

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| Focused AI + toggle + layout + adversarial | **98 passed** (56 prior + 22 adversarial + 10 toggle + 10 layout) |
| `npx vitest run` | **1487 passed / 6 failed / 1493** (171 files passed / 2 failed / 173) — inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 182 modules) |
| New regressions | none |

### Stop

Layout only. No Project / schema / provider / transaction change. Do **not** merge. Do **not** start AI-8.

---

## Next (outside this run)

Human retest of the Director sidebar layout. Coordinator may merge. Do **not** implement a second mutating tool on this branch.

---

## HUMAN-GATE / GOLDEN-PATH ACTIVATION

**Branch:** `cursor/ai-director-golden-path-activate-bb64`  
**Start HEAD:** `bc4a10b5e7177af22bf3f80468ece811a712dae8` (`ai/ai-director-foundation-v6`, includes PR #3 layout)  
**Target:** `ai/ai-director-foundation-v6` — **not** `main`. PR #2 stays open and unmerged.  
**Intent:** Smallest genuinely useful E2E path. Reuse AI-1…AI-7 + ADV-1…ADV-8. No AI-8. No second mutating tool. ADV-5 loopback unchanged.

### Implementation map before this run (Phase 0)

| Surface | Before | After |
| --- | --- | --- |
| DirectorPanel submit | E2E → orchestrator → provider chat | Same, plus structured parse |
| Mock provider | E2E free-form chat only | Deterministic golden phrase → structured `timeline.move_clip` |
| Local OpenAI-compatible | Adapter + Test connection UI; prefs unit-tested only (not hydrated) | Prefs hydrate/save in panel; structured JSON content parsed |
| Provider config UI | Present (mock / openai-compatible, URL, model, memory key) | Labels: mock (offline, not an LLM) / local-openai-compatible |
| Conversation / orchestrator | E2E stale-gate | Unchanged; draft no longer happens before chat |
| Context snapshot | Captured on submit, not sent | Sent as a compact system JSON when level ≠ NONE |
| Read tools | Unit-tested only | Unchanged (not expanded) |
| `timeline.move_clip` | Host exact-string golden draft **before** provider returned | Only after validated `toolRequest` |
| Txn preview / Apply / Reject | UI present | Shows tool / target / +2000ms / PREVIEW; still no auto-apply |
| Revision / conflict / audit / history | Unit + host Apply | Same path; reject/apply also explain in conversation |

### Hard laws kept

- Schema **5**. Config is localStorage prefs (`resonance-studio-v6-0-ai-prefs`), never Project JSON.
- No cloud adapters / no API keys in Project / prefs.
- Loopback only: `127.0.0.1` / `localhost` / `::1` (ADV-5).
- Opening Director does not call the provider. Changing provider does not mutate Project.
- Free-form text never mutates. Tool request alone never applies.
- Mutation only via `applyCommand({ type: "moveClips", clipIds, deltaMs: 2000 })`.
- No `applyMove` / nudge / snap path. No second engine.

### Human golden-path settings

Mode **AGENT**, Grant **EDIT**, Context **SELECTION**, Provider **mock** (offline) or **local-openai-compatible** with loopback Base URL + model. Defaults remain ASK / READ / NONE / mock.

### Files

- `src/app/ai/contract.ts` — structured `{ message, toolRequest? }` parse / validate
- `src/app/ai/host.ts` — prefs hydrate/persist; provider messages; draft only after validated tool
- `src/app/ai/providers/mock.ts` — golden German phrase → structured move_clip
- `src/app/ai/providers/prefs.ts` — reused (URL/model only)
- `src/ui/director/DirectorPanel.tsx` — prefs, late project-switch drop, txn PREVIEW card
- `tests/ai/ai-golden-path.test.ts`
- `tests/ai/ai-golden-path-adversarial.test.ts`

### Gates (this run)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npx vitest run tests/ai/ai-*.test.ts*` | **121 passed** (98 prior + 23 golden-path / adversarial) |
| `npx vitest run` | **1510 passed / 6 failed / 1516** (173 files passed / 2 failed / 175) — inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 184 modules) |
| Mock golden 12/12 | PASS |
| Reject 12/12 | PASS |
| Hostile snap 12/12 | PASS |
| Stale txn 12/12 | PASS |
| Provider failure 12/12 | PASS |
| Permission matrix | PASS |
| Project switch / ABA | PASS |
| Windows package | **NOT AVAILABLE** on this Linux VM |
| New regressions | none |

### Stop

No AI-8. Do **not** merge PR #2 to `main`. Do **not** merge this PR to `main`.

---

## HUMAN-GATE CLOSEOUT + DIRECTOR WORKSPACE UX

**Branch:** `cursor/director-workspace-human-gate-61f3`  
**Start HEAD:** `f8a48bbc20c11a44ff6aef2da2721a027129bc49` (`ai/ai-director-foundation-v6`, PR #4 merged)  
**Target:** `ai/ai-director-foundation-v6` — **not** `main`. PR #2 stays open and unmerged.  
**Intent:** Make Reject / Apply / Undo / Redo / stale `TRANSACTION_CONFLICT` unambiguous in Director UI. Add pure workspace UX (collapse, split, sidebar width, Focus, composer). Schema stays **5**. No AI-8. No tools/cloud/Voice/STT/Builder.

### Human-proven vs still requires Martin

| Gate | Status |
| --- | --- |
| Packaged EXE | **HUMAN-PROVEN** (prior) |
| Preview | **HUMAN-PROVEN** (prior) |
| explicit Apply | **HUMAN-PROVEN** (prior; examples ~89875→91875 and ~90019→92019) |
| exact +2000 ms | **HUMAN-PROVEN** (prior). This run preserves Apply exact +2000. Tests are not a substitute. |
| Reject | **STILL REQUIRES HUMAN CONFIRMATION** — UI now shows a dedicated REJECTED card |
| Undo / Redo | **STILL REQUIRES HUMAN CONFIRMATION** — Director now exposes the existing Session history buttons |
| stale TRANSACTION_CONFLICT | **STILL REQUIRES HUMAN CONFIRMATION** — dedicated STALE TRANSACTION — CONFLICT banner; Apply blocked |

### Workspace UX (local prefs only)

| Item | Behavior |
| --- | --- |
| 2A Inspector section collapse | Collapse Inspector / Expand Inspector. Content hidden (`hidden`), Director uses the sidebar. Selection/state preserved (Inspector stays mounted). Sidebar INS Collapse/Expand still hides the whole column. |
| 2B Inspector/Director split | Drag handle when both open. Min inspector 64px / Director 180px. Double-click reset. |
| 2C Sidebar width | Existing Preview↔Inspector splitter. Added `INSPECTOR_MAX_PX=720` so ultrawide does not starve Preview. Double-click reset. |
| 2D Director Focus | Focus collapses Inspector section; Exit restores prior Inspector + split. Not app fullscreen. |
| 2E Composer | Multiline textarea; vertical resize + auto-grow 56–200px; Enter=newline; Ctrl+Enter=Send. |
| 2F Layout | status/config → pending txn / conflict → conversation → composer/Send. |

Prefs keys (not Project JSON): `inspector-section-collapsed`, `director-split`, `director-normal-split`, `director-focus`, `director-composer-height`. Existing `preview-h-split` / `inspector-collapsed` reused.

### Hard laws kept

Schema **5**. No provider/tool/txn/command/history/Frame Engine/exporter change except host UI copy + `lastGateCode` runtime fields. Mutation path unchanged. No second engine.

### Gates (this run)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npx vitest run tests/ai/ai-*.test.ts*` | **137 passed** (121 prior + 16 workspace / human-gate UI) |
| `npx vitest run` | **1529 passed / 6 failed / 1535** (174 files passed / 2 failed / 176) — inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 184 modules) |
| Golden / Reject / hostile snap / stale / provider fail / ABA / ASK-READ | PASS (existing suites, no regression) |
| `git diff 7479fcf -- src/core/frame-engine src/core/exporter` | empty |
| Windows package | **NOT AVAILABLE** on this Linux VM |
| New regressions | none |

### Stop

No AI-8. Do **not** merge this PR to `main`. Do **not** merge PR #2 to `main`. Coordinator may merge to `ai/ai-director-foundation-v6` after Martin’s human gates.

---

## LOCAL PROVIDER HUMAN-INTEGRATION

**Branch:** `cursor/local-provider-human-integration-a15e`  
**Start HEAD:** `b033b1ed2654558161e28ce28ccd44b22ab5b375` (`ai/ai-director-foundation-v6` / Foundation, PR #5 merged)  
**Target:** `ai/ai-director-foundation-v6` — **not** `main`. PR #2 stays open draft → `main`.  
**Intent:** Diagnose why packaged Director reported `PROVIDER_UNAVAILABLE` against a working loopback `/v1` endpoint, then fix the generic OpenAI-compatible adapter only. Schema stays **5**. No AI-8. No `OllamaProvider`.

### Phase 0 re-verify

| Item | Evidence |
| --- | --- |
| Foundation HEAD | `b033b1ed2654558161e28ce28ccd44b22ab5b375` = Merge pull request #5 |
| PR #5 | MERGED into `ai/ai-director-foundation-v6` |
| PR #2 | OPEN draft → `main` (`ai/ai-director-foundation-v6`). Not merged. |
| Schema | `PROJECT_SCHEMA_VERSION = 5` |
| AI-8 | Not started |
| `OllamaProvider` | Not added |

### ROOT CAUSE (proven, not guessed)

Two independent defects plus one packaged-WebView transport gap:

1. **Chat timeout floor (code + human latency).** `DEFAULT_TIMEOUT_MS` was **8000**. Human cold `POST /v1/chat/completions` was **32380 ms**. `mergeSignals` aborts at 8s and maps that to `PROVIDER_UNAVAILABLE` / "Connection timed out". Connection test (`GET /models`) can still be fast.
2. **Test Connection never committed `Testing...`.** `testDirectorConnection` built a connecting state internally, then `await`ed the fetch, and the button handler only `commit`ed the final promise. Button text stayed "Test connection". No Testing / Connected / Failed surface next to the control.
3. **Packaged WebView Origin / CORS (protocol-proven for Windows Tauri 2 + typical local servers).** Packaged origin is `http://tauri.localhost`. PowerShell has no `Origin`. Local `/v1` servers that allow `127.0.0.1` / `tauri://*` but not `http://tauri.localhost` reject or CORS-hide the browser `fetch`. That also maps to `PROVIDER_UNAVAILABLE` ("Failed to fetch") and hid the category. WebView `TypeError: Failed to fetch` cannot distinguish CORS vs REFUSED; setup now labels that `UNKNOWN` unless the error names CORS/refused/timeout. `csp: null`; no mixed-content (`useHttpsScheme` unset). ADV-5 URL join (`/v1` + `/models`) is correct.

### WHY POWERSHELL WORKED

Native HTTP, no WebView `Origin`, no CORS preflight, default request timeout much longer than 32s.

### WHY PACKAGED FAILED

Browser `fetch` from `http://tauri.localhost` + 8s chat abort + error UI that showed only `PROVIDER_UNAVAILABLE` + Test Connection that did not flip visible state on click.

### Fix (generic provider, ADV-5 kept)

- Chat default **90000 ms** (configurable 8000–180000, still fail-closed). Connection test stays **8000 ms**.
- Packaged path: Rust `local_ai_http` loopback-only GET/POST (no WebView Origin). Tests / web keep `fetchImpl` / `fetch`.
- Immediate **Testing...**, then **Connected (endpoint, model, latency ms)** or **CONNECTION FAILED (endpoint, sanitized reason, category)**.
- `[Discover Models]` and Test Connection populate the model list from `GET {baseUrl}/models`. No vendor hardcoding.
- Optional user-triggered `[Find Local AI]` on loopback ports `11434, 1234, 8080, 4891, 5000, 8000` only, 800 ms each. No LAN / startup scan.
- Sanitized diagnostics only (no keys / Authorization / Project dumps).

### Human expected cold latency

First local chat after a model load can be **~32 s** (human `qwen2.5:7b`). Warm **~0.7 s**. Default chat timeout 90s covers cold start and still fail-closes.

### Gates (this run)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npx vitest run tests/ai/ai-*.test.ts*` | **149 passed** (137 prior + 12 human-integration) |
| `npx vitest run` | **1541 passed / 6 failed / 1547** (175 files passed / 2 failed / 177) — inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 186 modules) |
| `git diff 7479fcf -- src/core/frame-engine src/core/exporter` | empty |
| Windows package | **NOT AVAILABLE** on this Linux VM — coordinator builds EXE |
| New regressions | none |

### Stop

No AI-8. Do **not** merge this PR to `main`. Do **not** merge PR #2 to `main`. Coordinator may merge to `ai/ai-director-foundation-v6` after Martin’s human gates.

---

## AI DIRECTOR AUTO-ORCHESTRATION

**Branch:** `cursor/director-auto-orchestration-b277`  
**Start HEAD:** `21323a86e942da08507917d4a0b4df8527086c78` (`ai/ai-director-foundation-v6`, PR #6 merged)  
**Target:** `ai/ai-director-foundation-v6` — **not** `main`. PR #2 stays open draft → `main`.  
**Intent:** Deterministic Director plans intent → context → capability → provider → model, then invokes the existing pipeline. AUTO-ORCHESTRATION ≠ AUTO-AUTHORIZATION. Schema stays **5**. No AI-8. No new tools / delete / cloud / Voice / STT / Builder.

### Phase 0 — verify & map (before this run)

| Item | Evidence |
| --- | --- |
| HEAD BEFORE | `21323a86e942da08507917d4a0b4df8527086c78` = Merge pull request #6 |
| PR #6 | MERGED into `ai/ai-director-foundation-v6` (local provider) |
| PR #5 | MERGED (workspace UX) |
| PR #2 | OPEN draft → `main`. Not merged. |
| Schema | `PROJECT_SCHEMA_VERSION = 5` |
| AI-8 | Not started |
| Human-proven | Ollama + discovered `qwen2.5:7b` → `timeline.move_clip` +2000 exact Apply (prior). This run does **not** fake additional human proof. |

Map before coding: Provider mock / openai-compatible (loopback). Modes ASK/DRAFT/AGENT. Grants READ/DRAFT/EDIT. Context NONE…CUSTOM (auto uses SELECTION or NONE only). Tools = six READ + `timeline.move_clip`. Txn draft/apply/reject + revision. Prefs URL/model/timeout only.

### Hard laws

- Director MAY auto-pick intent / context / mode / capability / provider / model.
- MUST NOT silently escalate grants (READ→EDIT). LLM never asks for its own permissions; never self-grants.
- ALLOW EDIT ≠ APPLY EDIT. Allow once = this request. Allow session = until restart, not Project. Cancel = zero mutation / history / revision.
- Provider AUTO: configured available LOCAL only. No cloud fallback. Model AUTO from discovered ids (no vendor hardcode). Discovery cached. Down → LOCAL AI UNAVAILABLE + Retry / Advanced.
- Unsupported delete → structured `NO_TOOL`. Do not invent `move_clip`. Do not broaden tools.

### Files

- `src/app/ai/orchestration/intent.ts` — known routes only
- `src/app/ai/orchestration/plan.ts` — DirectorPlan (no execution)
- `src/app/ai/orchestration/health.ts` — discovery cache + auto provider/model
- `src/app/ai/host.ts` — `submitDirectorAutoTurn`, auth once/session/cancel, `effectiveGrant`
- `src/ui/director/DirectorPanel.tsx` — Normal compact + Advanced + auth + unavailable
- `tests/ai/ai-director-auto-orchestration.test.ts`
- `tests/ai/ai-director-auto-orchestration-ui.test.tsx`

### Tests A–N

| ID | Case | Result |
| --- | --- | --- |
| A | READ auto (selection / analyze clip) | pending gate |
| B | EDIT auto plan AGENT/SELECTION/EDIT/move_clip | pending gate |
| C | Escalation block READ→EDIT | pending gate |
| D | Allow once | pending gate |
| E | Allow for session (not Project) | pending gate |
| F | Cancel zero mutation | pending gate |
| G | Unsupported delete NO_TOOL | pending gate |
| H | Auto provider local only | pending gate |
| I | Auto model discovered ids | pending gate |
| J | Down/missing LOCAL AI UNAVAILABLE | pending gate |
| K | Golden AUTO path +2000 | pending gate |
| L | snap=true still +2000 | pending gate |
| M | stale TRANSACTION_CONFLICT | pending gate |
| N | Uncertain / capability / draft-cut less authority | pending gate |

### Gates (this run)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | pending |
| `npx vitest run tests/ai/ai-*.test.ts*` | pending |
| `npx vitest run` | pending |
| `npx vite build` | pending |
| Windows package | **NOT AVAILABLE** on this Linux VM |
| Human-proven additional | **not claimed** |

### Stop

No AI-8. Do **not** merge this PR to `main`. Do **not** merge PR #2 to `main`. Do **not** merge automatically to the foundation branch.
