# AILEXSI Resonance Studio V6.0

Version **6.0.0**. Product chip **`V6.0.0`**. JSON `schemaVersion` **5**.

Active development line. Baseline = final HUMAN-PROVEN V5.6 (`v5.6.0-final`). First-party Frame Engine. Mediabunny-free. Full git history from https://github.com/AILEXSI/ailexsi-resonance-studio-v5.6 (V5.6 is a frozen archive — not deleted).

One-look table: `CURRENT.md`. V6 baseline: `docs/V6.0-BASELINE.md`. V5.6 freeze: `docs/V5.6-FINAL-FREEZE.md`. V5.6 release: `docs/V5.6-RELEASE.md`. Human acceptance: `docs/V5.5-HUMAN-ACCEPTANCE.md`.

## What this is

Local-first arrange / cutter / mixer / export. Export is H.264 MP4 via WebCodecs. **Frame Engine: AILEXSI** only. Preview may use HTMLVideo. Export does not fall back to HTMLVideo.

Preserved from V5.6: D dynamic audio, E stem import, F track/chapter groups, G volume automation, H write volume, transport, VIS / LEXI FLOW, mixer, save/export `.vN`, AILEXSI Frame Engine, ENC-01 1080p.

**1080p H.264 @ 24/25/30 is HUMAN-PROVEN** on Windows WebView2 EXE tip `0ec7758`. Long-form VIDEO+VIS+AAC is HUMAN-PROVEN at **~34:18**, **~64 min**, and **~90 min (01:30:30)**. Do not invent 120/160 min HUMAN-PROVEN.

## Start

Dev (MODE A — browser or Tauri webview, port 1421):

```
npm run web:dev
```

or

```
npx tauri dev
```

Windows (operator machine):

```
INSTALL_BUILD_RUN_V6.0.cmd
BUILD_AND_RUN_V6.0.cmd
```

V5 and V5.5 launchers now live in `legacy/` and call the same helpers one directory up. Use the V6 launchers above.

Standalone EXE (MODE B, Windows host):

```
npm run tauri:exe
```

Copies `AILEXSI Resonance Studio V6.0.exe` to the repo root when the Windows toolchain is present. This Linux environment cannot produce that EXE — see `docs/V6.0-BASELINE.md` for the Windows recipe. Do not commit `*.exe` to git.

## Top bar

`File | Import | Export | ARRANGE | CUTTER` plus permanent top-right **`V6.0.0`**.

Export dialog shows **`Frame Engine: AILEXSI`** from `getFrameSourceBackend()`.

## Storage

V6-specific, side-by-side with V5.6: `resonance-studio-v6-0*` keys and Tauri identifier `com.ailexsi.resonance-studio-v6-0`. Project JSON `schemaVersion` **5** still opens. V5.6 AppData (`com.ailexsi.resonance-studio-v5-5`) is not migrated and is not overwritten.

## Compliance

Engineering SBOMs: `docs/compliance/`. No `LICENSE` / `THIRD_PARTY_NOTICES`. This product does **not** claim MPL FREE.

Historical V5 / V5.5 / V5.6 evidence remains labelled historical.

App icon: **愛** — Tauri icons in `src-tauri/icons/`. Icons nicht anfassen.
