# Repository cleanup recommendations

Status: recommendation only. This note does not close a pull request and does not delete a branch.

Checked against `origin` on 24 October 2026. `git ls-remote` listed **51** branch heads. A 52nd head was not present. Counts below are `git rev-list --count HEAD..<branch>` on `cursor/ai-director-d706`: zero means every commit on that branch is already in this branch.

Draft PR **#25** (`cursor/ai-director-d706`) is the studio line to keep. Do not merge it from this note.

## Launch scripts

Moved with `git mv` (nothing deleted):

- `legacy/Start-V5.cmd`
- `legacy/BUILD_AND_RUN_V5.5.cmd`
- `legacy/INSTALL_BUILD_RUN_V5.5.cmd`

Those three still call `scripts/build-v5.5-windows.ps1` and `scripts/run-v5.5.ps1`, but from the parent directory, because the helpers stay at the repo root.

V6 launchers stay at the root and still point at those same helpers:

- `Start-V6.cmd` → `scripts\run-v5.5.ps1`
- `BUILD_AND_RUN_V6.0.cmd` → `scripts\build-v5.5-windows.ps1` then `scripts\run-v5.5.ps1`
- `INSTALL_BUILD_RUN_V6.0.cmd` → the same pair, including the dev fallback

`npm run tauri:exe` is unchanged. Older docs that name the V5.5 launchers at the repo root now mean `legacy/`.

## Draft pull requests

| PR | Branch | In #25? | Recommendation |
| --- | --- | --- | --- |
| #2 | `ai/ai-director-foundation-v6` | No. 73 commits are not in this branch. | Keep. This is a different Director (inspect range, AUTO routing, human gates). #25 does not contain those tools. Do not treat it as superseded. |
| #20 | `cursor/ai-cutter-mechanics-exp-1-504f` | No. Two experiment commits on top of the foundation line. | Keep as a non-product archive. It is not wired into `src/`. |
| #21 | `cursor/resonance-dunes-vendored-e436` | No. Three commits, about 980 lines. | Keep. The dunes scene and live analyser are not in #25. Port later; it edits the scene catalog, so it was not copied in this pass. |
| #22 | `cursor/foundation-dunes-integration` | No. #21 merged onto the foundation branch. | Keep until #21 and #2 have a decision. It does not add a third feature. |
| #23 | `feat/music-journey-world-state` | No. 19 commits, about 400 added lines, 13 files. | Keep. Journey worlds and Journey Voyage are additive Visualz scenes and are worth a later port. Not copied here. |
| #24 | `cursor/song-analysis-pass0-cafd` | No. Three song-analysis commits (about 2200 lines, 14 files) on top of #2. | Keep. Do not merge onto #25: the base Director is the foundation branch, not this one. The useful part is pass-0 lyrics, one LRC offset, and fail-closed limits. That belongs in a later AI-7 slice, not a cherry-pick of the branch. |
| #25 | `cursor/ai-director-d706` | This branch. | Keep open as the draft. Do not merge until Martin says so. |

## Branches whose commits are already in this branch

These 26 heads, plus `main`, have no commits that this branch lacks. Deleting them is a later human decision. This note does not delete them. `cursor/ai-director-d706` is the open draft, so leave it.

- `cursor/afe-04-bframe-ctts-3d31`
- `cursor/afe-16-empty-pump-slice-8556`
- `cursor/afe-17-high-water-target-fd2c`
- `cursor/ai-0-architecture-mapping-v6-a186`
- `cursor/audio-01-long-form-fail-honest-80b1`
- `cursor/docs-stamp-90min-longform-0da2`
- `cursor/enc-01-1080p-avc-capability-2f62`
- `cursor/fix-windows-npm-cmd-a8a0`
- `cursor/ps1-handoff-parser-f602`
- `cursor/stress-01-clip-start-pts-100000-73dc`
- `cursor/stress-02-call-stack-diagnostic-59f3`
- `cursor/stress-03-pre-request-source-open-704d`
- `cursor/stress-04-mp4-mux-arg-overflow-11b1`
- `cursor/ui-responsive-track-headers-6a5d`
- `cursor/ui-workspace-ergonomics-v56-11df`
- `cursor/v55-complete-bootstrap-0abf`
- `cursor/v56-final-freeze-3d7e`
- `cursor/vis-lexi-family-consolidation-0a86`
- `cursor/vis-response-01-impact-layer-e2d7`
- `cursor/vis-scene-lexi-2036-cinematic-ef57`
- `cursor/vis-scene-lexi-horizon-e5c2`
- `cursor/vis-scene-lexi-polish-v2-f909`
- `cursor/vis-scene-lexi-ref-level-b8fe`
- `cursor/vis-scene-lexi-v3-cinematic-depth-9f48`
- `cursor/vis-sync-01-preview-export-parity-2f4e`
- `main`

## Branches that still have commits this branch does not

Leave all of them. They sit on the foundation Director line unless noted.

| Unique commits | Branch | What the tip is |
| --- | --- | --- |
| 2 | `cursor/ai-0-recon-architecture-freeze-45e4` | AI-0 reconnaissance docs |
| 20 | `cursor/director-sidebar-layout-ace9` | Director sidebar layout |
| 26 | `cursor/ai-director-golden-path-activate-bb64` | Golden-path move limits |
| 30 | `cursor/director-workspace-human-gate-61f3` | Workspace human gate |
| 33 | `cursor/local-provider-human-integration-a15e` | Local provider gates |
| 37 | `cursor/director-auto-orchestration-b277` | AUTO orchestration chrome |
| 40 | `cursor/director-auto-orch-plan-loss-fix-b9d7` | Request-scoped AUTO plan |
| 44 | `cursor/director-workspace-presentation-a23a` | Hidden diagnostics form |
| 46 | `cursor/human-gate-repair-2-c0bc` | Human-gate repair |
| 49 | `cursor/human-ux-auto-orch-dc1c` | Human UX plus AUTO |
| 52 | `cursor/human-retest-selection-resize-3eb7` | Selection and resize gates |
| 55 | `cursor/human-retest-auto-gate-31a2` | AUTO gate retest |
| 58 | `cursor/preview-resize-remeasure-49c2` | Preview resize remeasure |
| 59 | `cursor/preview-remeasure-repair-2-2b0c` | Preview remeasure after maximize |
| 62 | `cursor/ai-director-auto-routing-654f` | AUTO routing |
| 64 | `cursor/prepared-move-preview-audit-fa20` | Prepared-move preview |
| 68 | `cursor/perception-p1a-inspect-range-2dcb` | `timeline.inspect_range` |
| 72 | `cursor/ai-cutter-research-audit-v01-68c9` | AI Cutter research audit |
| 73 | `ai/ai-director-foundation-v6` | Foundation tip (PR #2) |
| 75 | `cursor/ai-cutter-mechanics-exp-1-504f` | Synthetic mechanics runner (PR #20) |
| 76 | `cursor/song-analysis-pass0-cafd` | Pass-0 song analysis (PR #24) |
| 77 | `cursor/foundation-dunes-integration` | Dunes on the foundation (PR #22) |
| 3 | `cursor/resonance-dunes-vendored-e436` | Dunes scene (PR #21), not on the foundation tip |
| 19 | `feat/music-journey-world-state` | Journey worlds (PR #23), based on main |

The preview remeasure branches may contain a resize fix this tree does not have. Compare them before any delete. Do not assume the foundation stack is obsolete just because #25 also has a Director.
