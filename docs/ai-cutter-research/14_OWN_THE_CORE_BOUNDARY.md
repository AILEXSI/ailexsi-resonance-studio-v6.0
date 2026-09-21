# 14 — Own-the-core boundary

Principle: **own the core, cut the edges.** The model is not the core. The NLE is not the core.

| Concern | Owner | Replaceable edge | v0.1 action |
| --- | --- | --- | --- |
| Evidence schema, epistemic status, ids | AILEXSI | — | Specify. Do not ship code in this PR |
| Peak and RMS reducers | AILEXSI | PCM decode (file reader, FFmpeg, future engine) | Specify. PoC may compute them in a throwaway script |
| Activity policy (threshold, margin, mins) | AILEXSI | The numeric defaults | Named policy `ae-default-v0` |
| Speech words | Contract | Whisper, faster-whisper, any STT | Fake JSON only |
| VAD probability | Contract, later | Silero, pyannote, WebRTC | Out |
| Shot scores | Contract, later | PySceneDetect math, TransNet | Out |
| Motion scores | Contract, later | — | Out. If added: mean abs diff, not exact pixel equality |
| Keyframes | — | Decoder | Out |
| Diarization, active speaker | — | pyannote, TalkNet, LR-ASD | Out. community-1 weights are CC-BY-4.0 |
| Edit decisions KEEP/CUT | AILEXSI | — | Specify |
| Arrangement document | AILEXSI | — | Specify. Not OTIO |
| Timeline diff and ripple vs retime | AILEXSI | otio-diff as a hint, not a library | Specify |
| Correction events | AILEXSI | — | Specify |
| Preference hypotheses, scopes, inert flag | AILEXSI | — | Specify. No trained policy |
| Confidence function | AILEXSI | — | The ratio in file 11, pre-registered |
| Vault retention / sync | — | — | UNKNOWN. Not designed |
| Canonical project, undo, commands | AILEXSI Resonance, already | — | Do not fork |
| Promote into the project | AILEXSI, later | — | Blocked on compound undo (map AI-9). Not v0.1 |
| Playback of a proposal | Host | Resonance engine | UNKNOWN if possible without temp clips |
| OTIO / EDL / FCP XML / AAF | Adapter, later | OTIO plugins | Not built |
| Premiere, Resolve, FCP, CapCut | Hosts, later | Their APIs | No adapters |
| LLM wording | Edge | Any chat model | Untrusted, as in P1. Not a decision maker |
| Embeddings, vector DB | — | — | Out |
| Codecs, GPU runtimes, torch | Edge | — | Not imported |
| Foundation / editor RL training | Nobody in this program | — | Stop |

## Legal boundary (practical, not a clearance)

| May read and reimplement the idea | Do not copy in | Do not redistribute |
| --- | --- | --- |
| Auto-Editor Unlicense algorithm description | Vendored tinyre, libp2p, Nim sources | FFmpeg builds |
| PySceneDetect BSD-3 ideas | The Python modules | Benchmark videos |
| OTIO Apache-2.0 concepts | The C++ | — |
| WhisperX schema shape | The package and its torch stack | community-1 weights |
| otio-diff class names as prior art | Its Python | — |

AGPL `whisper-timestamped`: do not read into a port. The license row is enough.

## Process boundary

A future provider is a process that reads a content hash and writes observations. The core does not link it. This PR creates no process.
