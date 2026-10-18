# Progressive high-quality generation: build plan (2026-10-17)

Spec: `research.md` (same folder). Branch `progressive-gen` off `main`. Decisions from Kyle: every eligible
define auto-forges at **good**; detail words or "make it better / more detailed" go **hero**; the reference
image stays invisible; $12 forge cap, $1.50 per session; Sol polish only on hero, in the background.

## Sprints

| # | What | Files |
|---|---|---|
| 1 | Spawn before define (placeholder at ~0.8 s; the motes keep swirling round the labelled blob until the define lands) | `server/utils/intent.ts` (rule 4/11 + examples), `app/world/renderer.ts` (forming resolves on the define), `bench/intent.ts` |
| 2 | Forge shape vocabulary: tube / lathe / extrude / mirror, `HQ_MAX_PARTS` 240, slots + material on every part; `partBounds`, islands, fit-to-draft, parts hash, tier choice, library key, ledger decision (all pure) | `shared/world/forge.ts` (new), `shared/world/ops.ts` (Part gains optional shape fields), `shared/world/kinds.ts` (bounds-aware `learnedKind`, `quality`, `basis`) |
| 3 | Geometry builders + per-object merge (by slot/colour/material), merged geometry shared across instances by parts hash, kit `mat()/glowMat()` only (no flatShading / DoubleSide) | `app/world/parts.ts` |
| 4 | Server forge: Opus writes a program; `node:vm` runs each closed-line prefix (frozen in-context API, null-proto global, no codegen, 50 ms timeout, part cap); NDJSON streams expanded parts. Endpoints: refine (`/api/forge`), polish, judge, library get/post. Reference image fetched inside the hero refine, cached on disk | `server/utils/forgeRun.ts`, `server/utils/forge.ts`, `server/utils/forgeLedger.ts`, `server/api/forge*.ts`, `server/utils/aiModels.ts` |
| 5 | Ledger: `.data/forge/ledger.jsonl`, $12 total / $1.50 per session, estimate check, gateway budget error → quietly keep the draft | `server/utils/forgeLedger.ts` |
| 6 | Progressive replace UX: arrival unchanged; draft → gold ghost; refined parts grow through it (gold pop, sparks every 3rd part, low mote swirl); light-band sweep on swap; `upgradeKind` outside undo (kernel `upgrades` overlay re-applied on replay when the basis matches); `useForge` orchestrates, all instances upgrade together | `app/world/fx/refine.ts`, `app/world/fx/placeholder.ts`, `app/world/renderer.ts`, `app/composables/useWorld.ts`, `app/composables/useForge.ts`, `app/composables/useIntent.ts`, `shared/world/state.ts` |
| 7 | 60 fps: ≤4 new part meshes per frame, merged body after the swap, precompile before swap, ghost material in the warm-up; rAF tracer during swaps | renderer, `scripts/forge-shoot.mjs` |
| 8 | (only if time) one hero item per Director teleport | — |

## Deviations from research.md

- **Haiku's `define` keeps its six primitives and 32-part cap.** The new shapes live in a forge-only strict cleaner (`cleanPart` in `shared/world/forge.ts`); forged parts never pass through `DefineOp`.
- **Mirror is expanded on the server into plain parts** (x → −x, rot (a, −b, −c), outline x negated), so the client never builds negative-scale or flipped-winding geometry.
- **Upgrades live in the kernel as an overlay** (`state.upgrades[kind] = { basis, parts, quality }`), applied by the `define` step when the define's parts hash equals the basis. That keeps the op log pure (undo and replay still work) while the upgrade survives undo of later batches, reloads and save files.
- **The reference image is generated inside the hero refine request** rather than a separate client round-trip (one less hop; same disk cache and in-flight de-dupe).
- **Studio shots use the main renderer and the main scene's lights** (an isolated layer, fog pushed out, lights brightened by uniforms only), so no second GL context and no new program variants.
- **Library key:** normalised kind (primary) plus normalised wish (secondary index). A hero entry serves good requests; a good entry doesn't satisfy a hero request.

## Status (2026-10-17)

Sprints 1–7 landed; sprint 8 (Director hero) skipped as risky for this pass.

**Measured** (headless Chromium, Metal GPU, `scripts/forge-shoot.mjs`, results in `shots/results.json`):

| Wish | Tier | Proxy | Draft | First refined part | Refined (swapped) | Polish | $ | Parts | Swap fps (avg / min 1 s / worst gap) |
|---|---|---|---|---|---|---|---|---|---|
| steampunk airship | good | 2.2 s | 4.8 s | 9.8 s | 18.7 s | — | 0.033 | 39 | 60 / 60 / 17 ms |
| intricate carousel | hero | 1.7 s | 5.0 s | 13.4 s | 24.6 s | lost the judge (136 s) | 0.075 | 115 | 60 / 60 / 17 ms |
| giant ornate fountain | hero | 1.2 s | 4.2 s | 11.8 s | 23.1 s | won both orders, swapped (129 s) | 0.076 | 134 | 60 / 60 / 17 ms |
| vintage motorcycle | good | 2.6 s | 5.1 s | 9.8 s | 17.9 s | — | 0.032 | 22 | 60 / 60 / 17 ms |
| lighthouse made of glass | good | 1.2 s | 2.6 s | 6.9 s | 13.1 s | — | 0.027 | 36 | 60 / 60 / 17 ms |
| treehouse village | — | Haiku used kit houses ×4 + oaks ×6: no define, no forge (as designed) | | | | | 0 | | |
| (repeat wishes) | library | ~1.1–1.4 s | ~2.5–3.8 s | — | draft + 0.9 s | — | 0 | | 60 / 60 / 17 ms |

Proxy = first op applied (the spawn: the labelled blob); the mote placeholder still shows at 0.7 s. Total model spend for the build and verification: about $0.39 of forge calls plus two Haiku benches (about $0.04).

- Undo during a live refine aborts the job; the kind, instances and upgrade all go, with no errors.
- Bench (Haiku): 76/76, define median 3.0 s, first op on define 2.0 s.
- Tests 143/143 (new `tests/forge.test.ts`, plus a clamp test in `tests/world.test.ts`). Typecheck and lint are clean.

**Found and fixed along the way:**
- Spawn-first framed only the 2.2 m blob, so tall defines (the lighthouse) were cut off. Any redefine more than 1.3× taller than what you saw now re-frames.
- A Director op with one oversized prop (length 240 > 200) was dropped whole. Bounded numbers now clamp to the bound (`shared/world/ops.ts` `num()`).
- The vm `microtaskMode: 'afterEvaluate'` timeout corrupted Node's async hooks. Replaced with a lexical deny-list (no async, promises or reflection words) plus the plain timeout.

**Known gaps:** forge $ isn't in the dev HUD yet (it's in `window.__forge` and `/api/forge/status`); there's no "remembered kinds" hint to the intent model; the merged-body memory cache is unbounded per forged kind; `node:vm` can't cap memory; the Director hero item is not done.
