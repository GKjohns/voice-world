# Loop 3 changes

## Intent & honesty

Covers eval items #2, #4 and #7, plus the partial "castle on a missing hill" result.

**#2 Missing subject means conjure it**
- **Digest** (`server/utils/intent.ts`):
  - New rule 12: a named thing that isn't in the world gets spawned with the requested props and motion. It's defined first if it isn't a kit or learned kind.
  - Rule 10 now bans offers ("Shall I…?") and drops the "Alas… Shall I summon one?" example.
  - New examples: "make the dragon fly around me" with no dragon (a spawn with orbit around the player at 18 m) and "make the horses gallop" with no horses (a 9-part horse define plus a herd of 6).
  - The castle-on-a-missing-hill example now uses an empty world.
- **Kernel fallback** (`shared/world/state.ts`, `conjure`): a `modify` or `move` whose selector matches nothing and names a known kind (kit or learned, plurals handled) becomes a spawn of that kind. It carries the props and motion, gets altitude 18 for orbit/fly, and lands at the horizon for colossal terrain.
  - It does nothing if anything in the world carries that word as a kind or tag, so a "lamp" selector over hanging lamps still just misses.
  - Refs and unknown kinds never conjure.
- **Voice** (`shared/voice.ts`): the build tool and the instructions say missing things go to `build` and get conjured. They never refuse, never offer, and never ask "Shall I…?".
- **Catch:** the "a dragon" define example is still in the digest. Once the creatures agent adds the kit `dragon`, the kernel ignores that define, so it only costs latency until the example is removed.

**#4 Weather keeps the time of day**
- **Digest:** rule 8 now says weather never sets the time unless the sentence names one. The storm example no longer sets `time: dusk`, and there's a new "a thunderstorm" at night example.
- **Kernel** (`keepTime`, applied in `applyBatch` and `extendLastBatch`): on a player sentence with no time word, a weather op's `time` is dropped. Aurora is the exception and may still bring night. Teleport (Director) batches aren't touched.
- The atmosphere step already merged field by field. A test now pins that.

**#7 Honesty on every path, no fragments** (`shared/world/honesty.ts`)
- "pour" is no longer a rain claim.
- Offer clauses ("Shall I…?") are dropped.
- A stripped line that is a fragment (it starts with and/then/but…, starts lowercase, or is one word) is replaced whole by `effectLine`, a true line built from the ops: "Day breaks. A waterfall.", "Nine pines.".
- No-op batches get a statement from `noOpLine`, never a question: "Nothing to move, yet." / "Nothing here to change, yet.".
- The no-batch caption path in `useIntent.ts` now runs `honestSay`. The voice tool result (`useRealtimeVoice.ts`) always passes the filtered `builderLine`.

**Verification**
- Tests: 93/93 pass, including 3 new tests in `tests/sky.test.ts`.
- Typecheck and lint are clean.
- `bench:intent` on Haiku: **63/63 (100%)**, with 6 new cases (dragon around me / dragon circles / horses gallop / castle on a hill, all from an empty world, plus storm and snow at night staying night). The conjure cases passed 8/8 over 2 repeats.

## Performance

Covers eval item #5 (frame freezes during teleport builds).

**Cause, measured.** The freezes were shader compiles. three.js bakes the point/spot light count into every program's cache key, unlit materials included. Each lamp that switched on during a build changed that count, so every material in the scene recompiled at once: frames with 6–8 `linkProgram` calls took 0.8–0.9 s. The first appearance of each material variant cost about 100 ms more on a cold GPU cache. Geometry, canvas textures, tweens and `sync()` were not the problem: `sync()` used 20–90 ms in total across a whole build. macOS caches compiled Metal shaders across runs, which hides this on a second run. To show what a first-time visitor gets, the profiler adds a random constant to every shader (`COLD=1`).

**Fixes** (new code is in `app/world/perf/`; `renderer.ts` only gets a few small hook-ins):
- **Fixed light budget** (`perf/lights.ts`, `LightPool`):
  - Six PointLights and six SpotLights always sit in the scene, at intensity 0 when idle.
  - The kit's lights are now only sources. They move to layer 31, which the camera never renders, so three never counts them.
  - Every 200 ms the pool picks the nearest visible sources, and each frame it copies their position, colour, intensity, range and cone.
  - The light count never changes, so nothing recompiles. Flicker, lamp tints, `light` props and the indoor budget all still work, because they set the source and the pool copies it.
  - `budgetLights()` now ends with `lightPool.collect(...)`.
- **Shader warm-up** (`perf/precompile.ts`):
  - `warmKit` builds one of every `KIT_BUILDERS` kind, plus the arrival fx, the dust puff, a blob and a contact shadow, a few per tick after load. It compiles them with `compileAsync` (KHR_parallel_shader_compile), which took about 0.4 s and covered 497 materials.
  - Their materials are pinned and never disposed, so the programs survive when a place dissolves.
  - The renderer also runs `compileAsync(scene)` once for its hidden fx (the vortex and the floor patch).
  - **Creatures agent:** anything registered in `KIT_BUILDERS` is warmed automatically. No API is needed.
- **Per-sync precompile:** holders and rebuilt bodies made in a `sync` are compiled (async) while they're still hidden and waiting for their cue. This covers learned kinds and glass looks.

**Before / after** (headless Chromium, ANGLE Metal, M4 Pro, 1440×900, replaying saved Director recipes through a stubbed `/api/director` with their original op timings, from teleport to 5 s after done; script `scratchpad/loop3_perf/prof.mjs`):

| Build | Cache | Before: avg / min 1 s / worst frame | After: avg / min 1 s / worst frame | Frames > 50 ms (before → after) |
|---|---|---|---|---|
| Pool hall (fresh world) | cold | 37 fps / **2 fps** / **885 ms** | 60 / **60** / **23 ms** | 11 → 0 |
| City (fresh world) | cold | 53 / **3** / **390 ms** | 60 / **60** / **30 ms** | 6 → 0 |
| City (after pool hall) | cold | — | 60 / 60 / 28 ms | 0 |
| Pool hall | warm OS cache, first run | 56 / 21 / 277 ms | — | 6 → — |

- Page load is unaffected: after the scene is ready, the worst frame during the warm-up is 54 ms (one frame).
- The visuals are unchanged. Screenshots of the pool hall's lamp pools and the city street match before and after.
- One caveat: if you teleport within about 0.5 s of page load, the build can still hit compiles that the warm-up hasn't reached yet.

## Camera & sky

Covers eval items #1, #3, #8 and #9. Files: `app/world/renderer.ts` (`standAt`, `skyLook`, `dimIndoorGlow`, plus a few lines in `budgetLights`), `app/world/fx/frame.ts` (`skyTilt`), `app/world/fx/weather.ts`, `shared/world/layout.ts` (`skyDome`, indoor scale), and one line in `app/world/kit/sky.ts` (the paper reads `userData.dim`). Tests are in `tests/frame.test.ts`, `tests/sky.test.ts` and `tests/terrain.test.ts`.

**#1 Tiny never goes under structures.**
- The camera now rides `standAt(x, z)`: the terrain, or the top of a walkable structure if one is within a 0.75 m step of your feet.
- Walkable means a tag of floor, rug, dock, pier, road, path or bridge (and a few similar), or a learned kind whose name matches bridge, deck, platform and so on.
- It works by casting one short ray straight down against those items' visible meshes, and only accepts surfaces that face up. The existing groundY smoothing still applies.
- Shrinking keeps your feet where they are, so you stay on the deck. Walking off the end drops you to the ground or water, and walking into a deck from the side steps you up onto it.
- Headless check: standing on a dock gives eye 2.15 (deck 0.55). "Tiny" gives eye **0.71**, on the planks ([after_cam_tiny_on_dock](loop3/after_cam_tiny_on_dock.webp)). Walking off the side while tiny gives 0.16. Indoors, the floor gives 1.7.

**#3 Look up for sky arrivals.**
- `skyLook` runs instead of the ground framing when one of these lands:
  - a batch where at least 60% of what arrived (or newly rose, or changed motion) sits more than 3 m above the eye;
  - a new storm or aurora.
- It holds your position fixed and glides over 2.1 s (ease in-out, 250 ms after landing). The tilt goes to the median elevation of the flock, clamped to 0.24–0.62 rad. A storm tilts to 0.34 rad at least, and an aurora to 0.5.
- The turn is partial: toward the middle of the things in front of you, at most 0.6 rad. It never tilts down, and it does nothing if you're dragging or walking.
- **Layout:** a "sky" flock outdoors (6 or more things, scatter or cluster, anchored on the player or the gaze) now uses `skyDome`:
  - 6 of every 7 lanterns sit in a ±55° wedge toward the anchor. The 7th can be anywhere around you.
  - Spacing is low-discrepancy, so there are no clumps or gaps.
  - Each lantern's distance (16–90 m) is chosen so it sits 10–35° above the eye, and heights stay inside `SKY_BAND`.
  - Indoors and on the horizon, behaviour is unchanged.
- Headless, 50 lanterns: 15/50 in frame at 0.8 s, then **43/50 at 3 s** after the tilt (pitch −0.12 → 0.47, position unchanged) ([after_cam_lantern_sky_tilt](loop3/after_cam_lantern_sky_tilt.webp)). A test pins at least 30/50 in frame for the tilted view.

**#8 Indoor lanterns.**
- Small airborne things spawned under a ceiling are scaled to 0.45×, and their altitude cap uses the scaled height, so they spread up to the beams.
- In the renderer, glowing floaters under a ceiling share a budget. Halos drop to 0.30–0.65 of normal depending on how many there are (8 get full), and the paper's emissive is set to 0.55×.
- At most 2 floaters indoors keep a real point light. The perf `LightPool` respects this through `visible`.
- The pool hall with 50 lanterns now reads as warm paper under the beams, with no white-out.

**#9 Storm cadence and night snow.**
- The first strike now lands at 0.7 s, inside a ±23° cone in front of you, 70–120 m out. The second comes 2.6–3.8 s later, then every 4–9 s. Measured strikes: 0.74, 3.64, 9.65 and 14.0 s ([after_cam_storm_early_bolt](loop3/after_cam_storm_early_bolt.webp)).
- At night, snow changes in four ways:
  - Flakes are bigger (uSize 0.24 → 0.5), slightly oval, with a bright core and a cool tint.
  - Flakes that would draw at only a few pixels fade out, because those are the ones that read as stars.
  - The cloud cover closes to 0.95.
  - The hemisphere fill rises 60% instead of 15%.
- The day look is unchanged. A night snow still is in the scratchpad (`loop3_cam/snow_night.png`).

**Checks:** 93/93 tests pass. Lint is clean on the touched files. My code typechecks; the one remaining typecheck error is in `kit/creatures.ts` (z possibly undefined), which belongs to the creatures agent. There were no page errors in the headless GPU runs. The script is in the session scratchpad, `loop3_cam/cam.mjs`, and it ran raw ops only, with no model spend.

**Notes**
- On the dock, after the mountain range's framing tilt, the shrink batch left pitch at −0.12 / yaw 0. Something reset the view to the default; it's not from `skyLook`, which returns false on a scale-only batch. Worth a look if it shows up in the demo.
- Inside the room test, the room's own framing first backed the player 6 m out of it (loop 2's `MAX_BACK`). That's existing behaviour, but an indoor wish can put you outside the room.

## Creatures

Covers eval item #6 (a hero dragon and whale), widened to a set of hand-built creatures that move. Files: new `app/world/kit/creatures.ts`; `app/world/fx/motion.ts` (owned this loop); small edits to `shared/world/kinds.ts`, `app/world/kit/index.ts`, `app/world/renderer.ts` (`moveItems`, `driveCreature`, two arrival branches) and `app/world/sound.ts` (`sfxDragon`, `sfxWhaleSong`). Tests: `tests/creatures.test.ts`.

**Kinds** (exact names, for the digest): `dragon`, `whale`, `horse`, `deer`, `fish_school`, `butterflies`, and a rebuilt `bird`. All are tagged `creature` and `animal`, plus their own tags (`dragon`, `beast`, `flying`; `whale`, `sky`, `sea`; `horse`, `mammal`; `deer`, `stag`; `fish`; `butterfly`, `insect`). Each catalog note gives the size and the right altitude and motion.
- **Dragon:** about 16 m nose to tail and 19 m wingspan, faceted. Curved horns, teeth, glowing amber eyes, dorsal spines and a spade at the end of an 8-segment tail. Membrane wings have a shoulder pivot and a wrist pivot, with four fingers and a scalloped trailing edge. Standing, it folds its wings and stands on four jointed legs. It breathes embers now and then, and on arrival.
- **Sky-whale:** a 25 m humpback. A 5-joint spine runs to swallowtail flukes. It has long barnacled flippers, tubercles and barnacles on its head, a lip line and throat pleats. Soft cyan lights run down its flanks and belly, with an additive pool of light underneath.
- **Horse and deer** share one articulated quadruped: 4 legs with hip and knee joints, a 2-segment neck, a head, ears, a tail, a mane (horse) and antlers (deer).
- **Fish school** (28 fish) and **butterflies** (18): one entity each, drawn as instanced meshes and animated in their own frame.

**Slots:** primary is the hide, so "make the dragon gold" recolours it. Vertex colours carry the shading (paler belly, darker membranes), so the shading survives a recolour. Trim covers horns, spines, claws, mane, hooves and barnacles. Only the whale's lights use the glow slot. The dragon's eyes glow by themselves, so "make it glow" lights the dragon's body, and on the whale it brightens the lights and the pool under it. Both were checked in a headless run.

**Animation (all pure and seeded, in `motion.ts`):**
- **`driveOf(e, t, height, style, player, ground)`** reads the same blended pose the body uses, so it agrees with it. It returns speed, turn rate, climb, height above the ground, a stride phase locked to the gallop and walk bob in `travel`, and a weighted look at the player. The look happens about a third of the time, and never while you're behind it.
- **`rig(kind, drive)`** turns the drive into joint angles:
  - **Wings:** a power stroke (a 42% downstroke) with the hand lagging the arm. They beat steadily in `fly` and `hover`. In `orbit` and `drift` it soars, with bouts of beats, and beats harder when it climbs. In a dive the wings half-close and sweep back. On the ground they fold.
  - **Tail:** the swish travels down the segments with a phase lag, and the tail trails to the inside of a turn.
  - **Legs:** lateral-sequence walk and transverse gallop gaits, with a stance phase and a swing phase. In flight the forelegs tuck and the hind legs trail.
  - **Head:** horses and deer graze while still. The dragon roars now and then.
  - **Whale:** its body undulates as a wave that grows toward the flukes, and its flippers tilt into turns.
- **`MotionStyle`** (`pace`, `creature`) is a new optional parameter on `motionPose` and `blendedPose`. The whale cruises at 0.36× pace. For creatures, `drift` becomes a slow swim that faces its velocity instead of a sideways wobble. Facing along the velocity and banking into turns come from the existing `travel` pose.
- The renderer calls `body.userData.drive(d)` every frame (`driveCreature`), moving or not, and adds the arrival tween's lift to `air`, so a diving dragon counts as flying.

**Arrivals:**
- The dragon dives in from 40 m up and 48 m behind its heading. The renderer tweens the holder over 2.6 s while the rig pitches the dragon nose-down with its wings swept back. It levels out, then roars and breathes embers. Sound: `sfxDragon` is a whoosh that swells through the dive, then a growling roar (detuned sawtooth, a sweeping resonant low-pass, a rough 23 Hz tremolo) with a sub rumble.
- The whale sinks 32 m over 6.5 s. Sound: `sfxWhaleSong`, two gliding calls (a long low moan, then a higher answer) with vibrato, harmonics, a sub swell and heavy reverb.
- Horses, deer and the swarms use the standard `grow` arrival.

**Materials:** geometry is built once per kind (`userData.shared`), so the perf warm-up covers every creature automatically. Materials are made per instance, 3–6 per creature, because the recolour path writes material colours per entity. Sharing them across instances would turn every dragon gold.

**Screens** (headless, raw ops only, no model spend):
- [after_creatures_dragon_dusk](loop3/after_creatures_dragon_dusk.webp): orbiting at dusk, wings spread on a downstroke, breathing embers.
- [after_creatures_skywhale_night](loop3/after_creatures_skywhale_night.webp): the sky-whale overhead at night among lanterns.
- [after_creatures_horses_gallop](loop3/after_creatures_horses_gallop.webp): six horses galloping.
- Deer, fish, butterflies, gulls, the gold and glow recolours and the dive are in `scratchpad/loop3_creatures/out/`.

**Checks:** all tests pass (6 new in `tests/creatures.test.ts`: determinism, the power stroke, folding versus flying, the bank and tail-to-inside, the gallop stride and fluke amplitude, and the look gating). Typecheck and lint are clean.

**Notes:**
- The intent digest's "a dragon" `define` example should go. The kit `dragon` now wins.
- An orbit around the player is mostly seen side-on. The dragon looks best when you stand off-centre from the loop, or when it orbits `self` near the gaze.
- The standing dragon's folded wings read as a raised sail. They're acceptable, but they're the weakest pose.
