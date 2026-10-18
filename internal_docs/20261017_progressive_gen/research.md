# Progressive high-quality generation: research and port plan (2026-10-17)

This is read-only research. Neither repo was modified, and the only file written is this one. No paid calls were made. Every number comes from logs already on disk in `conjure-progressive/` (`server.log`, `runs/lab/matrix_*.log`, `runs/scene/results.jsonl`, `runs/scene/ledger.jsonl`) or from the conjure loop docs.

Paths are relative to each repo root. `CP:` means `~/Programming/Workspace/conjure-progressive`, and `C:` means `~/Programming/Workspace/conjure` (checked out on `npc-people`).

---

## 1. What conjure-progressive is

It's a standalone lab, not a Nuxt app and not a git repo. The pieces:

- `CP:server.mjs` is a Node http server on :3092 for single objects. It serves `index.html` (the current "staged" pipeline) and `index-v1.html` (older modes).
- `CP:scene-server.mjs` + `CP:scene/*.mjs` + `CP:scene.html` run on :3093. This is a hierarchical, budget-aware **scene** builder (towns, castles, cathedrals). It reuses the same object generator per leaf.
- `CP:shapes.js` holds the shared spec → THREE.Group builder and the structural check. three@0.170 comes from a CDN (conjure uses 0.186).
- `CP:lab/*.mjs` are the eval harnesses: `gauntlet.mjs` (build → render → blind critic → repair), `matrix.mjs` (model × reasoning matrix judged by a 2-critic blind panel), `frontier.mjs`, `record.mjs` (Playwright session videos) and `approaches.mjs` (all prompts).
- It has its own gateway key: the `.env` key hash differs from conjure's. That key hit its own $30 cap mid-matrix (`CP:runs/lab/matrix_refdraft2.log`: "Current spend: $30.18, limit: $30.00"). The scene ledger alone records **$12.91 over 1,062 calls** (plan $1.33, leaf $7.62, ref images $3.61, critic $0.33, harmony $0.03).

There's no README or docs folder. The headers at the top of each file are the docs.

### 1.1 Representation: a tiny JS program over a primitive API

The winner of the lab's approach bake-off (`CP:lab/approaches.mjs:84-125`: `prims`, `sculpt`, `code`, `code2`, `brief+*`) is **code**. The model writes the *body of a JS function* against this API (`CP:lab/approaches.mjs:87-97`, executed by `CP:shapes.js:88-106`):

- `box | sphere | cylinder | cone | capsule | torus (size, at, color, o)`: the same unit-primitive and bounding-box convention as conjure's `Part`.
- Three shapes conjure lacks, which carry the quality gain for organic forms:
  - `tube(points, radii, color, o)`: a Catmull-Rom swept, tapered body. Used for necks, tails, limbs, horns and branches. Built in `CP:shapes.js:22-59`.
  - `lathe(profile, at, color, o)`: a profile turned around y. Used for towers, vases, domes and tree crowns.
  - `extrude(outline, depth, at, color, o)`: a 2D outline with thickness. Used for wings, sails, fins, ears and signs.
- `o = { rot, mirror, glow }`. `mirror: true` adds the x → −x copy, so a model describes one leg and gets the pair.
- Variables, loops and `Math` are allowed. Loops make repeats cheap (windows, spines, planks), and shared anchor consts make joints line up.

`code2` (`CP:lab/approaches.mjs:98-123`) adds an explicit **anchor method**. It declares a palette and key anchor points first, builds every part *at or between* anchors, orders statements biggest to smallest, and exaggerates the silhouette. A worked horse example comes in about 10 lines. The scene leaves use `code2` (`CP:scene/leaf.mjs:88`). The staged single-object pipeline uses `code` with a streaming suffix (`CP:server.mjs:151`): "Order statements biggest to smallest… one statement per line… First line: `// name: <snake_case>`."

Why code beats flat parts: a 60–190-part object is a 40–80-line program, which is far fewer output tokens than 190 JSON parts. Mirroring and loops also remove most of the left/right and spacing errors. The lab log shows refined objects at **17–189 parts** (`matrix_handoff.log`, `matrix_refine.log`), while conjure's `define` is capped at 32 (`C:shared/world/ops.ts:54`).

### 1.2 The staged pipeline (the current default, `CP:index.html` mode "staged")

The flow is `wish(text)` (`CP:index.html:301-322`): library lookup first (`/api/library?q=`, which replays for $0 if hit, `:324-343`), then `staged(job)` (`:355-422`):

| Stage | What runs | Where | Model / settings | Measured (server.log) |
|---|---|---|---|---|
| **draft** | Streams a program; every closed line re-runs the program so far and pops the new parts in (`streamCode`, `CP:index.html:248-277`) | `/api/draft` → `pipeText` (`CP:server.mjs:165-179, 223`) | `anthropic/claude-haiku-5.5`, `reasoning:'none'`, `only:['anthropic']`, 6k max tokens | 4.4–7.7 s, **$0.0006–0.0008** |
| **vision** (in parallel with draft) | A concept image: "Low-poly 3D game asset of X… three-quarter view from the front-right… plain background" (`CP:server.mjs:187`), shown to the player as a floating "genie's vision" card (`CP:index.html:280-298`) | `/api/ref` → `makeRef` (`CP:server.mjs:191-208`), disk-cached by slug, in-flight de-duplicated | `google/gemini-3.1-flash-lite-image`, flat **$0.034/image** (`:185-186`) | 4.2–8.4 s |
| **refine** (once draft + vision are both in) | The draft becomes a translucent gold **ghost** (`:389-395`), and the refined program streams in *through* it, part by part (`:396-401`). The ghost fades as refined parts arrive. | `/api/refine` (`CP:server.mjs:221-246`). The client sends the draft code, a **studio render** of the draft (offscreen renderer, front-right camera, `CP:index.html:176-202`), the **structural issues** (floating islands, `CP:shapes.js:128-149`) and the ref slug | With ref: `anthropic/claude-opus-5.5`, reasoning none, prompt forces "the line right after the name line must already create the main body mass… at most 2–3 key numbers on ONE line" (`:233`). Without ref: `claude-sonnet-5.5` (`:238-245`) | Opus 11.3–16.8 s, **$0.037–0.047** |
| **accept or fall back** | The refine wins if it has ≥3 parts and the program ran (`:404-407`). Otherwise the ghost draft fades back to full strength (`:408-415`). Only non-draft results are saved to the library (`:417`). | client | — | — |
| **polish** (background, starts at refine start) | Rebuilds the *current* object toward the reference, with "same character… so the player experiences it as the same thing getting better" (`CP:server.mjs:261`). Modes: `full` / `image` / `summary` / `scratch`. | `/api/final` (`CP:server.mjs:251-269`), non-streaming | `openai/gpt-6.1-sol`, `reasoning:'low'`, 32k max tokens, 170 s timeout | **24–78 s**, **$0.021–0.028**, 3.1–3.5k in / 1.4–2.1k out |
| **gate + judge** | Hard gates: the polish program must run, have ≥4 meshes and **no more floating islands** than the current object (`CP:index.html:439-441`). Then Haiku compares the two renders against the reference **twice with A/B swapped**, and the polish wins only if it wins both orders (`:443-458`). | `/api/judge` (`CP:server.mjs:270-292`) | Haiku, reasoning none, 200 tokens | 1.0–6.3 s, **$0.0003 each** |
| **swap** | The polish is rescaled to the size the player already saw if it is off by more than 0.8–1.25× (`:466-469`). If the user is idle, the camera turns to look (`:478-484`). Then a **shimmer swap**: a light band sweeps up, old meshes fade out below it, new ones fade in above it, and glints ride the band (`shimmerSwap`, `:493-526`). The result is saved to the library (`:487`). | client | — | 1.8 s animation |

**Cost per new object, end to end:** about $0.0007 + $0.034 + ~$0.040 + ~$0.023 + $0.0006 ≈ **$0.10**. The reference image is a third of that and is cached per normalised wish.

**Latency to each visible state** (estimated from the stage timings above and the code's ordering):

- First draft part: ~1–2 s. This is a streaming Haiku TTFT; it wasn't logged directly.
- Draft complete: 4–8 s.
- Refined version complete: ~18–25 s. The refine waits for both draft and vision, plus a 350 ms beat (`:382`), plus 11–17 s of Opus.
- Polish decision: ~35–90 s.

**What the player sees:** draft parts pop in one by one with an elastic scale, a gold emissive flash and a small spark burst (`addPart`, `CP:index.html:126-147`). Motes swirl around the anchor while it's forming. The vision card floats above the object, with "Sol is sculpting…" shown under a sheen while it polishes. The refined parts then grow through the ghost, and much later a quiet shimmer upgrade lands.

### 1.3 Older single-object modes (`index-v1.html`, `/api/conjure`)

`CP:server.mjs:98-147` keeps three earlier modes that output JSON Lines parts (not code):

- `oneshot`
- `stream`: one call, coarse to fine.
- `progressive`: a Haiku **blockout** call (plan line with name, envelope size, colour and 3–5 regions, then 3–6 big masses, `:46-49`), followed by **per-region `form` then `detail` calls, all regions in parallel** (`:133-142`). Form parts may `replaces` a blockout part.

These were superseded by draft → refine. The lab found that a single strong refiner looking at a render beats many cheap parallel rounds (`lab/frontier.mjs`, "Power vs repetition"). For example, 10 chained Haiku rounds reach rec/coh/app 8.7/7.2/6.6 in ~60 s, while one Opus refine reaches 9.2/7.7/7.2 in 13 s (`matrix_chain10.log`, `matrix_refine.log`).

### 1.4 Measured quality (lab panel, 6 wishes)

The bar (`CP:lab/gauntlet.mjs:4-6`) is that a blind critic names the object from two renders, and with the wish revealed it scores recognisable ≥7 and coherent ≥7. The panel is Opus + Sol (`CP:lab/matrix.mjs:44-59`).

| Config | Pass | rec / coh / app | median s | $/object |
|---|---|---|---|---|
| **Draft from scratch:** `haiku@none` (≈ today's conjure `define` class) | **1/6** | 7.3 / 6.1 / 5.5 | 6.4 | 0.0007 |
| Draft: `sonnet@none` | 5/6 | 9.2 / 7.5 / 7.3 | 10.0 | 0.015 |
| Draft: `opus@high` | 6/6 | 9.3 / 7.8 / 7.5 | 27 | 0.057 |
| Draft: `sol@high` | 6/6 | 9.5 / 8.1 / 8.0 | 93 | 0.039 |
| **Refine a Haiku draft:** `opus@none` | 6/6 | 9.2 / 7.7 / 7.2 | 13.4 | 0.036 |
| Refine: `sonnet@none` | 3/6 | 9.0 / 7.3 / 7.0 | 10.7 | 0.021 |
| Refine: `sol@high` | 6/6 | 9.5 / 8.3 / 8.1 | 98 | 0.046 |
| **Hand-off (rebuild toward ref):** `sol@low+ref, edit` | 6/6 | 9.3 / 8.3 / 7.5 | 39.5 | 0.023 |
| Hand-off: `opus@none+ref, edit` | 6/6 | 9.0 / 7.5 / 7.1 | 17.5 | 0.044 |

Takeaways:

- A Haiku-class draft alone rarely passes the blind bar.
- **One Opus refine that looks at the draft's render is the biggest, fastest jump**, from 1/6 to 6/6 in about 13 s for about 4¢.
- Sol with low reasoning plus the reference gives the best coherence, at about 40 s.
- The Gemini image-based reference beat Recraft (`matrix_refdraft.log`: Recraft refs produced "Godzilla" for "a dragon").

### 1.5 The scene harness (`CP:scene/`)

The scene harness is a recursive planner with **quality tiers** and a **harness-enforced budget**:

- **Tiers** (`CP:scene/leaf.mjs:10-15`):
  - `block`: free massing.
  - `draft`: Luna low, ~$0.0009, 12 s.
  - `good`: Sonnet none, ~$0.026, 15 s.
  - `hero`: Sol low + reference image, ~$0.07, 50 s.
  - Estimates are replaced by observed means as the run goes (`CP:scene/harness.mjs:49-54`).
- **Money and time enforcement:**
  - `affordTier` downgrades whatever the remaining money or time can't pay for (`harness.mjs:60-71`).
  - A global accountant tracks spent + reserved ≤ budget.
  - Unspent shares go to a pool.
  - An end-of-run **upgrade pass** spends leftovers on the highest-priority leaves (`:113-146`).
  - **Hero-draft-first:** a hero leaf builds a cheap draft first and emits it as `prelim`, so something stands there while the hero cooks (`:90-96`).
- **Library:** keyed by normalised brief and tier, so repeats across scenes are free (`leaf.mjs:20-41`).
- **Failure handling:** one repair retry when the program doesn't parse (the error is fed back, `:85-99`). On any failure, fall back to block massing, so the build never throws (`:105-108`).
- **Spend ledger:** every call is appended to `ledger.jsonl`, and a hard **spend-cap guard** throws before a call once the ledger is near `SPEND_CAP` (`CP:scene/llm.mjs:25-47`).
- **Deterministic plan validation** (`scene/validate.mjs`) and a **harmony** pass. Harmony renders the built node in a headless replay (`scene/studio.mjs`) and asks Sonnet for move/rotate/remove ops, with at most one rebuild (`scene/harmony.mjs`, `harness.mjs:279-328`).
- **Results** (`runs/scene/results.jsonl`):
  - "a small town" at $0.25 cost $0.21, took 81–231 s and produced 53 nodes / 15 builds / 47 instances.
  - At $1.5 it cost $1.38, took 299 s and produced 90 nodes.
  - Critic scores were about rec 8–9, layout 5–7, app 8.

This is the right blueprint for conjure's **Director teleports**, but it is minutes-scale. It's a later port, not the first one.

### 1.6 What it does not have

- No sandbox: programs run through `new Function` in the browser and in Node (`CP:shapes.js:104`, `CP:scene/geom.mjs:16`).
- No tests or typecheck.
- No geometry merging or instancing: one `Mesh` and a **new `MeshStandardMaterial` per part**, with `flatShading:true, side:DoubleSide` (`CP:shapes.js:63`).
- No shader warm-up.
- A second and third `WebGLRenderer` for studio shots (`CP:index.html:182, 753`).
- Mirroring via a `scale.x = -1` group (`CP:shapes.js:114-123`).
- The draft re-runs the whole program on every newline (O(n²), harmless at 60 lines).

---

## 2. How conjure generates objects today

### 2.1 Kit vs define

- The intent brain is Haiku 5.5, `reasoning:'none'`, streaming JSON-in-text ops, max 2,600 tokens (`C:server/utils/intent.ts:382-407`).
- The digest lists the kit catalog and synonyms (62 kit descriptors in `C:shared/world/kinds.ts`), plus learned kinds from context.
- **Rule 4** (`C:server/utils/intent.ts:109`): if nothing in the kit or learned kinds fits, define it with 3–20 parts and spawn it in the same response. If a placeholder of that kind already stands in the world, define it ("the placeholders morph").
- Kit creatures (dragon, whale, horse, deer, fish_school, butterflies, bird) are always spawned, never defined (`:175`; final_eval fix #1).
- So **the kit vs define choice is made by Haiku from the digest**. There is no separate classifier.

### 2.2 The `define` op and Part data

- `PartSchema` (`C:shared/world/ops.ts:129-146`): `{shape: box|cylinder|cone|sphere|torus|capsule, size[w,h,d] bbox, at centre, rot?, color, slot?: primary|trim|glow, material?}`. The coordinate convention is **identical** to conjure-progressive's primitives.
- `DefineOp` (`ops.ts:268-273`): kind, tags (max 12), parts with 1–`MAX_PARTS` (32, `:54`).
- It is plain data, deliberately: "safe without a sandbox" (`C:internal_docs/20261016_voice_world/implementation_plan.md:42`). The plan already anticipates this port at `:126`: "(Later: a Sonnet polish pass could re-`define` a learned kind, and every instance would update in place.)"
- **State** (`C:shared/world/state.ts:95-100`): `learnedKind()` stores the descriptor, and its footprint and baseHeight are derived from the parts (`C:shared/world/kinds.ts:135-147`). Placeholder entities of that kind get the tags.
- `effects.redefined` fires when a learned kind's parts change (`state.ts:500`).
- An unknown-kind spawn holds its spot with a labelled blob (`state.ts:77`, `C:app/world/renderer.ts:751-756`).
- **Build:** `buildFromParts` (`C:app/world/parts.ts:31-48`) uses a shared unit-geometry cache (`:11-29`) with **one new material per part** (`mat()`/`glowMat()`, `C:app/world/kit/helpers.ts:22-28`), plus `materialLook`.
  - Slots drive recolouring (`applyMaterialProps`, `C:app/world/look.ts:55-...`). It mutates materials **per item**, so materials can't be shared across instances; geometry can.
- **Morph:** `sync()` rebuilds every instance of a redefined kind (`renderer.ts:333-336` → `rebuild(..., morph=true)`, `:1040-1066`). It's a pop: the body is swapped, then scale springs from 0 with `ease.back` and a dust puff.
- Persistence: the world (kinds included) goes to `localStorage` key `conjure:world:v1` (`C:app/composables/useWorld.ts:14, 53, 158`).

### 2.3 Arrival FX and the placeholder

- **Anticipate:** the "world listens" glow at the gaze point at request start (`useIntent.ts` → `renderer.anticipate`).
- **Placeholder** (`C:app/world/fx/placeholder.ts`):
  - 260 warm motes in a swirling spindle, ~2.4 m tall, swelling to ~5 m over 8 s.
  - It appears when nothing has landed after **700 ms** (`PLACEHOLDER_MS`, `C:app/composables/useIntent.ts:64, 175-178`) or as soon as a `define` op arrives (`:221`).
  - When the spawn lands it collapses into the arrival point (`renderer.ts:312-316`).
- **Arrival** (`C:app/world/fx/arrival.ts` + `renderer.ts:784-...`), scaled by height tier (`BIG = 8 m`, `MID = 3 m`, `renderer.ts:48-49`):
  - Small and mid things pop in with a `sparkle`.
  - Big things come down a sky `beam` (a camera-facing additive shader quad with a hot core, streaks and a touchdown flare), then a `shockwave`, dust and a shake.
  - Modifies get a `shimmer` band that sweeps bottom to top in step with the colour wipe (`arrival.ts:123-150`).
  - Removals `dissolve` into rising sparks.
- **Framing:** `C:app/world/fx/frame.ts` solves a view that shows what just arrived. It turns and tilts first, backs off at most 7 m, and never goes through walls (`MAX_BACK`).

### 2.4 Perf infrastructure (loop 3)

- **LightPool** (`C:app/world/perf/lights.ts`): a constant 6 point + 6 spot real lights. Kit lights are only sources on layer 31, which the camera never renders, so the light count, and therefore the program keys, never change.
- **Shader warm-up** (`C:app/world/perf/precompile.ts`):
  - `warmKit` builds one of each kit kind plus the fx (`renderer.warmExtras`, `:1189-1193`) and calls `compileAsync`, pinning the materials.
  - `precompile` compiles each freshly built hidden holder (`renderer.fresh`, `:180, 413, 775, 1046`).
- **Result:** 60 fps on every beat of the final demo, worst gap 126 ms (`final_eval.md:37`). Loop 3 used to drop to 2 fps with 988 ms frames.

### 2.5 Where the latency budget goes

From `loop1_latency.md` and `final_eval.md`:

- Plain edit: TTFT-bound, about 0.8–1.0 s for intent, so about 1.4–1.9 s from speech end to a built world.
- **Define:** generation-bound. 550–800 output tokens at about 300 tok/s puts the first op at about 2.0–2.4 s. The define-path median is **2.4 s** (`final_eval.md:13`), so speech end to the object is about 3.2 s.
  - The placeholder covers that wait.
  - Loop 1 recommendation 6 (spawn before define, so a placeholder stands at about 0.8 s and morphs when the define closes) was **not done**.
- Director teleport: first op +2.5 s, done +8.4–11.4 s, generation-bound at about 200 tok/s.
- Spend so far is tiny: the final demo cost about $0.30, a define costs about $0.0002–0.0008, and the conjure-30 key is around $7 / $30.

### 2.6 The NPC branch

`npc-people` is three commits ahead of `9dffe58` (104 files, +5,977). It touches `C:app/world/renderer.ts` (+73), `C:server/utils/intent.ts` (+47) and `C:shared/world/ops.ts` (+35), the same three files this port touches. Port on top of `npc-people`, or after it merges, to avoid conflicts. Neither branch touches `parts.ts` or `fx/placeholder.ts`.

---

## 3. Recommended port

### 3.1 Principles

1. **The cheap path never waits on the expensive one.** Haiku `define` and kit spawns stay exactly as fast as they are now. The high-quality (HQ) path is a background upgrade of a *learned kind*. It's a re-define that conjure already knows how to morph into every instance.
2. **Programs on the server, data on the client.** The model writes the conjure-progressive program. The server runs it in a sandbox and streams **expanded `Part[]` data**. The client never runs model code, so the op log and localStorage still hold only data, which keeps the plan's "safe without a sandbox" property.
3. **One refine stage is the core.** Opus with no reasoning, looking at a render of the draft (plus a reference image when the hero tier is on), takes the draft from 1/6 to 6/6 in about 13 s. The Sol polish and judge are an optional third stage.
4. **Merge after the stream ends.** Stream parts as individual meshes so they can pop in. When the stream ends, merge by slot and material into a handful of meshes whose geometry is shared across instances.

### 3.2 When to take the HQ path

The decision is client-side, in `C:app/composables/useForge.ts` (new). It runs when a `define` op is applied:

| Situation | Path |
|---|---|
| Kit kind (incl. dragon, whale, horse, person) | Kit only, **never** HQ. The hand-built kit is already the quality bar. |
| Learned kind already in the world, or a **library hit** for the kind and wish | Use the stored HQ definition (free, instant). Skip the Haiku draft if the library hit comes back first. |
| `define` with count ≤ 3 (a "thing", not a crowd of filler) | **good** tier: Opus refine from the draft render, no reference image. About $0.04, about 13–17 s. |
| Explicit detail words ("detailed", "intricate", "ornate", "realistic", "beautiful", "majestic", "elaborate", "highly detailed") **or** a follow-up "make it better / more detailed / more realistic" on a gazed learned kind | **hero** tier: reference image + Opus refine toward the reference, then Sol polish + two-order judge in the background. About $0.10, refined about 20 s, polish about 40–90 s. |
| `define` with count > 3, inside a Director teleport, or the budget guard is tripped | Cheap define only. Optionally queue a single good-tier upgrade per kind once the scene settles, since all instances morph together. |

For the "make it more detailed" follow-up, add one intent rule: a `modify` with `set.detail: 'high'` (a new prop) on `ref: gaze`. Alternatively, have the client match the phrase. The kernel ignores the prop and `useForge` reacts to it. In the Director, allow at most one hero per teleport (the scene harness's "one hero at most" rule, `CP:scene/planner.mjs:62`).

### 3.3 The pipeline in conjure

```
sentence ─ Haiku intent ─ define(draft parts ≤32) + spawn ─► arrival as today (beam/sparkle, placeholder collapses)
                                   │
                                   └─► useForge.eligible? ── no ──► done
                                             │ yes
            library GET /api/forge/lib?kind&text ── hit ──► upgradeKind(parts) → refine-swap FX
                                             │ miss
     studio render of draft (main renderer → render target)  ‖  [hero] POST /api/forge/ref (cached image)
                                             │
     POST /api/forge (NDJSON): Opus streams program → server vm runs each closed line → {t:'part'} events
                                             │
     renderer: draft → ghost; parts grow through it (≤4 meshes/frame, gold pop + small sparkle)
                                             │
     stream done → validate (parts ≥3, islands ≤ draft's, fit to draft bounds) → merge → upgradeKind
                                             │
     [hero] POST /api/forge/polish (Sol low) → gate → 2× judge → shimmer-swap upgradeKind → library POST
```

### 3.4 Ordered steps with target files

**Step 0: spawn-first (latency, no new spend).** Make the loop 1 recommendation 6 change in the digest (`C:server/utils/intent.ts`, rule 4 / rule 11 and the snowman, clock and castle examples). For unknown kinds, emit `spawn` *before* `define`, so a labelled placeholder lands at about 0.8 s and morphs when the define closes. Then run `bench:intent` to confirm. This shortens the cheap path for every HQ case as well.

**Step 1: richer Part data (shared).** In `C:shared/world/ops.ts`:
- Extend `SHAPES` with `tube | lathe | extrude`.
- Add optional `points`, `radii`, `profile`, `outline`, `depth` and `mirror` to `PartSchema`/`Part`. Validate these strictly: finite numbers, ≤8 points, ≤16 profile or outline vertices.
- Add `HQ_MAX_PARTS = 240`, used only by the forge path. Keep `DefineOp`'s 32 cap so Haiku's defines stay small.
- `C:shared/world/kinds.ts` `learnedKind`: compute footprint and top from a shared `partBounds` (port `CP:scene/geom.mjs:20-59`, which needs no three) so tubes, lathes, extrudes and mirrors size correctly.
- Add `quality?: 'draft'|'good'|'hero'` and `basis?: string` (the draft's parts hash) to `KindDescriptor`.

**Step 2: geometry builders + merge (client).** In `C:app/world/parts.ts`:
- Port `tubeGeometry` (`CP:shapes.js:22-59`), lathe and extrude (`:66-73`).
- Bake `mirror` into geometry: apply scale x −1 and flip the index winding. Don't use a negative-scale group.
- Use conjure's `mat()`/`glowMat()`/`materialLook`. Do **not** use progressive's `flatShading`/`DoubleSide` materials; they're new program variants the warm-up doesn't cover. Lathe profiles should close with r=0, and extrudes and tubes are capped, so front-side culling is fine.
- Add `buildFromPartsMerged(parts)`: group by (slot, color, material, glow), apply each part's TRS, and `mergeGeometries` (three/addons `BufferGeometryUtils`). The result is **≤ ~8 meshes per object** instead of 60–190.
- Cache the merged geometry by `hashParts` (the renderer already has `hashParts`, `renderer.ts:1032`) with `userData.shared = true`. Every instance shares geometry, and each gets fresh materials, because `applyMaterialProps` mutates per item.
- Keep the per-part path for the streaming phase only.

**Step 3: sandboxed program runner + forge API (server).**
- `C:server/utils/forgeRun.ts`: port `runCode` (`CP:scene/geom.mjs:5-18`) into `node:vm` with:
  - a frozen API context;
  - no `require` or `process`;
  - `timeout: 50 ms` per run, which catches `for(;;)`;
  - a part cap.
  - Run the **prefix up to each closed line** as the stream arrives, and emit only the new parts (the server-side version of `streamCode`, `CP:index.html:248-277`).
  - Port the structural island check onto part bounds (union-find over expanded AABBs, `CP:shapes.js:128-149`).
- `C:server/utils/forge.ts`: the prompts. Use `LIVE`/`REFINE` (`CP:server.mjs:151-152`) plus `REF_NOTE` and the Opus speed instruction (`:233`), adapted to conjure:
  - add `o.slot: 'primary'|'trim'|'glow'` and `o.material` to the API, so "make it red" and "make it glow" keep working;
  - use conjure's scale table;
  - instruct "keep the draft's overall size and footprint: envelope W×H×D m".
- `C:server/api/forge.post.ts` (NDJSON, like `director.post.ts`): `{kind, text, tier, draftParts, image(png b64), issues}` → `{t:'part'|'done'|'error'}`.
  - Model: `anthropic/claude-opus-5.5`, `reasoning:'none'`, `only:['anthropic']`, max output 6,000 tokens, 40 s timeout.
- `C:server/api/forge/ref.post.ts`: `google/gemini-3.1-flash-lite-image`, `responseModalities:['IMAGE']`, 40 s timeout. Cache by slug in `.data/forge/ref/`, with in-flight de-dupe (`CP:server.mjs:190-208`).
- `C:server/api/forge/polish.post.ts`: `openai/gpt-6.1-sol`, `reasoning:'low'`, mode `full` (`CP:server.mjs:251-269`), 170 s timeout.
- `C:server/api/forge/judge.post.ts`: Haiku, both A/B orders (`CP:server.mjs:270-292`, `CP:index.html:446-458`).
- `C:server/api/forge/lib.get.ts` / `lib.post.ts`: a cross-session library in `.data/forge/lib/<slug>.json` storing the expanded parts, the program, tier, model, usd, bounds, tags and the key (normalised kind + wish, `slugOf`, `CP:server.mjs:182-183`). Store **expanded parts**, not code, so a hit needs no vm.
- `C:server/utils/aiModels.ts`: add pricing for Sol, the Gemini image model (flat $0.034) and Opus (already there).

**Step 4: cost guardrails (server).**
- `C:server/utils/forgeLedger.ts`: port `CP:scene/llm.mjs:25-47`. Append every forge call to `.data/forge/ledger.jsonl`.
- Before any forge call, refuse with `{error:'budget'}` if:
  - the forge ledger total ≥ `FORGE_CAP` (suggest **$12**, which leaves a buffer under the conjure-30 key with about $23 left);
  - this session spent ≥ `SESSION_CAP` (suggest $1.50, about 15 heroes or 35 goods);
  - or the request's estimate (good $0.05, hero $0.12) exceeds what remains.
- Detect the gateway's "budget exceeded" error (the `why()` pattern, `CP:index.html:243`) and stop forging for the session.
- Show the session's forge $ in the dev HUD.
- Defaults that keep spend low:
  - library first;
  - reference images cached;
  - one forge per kind per world;
  - no forge for count > 3;
  - no auto-forge inside teleports;
  - polish only on the hero tier.

**Step 5: the progressive replace (client renderer + FX).** The goal is to keep beam, sparkles and placeholder exactly as they are for the draft's arrival, then refine the arrived object in place.
- `C:app/world/fx/refine.ts` (new):
  - `ghost(body, level)`: per-item materials go transparent, `depthWrite:false`, gold emissive 0.18 (`CP:index.html:389-395`), animated by a ghost level that falls as refined parts arrive (`:399`).
  - `growPart(mesh)`: elastic scale from 0.001 with a gold emissive flash that decays `(1-t)^2` (`:126-147`). A sparkle burst on every 2nd–3rd part, drawn from the renderer's `PARTICLE_BUDGET`.
  - `sweepSwap(old, next)`: a port of `shimmerSwap` (`:493-526`) that reuses `arrival.ts` `shimmer()` for the band. Old meshes fade out below the band and new ones fade in above it, with glints on the band.
- `C:app/world/renderer.ts`:
  - `refining(kind, on)`: ghost every instance of the kind, plus a gentle Placeholder-style mote swirl at low level around the *focused* instance (reuse `Placeholder`, but with `set()` sized to the object's bbox instead of 2.4 m).
  - `growParts(kind, parts[])`: stream parts into an overlay group on the instance nearest the camera only. Queue them so at most ~4 part meshes are created per frame. Other instances just stay ghosted.
  - In `sync()`, for `fx.redefined` kinds whose new descriptor has `quality > draft`, call `rebuild(item, e, at, 'refine')`. This is a third mode next to the morph pop: `buildFromPartsMerged` → `precompile` → `sweepSwap`, staggered 60 ms per instance by distance.
  - Don't auto-turn the camera, which differs from progressive's spotlight (`CP:index.html:478-484`). Conjure's framing rules (`frame.ts`, "camera restraint" in loop 2) say the view only moves for what the player just asked for. At most, re-frame if the HQ version is more than 1.3× taller than the draft.
- `C:app/composables/useWorld.ts`: add `upgradeKind(kind, parts, {quality, basis})`.
  - It replaces the descriptor **outside the undo history**, so the original sentence's undo still removes the kind.
  - It's a no-op if the kind is gone, or if its current parts hash ≠ `basis` (the player redefined or undid it meanwhile).
  - It emits `redefined` and persists.
- `C:app/composables/useForge.ts` (new) orchestrates the flow in §3.3:
  - Keep an `AbortController` per kind, and abort on teleport, undo, or removal of all instances.
  - **Fit to the draft:** scale the HQ parts uniformly so the bbox height or footprint matches the draft's within 0.8–1.25× (`CP:index.html:466-469`), recentre to the ground origin (y_min = 0), and keep +z as the front. Placement and collision were already solved with the draft footprint.
  - **Accept rule:** ≥3 parts, the program ran, islands ≤ the draft's, and any floating parts are a small fraction of the total. Otherwise discard silently and the draft stays (`:404-415`).
  - **Polish (hero):** apply only if it passes the gates *and* wins both judge orders (`:439-458`).
  - **Studio shot:** render one instance with the **main** renderer into a 640×480 `WebGLRenderTarget` with a front-right camera (`CP:index.html:193-197`), read the pixels back, and encode a PNG off the frame. Don't create extra `WebGLRenderer`s: each one is a separate GL context with its own program cache, which compiles everything again and fights the 60 fps budget.

**Step 6: perf checks for 60 fps.**
- Streaming phase: per-part meshes use shared unit geometry for primitives. Unique tube, lathe and extrude geometry is built on demand, about 0.1–0.5 ms each. Cap the queue at ~4 per frame.
- Final phase: merged geometry gives about 4–8 draw calls and shadow casters per instance, versus 60–190.
  - If one kind has >12 instances, build `InstancedMesh` per merged sub-mesh with per-instance colour for recolours. This is optional, because forged kinds are capped at count ≤3 by the trigger rule.
- No new program variants: same `MeshStandardMaterial` parameters as the kit, no flatShading or DoubleSide. Add one ghosted (transparent) material and the refine FX to `warmExtras` (`renderer.ts:1189-1193`).
- Glow parts are emissive only and never create real lights. If an HQ part asks to cast light, put it on `SOURCE_LAYER` so the `LightPool` picks it up (`perf/lights.ts`).
- `precompile` every merged holder before the swap starts (`this.fresh`).
- Verification: rerun the final-eval rAF tracer with "a detailed clockwork owl" and "an intricate pagoda" during a build. The target is 60 fps average and a worst gap under 150 ms.

**Step 7: caching and reuse.**
- Within a world: one forge per kind. Every instance shares the merged geometry, and "five more of those" reuses the HQ kind instantly. This is already how learned kinds work.
- Across sessions: the server library is keyed by normalised kind + wish. Also feed the library index (kind names only, top ~30) into the intent *context* block, not the cached digest, as "Remembered kinds (free, already built)". Haiku then spawns `clockwork_owl` instead of defining it, and the client pulls the parts from `/api/forge/lib`. This is the scene planner's `LIBRARY` pattern (`CP:scene/planner.mjs:86`).
- Reference images are cached per slug; at $0.034 each they're a third of hero cost.
- Seed the library from conjure-progressive's `runs/library/*.json` (8 objects: dragon, lighthouse, lion head, flowers, ramen, wells, face) by expanding their code once offline. Note these use progressive's API, so check the scale and front direction.

**Step 8 (later): the Director.** Port the scene harness ideas into `C:server/utils/director.ts`: the tier field per spawn, a budget accountant, repeats as one forged variant instanced N times, and an upgrade pass for leftover money. A teleport would then mark one hero item (for example the pool table in a pool hall) for a background forge while the kit builds the rest. This is minutes-scale and multi-dollar in the lab, so it needs its own plan.

### 3.5 Expected numbers after the port (estimates)

| Moment | Cheap path (today) | Good tier | Hero tier |
|---|---|---|---|
| Something stands there | 0.8 s placeholder (after Step 0) / 2.4 s draft | same | same |
| HQ starts streaming in through the ghost | — | ~3.5–4 s (draft + studio shot + Opus TTFT ~1 s) | ~7–9 s (waits for the reference image) |
| HQ complete, swapped in | — | ~15–20 s | ~20–26 s |
| Polish decision | — | — | ~45–90 s |
| Cost | ~$0.0005 | ~$0.04 | ~$0.10 |
| Library hit | — | ~0.3 s, $0 | ~0.3 s, $0 |

With about $23 left on conjure-30 and a $12 forge cap, that's roughly 300 good or 120 hero objects before the cap bites. Library hits are free.

---

## 4. Risks

1. **Code execution.** Programs are model-written JS. `new Function` is not a sandbox. Use `node:vm` with a timeout, frozen globals and part caps, and run only on the server. Never ship code to the client or store it in world state; the library stores expanded parts.
2. **Undo, redefine and modify races.** The HQ result lands 15–90 s later. The `basis` hash plus `upgradeKind` outside history handles undo and redefine. Recolours survive only if the HQ parts carry slots, so the prompt must require `slot` on main-body and accent parts, and the client should default the largest part to primary as `buildFromParts` does (`parts.ts:33-35`).
3. **Scale and footprint drift.** HQ programs build at their own scale (progressive had to rescale its polish). If the result isn't fit to the draft bounds, it can intersect neighbours that `layout` placed around the draft footprint.
4. **Style mismatch.** Progressive's renders are flat-shaded, DoubleSide and in studio light. In conjure's lighting, next to the hand-built kit, the HQ objects may read differently. Check visually before tuning prompts.
5. **Perf regressions.** 190 un-merged meshes per instance, a second GL context, or flatShading/DoubleSide variants would each bring back loop 3 hitches. Steps 2, 5 and 6 cover these. Verify with the rAF tracer.
6. **Persistence size.** A 190-part kind is about 20–40 KB of JSON in localStorage, duplicated if the op log keeps the parts. Store HQ kinds by library id plus parts once, not in each history entry.
7. **Judge reliability.** Haiku judging two renders against the reference is cheap but noisy, which is why both orders must agree. Never judge the refine against the Haiku draft: the panel data says the refine almost always wins, so accept it on the structural gate alone, as progressive does.
8. **Gateway budget.** The conjure-progressive key ran into its $30 cap during the matrix. The forge ledger cap and session cap must sit well under the conjure-30 key, and a budget error has to degrade to the draft quietly.
9. **Merge conflicts.** `npc-people` changes the same three core files. Branch from it.
10. **Latency perception.** The 20–90 s upgrades happen while the player keeps talking. The ghost has to read as "being perfected", not "broken", and a lingering half-transparent object for 20 s could annoy. Limit the ghost to a mild level (opacity about 0.6, falling as parts arrive), and only on the instance nearest the camera.

---

## 5. Open questions for Kyle

1. **Default trigger.** Should every eligible define (count ≤3, no kit match) auto-forge at the good tier (about 4¢ and 15 s), or only on explicit detail words and "make it better"?
2. **Reference images.** Show the "genie's vision" card from progressive (`CP:index.html:280-298`) in conjure's immersive HUD, or keep the reference invisible?
3. **Budget.** Is a $12 forge cap and $1.50 per session right for the remaining conjure-30 headroom, or should conjure get a separate key for forging?
4. **Polish stage.** Is Sol's 40–90 s polish worth keeping in a voice-first app where the player has usually moved on, or should the port stop at the Opus refine?
