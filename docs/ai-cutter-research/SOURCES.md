# Sources

Every important claim in `docs/ai-cutter-research/` should trace to a row here. This file is an evidence index, not a license clearance and not permission to copy.

**Date inspected:** 2026-09-21  
**Method:** shallow `git clone` into `/tmp/research` (not this repository), plus GitHub metadata and public model cards. No reference-repo tests were executed. No models were run. README numbers are labeled as README claims in the audits.

| ID | What | URL | Commit / tag inspected | License as inspected | Paper / notes |
| --- | --- | --- | --- | --- | --- |
| AE | WyattBlue/auto-editor | https://github.com/WyattBlue/auto-editor | `7796222139b5d87fe32247f8a60a931b02006db5` (2026-09-19, "ffmpeg 9.0.2") | Unlicense (root `LICENSE`). Vendored `tinyre` MIT, `libp2p` MIT, `csort` Unlicense | Tests live in a separate repo: https://github.com/WyattBlue/auto-editor-tests (referenced by `.github/workflows/smoke.yml`). Not cloned. |
| WX | m-bain/whisperX | https://github.com/m-bain/whisperX | `2cfd7b7c5c7bba144954364db747319b50e8232b` (2026-07-13) | BSD-2-Clause. Package version in `pyproject.toml`: `3.8.7rc1` | Bain et al., arXiv:2303.00747, INTERSPEECH 2023. https://arxiv.org/abs/2303.00747 |
| PSD | Breakthrough/PySceneDetect | https://github.com/Breakthrough/PySceneDetect | `81c414cb4b706e58648f98efd381024790b1565f` (2026-09-21) | BSD-3-Clause. Package `__version__` = `0.7.1` | Sweep numbers are in-repo `benchmark/SWEEP_REPORT.md`, not a re-run by this audit. |
| TN | soCzech/TransNetV2 | https://github.com/soCzech/TransNetV2 | `85cef72af9a916bdfd7cc94a670c9cdfbf12d1ed` (2021-07-28, "minor fix"). GitHub `pushed_at` 2023-12-04 does not move `master` | MIT (`LICENSE`). Weights are git-lfs; this clone did not pull LFS payloads | Souček & Lokoč, arXiv:2008.04838. https://arxiv.org/abs/2008.04838 |
| OTIO | AcademySoftwareFoundation/OpenTimelineIO | https://github.com/AcademySoftwareFoundation/OpenTimelineIO | `8ab0cf963624cfe3daf3c79c937cf603b4ef783b` (2026-09-20). `OTIO_VERSION.json` = 0.19.0 | Apache-2.0 | Core adapters are only `.otio` / `.otioz` / `.otiod`. NLE adapters moved out after v0.16. |
| OTIO-AAF | otio-aaf-adapter | https://github.com/OpenTimelineIO/otio-aaf-adapter | not cloned; GitHub metadata 2026-09-21 | Apache-2.0 (GitHub SPDX) | |
| OTIO-FCP | otio-fcp-adapter | https://github.com/OpenTimelineIO/otio-fcp-adapter | not cloned; metadata pushed 2026-04-08 | Apache-2.0 | |
| OTIO-26 | Comparing Timelines | https://github.com/AcademySoftwareFoundation/OpenTimelineIO/issues/26 | issue open; page updated 2025-08-15 | n/a | No core diff in the commit above (`*diff*` search empty). |
| OTIO-1922 | otiodiff draft | https://github.com/AcademySoftwareFoundation/OpenTimelineIO/pull/1922 | not merged into inspected tip | n/a | Draft integrated tool. |
| OTIO-2030 | cut_diff example | https://github.com/AcademySoftwareFoundation/OpenTimelineIO/pull/2030 | not present in inspected tip | n/a | Identity = media URL + source in-point. |
| ODIFF | chaoz23/otio-diff | https://github.com/chaoz23/otio-diff | not cloned; metadata pushed 2026-07-21, 2 stars | Apache-2.0 | Same identity idea as PR 2030. Not a mature product. |
| SILERO | snakers4/silero-vad | https://github.com/snakers4/silero-vad | not cloned; metadata pushed 2026-09-17 | MIT (LICENSE file via GitHub API) | Used as one WhisperX VAD backend. |
| FW | SYSTRAN/faster-whisper | https://github.com/SYSTRAN/faster-whisper | not cloned; metadata pushed 2025-11-19 | MIT | WhisperX ASR backend. |
| WHISPER | openai/whisper | https://github.com/openai/whisper | not cloned; metadata pushed 2026-08-31 | MIT | Model family. Do not reproduce. |
| PANN | pyannote/pyannote-audio | https://github.com/pyannote/pyannote-audio | not cloned; metadata pushed 2026-09-21 | MIT (code) | Weights are separate. |
| PANN-C1 | speaker-diarization-community-1 | https://huggingface.co/pyannote/speaker-diarization-community-1 | model card read 2026-09-21 | **CC-BY-4.0** on the card (`license: cc-by-4.0`). Gated. | WhisperX `diarize.py` default string: `pyannote/speaker-diarization-community-1`. |
| PANN-31 | speaker-diarization-3.1 | https://huggingface.co/pyannote/speaker-diarization-3.1 | card read 2026-09-21 | Card says MIT. **Not** the WhisperX 3.8 default | Do not treat 3.1's MIT card as evidence for community-1. |
| WEBRTC | wiseman/py-webrtcvad | https://github.com/wiseman/py-webrtcvad | tip `e283ca41df3a` (2021-02-15); repo `pushed_at` 2024-07-04 | MIT (LICENSE file). GitHub SPDX field was `NOASSERTION` | Classic frame VAD. Stale. |
| WTS | linto-ai/whisper-timestamped | https://github.com/linto-ai/whisper-timestamped | not cloned; metadata pushed 2026-08-17 | **AGPL-3.0** | Do not link. |
| STS | jianfch/stable-ts | https://github.com/jianfch/stable-ts | not cloned; archived; pushed 2026-05-30 | MIT | Archived. |
| TALKNET | TaoRuijie/TalkNet-ASD | https://github.com/TaoRuijie/TalkNet-ASD | not cloned; pushed 2023-10-23 | MIT | Tao et al., ACM MM 2021, arXiv:2107.06592. Stale. |
| LIGHT | Junhua-Liao/Light-ASD | https://github.com/Junhua-Liao/Light-ASD | not cloned; pushed 2025-03-23 | MIT | CVPR 2023. |
| LRASD | Junhua-Liao/LR-ASD | https://github.com/Junhua-Liao/LR-ASD | not cloned; pushed 2025-03-23 | MIT | IJCV 2025. Paper page: https://duanhaihan.github.io/publications/2025/IJCV2025.pdf |
| AUTOCUT | trsdn/autocut | https://github.com/trsdn/autocut | not cloned; metadata pushed 2026-08-27, 3 stars | MIT | Local cut plan JSON. Tiny, recent. |
| NAGARE | diginatu/nagare-clip | https://github.com/diginatu/nagare-clip | not cloned; metadata pushed 2026-09-19, 0 stars | MIT | Separates ffmpeg `silencedetect` from WhisperX word gaps. |
| PREEN | roothch/PreenCut | https://github.com/roothch/PreenCut | not cloned; pushed 2025-08-22, 418 stars | MIT | LLM retrieval over transcript. Not a timeline. |
| QC | QuickCut | https://graphics.stanford.edu/projects/quickcut/ | paper, not a repo | Adobe Research / Stanford. Not OSS | Truong et al., UIST 2016. https://doi.org/10.1145/2984511.2984569 |
| RC | Rough cut / dialogue idioms | https://graphics.stanford.edu/papers/roughcut/ | paper, not a repo | Adobe Research / Stanford. Not OSS | Leake, Davis, Truong, Agrawala. HMM idioms. Not preference learning. |
| RLVE | RL video editing | https://arxiv.org/abs/2411.04942 | paper | arXiv preprint | Trains a virtual editor. Out of scope (would become model training). |
| AILEXSI | This product, AI Director map and P1 status | `docs/ai/AI_DIRECTOR_IMPLEMENTATION_MAP_v6.0.md`, `docs/ai/AI_DIRECTOR_IMPLEMENTATION_STATUS_v6.0.md` | branch `ai/ai-director-foundation-v6` @ `856044a45c7d1a504911da93366a5778f141df03` | product repo | Timeline model: `src/core/models.ts` schema 5. |
| LIC | AILEXSI license inventory | `docs/compliance/LICENSE-INVENTORY.md` | same tip | n/a | CC-BY already classed YELLOW. Not a legal opinion. |

GitHub star counts below are metadata reads on 2026-09-21, not quality scores.

| Repo | Stars | Archived |
| --- | ---: | --- |
| openai/whisper | 109432 | no |
| SYSTRAN/faster-whisper | 25500 | no |
| m-bain/whisperX | 24171 | no |
| pyannote/pyannote-audio | 10579 | no |
| snakers4/silero-vad | 10271 | no |
| WyattBlue/auto-editor | 5313 | no |
| Breakthrough/PySceneDetect | 5193 | no |
| linto-ai/whisper-timestamped | 2845 | no |
| wiseman/py-webrtcvad | 2498 | no |
| jianfch/stable-ts | 2284 | **yes** |
| AcademySoftwareFoundation/OpenTimelineIO | 1986 | no |
| soCzech/TransNetV2 | 1043 | no |
| TaoRuijie/TalkNet-ASD | 504 | no |
| roothch/PreenCut | 418 | no |
| Junhua-Liao/Light-ASD | 190 | no |
| Junhua-Liao/LR-ASD | 144 | no |
| chaoz23/otio-diff | 2 | no |
| trsdn/autocut | 3 | no |
| diginatu/nagare-clip | 0 | no |
