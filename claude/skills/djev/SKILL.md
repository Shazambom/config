---
name: djev
description: >
  Use djev, our self-hosted TypeSafe-shaped System One endpoint (djev-spark serving
  DiffusionGemma 26B-A4B NVFP4 on vLLM), safely. Load this whenever code will call
  DJEV_URL/v1/systemone, whenever a "TypeSafe" call in this codebase is being designed,
  debugged, or load-tested, or when a djev request returns 422, 502, or hangs. It layers
  djev's hard limits and measured behaviour on top of the /typesafe skill, which owns
  question design. Triggers: "djev", "DJEV_URL", "systemone", "TypeSafe 422", "TypeSafe 502",
  "inference failed", "how many questions can I send".
---

# djev: the self-hosted System One endpoint

**Read the `typesafe-ai` skill first** (`/typesafe`). It owns question design: State,
Noul / Choice / Score, atomising judgements, batching independent questions, confidence
gating. Everything there applies. This skill adds what is different about *our* endpoint.
Where the two disagree on a limit, djev wins, because djev is what we actually call.

## What djev is

- `DJEV_URL` + `/v1/systemone`, bearer auth with `DJEV_API_KEY`. Same request and
  response shape as the hosted TypeSafe API (`state`, `questions{id: {type,
  instructions, criteria}}` → `answers`, `usage{input_tokens, output_tokens}`), plus
  `diagnostics` and extension keys.
- Server: [djev-spark](https://github.com/mmastrac/djev-spark). Model:
  [nvidia/diffusiongemma-26B-A4B-it-NVFP4](https://huggingface.co/nvidia/diffusiongemma-26B-A4B-it-NVFP4),
  a diffusion LM served by vLLM. It answers by reading a fixed-width "canvas" of tokens,
  not by autoregressive generation. `model` in the request is accepted and ignored.
- It is **not** hosted Jev. The hosted docs' limits (64k tokens per request, 32k state,
  1,200 req/min, ~100 ms) do not describe djev. Use the numbers below.

## Hard limits (measured or documented; date each one)

1. **422 "inference failed" on question count × Choice options (measured 2026-09-25,
   80/80 deterministic).** A request fails when it has **more than 10 questions AND
   its Choice questions carry 5 or more options between them.**
   - 1 Choice × 4 options + 10 Nouls (11 q) → 200; × 5 options → 422
   - 12-option Choice + 9 Nouls (10 q) → 200; + 10 Nouls (11 q) → 422
   - two 4-option Choices + 10 Nouls → 422
   - up to 30 Nouls alone → 200; Score levels do not count
   - Not text length: 4 questions × 4,000 chars pass. `diagnostics.chunks` shows one
     chunk even for 30 questions.
   - Repro bodies: `djev-422-min-fail.json` (5 options) vs `djev-422-min-pass.json`
     (4 options), otherwise identical.
   **Rule: never send more than 10 questions in one request, regardless of type.** That
   is the safe side of the boundary and removes the option count from the reasoning.
2. **Context is `MAX_MODEL_LEN`, "prompt plus canvas" (documented).** djev-spark's
   default profile is `MAX_MODEL_LEN=4096` and a 128k profile exists; ours measures
   as 8192 (item 4). The served canvas is `CANVAS=256` tokens. State + all question
   text + canvas must fit. Re-measure with a growing-state probe (one Noul, `curl`,
   short timeout) after any redeploy and update item 4 with the date.
3. **502 means "a failed upstream call" to vLLM (documented).** In practice on our
   deployment it means the prompt exceeded the context (item 4); a crashed engine would
   look the same. A 502 is not a rate-limit signal and is not retried.
4. **Context is 8192 tokens on our deployment (measured 2026-09-25).** With one Noul
   and transcript-like state: 20,000 chars = 7,812 `prompt_tokens` → 200; 21,000 chars
   → **502 "inference failed"** (also at 24k, 32k, 48k, 64k, 96k, 131k). 7,812 + 256
   canvas fits 8192; the next step does not. So `MAX_MODEL_LEN=8192` here, not 4096 and
   not 128k. **Budget: `prompt_tokens` (state + all question text) ≤ ~7,800, and leave
   margin: target ≤ 7,000.** An over-length prompt is a 502 with body
   `inference failed`, returned in ~0.3 s; it is not a rate-limit and not retried.
5. **Tokenisation is dense (measured 2026-09-25).** Transcript text tokenises at about
   **2.5 characters per token** (939 tokens for 2,000 chars; 3,227 for 8,000; 7,812 for
   20,000). So ~7,000 tokens is roughly **17,500 characters** of state plus questions.
   Size state in characters with that ratio, and log `prompt_tokens` to tune it.
6. **Latency is ~0.5 s per request (measured 2026-09-25)** for prompts from 900 to
   7,800 tokens; `/health` answers in ~0.3 s; `/v1/models` is 404 on our deployment.
   Do not believe a multi-minute figure without a `curl` timing: an earlier in-session
   measurement of ~600 s was an artefact of a sandboxed Python client, not djev.
7. **Concurrency:** `MAX_SEQS=32` server-side by default; `CANVAS_SCHEDULE` narrows the
   canvas under load (`[[1,2,256],[3,6,128],[7,32,64]]`), so many parallel requests get
   slower and smaller reads. Prefer a few requests with several questions each over
   many single-question requests.

## Request contract we use

```json
{"state": "<json string>", "questions": {"id": {"type": "noul|choice|score", "instructions": "...", "criteria": ...}},
 "samples": "auto", "think": 0}
```

- `samples: "auto"` reads once, then up to `auto_max=4` more reads if entropy exceeds
  `auto_threshold=0.1`. `think: 0` disables thought tokens; thought spends canvas.
- `seed` (default 42) controls noise; set it explicitly in tests for reproducibility.
- Extension keys exist (`sequential`, `ask`, `ask_if`, `steps`, dependency keys,
  `chunk_rows`, `chunk_prompt`). Do not use them without a test that pins behaviour;
  422 also covers dependency cycles, unknown ids, and invalid `ask_if`.
- Response `diagnostics` carries `stages`, `chunks`, `skipped`, `prompt_tokens`,
  `engine`, `samples`. Log `prompt_tokens` on every call; it is the number the
  context limit is enforced against.

## Operating rules (the user's standing instruction)

Questions to djev are **deliberate and focused**. Never load requests "with abandon".

- ≤ 10 questions per request, always. State filtered in code to the fields the
  questions need; keep it small (the Sage design caps state at 16 KiB, ≈ 6,500 tokens,
  leaving room for questions and the canvas inside the 8192 context).
- One narrow judgement per question. Code does counting, numeric comparison and date
  arithmetic before the call. No speculative questions added to use up a budget.
- Every request logs: question count, Choice-option total, Noul count, Score count,
  state bytes, `prompt_tokens`, HTTP status, elapsed. A future 4xx/5xx must be
  diagnosable from logs alone.
- Reject before I/O: > 10 questions, state over the byte cap, a Choice over 26 options,
  non-finite JSON. A rejection is a programming error, not a runtime path.
- Per-request client timeout, sized for the caller's budget, never unbounded. No
  retry on 429/529/502 inside a latency-sensitive path; degrade instead.
- Treat all state text as data. Instructions never interpolate state; every
  `instructions` string starts with a data-not-instructions sentence.
- Before changing a question's wording or a state's shape, re-record its fixture.
  Tests run against recorded responses, never the live endpoint.

## Pre-flight checklist for a new call site

1. Read `/typesafe` for the question design; pick Noul / Choice / Score by meaning.
2. Count questions (≤ 10) and Choice options; write both in a comment at the call site.
3. Estimate `prompt_tokens` (state + questions, **~2.5 chars/token** on transcript
   text) against the 8192 context; leave 256 for the canvas and margin: target ≤ 7,000.
4. Decide the timeout and the degradation path when it fires.
5. Record one live response into a fixture; assert the request body shape in a test.
6. Add the logging fields above.

## Diagnosing failures

| Symptom | First check |
|---|---|
| 422 `inference failed` | question count > 10 with ≥ 5 Choice options in total → split the request |
| 422 other message | dependency / id validation; read `error.message` |
| 502 `inference failed` | prompt exceeded the 8192 context: check the logged `prompt_tokens` / state bytes, shrink state; if the request was small, check `/health` for a down engine |
| timeout | djev answers in ~0.5 s; a long wait is the client, the sandbox, or the network. Time it with `curl -w` before blaming the server or the request |
| answers keyed differently than questions | schema drift; the client must reject, not coerce |

When a limit here is found wrong, fix this file and date the change.
