# Loop 1: latency (2026-10-17)

The north star is "you're a genie", so the gap between finishing a sentence and seeing the world change is the main thing to fix. Every number below comes from real gateway calls made today. The bench scripts are throwaway files in `bench/`: `latency_probe.ts`, `latency_interpret.ts` + `latency_bench.ts` (the intent bench with a pluggable variant), `latency_flat.ts`, `latency_director.ts`, `latency_vad.ts` and `latency_teleport.ts`. Total spend was about $0.3.

## 1. Who serves `/api/intent`, and where the time goes

**Bedrock serves it, not Anthropic.** Gateway routing metadata on the shipped call: `resolvedProvider: "bedrock"`, `finalProvider: "bedrock"`, `affinity: { outcome: "promoted", pinnedProvider: "bedrock", displacedProvider: "anthropic" }`. Two separate problems cause this:

- **Anthropic refuses the schema.** With `only: ['anthropic']`, the call fails fast (~400 ms) with `Schemas contains too many optional parameters (49) ... (limit: 24)`. The Sprint 4 suspicion is correct.
- **`order: ['anthropic']` does nothing.** Gateway session affinity (keyed by a client fingerprint) pins the session to Bedrock and overrides `order`. Even calls without structured output went to Bedrock under `order` (4 of 5 runs). Only `only: [...]` actually pins a provider.

Bedrock runs `Output.object` as tool mode. That adds about 2.2k input tokens (cache read 10,666 vs 8,502 in text mode) and delivers the object in one burst at the end:

| Call (Haiku 5.5, "make a bunch of trees", warm cache) | TTFT | generation | total |
|---|---|---|---|
| Shipped: `Output.object`, served by Bedrock | 950–1,220 ms | 60–160 ms (burst) | 1,020–1,310 ms |
| JSON in text, `only: ['anthropic']` | 710–770 ms | 200–300 ms (~300 tok/s) | 916–1,077 ms |
| Define ("a hot air balloon"), Bedrock structured | 1,225–1,386 ms | 1,660–2,235 ms | 2,880–3,620 ms |
| Define, Anthropic text | 880–990 ms | 2,140–2,700 ms | 3,130–3,580 ms |

**Plain edits are bound by TTFT** (prefill of an ~8.5k-token cached digest, plus gateway and provider overhead). Generation is 10–20% of the time. **Defines are bound by generation**: 550–800 output tokens at ~300 tok/s.

## 2. Options

Accuracy is the full 37-case `bench:intent` suite unless a row says otherwise. Latencies are medians at concurrency 2.

| Option | Measured | Accuracy impact | Effort |
|---|---|---|---|
| Baseline (shipped, Bedrock structured) | plain **1,066 ms**, define 2,313 ms, all 1,135 ms | 37/37 | — |
| (a) Flat schema pinned to Anthropic (`{op, json:string}`, 0 optionals) | **1,610–1,810 ms** (TTFT ~1.0–1.15 s; escaped JSON bloats output) | not run (format change) | M. **Rejected: slower** |
| (b) No structured output: JSON in text, `only: ['anthropic']`, `parseOps` recovery | plain **858 ms** (−210), define 2,290 ms, TTFT 677 ms | **37/37**, 0 unparseable | S |
| (c) (b) + streaming ops (apply each op as its object closes) | first op: plain **805 ms**, teleport 714–1,088 ms (median ~0.98 s), forest 779 ms vs total 998 ms. Define: first op at 1,977–2,441 ms, since the define itself is the long op | same as (b) | M (NDJSON route like `director.post.ts`, plus an appendable per-sentence batch like `extendLastBatch`) |
| (d) `openai/gpt-6-luna-fast`, reasoning none, text JSON | plain 893 ms, **define 1,714 ms** (−576), TTFT 573 ms. OpenAI prompt cache hit only 1/37 | **37/37** | S (model id + `reasoning: 'none'`) |
| (d) `gpt-6-luna` (reasoning low) | ~1,460 ms | 1/1 smoke | — |
| (d) `gemini-3.5-flash-lite` / `gemini-3.8-flash` | 1,770–1,890 ms / 3,670–4,680 ms (350–640 thinking tokens; `reasoning: none/minimal` doesn't turn them off) | 3/3 smoke | **Rejected** |
| (d) `spacexai/grok-4.1-fast-non-reasoning` | "Not Found" via the gateway | — | n/a |
| (e) Speculation from partial transcripts | **Not possible.** The normalized realtime protocol has no input-transcript delta, only `input-transcription-completed`, and that arrives ~750 ms **after** the `build` tool call (sprint3 log: call @3,778 ms, transcript @4,527 ms). The tool call is already the earliest text signal. A second streaming STT on the mic would double STT cost for maybe ~300 ms | — | L, not recommended |
| (f) Realtime `teleport({ world, brief })` tool, skipping the intent hop | Tool call arrives 330–506 ms after VAD stop (vs 250–380 for `build`: the brief adds ~100 ms). Saves the whole intent hop (~1.1 s now, ~0.8–1.0 s after b+c). 3/3 teleports routed correctly, and "put a bunch of trees" still went to `build` | **Briefs are thinner** ("nighttime, neon lights, soft chatter, pool tables gleaming…"), but they still name the place and mood. The Director already handles a missing brief | S–M (one tool + one instruction line + `onToolCall` → `useDirector().start`) |
| (g) VAD silence 600 → 400 ms | speech end → tool call: **958–1,034 → 819–895 ms** (−~135 ms, 4 runs each) | Risk of cutting off "put trees… over there" mid-pause. Not seen with `say` fixtures; needs a check with Kyle's real speech | XS (one constant) |
| Director, JSON in text instead of `Output.array` grammar (Sonnet, `only: anthropic`) | first op **890–1,015 ms vs 1,360–1,782 ms** (−~450). Done 8.3–8.9 s (unchanged: generation-bound, ~200 tok/s) | 35–36 ops, **0 bad ops** (3 runs). Also removes the 25–66 s grammar warm-up plugin | S |
| Director on Haiku (text) | first op ~1.0 s, **done 4.46 s** | 26 ops vs ~35. Scene quality not checked visually | S, needs a visual check |

## 3. Recommendation

Do these in order. Each one ships on its own.

1. **(b) Intent: drop `Output.object` and pin with `only: ['anthropic']`** (not `order`). Keep `parseOps` with a fallback that keeps any op objects that closed if the envelope doesn't parse. −210 ms on every sentence, same accuracy, and it removes the Bedrock affinity dependency.
2. **(c) Stream intent ops over NDJSON.** Apply each op into one appendable batch so that undo still covers the whole sentence. The first op lands ~50–100 ms sooner on plain edits. Teleports benefit most: start the Director the moment the `teleport` op closes, before the `say`.
3. **Director: JSON in text plus the same scanner.** First op lands ~450 ms sooner, and `directorWarmup.ts` can be deleted.
4. **(f) Realtime `teleport` tool.** The voice path skips the intent hop entirely. Keep `build` for everything else. The text bar still goes through intent (2).
5. **(g) VAD 400 ms**, after a 5-minute check with real speech. If clipped sentences show up, use 500.
6. Optional: route **defines** to `gpt-6-luna-fast` (−~580 ms at 37/37). One way is a cheap client hint: no kit or learned kind is named. The other is to retry only when Haiku's first op is a `define`. Not worth it yet. An alternative for defines is to emit `spawn` before `define` (the placeholder morphs when the define closes), so something appears at ~0.8 s. That needs a prompt rule plus a bench check.

Not recommended: (a) flat schema, (e) speculation, Gemini flash-class.

### Expected end-to-end numbers (medians)

| Path | Now | After 1–5 |
|---|---|---|
| Voice plain edit: speech end → first op applied | ~1.0 s + 1.07 s ≈ **2.1 s** | 0.875 + 0.805 ≈ **1.7 s** |
| Text plain edit: Enter → first op | **~1.1 s** | **~0.8 s** |
| Voice define: speech end → object | ~1.0 + 2.3 ≈ **3.3 s** | ~0.875 + 2.29 ≈ **3.15 s** (≈2.6 s with luna-fast; ≈1.7 s to a placeholder with spawn-first) |
| Text teleport: Enter → first Director op | **2.7–3.0 s** | ~0.98 (teleport op closes) + ~1.0 ≈ **~2.0 s** |
| Voice teleport: speech end → first Director op | ~1.0 + 1.1 + 1.5 ≈ **3.6 s** | ~0.875 + 0.12 + 1.0 ≈ **~2.0 s** |
| Teleport complete (Enter) | **9.9–12.1 s** | ~9.3 s (Director generation-bound) |

Making completion fast is a separate problem. The recipe is ~1.5k Sonnet tokens at ~200 tok/s. Two cheap levers are left untested: run 2–3 Director shards in parallel (shell+light / furniture / props, each with a disjoint `xz` region), or use Haiku for the recipe (4.5 s done, but fewer ops: check visually first).
