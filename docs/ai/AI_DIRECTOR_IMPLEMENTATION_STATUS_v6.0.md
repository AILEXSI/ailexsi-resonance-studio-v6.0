# AILEXSI Resonance Studio V6.0 — AI Director Implementation Status

**Document:** `docs/ai/AI_DIRECTOR_IMPLEMENTATION_STATUS_v6.0.md`  
**Branch:** `ai/ai-director-foundation-v6`  
**Base:** `7479fcf0fce2f4f0b81e6ec141f855c47cb613ff` (AI-0 merged on `main`)  
**Map:** [`AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md`](./AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md) (AI-0 evidence; proposals are not shipped facts)

This file records **what this implementation run actually shipped**, per completed gate. It does not rewrite AI-0 evidence as history.

Labels: **SHIPPED** = present on this branch after a passing gate. **PROPOSAL** remains a later-phase design from the AI-0 map.

---

## Highest completed phase

| Field | Value |
| --- | --- |
| Highest gate | **AI-3** (gate recording) |
| Schema | **5** (unchanged) |
| Mutation path | none |
| Second engine | none |
| Direct AI project mutation | none |
| RAF provider traffic | none |
| Secrets in Project / Git | none |

### AI-1 gate

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npx vitest run tests/ai/ai-1-director-shell.test.tsx` | **6 passed** |
| `npx vitest run` | **1394 passed / 6 failed / 1400** (164 files) — failures are inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 170 modules) |

### AI-2 gate

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | PASS |
| `npx vitest run tests/ai/ai-1-director-shell.test.tsx tests/ai/ai-2-provider.test.ts` | **16 passed** |
| `npx vitest run` | **1405 passed / 6 failed / 1411** — inherited AFE-15×2 + STRESS-03×4 only |
| `npx vite build` | PASS (vite 7.3.6, 175 modules) |

---

## AI-1 — Director shell

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `feat(ai): add feature-gated Director shell` |
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

- Offline mock conversation only.
- Provider / mode / context / transaction rows are placeholders.
- No tools, no providers, no revision, no grants.

### Next gate (completed)

AI-2 — provider abstraction + MockProvider.

---

## AI-2 — Provider abstraction

| Field | Value |
| --- | --- |
| Status | **SHIPPED / GATE PASS** |
| Commit | `feat(ai): add provider abstraction` |
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

- No real HTTP provider yet.
- Cloud ids reserved only.
- No tools / grants.

### Next gate

AI-3 — local OpenAI-compatible provider (CHAT only).

---

## AI-3 … AI-7

Not started.

---

## Inherited baseline (do not treat as AI regressions)

From AI-0 / V6 baseline: AFE-15 ×2 (dump-ban regex) and STRESS-03 ×4 (operator clip absent) may fail identically. Do not “fix” AFE/exporter/mux.
