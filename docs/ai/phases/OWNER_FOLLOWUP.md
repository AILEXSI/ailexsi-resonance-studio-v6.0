# Owner follow-up

Status: complete for the items this environment can build.

The owner answered the open questions and asked for the missing pieces on the same branch. AI-4, AI-5, and AI-6 remain one commit, `cb988ed`. This follow-up is a later commit. The history was not rewritten.

## What landed

- Send context includes the project name, every track name, and marker labels. Asset file names, paths, object URLs, and media bytes stay out. The Director panel shows the JSON that Send includes. The mock provider still receives no context.
- Same-track audio crossfades are proposed with `setClipFades` (200 ms, then the existing fade normalizer) when a marker split asks for transitions. One Accept is one undo, and that undo restores the fades.
- `audio.detect_beats` decodes the selected clip's loaded audio in process and measures RMS onsets. It proposes markers at those times, labeled Beat or Onset with a confidence number. It does not invent a tempo. Accept keeps the clip selected. One undo removes the markers.
- After those markers exist, the existing cut-at-beats request splits on them and can add the audio fades.
- Opt-in OS keychain commands (`ai_keychain_status`, `ai_keychain_exists`, `ai_keychain_set`, `ai_keychain_delete`) use the `keyring` crate in the Tauri shell. `ai_chat` reads a saved key in-process and returns only the provider response. The browser checkbox stays disabled. The key is not written to localStorage and is not copied back into the webview.

## Windows EXE

The Linux agent VM still cannot produce the EXE (rustc 1.83.0, no Windows target, lockfile needs Rust 1.85+ for `icu_locale_core` 2.3.0). GitHub Actions builds it instead.

- Workflow: `.github/workflows/windows-exe.yml`
- Runner: `windows-latest`, Rust stable (the job fails if rustc is older than 1.85)
- Command: `npm run tauri:exe` (`tauri build`, then `scripts/copy-exe.ps1`)
- Triggers: push to `cursor/ai-director-d706`, and `workflow_dispatch`
- Artifact: `resonance-studio-v6-windows` (repo-root EXE, plus NSIS/MSI if the bundler produced them)
- No signing secrets and no GitHub Release
- The job also checks that the built EXE contains the keychain service id and `ai-director-api-key`, so the new keyring commands were linked

## Inherited export tests

Left unchanged.

- AFE-15 A and N fail because `formatStallMessage` in `src/core/frame-engine` prints `visFrames` and `coldOpenAfterVis`. The tests forbid the substring `VIS`. Changing that dump means editing the Frame Engine, which stays off limits. Loosening the ban would hide the check.
- STRESS-03 H–K fail because `STRESS03_CLIP` is unset and the physical source file is not in this environment. There is no safe code fix for a missing media file.

## Tests

Recorded after this follow-up, on this branch:

- `npx tsc --noEmit` passed.
- `npx vitest run` — 1429 passed, 6 failed, 1435 tests, 174 files. The six failures are the inherited cases above: AFE-15 A and N, and STRESS-03 H–K.
- `npx vite build` passed (187 modules). Rollup printed the existing chunk-size warning.
- This repo has no eslint script. Unused symbols are gated by `tsc`.
