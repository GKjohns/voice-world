# Conjure (working name) — Voice-Built Worlds — Implementation Plan

**Created:** October 16, 2026
**Status:** Approved (A + C, with selectors, counts and `define`). Executing. Sprints 1–2 complete (Oct 16).
**Decision (Oct 16):** Kyle approved building A + C, keeping the name Conjure, with webcam last. After seeing the storyboard he asked for sets, counts and new objects in the language, which is now in the core idea section.

**North star (Kyle, Oct 17):** "I want the player to almost feel like they're god or they have a genie. It should be a 'holy shit' experience." Every improvement loop gets judged against this, not against "works correctly." That means three things. Responses come fast and feel like they're anticipating you. Arrivals are spectacular, with light, sound, motion and scale. And the world feels alive, and like it answers to *you*.

**Context:** Kyle wants to stand inside a simple 3D world and change it by talking. "Put a building over there" should land a building where he's looking. "Take me to a pool hall" should put him in one. "Somewhere tranquil so I can relax" should build that scene around him, piece by piece. The LLM's job is to work out what he means; the engine's job is to make it happen fast and look good doing it. Meta's metaverse had the 3D and lacked the authoring. Voice plus an LLM that understands intent is the authoring layer it was missing.

**Goal:** Kyle says a sentence, and within about 1.5 s something new falls into the world in a spot that makes sense. A "take me to X" request builds a whole place around him in under 10 s.

**Scope (v0):** desktop Chrome, single player, first-person, simple low-poly procedural graphics (no downloaded assets, same idea as workspace-3d). Voice in, short voice replies out. Optional webcam head-look. Worlds saved as JSON files. No multiplayer, no accounts, no deploy until it's fun.

---

## The dream (what it should feel like)

You open the page and you're standing on a soft grid at dusk. Nothing else is there. A small pill at the bottom says *listening*.

- **"Put a little house over there."** You're looking at a spot about 8 m ahead and to the left. A ghost outline appears there almost at once (that's the engine guessing from your gaze). About a second later the house drops in from a few meters up, bounces once, and settles. Dust puffs out. The voice says "There you go."
- **"Make it taller. And red."** The model knows "it" means the last thing it made, or the thing you're looking at. The house stretches up a floor with a springy ease, and the paint changes color in a wipe.
- **"Line some trees along the road."** It works out what "the road" is, then plants twelve trees one after another, *tk-tk-tk*, each popping up from the ground.
- **"Take me to a pool hall."** The world fades into fog. Your feet stay on a patch of floor. Then the pool hall builds outward from you: floorboards, walls rising, the tables, then green-shaded lamps that flicker on, then cues on racks, a jukebox and neon. It's done in about six seconds, and it's warm and dim.
- **"Take me somewhere tranquil. I want to relax."** No questions back. The voice gets softer, and the scene is a dock on a still lake at golden hour with low fog, pines and drifting fireflies. Ambient loon sounds come in. The model picked all of that on its own because it understood *relax*.
- **Hands-free mode.** Turn your head and the view turns with you (webcam head tracking). Point at a spot and say "there" to mark where something should go. Lean forward to walk.

The magic is *intent → sensible placement → satisfying arrival*. All three have to land, and the third (the animation) is cheap but sells the other two.

---

## The core idea: a small world language

All of the approaches below share one idea, which is also your instinct: **models don't draw. They emit tiny JSON ops onto a stack, and a deterministic engine turns those ops into geometry, placement and animation.**

### Revised after the storyboard: sets, counts and new things (Oct 16)

Kyle tried the storyboard and found two failures. "Make a bunch of trees" made one tree, and "make all the trees red" did nothing. Both come from one flaw in the first draft: **every op pointed at exactly one thing, and only kit items could exist.** The language needs three ideas that it was missing.

1. **Selectors address sets.** Every op that touches existing objects takes a query, not a single reference. "All the trees" is `{ tag: 'tree' }`. "Those houses" is `{ tag: 'house', near: 'gaze', within: 15 }`. "The tallest building" is `{ tag: 'building', sort: 'height', limit: 1 }`. "Every other lamp" is `{ kind: 'lamp', every: 2 }`.
2. **Spawns carry a count and an arrangement.** "A bunch of trees" is `count: 9, arrange: 'cluster'`. "A row of lamps" is `arrange: 'line'`, "a ring of rocks" is `'ring'`, "a forest" is `count: 60, arrange: 'scatter', radius: 25`. Each instance gets a little jitter (`vary: { scale: 0.3, hue: 0.05 }`), so a group never looks copy-pasted. Separate `scatter` ops are gone: `along` is just one more arrangement.
3. **Anything that isn't in the kit gets built from parts.** When there's no matching kind, the model describes the object as 3–20 primitive parts in plain data (shape, size, offset, color, material, slot). Because it's data and not code, it's safe without a sandbox and small enough for a fast model to write in a few seconds. The engine then **remembers the new kind for this world**, so "make five more of those" reuses it right away. This replaces the old Option B codegen with a version that's faster, safer and works with every other op.

Underneath all three is a uniform **entity model**. Every object, whether from the kit or from parts, has the same property bag and the same named material slots, so any `modify` works on anything.

```ts
// The entity: one object in the world. WorldState = { entities, kinds (kit + learned), atmosphere, log }.
interface Entity {
  id: string                    // 'pine#14'
  kind: string                  // 'pine' | 'house' | 'grandfather_clock' (learned)
  tags: string[]                // from the kind definition: ['tree','plant','nature'], so "trees" matches pine/oak/palm
  pos: [number, number, number]; rotY: number
  props: Props
  group: string                 // spawn batch id, so "those" / "undo that" act on the whole batch
}
interface Props {               // the universal property bag: every modify targets these, on any kind
  scale?: number; height?: number                 // uniform scale; vertical stretch
  color?: string; trim?: string; glow?: number    // tint the 'primary' / 'trim' slots; emissive on 'glow'
  material?: 'matte' | 'wood' | 'metal' | 'glass' | 'stone'
  floors?: number; text?: string                  // the only kind-specific params in v0 (house/tower, neon)
}

// ---- What the model emits: ONE flat op shape, `op` is an enum, every other field optional. ----
// Output.object validates the wrapper loosely ({ ops: z.array(LooseOp) }); then each op is parsed
// strictly on its own and dropped (console.warn) if invalid, so one bad op never loses the sentence.
interface Op {
  op: 'spawn' | 'define' | 'modify' | 'move' | 'remove' | 'undo' | 'atmosphere' | 'teleport' | 'say'
  // spawn
  kind?: string; count?: number                   // count defaults to 1
  arrange?: 'cluster' | 'line' | 'ring' | 'grid' | 'scatter' | 'along'
  at?: Placement; radius?: number; vary?: number  // vary: 0..1 jitter on scale/hue/yaw per instance
  facing?: 'player' | 'center' | 'along' | 'random'
  // define (teach a kind, then spawn it in the same response)
  tags?: string[]; parts?: Part[]
  // modify / move / remove
  target?: Selector; set?: Props; relative?: boolean   // relative: numbers multiply ("twice as tall")
  // atmosphere / teleport / say
  time?: 'dawn' | 'day' | 'golden' | 'dusk' | 'night' | 'interior'; fog?: number
  world?: string; brief?: string; text?: string
}
interface Selector {            // always an object, so targets have one shape
  ref?: 'gaze' | 'last' | 'all' // the thing you looked at / the last batch / everything
  kind?: string; tag?: string
  near?: 'gaze' | 'player'; within?: number       // metres
  sort?: 'distance' | 'height'; limit?: number
}
interface Placement {           // one object; the resolver does all coordinate math
  anchor: 'gaze' | 'player' | 'target'            // 'target' = relative to `of`
  of?: Selector; dir?: 'ahead' | 'left' | 'right' | 'behind'
  side?: 'left' | 'right' | 'front' | 'behind' | 'on_top' | 'around'
  dist?: number; gap?: number
}
interface Part {                // plain data, no code: safe without a sandbox
  shape: 'box' | 'cylinder' | 'cone' | 'sphere' | 'torus' | 'capsule'
  size: number[]; at: number[]; rot?: number[]    // arrays of length 3 (described, not tuple-typed, for strict-mode portability)
  color: string; slot?: 'primary' | 'trim' | 'glow'; material?: Props['material']
}
// Director-only extension (Sprint 4): recipes may place by room coordinates, `xz: number[]`,
// because laying out a room shell is coordinate work. The fast intent model never sees `xz`.
```

**How the two failing sentences come out now:**

```jsonc
// "make a bunch of trees"
{ "op": "spawn", "kind": "pine", "count": 9, "arrange": "cluster", "at": { "anchor": "gaze" }, "radius": 6, "vary": 0.35 }
// "make all the trees red"
{ "op": "modify", "target": { "tag": "tree" }, "set": { "color": "#c0453a" } }
// "put a grandfather clock next to the bar" (no clock in the kit)
{ "op": "define", "kind": "grandfather_clock", "tags": ["clock","furniture"], "parts": [
    { "shape": "box", "size": [0.6, 2.0, 0.4], "at": [0, 1.0, 0], "color": "#5a3a22", "slot": "primary", "material": "wood" },
    { "shape": "cylinder", "size": [0.4, 0.04, 0.4], "at": [0, 1.6, 0.21], "rot": [1.571, 0, 0], "color": "#f2ead8", "slot": "trim" },
    { "shape": "box", "size": [0.08, 0.6, 0.02], "at": [0, 0.9, 0.21], "color": "#c9a34a", "slot": "glow" } ] }
{ "op": "spawn", "kind": "grandfather_clock", "at": { "anchor": "target", "of": { "kind": "bar" }, "side": "right", "gap": 0.5 } }
// "make those houses twice as tall"
{ "op": "modify", "target": { "tag": "house", "near": "gaze", "within": 15 }, "set": { "height": 2 }, "relative": true }
```

The model never does coordinate math, and it never does set logic either. It says *what*, *how many*, *which ones* and *roughly where*. Two deterministic pieces handle the rest:

- **The selector engine** filters entities by kind, tag, distance, prop and sort.
- **The placement resolver** raycasts, snaps to the ground, lays out the arrangement, nudges overlapping footprints apart and faces things sensibly.

That's why fast models are enough for most sentences: a plain edit lands in about 1 s on Haiku. A `define` is slower, roughly 600–1,000 output tokens or 3–5 s, but the ghost marker appears at once, so the wait reads as building. Choosing `tag: "tree"` and `count: 9` is a classification-sized decision, which is where Haiku-class models do well. (Jev isn't a candidate: in picnic-panic it only answers choice questions through `experimental_decide` and can't emit structured ops.) Picnic Panic proved the same split: the model picks macros and a deterministic executor places them.

**The kit plus learned kinds.** The kit is about 40 parametric prefabs, each a `build(props) → THREE.Group` written the way workspace-3d writes its `build*` functions (primitives plus canvas textures). Each one declares `tags`, a footprint, a ground-snap rule, its params, and which meshes belong to the `primary`, `trim` and `glow` slots. Learned kinds (`define`) go into the same registry and are saved with the world. If the fast model produces bad parts, it still gets drawn, as a clumsy but recognizable object. (Later: a Sonnet polish pass could re-`define` a learned kind, and every instance would update in place.)

**Tags carry the semantics.** The catalog the model sees lists each kind with its tags (`pine: tree, plant, nature`; `house: building, home`; `lamp: light, street`), so "the trees", "the plants", "the buildings" and "the lights" all resolve without the model needing to remember which ids exist. A learned kind brings its own tags.

**Context the model sees each turn** (kept small so a fast model can answer quickly; the world is summarized by kind, not listed by id):

```
player: at (0,0), facing N
gaze: ground hit 8.2 m ahead-left (at speech start)  | or: object house#3 (house; color #c0453a; floors 2)
last batch: pine ×16 (group g7)
world (by kind): pine ×16 [tree] · house ×2 [building] · road ×1 · lamp ×3 [light] · grandfather_clock ×1 [clock] (learned)
catalog: <kit kinds + tags + params, cached in instructions>
```

**Deictics are the subtle part.** "Over *there*" refers to where you were looking *when you said "there"*, not where you're looking after you finish talking. So the engine snapshots the gaze ray at `speech-started` (realtime doesn't give word timestamps). The resolver uses the snapshot, not the live gaze.

---

## Approaches

### Option A — Op stack with a fast model ("Lego mode")
Speech → transcript → one fast model call (`generateText + Output.object`, Haiku 5.5) with the scene context → `WorldOp[]` → resolver → animated arrival.

- **Feels like:** instant and dependable. Kit items are instant, and anything else is built from parts through `define`.
- **Latency:** about 300 ms STT tail plus about 400–800 ms model, so roughly 1–1.3 s to arrival. The ghost outline at the gaze point shows up at about 300 ms because it doesn't need the model at all.
- **Cost:** fractions of a cent per command.
- **Weakness:** "Take me to a pool hall" needs 40 well-arranged ops, which is a lot for a small model to get right in one shot.

### Option B — Codegen prefabs ("Infinite kit"). *Superseded by `define` + parts (see the revision above). It's kept here only for the record.*
When a kind isn't in the kit, a strong model (Opus/Sonnet 5.5) writes a `build(params)` function against a tiny safe API (`box`, `cyl`, `cone`, `sphere`, `lathe`, `group`, `mat(color)`). It runs in a Web Worker that returns a serialized mesh description, never raw `eval` on the main thread. The result gets cached into a growing library, so next time it's instant.

- **Feels like:** "make a grandfather clock" really does produce a grandfather clock, about 8–15 s later. The proxy blob is there right away and morphs into the real model when it's ready.
- **Weakness:** slow on first sight, and quality varies. It's a great *layer* but a bad *foundation*.

### Option C — Scene recipes from a Director ("Teleport mode")
"Take me to / build me a…" goes to a planner model (Sonnet 5.5, `reasoning: 'low'`) that writes a **scene recipe**: shell (room size, walls or open), atmosphere, palette, sound, and then 20–60 ops in *build order* (ground → structure → big furniture → lights → small props → life such as fireflies, smoke or birds). The recipe streams, and the engine plays ops as they arrive, so the world assembles around you while the model is still writing.

- **Feels like:** the pool-hall moment. This is the wow demo.
- **Latency:** the first op lands in about 1.5–2 s, and the full scene takes 6–10 s. That's fine, because the building is the show.
- **This is the Camera Shy two-brain split again:** a fast mouth for quick edits and a smart Director for the slow, considered work.

### Option D — Generative 3D and world models (deferred, watch list)
Text-to-mesh, Gaussian splats and world models (World Labs-style navigable scenes, Genie-style). They're beautiful, but they're slow, expensive, hard to edit piece by piece and don't fit "make it taller." **The one cheap win to pull in early is a generated 360° panorama skybox** (an image model through the gateway, mapped onto the sky dome). It gives the tranquil-lake scene a painted horizon for a few cents and doesn't touch the editable foreground.

### Voice front-end: two ways in
- **V1 — Realtime model calls the ops as tools.** `openai/gpt-realtime-mini` through the gateway, using the Camera Shy token route plus the `AbstractRealtimeSession` composable. Ops become realtime tools, so speech-to-tool-call happens in one hop with native barge-in and spoken replies. **Unverified:** Camera Shy runs `tools: []`, so realtime tool calling through the gateway still needs a spike (Sprint 3, task 1).
- **V2 — Transcription, then the op model.** Streaming transcription goes to Option A's fast model. It's more controllable and lets us swap models freely, but the spoken reply is a separate TTS call.
- **Recommendation (revised after review):** V1, but the realtime model gets **one tool, `build({ request: string })`**, not the op schema. The client attaches the gaze snapshot captured at `speech-started` and forwards the request to `/api/intent`. The op schema stays in one place (Haiku, a stronger structured emitter than gpt-realtime-mini), the realtime model just speaks, and `say` ops are shown as captions instead of being spoken. The SDK supports tools: `RealtimeSetupResponse.tools`, `experimental_getRealtimeToolDefinitions`, `onToolCall`. Two traps: tools must come back from the token route (`connect()` overwrites `sessionConfig.tools`), and Camera Shy's `baseConfig = { ...sessionConfig, tools: [] }` must NOT be copied, because it would wipe tools on every instruction patch. The one open question is whether the gateway forwards function calls for gpt-realtime-mini, which is a quick live check at the start of Sprint 3. If it doesn't, fall back to V2 (browser transcription → `/api/intent`) and nothing upstream changes.

### Recommended: **A + C now, with `define` + parts covering what B was for, and D's skybox as garnish**
Start with Lego mode, because it makes every sentence pay off within a second. Then add Teleport mode for the big scenes. Both speak the same `WorldOp` language, so the Director is just a slower, smarter op author. `define` + parts covers what codegen (B) was meant to do.

---

## Architecture (recommended path)

```
 mic ──► realtime session (gateway) ──tool calls──►┐
  │        (ears + mouth, fast edits)              │
  │                                                ▼
 webcam ─► MediaPipe face/hand ─► look + point ─► gaze snapshot @ speech start
                                                   │
                       "teleport" / big ask        ▼
 /api/director ◄────────────────────────────── op router ──► op queue ──► resolver ──► kit.build() ──► arrival anim
 (Sonnet, streams recipe ops) ─────────────────────►┘          (undo stack)    (raycast, snap,    (three.js scene)
                                                                                collide, face)
 worlds/*.json ◄── save/load (op log = the world; replay = rebuild)
```

The world is its op log. Saving writes the log, and loading replays it, so you watch your own world rebuild itself. Undo pops ops off the log.

---

## Handoff / Execution Notes (read first — this plan is self-contained)

- **Repo:** new repo at `~/Programming/Workspace/conjure/`, with Nuxt 4 + Nuxt UI at the repo root. Use the picnic-panic / 2048-ai shape, **not cosmo**: no DB, no auth, no Supabase. It's a toy until it's fun. `nvm use 22`, `npm run dev` (port 3091 is in the script), `npm run typecheck`, `npm run lint`. `npm test` (`node --test tests/*.test.ts`, as in picnic-panic) covers the pure world functions (select, layout, applyOp). Copy `nuxt.config.ts`, `eslint.config.mjs`, `app.config.ts` and `main.css` from picnic-panic as the starting point. Global `ssr: false` (already set in `nuxt.config.ts`). The scaffold and `npm install` are done; npm 10 hits an arborist `edgesOut` bug on this tree, so use `npx npm@11 install` to add packages.
- **3D conventions:** plain `three` (r186), not TresJS, in a `WorldScene.client.vue` the way `workspace-3d/app/components/WorkspaceScene.client.vue` does it. Copy its renderer setup, tone mapping, canvas-texture helpers (`workspace-3d/app/utils/workspaceTextures.ts`) and its Playwright `shoot` script for screenshot iteration.
- **AI conventions:** follow `~/claude-ops/conventions/ai_sdk_usage.md`. Everything goes through the gateway on one `AI_GATEWAY_API_KEY`, using `ai@7`, `generateText + Output.object` for ops, and `instructions:` rather than system messages. The realtime pattern (token route returning `{token,url,expiresAt,tools}` plus a subclassed `Experimental_AbstractRealtimeSession`) comes from `camera_shy/src/server/api/realtime/token.post.ts` and `camera_shy/src/app/composables/useCameraShyRealtime.ts`. Model aliases match `picnic-panic/shared/agents/types.ts` `MODEL_ALIASES`. The dedicated gateway key `conjure-30` ($30 quota, team gkjohns-projects) is already minted and in `.env`.
- **Contract:** `WorldOp` (above) lives in `shared/world/ops.ts` and is the single seam. Kit, resolver, models and voice all import it. Validate every model output with zod and **drop invalid ops instead of throwing**, because one bad op must never stop a scene from building.
- **Order:** Sprint 1 is foundational. Sprints 2 and 3 are sequential (3 reuses 2's context builder). Sprint 4 (Director) and Sprint 5 (camera) are independent and can run in parallel worktrees.
- **Per-sprint loop:** typecheck → lint → Playwright shoot of the scene → update this file → report. Phase 5 verification page in `verification/`.
- **Commits:** local only, never push unless asked. Create the GitHub repo (private) only when Kyle says so.

---

## Sprint Breakdown (recommended path, A + C)

### Sprint 1: World kernel + kit — Foundational [Complete]
**Goal:** a first-person world you can change by typing ops, with arrivals that feel good.
- 1.1 Scaffold Nuxt 4 + Nuxt UI + three. Full-bleed `WorldScene.client.vue`, WASD + mouse-look (pointer lock), ground grid, sky dome, sun.
- 1.2 `shared/world/ops.ts`: `Entity`, `Props`, `Op`, `Selector`, `Placement` and `Part` types plus zod schemas: a loose `OpsEnvelope` for `Output.object`, and a strict per-op parse (`parseOps(raw) → { ops, dropped }`). Invalid ops are dropped with a console warning, never thrown.
- 1.3 `app/world/kit/*.ts`: about 12 prefabs to start (house, tower, pine, oak, rock, bush, road, lamp, bench, fence, table, chair; the kit grows in Sprint 4), each `{ tags, build(props), footprint, fall, params }`, with meshes tagged `userData.slot = 'primary'|'trim'|'glow'`. `app/world/parts.ts` builds a learned kind from `Part[]` through the same interface. One registry holds kit kinds plus learned kinds.
- 1.4 `shared/world/select.ts` (selector engine: ref gaze/last/all, kind, tag, near/within, sort distance/height, limit) and `shared/world/layout.ts` (count + arrange → positions: cluster/line/ring/grid/scatter/along, with jitter and footprint de-overlap). Both are pure, framework-free functions over plain entity data, tested with `node --test`.
- 1.5 Arrival animations: drop-and-bounce, grow-from-ground (plants), rise (walls), flicker-on (lights), plus a dust puff. Ghost outline at the gaze point.
- 1.6 `applyOp` on a plain `WorldState` (entities + learned kinds + atmosphere), with the three.js side reconciling from it. Op log with undo per batch. Save/load to localStorage plus JSON export (replay rebuilds it).
- 1.7 Dev console: type raw JSON ops or pick canned ones.
- [x] **Verify:** typed ops spawn kit items at the gaze point, nothing overlaps, undo works, and a saved world replays.

**Done (Oct 16).** `npm test` (22 tests over parse/select/layout/applyOp, including every worked example), `npm run typecheck` and `npm run lint` are clean. Playwright (`npm run shoot`, `scripts/shoot.mjs`) drove the HUD's example chips; keepers are in `verification/screenshots/sprint1_*.webp` (empty, trees cluster, trees red with the house untouched, houses, houses twice as tall, learned grandfather clock ×6, after undo, night road with lamps plus a dropped bad op). localStorage save → reload replays to the same world.

**Seams for Sprint 2:** `parseOps(raw) → { ops, dropped }` and `OpsEnvelope` (loose, for `Output.object`) in `shared/world/ops.ts`; `applyBatch(state, raw, ctx, label?) → { state, effects, ops, dropped, batch? }` (one sentence = one batch; the client entry point) and `applyOp(state, op, ctx) → { state, effects }` in `shared/world/state.ts`. Context-builder inputs: `WorldState` (`entities`, `kinds`, `atmosphere`, `log`, `lastGroup`), `summarizeKinds(state)` (world by kind with tags/learned/placeholder), `lastBatch(state)` and `gazeEntity(state, ctx)` from `select.ts`, `catalogLines(state.kinds)` from `kinds.ts`, and the `OpContext` (`gaze: { point, entity?, dist? }`, `player: { pos, yaw }`, `seed`) that `useWorld().snapshot()` builds. All of `shared/world` is three-free and runs on the server.

**Deviations:**
- `spawn` also takes `set` (props at birth: "a red house"); the flat op already had `set`, the plan just didn't list it under spawn.
- Unknown kinds spawn a labelled placeholder that **keeps the requested kind name**, so a later `define` of that kind morphs every placeholder in place (effects `redefined`). `define` of a kit kind is ignored with a note.
- `undo` replays the log minus the last batch (the log stays the single source of truth); undo ops run first in their batch and are never logged. Batches that change nothing (a `modify` that matched nothing, a lone `say`) aren't logged either, so undo always undoes something visible. Batch ids (`g3`) can be reused after an undo.
- Effects are a before/after diff (`spawned/modified/removed/redefined/atmosphere/say/teleport/notes`), so they stay right however ops in a batch interact. `notes` explain no-ops ("modify: nothing matches {tag:'tree'}") and are what Sprint 2 should feed back into the op log.
- Selector leniency: plurals ("trees", "houses", "benches") and `kind` falling back to a tag (`kind:'tree'` finds pines and oaks). `ref:'gaze'` with nothing under the crosshair falls back to the last batch.
- Placement keeps the viewer clear: gaze-anchored clusters fill the far side of their disc and other groups/long kinds shift back until the near edge is ~2.5 m + 1.5× footprint away. Without this a 4-house cluster swallowed the camera. Sides (`left/right/front/behind`) are read from the player's view, not the target's.
- `vary` defaults to 0.15 for groups (0.3 for nature) so groups never look copy-pasted; per-instance hue jitter lives on `Entity.hue`.
- `teleport` only clears the stage in Sprint 1 (the Director fills it in Sprint 4); `fog` scales the preset's fog distances. Added a `dawn` preset since the time enum has it.
- Kit is the 12 kinds plus `blob`; descriptors (tags, footprint, height, defaults) live in `shared/world/kinds.ts`, builders in `app/world/kit/*.ts`. Renderer budgets real point lights to the 8 nearest lamps.
- `WorldScene.client.vue` awaits `nextTick()` in `onMounted`: Nuxt's client-only wrapper renders a placeholder first, so the template ref is null on the first tick. The ground grid is an analytic shader (GridHelper aliased into scanlines), and the sky dome blends into the fog colour at the horizon.

### Sprint 2: The op brain (text) [Complete]
**Goal:** type plain English and get ops back.
- 2.1 `shared/world/context.ts`: the compact context block (player, gaze snapshot, last batch, world summarized by kind with tags, learned kinds).
- 2.2 `server/api/intent.post.ts`: fast model (default `haiku`) → `{ ops: WorldOp[] }` via `generateText + Output.object`, with the catalog (kinds, tags, params, prop bag, selector grammar, worked examples including "a bunch of trees" and "all the trees red") as cached instructions.
- 2.3 A text bar in the HUD as the input until voice lands. An op log panel shows what the model emitted.
- 2.4 `bench/intent.ts` eval: about 30 canned utterances × scene snapshots, covering sets ("all the trees red"), counts ("a bunch of", "a row of"), unknown kinds (→ `define`) and references ("it", "those"). Checks for valid ops and the right target set, and reports latency and pass rate for Haiku vs Sonnet.
**Verify:** "put a house over there", "make it taller", "line trees along the road" and "get rid of that" all work from text, and median latency is under 1 s.
- [x] **Verify:** all of these work from text (bench + live app). Median latency is **not** under 1 s: Haiku plain edits are ~1.3 s median through the gateway (see below).

**Done (Oct 16).** `npm test` (27 tests, incl. `tests/context.test.ts`), `npm run typecheck` and `npm run lint` are clean.
- **Files:** `shared/world/context.ts` (`buildContext(state, ctx)`, `trimScene`/`sceneToState`, `compass`/`relativeDir`), `server/utils/aiModels.ts` (`MODELS`, `resolveModel`, pricing), `server/utils/gateway.ts` (`callStructured`, the picnic-panic pattern: cached digest part, short `instructions`, deadline, never throws), `server/utils/intent.ts` (`DIGEST` + `interpret`), `server/api/intent.post.ts`, `app/composables/useIntent.ts`, `app/components/hud/HudIntent.vue`, `bench/intent.ts` (`npm run bench:intent`).
- **Bench** (`verification/samples/sprint2_bench.txt`, 34 utterances × 8 scenes, applied with the real `applyBatch`, checked on the resulting state): **Haiku 34/34 (100%)**, median 1.43 s, p90 2.65 s, plain edits median 1.31 s, `define` median 2.6 s, $0.0002/call, cache hits 34/34. **Sonnet 34/34 (100%)**, median 1.57 s, p90 4.0 s, plain edits 1.42 s, `define` 4.0 s, $0.0049/call. Haiku is the default; Sonnet buys nothing on this set at 25× the cost. Total bench + iteration spend ≈ $0.45.
- **Live app** (`node scripts/shoot.mjs sprint2`, real model through the text bar): "make a bunch of trees" → 9 pines; "make all the trees red" → every tree red; "put a grandfather clock next to the trees" → `define` (6 parts) + spawn beside the grove; "make five more of those" → 5 clocks in a line; "make it night". Screenshots: `verification/screenshots/sprint2_*.webp` (trees, trees_red, clock_thinking, clock, five_more, night).
- **Sprint 3 seam:** `useIntent().build(request, ctx, 'voice') → Promise<IntentOutcome { ok, summary, say?, ops, dropped, model, ms, error? }>`, with `ctx` = `useIntent().capture()` (or `useWorld().snapshot()`) taken at `speech-started`. `summary` is the one-line tool result for the realtime model to confirm with.

**Deviations:**
- Latency misses the 1 s target: a cached ~8k-token digest + ~100 output tokens on Haiku 5.5 is ~1.0–1.4 s per call through the gateway (the first call after idle can take several seconds). Dropping `Output.object` for plain JSON text saved only ~150 ms, so structured output stays. The ghost ring appears at the snapshot instantly, and a pending caption shows the sentence while the pill says thinking, which covers the wait.
- Haiku sometimes returns the envelope with `ops` as a JSON **string** (occasionally with the envelope's closing brace inside it) on long `define` answers, which fails `Output.object`. `callStructured` now salvages the raw text when the envelope fails, and `parseOps` unwraps a stringified `ops` (bracket-aware). This took `define` from 4/6 to 100%.
- "More of those" means the **last batch's kind**, even when the crosshair is on something else (the first live run made 5 pines while looking at the grove). It's a digest rule plus a worked example, and the bench covers it.
- Text-bar deixis: the snapshot (and ghost ring) is taken on the first keystroke of a sentence and discarded if the bar is cleared. Enter anywhere focuses the bar.
- **Mic (V2 fallback, added early):** a mic button uses the browser's `webkitSpeechRecognition` (continuous, interim results shown in the bar). The gaze is snapshotted at `onspeechstart` (and re-armed on each utterance's first partial, since Chrome fires `speechstart` once per session), and the final transcript goes through the same `build`. No spoken replies; `say` is a caption. Sprint 3 replaces this with realtime voice.
- The raw-JSON console is behind the `{}` toggle on the bar (the sprint1 shoot opens it). The op log shows the utterance, its source (keyboard/mic/console), model, ms, ops, dropped ops (server-side and client-side) and notes, and is capped at 24 rem tall. A model toggle (haiku ⇄ sonnet) is on the bar.
- `HudLog`/`useWorld.run` take an optional `RunMeta` (`source, model, ms, dropped, error`).
- Renderer tweak: per-instance hue jitter is ¼ as strong when the entity has an explicit `color`, so "make them red" reads as red and not a mix of pink and orange.
- Known, not fixed (Sprint 4 territory): the night preset is just dark, with no moon or stars; learned kinds get no contact shadow.

### Sprint 3: Voice [Complete]
**Goal:** talk instead of type.
- 3.1 **Spike first:** does gateway realtime support tool calls? Yes → V1. No → V2 (transcription + `/api/intent` + TTS).
- 3.2 Port the Camera Shy token route and realtime composable, with one tool, `build({ request })`, returned from the token route. `onToolCall` → `/api/intent` with the gaze snapshot → apply ops → return a one-line result so the voice can confirm it. Don't copy the `tools: []` baseConfig.
- 3.3 Gaze snapshot at `speech-started`, attached client-side to the tool call. Fallback (V2) if the gateway doesn't forward function calls: browser speech recognition → `/api/intent`, with no spoken replies.
- 3.4 Listening pill states: idle / hearing / thinking / building.
**Verify:** spoken commands build in about 1.5 s, and "there" resolves to where you were looking when you said it.
- [x] **Verify:** realtime tool calls work through the gateway, and "there" resolves to the speech-start gaze. Spoken commands do **not** build in 1.5 s: ops land about 2–3.5 s after you stop talking, and most of that is the Haiku intent call (see below).

**Done (Oct 16).** V1 is the primary path. `npm run typecheck` and `npm test` (43) are clean; `npm run lint` is clean on Sprint 3 files (the one remaining error, at the time of writing, is in Sprint 4's in-progress `server/utils/director.ts`).
- **3.1 live check: the gateway forwards function calls for `openai/gpt-realtime-mini`.** `bench/realtime_check.ts` (`node --env-file=.env bench/realtime_check.ts`) opens the same session the browser opens over the gateway's normalized WebSocket protocol, streams a `say`-generated wav at real-time pace, runs the real `/api/intent` on the tool call and returns the summary. "Put a bunch of trees over there" → `build({"request":"put a bunch of trees over there"})` → 9 pines → spoken "Nine pines, coming up." "Hey, how's it going?" → no tool call, a one-line chat reply. Output: `verification/samples/sprint3_realtime_check.txt`.
- **Latency.** Speech end → build call: **1.15 s** in the node check. That breaks down as the 600 ms VAD silence window plus 0.2–0.5 s of realtime model time (VAD `speech-stopped` → tool call: 311 ms in node; 177–510 ms over 4 browser calls). Then the `/api/intent` round trip takes 1.2–2.7 s (Haiku, same as Sprint 2). The ghost ring appears at speech start and the pending caption shows the request while thinking, so the wait reads as building. The fastest remaining lever is a shorter VAD silence (600 → 400 ms). The intent call is the real cost.
- **Browser run.** `node scripts/voice-shoot.mjs` drives headless Chromium with a fake mic (`--use-file-for-fake-audio-capture=bench/fixtures/session.wav%noloop`, "put a bunch of trees over there … now make them all red"). It screenshots each pill state the first time it appears, and **turns the camera 1.6 rad away right after `speech-started`**. The 9 pines still landed 0.8–0.9 m from the speech-start gaze point, then all turned red. Then it forces the token route to 502 and checks the fallback: a toast appears and the browser mic engages. Screenshots: `verification/screenshots/sprint3_{connecting,listening,hearing,thinking,building,speaking,after,fallback}.webp`. One of 4 runs missed the first sentence (no transcript and no call) and built only the second; it didn't reproduce.
- **Files:** `server/api/realtime/token.post.ts` (`{ token, url, expiresAt?, tools }`), `server/utils/realtimeTools.ts` (`experimental_getRealtimeToolDefinitions` over one `build` tool, memoized), `shared/voice.ts` (voice model ids, instructions, server-VAD and session config, shared by the browser and the bench), `app/composables/useRealtimeVoice.ts`, `app/components/hud/HudVoice.vue` (captions), `app/components/hud/HudIntent.vue` (mic → realtime, pill states, fallback), `bench/realtime_check.ts`, `bench/fixtures/*.wav`, `scripts/voice-shoot.mjs`. `server/utils/aiModels.ts` gained `VOICE_MODELS`.

**Deviations:**
- Model ids are `VOICE_MODELS.voice` / `.transcriber` (re-exported from `shared/voice.ts`), not `MODELS.voice`. A `voice` key in `MODELS` would have made the realtime model selectable as an op model through `resolveModel` / `?model=voice`. The ids live in `shared/` because the browser session needs the model id too.
- **No custom audio class.** `ai@7.0.143` creates its `BrowserRealtimeAudio` lazily inside `connect()` (Camera Shy's 7.0.37 built it in the constructor), so the swap-`this.audio`-after-`super()` seam no longer applies. Conjure records nothing, so it doesn't need that seam. It uses the SDK's audio and hands it our own `getUserMedia` stream with `echoCancellation: true` and `autoGainControl: false` (Camera Shy's two capture lessons). There are no mic/voice level meters.
- Nothing ever sends a `session-update` after connect, so there's no `baseConfig` at all. Tools come only from the token route.
- The tool result is `{ result: summary, hint: "the builder suggests saying: <say>" }`. The voice usually speaks the `say` line ("A little grove for you."), so while the voice is live the world's `say` caption is hidden and `HudVoice` shows what the voice actually says. Without that, the same line appears twice.
- Pill while the voice is live: connecting / listening (connected, quiet) / hearing / thinking / building / speaking. The text-only pill (ready / listening / thinking / building) is unchanged when the voice is off. `data-phase` on the pill carries the state for scripts.
- Fallback triggers when the mic is blocked, the token route fails, startup times out (10 s) or the socket drops while live. It doesn't trigger when the model answers without calling the tool, because that can't be told apart from chit-chat. The voice hangs up on its own after 4 min without speech, so an open mic doesn't stream audio forever.
- The input transcription (whisper-1) arrives about 0.7 s **after** the build call, so the "you said" caption lands after the pending caption (which shows the tool's request text).
- Server VAD `silenceDurationMs` is 600 (Camera Shy uses 900): commands are short. Threshold 0.6, prefix 300 ms.

### Sprint 4: Teleport mode (Director + atmosphere) [Complete]
**Goal:** "take me to a pool hall" builds the whole place around you.
- 4.1 `server/api/director.post.ts`: Sonnet 5.5 streams a scene recipe (shell + atmosphere + build-ordered ops) via `streamText` + `Output.array({ element })`. The client applies each op from `elementStream` as it closes. Recipes may use `xz` room coordinates and `define`.
- 4.2 Transition: fog-out, keep the floor patch under you, then build outward ordered by distance from the player.
- 4.3 Atmosphere: time-of-day lighting presets, fog, palette tinting, ambient sound loops (a few CC0 files), particles (fireflies, dust, smoke).
- 4.4 Extend the kit with interior sets (bar, lounge, cabin) and nature sets (lake, dock, pines).
**Verify:** pool hall, "somewhere tranquil" and "a neon city street at night" each build in under 10 s and read as the right place.
- [x] **Verify:** all three build from the real models, read as the place and are lit well; "make all the lamps blue" works inside the Director-built pool hall; reload replays the street with zero Director calls. Director time-to-complete is 7–10 s; from the Enter key it's 9–12 s (Haiku intent ~1.4 s comes first).

**Done (Oct 17).** `npm test` (56 tests, incl. `tests/director.test.ts`), `npm run typecheck`, `npm run lint` clean. Intent bench (haiku) 37/37, incl. 3 new teleport cases.
- **Files:** `server/utils/director.ts` (digest: room frame, build order, composition rules, catalog, two worked examples; `directScene()` async generator), `server/api/director.post.ts` (NDJSON: `op` / `done` / `error` lines; client disconnect aborts the model), `server/plugins/directorWarmup.ts`, `app/composables/useDirector.ts`, `app/world/kit/{interior,outdoor,city,life}.ts`, `app/world/sound.ts`, `bench/director.ts` (`node --env-file=.env bench/director.ts [--ops] ["place|brief"]`), `tests/director.test.ts`. Edited: `shared/world/{ops,kinds,layout,state,types}.ts`, `app/world/{renderer,atmosphere}.ts`, `app/world/kit/{helpers,index,street}.ts`, `useWorld.ts` (`extend`, director hooks), `WorldScene.client.vue` (`__conjure.director()/renderer()`, M = mute), `server/utils/intent.ts` (kind notes from `kinds.ts`, synonyms, place-description rule), `bench/intent.ts`, `scripts/shoot.mjs` (`sprint4`, `sprint4:pool|lake|street`).
- **Timings** (`node scripts/shoot.mjs sprint4`, final run): pool hall: Director first op 1.37 s, done 8.5 s (34 ops, $0.015); from Enter: first op 2.7 s, complete 9.9 s. Tranquil lake: 1.35 s / 10.4 s (25 ops, 103 entities, $0.013); from Enter 2.7 / 11.7 s. Neon street: 1.30 s / 10.4 s (36 ops, $0.017); from Enter 3.0 / 12.1 s. Across runs: Director first op 1.2–2.7 s, done 6.7–11.3 s. Recipes stream at ~200 tok/s, about 4 ops/s.
- **Screenshots:** `verification/screenshots/sprint4_*.webp`: pool_fog (the fog-out), pool_mid, pool_hall, pool_lamps_blue, lake_mid, tranquil_lake, street_mid, neon_street, street_replayed.
- **Seam:** a `teleport` effect from any `useWorld().run` (text, voice, console) starts `useDirector().start()`; `useDirector().current` has `{ status, t0, firstOpAt, doneAt, ops, dropped, costUsd }`.

**Deviations:**
- **Structured-output grammar limits shaped the Director schema.** Anthropic compiles the schema into a grammar, and compile time explodes with optional fields (measured: 4 optional → 2.5 s, 10 → 11.5 s, 13 → 45 s, 20 → "Schema is too complex"). The full loose op (~50 optional) is refused by Anthropic, and the gateway falls back to Bedrock, which streams **nothing** in tool mode. So `DirectorOpSchema` is its own flat, string-typed shape with 13 optionals (`op` spawn|atmosphere|say; time, fog, ambient, kind, xz, yaw, count, arrange, radius, size, scale, color, text), the gateway is pinned with `only: ['anthropic']`, and `directorToOp()` converts each element to a normal op before `parseOps`. Compiled grammars are cached for about a day. `server/plugins/directorWarmup.ts` pays the one-time compile (25–66 s) at server boot so the first teleport isn't stuck in fog. (FYI for the intent route: its ~50-optional envelope also gets refused by Anthropic and probably runs on the Bedrock fallback. That works with `generateText`, but it's worth a look for latency.)
- **No `define` in Director recipes.** Dropping it kept the schema under the grammar budget. The kit covers the three scenes, and the digest says to substitute the closest kind.
- `xz` and `yaw` (degrees) are top-level spawn fields. Room frame: origin is the player's feet at teleport time, -z is the way they faced, +x is their right (`roomToWorld` rotates by the batch ctx's yaw). Room placements skip de-overlap (a lamp hangs over its table on purpose). New props `length`/`width` size flat kinds. Atmosphere gained `ambient`.
- **One batch per teleport.** `extendLastBatch(state, ops)` appends streamed ops to the teleport's own batch using its ctx and group, so live build == replay and one undo removes the place. If the player speaks mid-build, the rest continues in a follow-on batch (`"pool hall (cont.)"`). Undo, clear, load or a new teleport aborts the stream.
- **Build order and outward stagger.** The recipe's own order (atmosphere → ground → shell → big things → lights → props → life, nearest first) sets the stagger. On top of that, the renderer delays each arrival by distance from the player and recedes the fog to the build frontier at ≤ 9 m/s, plus a sky "veil", a floor patch under your feet, and old entities shrinking out behind the fog. There's no client-side reorder buffer, because ops only arrive about 4 per second.
- **Ambient sound is synthesized** (WebAudio filtered-noise beds: water, wind, room, city, fire), not CC0 files. It starts on the first gesture, and M mutes it. It wasn't verified by ear, because the headless run can't hear.
- **The sky dome was never tone-mapped or colour-converted** (from Sprint 1), so it rendered darker than its hex values and couldn't match the fog. Added `tonemapping_fragment` and `colorspace_fragment`. The dusk horizon is now seamless and skies are a little brighter.
- **Kit:** 28 new kinds. Interior: floor, wall, ceiling, window, rug, pool_table, hanging_lamp, bar_counter, stool, jukebox, neon_sign, sofa, bookshelf, fireplace, cue_rack, potted_plant. Outdoor: water, shore, dock, boat, campfire, tent, reeds. City: storefront (with its own sign and a blade sign from `text`), car. Life: fireflies, dust_motes, embers. Contact-shadow blobs sit under furniture and learned kinds. The placeholder test kind moved from jukebox to pinball_machine. Street lamps were dimmed (28 → 16), since six of them washed out a street.

**Remaining issues:** headless swiftshader runs at about 5 fps, so the mid-build and fog shots are timing-approximate. The Director sometimes puts a rug or a lamp right at the player's feet. Towers are glass-transparent and read pale at night. Bookshelves share one book pattern. Window panes are flat glowing panels.

### Sprint 5: Hands-free (webcam) [Complete — real-face tuning pending]
**Goal:** look and point with your body.
- 5.1 MediaPipe Face Landmarker → head yaw/pitch → camera look, with a dead zone and smoothing. Calibrate by "look at the center."
- 5.2 Hand Landmarker → index-finger ray → a gaze override while pointing.
**Verify:** you can turn, point and place without touching the mouse.
- [x] **Verify (headless):** the camera toggle, models, preview, status, pointing override and permission denial all work with Chromium's fake camera and a face clip. **Not verified:** turning and pointing with a real head and hand (needs Kyle at a webcam; see below).

**Done (Oct 16).** `npm test` (46 tests, incl. 19 in `tests/tracking.test.ts`) and `npm run typecheck` are clean, and lint is clean on every Sprint 5 file. The remaining lint errors are in `bench/.dbg.ts` and `server/utils/director.ts`, which belong to other sprints' in-progress work.
- **Files:** `app/world/tracking/math.ts` (pure: `headAngles`, `headLookStep`, `applyHeadLook`, `smooth`, `wrapDeg`, `detectPointing`, `pointNdc`, tunings), `app/composables/useHeadTracking.ts` (`{ enabled, status, error, yaw, pitch, pointing, pointRay, stream, frame, connections, enable, disable, toggle, recenter }`), `app/components/hud/HudCamera.vue` (toggle + recenter `UButton`/`UTooltip`, 200 px mirrored preview with face-oval and hand landmarks, status line, amber pointing reticle, toast on denial), `tests/tracking.test.ts`. Package `@mediapipe/tasks-vision@1.1.1`.
- **Lazy loading:** nothing loads until the camera toggle is pressed. Then the composable dynamic-imports `@mediapipe/tasks-vision`, fetches WASM from `cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm` (`MEDIAPIPE_VERSION`, which a test checks against the installed package) and loads `face_landmarker.task`/`hand_landmarker.task` (float16) from storage.googleapis.com. It tries the GPU delegate first and falls back to CPU. Cold start in headless Chromium takes about 13 s (SwiftShader); expect it to be much faster on a real GPU.
- **Head look:** yaw/pitch come from the facial transformation matrix (column-major, forward axis = third column). The first face after enabling sets the centre, and the recenter button does it again. Inside ±4° nothing happens. From 4° to 15° the camera is offset directly (2× for yaw, 1.6× for pitch). Past 15° yaw becomes a turn rate (7°/s per degree, capped at 120°/s), so holding your head turned spins you a full 360. Pitch only uses the offset. Angles are smoothed with an EMA (τ 120 ms). Offsets are applied as **deltas** to `renderer.yaw/pitch`, so mouse drag, pointer lock and WASD keep working underneath. The headless run turned the camera 0.8 rad by mouse drag with tracking on.
- **Pointing → gaze override (the seam):** `setGazeOverride(ndc | null)` / `gazeNdc()` live in `app/world/look.ts`. `useWorld()` re-exports `setGazeOverride`, and `renderer.gaze()` casts through `gazeNdc()` instead of the centre (a one-line change in renderer.ts). Because of that, the ground reticle, the HUD gaze label, `useWorld().snapshot()` and `useIntent().capture()` (so the text bar, mic and realtime `build`) all use the pointed spot. Pointing means the index tip is >1.1 palm-sizes from the palm centre and straighter than its PIP, with the middle, ring and pinky tips within 0.9 palm-sizes. It takes 3 frames to turn on and 5 to turn off. The screen point is the fingertip extended 0.6× further along wrist→tip, mirrored for the selfie view, with 1.6× gain and clamped to ±0.95 NDC, then smoothed (τ 80 ms). `window.__conjureTracking.point(ndc|null)` forces a pointed spot for tests and devtools.
- **Headless verification** (scratch Playwright script with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, 0 page errors in every run):
  - Fake camera (no face): status `no face detected`, no crash.
  - Forced pointing at (0.45, −0.35): the amber reticle and ghost ring appear at the pointed spot, and "spawn tower at gaze" lands at (5.6, −5.1) instead of the centre spot. Toggling off clears the override and the preview.
  - `--use-file-for-fake-video-capture` with a y4m clip made from the public-domain 2012 official White House portrait (panning): status `tracking`, face oval drawn, yaw ±2.7° (inside the dead zone, so the camera stays still, as it should). Recenter works.
  - A perspective-warped clip only moved the estimated yaw by 1.6°. A still photo can't fake a head turn, so the rate band is covered by unit tests (`applyHeadLook`: a full 360 at 25°, mouse independence, pitch clamp).
  - Denial (getUserMedia rejected with `NotAllowedError`): status `denied`, with a "Camera blocked" warning toast.
  - Screenshots: `verification/screenshots/sprint5_{noface,pointing,face,denied}.webp`.
- **Needs Kyle at a real webcam:** (1) **sign check**: turning your head left should turn the view left and tilting up should look up. If either is backwards, flip `HEAD_SIGN` in `tracking/math.ts`. (2) Gains and dead zone feel. (3) Pointing thresholds on a real hand (`POINT_TUNING`) and whether the "fingertip + lean" mapping feels like pointing. (4) GPU-delegate start time.

**Deviations:**
- `look.ts` held material looks, not camera look, so the gaze override was added to it as a small separate section, as the brief suggested. Applying it needed a **one-line edit in `renderer.ts`** (Sprint 4's file): `gaze()` now calls `setFromCamera(gazeNdc(), …)`, plus the import. Nothing else in the renderer changed.
- The pointing reticle is a DOM ring (amber, glowing) at the pointed screen spot. The 3D ground ring already follows the gaze, so the private renderer reticle wasn't recoloured (that would have meant more edits to renderer.ts). The centre crosshair stays.
- When pointing at the sky, the renderer's existing fallback still drops the point 14 m ahead along the camera's yaw, not along the pointed ray.
- A pure wrist→tip direction has only one degree of freedom (its angle), so the screen point combines the fingertip's position in frame with the finger's lean (extrapolated past the tip).
- `NotSupportedError` (e.g. headless without fake-UI) shows as an `error` toast rather than `denied`.
- Lean-to-walk moved to Later (as planned).

### Later: lean-to-walk, a Sonnet polish pass for learned kinds, D panorama skybox, a VR/WebXR headset mode, multiplayer worlds.

---

## Review notes (Phase 2.5, Oct 16)
Pass 1 (fresh-eyes simplicity) ran and its findings are baked in above: flat op schema with per-op strict parsing, a single `build` tool for realtime, Jev removed, a smaller Sprint 1, an `undo` op, no `xz` for the fast model, and a smaller selector (dropped `ids`/`where`/`every`). Pass 2 (prod safety) was skipped: there's no deploy, DB or users yet. Pass 3 (analytics/docs) was skipped: there's no analytics framework in this toy, and the README lands in Sprint 1.

## Storyboard

[`storyboard.html`](storyboard.html) is a single file with a live three.js scene. Click a frame, type a command or press the mic button (Chrome speech recognition). It uses a **keyword matcher standing in for the model**, and it **predates the selector/count/define revision**: its panel shows the first-draft ops (`scatter`, single refs). Its job was to show the feel; the shipped app is the spec now.

1. **The void.** Grid at dusk, listening pill. (Sprint 1)
2. **"Put a house over there."** Gaze ghost, then drop-and-bounce. (Sprints 1–2)
3. **"Make it taller and red."** `modify` on `last`. (Sprint 2)
4. **"Line trees along the road."** `scatter` along a ref. (Sprint 2)
5. **"Take me to a pool hall."** Fog-out, then the room builds outward from you. (Sprint 4)
6. **"Somewhere tranquil."** Lake, dock, pines, golden-hour fog, fireflies. (Sprint 4)
7. **Hands-free.** Head-look and point overlay (mocked). (Sprint 5)

**Deviation from the Nuxt UI rails (on purpose):** the world is a full-bleed WebGL canvas, which no Nuxt UI template covers. Only the HUD (listening pill, op log `USlideover`-style panel, text bar `UInput`) maps to Nuxt UI primitives, and the build should use them there.

---

## Environment / Config

| Variable | Required | Description |
|---|---|---|
| `AI_GATEWAY_API_KEY` | yes | dedicated key `conjure-30` ($30 quota) |

## What's Deferred / Out of Scope
Multiplayer, accounts/DB, mobile, VR, physics beyond arrival animations, generated meshes, deploy.

## Open Questions
1. **Which direction?** Recommended: A + C (then B). Or start pure C if the teleport moment is the whole point.
2. **Name:** "Conjure" is a placeholder.
3. **Webcam priority:** is hands-free core to the feel (move Sprint 5 earlier) or a nice-to-have?
