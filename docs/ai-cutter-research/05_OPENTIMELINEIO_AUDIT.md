# 05 — OpenTimelineIO audit

**Repo:** https://github.com/AcademySoftwareFoundation/OpenTimelineIO  
**Commit:** `8ab0cf963624cfe3daf3c79c937cf603b4ef783b` (2026-09-20)  
**Version:** 0.19.0 (`OTIO_VERSION.json`)  
**License:** Apache-2.0 (`LICENSE.txt`). SPDX headers on sources. Contributor CLA files exist (`OTIO_CLA_*.pdf`). The CLA binds contributors, not users of the library.  
**Inspected:** 2026-09-21. Headers and schema read. Not built.

## 01–26

### 01 Repo

**FACT.** AcademySoftwareFoundation/OpenTimelineIO. C++ core (`src/opentimelineio`), Python bindings (`src/py-opentimelineio`). 1986 stars. Not archived. Tip commit links minizip-ng.

### 02 License

Apache-2.0. Permissive. Patent grant is part of Apache-2.0. Trademark: README states nothing grants rights to Pixar or other names.  
**INFERENCE.** Depending on OTIO later as an adapter is legally ordinary. Copying the C++ into Resonance to "own" it would create an Apache-2.0 attribution duty and a second timeline. This audit recommends neither copying nor linking in v0.1.

### 03 Maintenance

**FACT.** Commit 2026-09-20. ASWF project. VFX-platform support policy is documented. Active.

### 04 Problem

Interchange of editorial data across tools: clips, tracks, ranges, transitions, markers, metadata, media references. Not a player, not a cutter, not an intelligence core.

### 05 Input / output

**Core, this commit.** `builtin_adapters.plugin_manifest.json` lists only `otio_json` (`.otio`), `otioz`, and `otiod`.  
**FACT (README).** After v0.16, PyPI `OpenTimelineIO` is core only. NLE formats ship in `OpenTimelineIO-Plugins` and org repos such as `otio-aaf-adapter` and `otio-fcp-adapter` (Apache-2.0, separate trees, not cloned). README names Final Cut Pro XML, AAF, and CMX 3600 EDL as adapter-plugin formats.

### 06 Algorithm

There is no detection algorithm. The object model:

- **RationalTime.** A value and a rate. Not an integer millisecond.  
- **TimeRange.** Start plus duration, both rational.  
- **Item.** Optional `source_range`. Effects and markers hang off composable items.  
- **Clip** (schema version 2 in `clip.h`). A media reference plus a trim (`source_range`). Multiple media references can exist; one is active (`DEFAULT_MEDIA`).  
- **Gap.** Empty time on a track.  
- **Track.** A sequence (items in order).  
- **Stack.** Layers. A timeline's tracks are composed this way.  
- **Transition.** Overlap between neighbors (in/out offsets). Kind is not a full effect graph.  
- **Marker.** Name, color, marked range, comment.  
- **Effect / LinearTimeWarp / FreezeFrame.** Time effects. `time_scalar` on a linear warp is how Auto-Editor encodes speed in its OTIO writer (comment in `auto-editor/src/exports/otio.nim`: visible duration = source duration / time_scalar).  
- **MediaReference.** `ExternalReference` (target URL), `MissingReference`, `ImageSequenceReference`, `GeneratorReference`.  
- **Metadata.** `AnyDictionary` on serializable objects. Untyped.  
- **Serialization.** Each object has `OTIO_SCHEMA` name and version. Unknown schemas can round-trip (`unknownSchema`).  
- **Algorithms present in core.** Track and stack algorithms (trim, insert, and similar editorial operations in `trackAlgorithm` / `stackAlgorithm`). Not a diff.

### 07 State

A serializable object graph. No undo stack. No selection. No playhead required by the schema (applications add those).

### 08 Parameters

Schema versions per type. Adapter arguments are plugin-defined. No detection thresholds.

### 09 Dependencies

C++ standard library, Imath (vendored under `src/deps`), RapidJSON, pybind11, minizip-ng for otioz. Plugins add their own (AAF SDK, XML).

### 10 Models

None.

### 11 Hardware

Irrelevant. CPU, in memory.

### 12 Performance

**UNKNOWN** here. **INFERENCE.** Fine for a timeline document. Not a media scanner.

### 13 Deterministic vs model

Deterministic schema. Adapter lossiness is the non-determinism: two NLEs do not round-trip effects.

### 14 Failures

- Effects and many transitions are tool-specific. Auto-Editor's OTIO embeds `AE.ADBE Invert`. A Resolve reader may ignore it or misread it. **FACT** that the writer does this. **UNKNOWN** whether current Premiere still imports that file.  
- Metadata is a bag. Nothing stops a tool from writing an interpretation into metadata and another tool from treating it as fact.  
- Rational rates (24000/1001) do not survive a round-trip through integer milliseconds without a recorded rounding rule.  
- Missing media becomes `MissingReference`. The cut structure can still be valid.  
- Nested stacks make "the clip list" ambiguous.

### 15 Edge cases

Zero-duration clips. Overlapping transitions. Multiple media references (picture vs proxy). Generators with no URL. Mixed rates on one timeline. Gaps that a ripple would close. Negative time (Auto-Editor uses a Premiere sentinel around −100 hours for keyframe position in its writer: constant `POS = -10800000.0` in `otio.nim`). That sentinel is an NLE habit, not an OTIO rule.

### 16 Tests

**FACT.** A `tests/` tree exists in the repo (not executed). The project is known for conformance tests. **UNKNOWN** adapter conformance at the plugin repos' tips.

### 17 Architecture decisions

- Core schema versus plugins. This is the important one. Interchange formats rot independently of the object model.  
- Rational time instead of floats or milliseconds.  
- Explicit gaps instead of "the space between clips".  
- Source range (media time) separate from the item's place on the track (record time).  
- Unknown schema preserved rather than stripped.

### 18 Commodity vs clever

**Commodity:** a clip has a media ref and an in/out.  
**Clever:** versioned schema, rational time, missing references, plugin hooks (`post_adapter_read`, media linkers).  
**Not provided:** diff, evidence, confidence, preference.

### 19 Useful for AILEXSI

Concepts to borrow, not classes to import:

| OTIO idea | AILEXSI v0.1 use |
| --- | --- |
| source_range vs record placement | Already half-present: `sourceInMs` / `sourceOutMs` vs `startMs` / `durationMs` |
| Gap | Represent removed time explicitly in an arrangement, or as a decision. Do not only store keeps and hope |
| MissingReference | Asset `missing: true` already exists on `MediaAsset` |
| RationalTime | Record `rateNum/rateDen` beside millisecond fields |
| Untyped metadata | Do **not** use it as the evidence store |
| Adapter plugin | Later, one writer, editorial fields only |

### 20 Avoid

- Replacing `Project` / `HistoryStack` / `EditorCommand` with an OTIO document.  
- Reimplementing AAF or FCPXML.  
- Putting observations in a free-form dictionary.  
- Assuming `.otio` from another tool is free of vendor effects.

### 21 Legal

Apache-2.0 is compatible with a later optional dependency if counsel agrees. v0.1 takes no dependency. Do not paste OTIO sources into docs or into `src/`. CLA is irrelevant unless AILEXSI contributes upstream.

### 22 Easiest independent approach

Keep schema 5 as the host document. Define a smaller **Arrangement** for AI proposals (file 09). Convert to OTIO only at an export boundary that does not exist yet.

### 23 Difficulty

**HIGH** to own full interchange. **LOW** to borrow four concepts. **MEDIUM** to write a correct editorial OTIO exporter later (rates, gaps, speed).

### 24 Benchmark cases

Not media. Schema fixtures:

1. One clip, source in 10 s, timeline start 0, duration 4 s.  
2. Same clip after a 1 s head trim (source in moves, record start may not).  
3. A ripple that shifts the next clip's record time only.  
4. Rate 30000/1001 stored as rational, and the millisecond rounding written down.  
5. A missing asset with the cut still intact.

### 25 Provenance

`OTIO_VERSION.json`, `LICENSE.txt`, README adapter section, `builtin_adapters.plugin_manifest.json`, `clip.h`, Auto-Editor `otio.nim` comment for the vendor-effect fact.

### 26 Open questions

Fidelity of current AAF and FCPXML adapters. **UNKNOWN** (not cloned). Whether issue #26 will land a core diff. **UNKNOWN.** As of this tip it has not.

---

## Decision: A, B, or C?

The question: should AILEXSI (A) keep an independent timeline, (B) own an implementation of OTIO's concepts, or (C) keep an internal model plus an OTIO adapter?

**Choice: A now, C later, B never as a goal.**

| Option | Verdict | Evidence |
| --- | --- | --- |
| A. Independent arrangement | **Yes, v0.1** | Resonance already owns `Project`, stable clip ids, `EditorCommand`, `HistoryStack` (map + `models.ts`). OTIO has no evidence layer and no diff. P1 forbids a second mutation path. |
| B. Reimplement OTIO concepts as the core | **No** | That is a second timeline: rational time, stacks, effects, schema versions, unknown-schema passthrough. It does not buy perception or preference. Adapter fidelity still lives outside core. |
| C. Internal model + OTIO adapter | **Later, editorial only** | The plugin split (post-0.16) is the pattern: core stays small; formats are edges. Auto-Editor shows an OTIO file can be a Premiere dialect. An adapter must declare what it drops. |

**INFERENCE.** The intelligence core's timeline is an Arrangement of source ranges over AILEXSI asset ids. OTIO is one export, beside a future Premiere or Resolve adapter, not the document those adapters edit.

**HYPOTHESIS.** Integer milliseconds plus a recorded rational rate are enough for interview jump-cuts (frame is ~33 ms at 30 fps; 1 ms is finer). **UNKNOWN** for a frame-accurate 23.976 round-trip into an NLE. The rate fields exist so that unknown can be closed without a schema break.
