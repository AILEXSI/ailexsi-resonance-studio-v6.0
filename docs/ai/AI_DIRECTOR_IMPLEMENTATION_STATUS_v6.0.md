# AILEXSI Resonance Studio V6.0 — AI Director Implementation Status

**Document:** `docs/ai/AI_DIRECTOR_IMPLEMENTATION_STATUS_v6.0.md`  
**Branch:** `ai/ai-director-foundation-v6`  
**Base:** `7479fcf0fce2f4f0b81e6ec141f855c47cb613ff` (AI-0 merged on `main`)  
**HEAD (AI-7 code):** `3e4def1958584a7c153ffc70ef8cb5f6978ecb31`  
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

## Next (outside this run)

Human review of PR. Coordinator may merge. Do **not** implement a second mutating tool on this branch.
