# 16 — Smallest PoC plan

**Goal:** falsify or support one sentence.

> Historical human corrections measurably reduce correction cost on a later cut, without a Good/Bad button and without a trained model.

**Not the goal:** a cutter inside Resonance, a demo reel, or a dependency.

**Where it runs:** a throwaway script outside this repository, after a human approves. This file is the plan only. Days means a short experiment, not a product milestone.

## Setup

**Policies**

- `P0` = `ae-default-v0`: peak threshold 0.04, margin 200/200 ms, mincut 200 ms, minclip 100 ms, hop 10 ms. Order: threshold, then margin, then min durations (file 08). That matches Auto-Editor's `mutMargin` then `smoothing` call in `conductor.nim`.  
- `P1` = same, except `marginStartMs` and `marginEndMs` are the median of human-implied margins from the training items in that **scope**.

**Human-implied margin.** On each matched boundary where both sides cut from active to inactive (or the reverse), measure the distance from the P0 activity edge to the human edge. Median of those distances. If there are fewer than 4 boundaries in the scope, `P1` is not formed and the item is reported as inert.

**Data.** D0-2 style items plus D1 from [13](./13_BENCHMARK_PLAN.md). Author `H` by hand in JSON. At least:

- 6 interview-tagged items where the human margin is about 400 ms (the effect is real).  
- 6 music-bed items where a constant 0.08 peak makes P0 keep everything and the human cut is based on the bursts (the effect must not appear).

Leave-one-out inside each tag. Do not train on the music bed and test on the interview.

## Steps

1. Synthesize PCM.  
2. Compute peak series.  
3. Run `P0`. Emit decisions and arrangement `A0`.  
4. Load `H`. Diff. Record correction events. Compute cost.  
5. Fit margin on all but one interview item. Run `P1`. Diff against the held-out `H`.  
6. Repeat leave-one-out.  
7. Repeat the fit using a GLOBAL pool (interview + music) and show that pool on a held-out interview item.  
8. Write a table. Do not tune the 10% band or the support minimum after seeing the table. Those numbers are already in files 11 and 12.

## Decisions the table is allowed to produce

| Observation | Conclusion |
| --- | --- |
| Interview leave-one-out median reduction > 0.10, and `op_count` and `unmatched_ms` agree | The sentence holds **for margin on this synthetic interview regime** |
| Interview reduction inside ±0.10 | Inert. Sentence not supported. Do not ship a vault |
| Music-bed `P1` margin changes cost by "helping" because the threshold was also secretly changed | Invalid run. Margin-only was the rule |
| GLOBAL fit hurts the interview holdout or does nothing, while the typed fit helps | Scope is doing work. GLOBAL is the wrong default |
| Music-bed reduction > 0.10 from margin alone | Unexpected. Stop and inspect the fixture before believing it. A constant bed should not move with margin |

## Explicit non-moves

- No ASR, no VAD, no shots, no OTIO, no Resonance UI, no torch.  
- No committing the script in the approval PR that only asked for research. A follow-up can add it if the human asks.  
- No claim about real interviews until D2 is run on rights-cleared audio outside git.

## Complexity

The experiment is **LOW** if PCM synthesis is accepted as the human. It becomes **MEDIUM** only if D2 uses a real file and a real listening pass (`session_ms` still optional). It is not **RESEARCH** in the sense of new algorithms. It is research in the sense that the sentence might be false.

## Afterward

Bring the table back. If the sentence fails, the architecture in file 15 still stands as a document model, and the vault stays unspecified as a product. If it holds on synthetic data only, the next question is D2, still not an integration.
