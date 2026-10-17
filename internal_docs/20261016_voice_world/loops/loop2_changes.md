# Loop 2 changes

## Camera, input & anticipation

Covers loop2_eval.md items #1, #2, #5 and #7. Files: `app/components/hud/HudPresence.vue`, `app/components/WorldScene.client.vue` (the M handler moved out), `app/world/fx/frame.ts`, the camera code in `app/world/renderer.ts` (`frameWish`, `godView`, the new `landing`, `freeDist`, `cancelWalk`, `placeholder`), `app/world/fx/anticipate.ts` (brighter), the new `app/world/fx/placeholder.ts`, `app/composables/useIntent.ts`, `app/composables/useRealtimeVoice.ts`, and the new `tests/frame.test.ts`. One example block was added to `server/utils/intent.ts` (sky's file; see the end of this section).

**#1 Type-to-start keeps every letter.** W, A, S, D, M and space are now "maybe typing". They walk at once (or, for M, wait to mute). If any other key follows within 350 ms, the HUD takes the step back (`renderer.cancelWalk(pose)`), opens the field and inserts both letters. It's always walking when the key repeats, is held longer than 180 ms, is the same walk key tapped again, or is pressed while the mouse is locked or dragging. A lone M mutes once 350 ms pass with nothing after it, and in dev mode M mutes immediately. The HUD listens in the capture phase and `preventDefault`s the keys it takes, and the renderer's walk handler now skips prevented keys, so a second letter never walks. The onboarding whisper now reads "just start typing (or press Enter)". Headless (keys typed at 70 and 130 ms): "a dragon", "make it huge", "slow down", "wander", "summon a thunderstorm" and "draw a sword" were sent exactly, and mute stayed off. Holding W for 700 ms walked 4.1 m with no field opening, and a lone M muted.

**#2 Camera restraint.**
- `solveFrame` tries a step back of 0 first, then 1.5, 3, 4.5, 6 and 7 m (`MAX_BACK` = 7). It stops 0.8 m short of whatever the renderer's `freeDist` ray hits; that ray is cast at eye and knee height against every entity. If nothing fits, it stays put and turns and tilts toward the middle of the thing ("awe from below"). The old 100 m ladder is gone.
- `godView` records where you stood (the first lift only). On undo you land exactly back there, at eye height. On any other wish that isn't a scale-up, you land there too, unless you've flown more than 8 m from the lifted spot, in which case you drop straight down where you are. The old "something over 14 m exists, so stay aloft" rule is gone. `preLift` clears once you're back on the ground, so a landing you interrupt by moving finishes on the next wish.
- Headless: in a Director pool hall, standing 1.5 m in front of a wall, lanterns, a giant lion statue and a mountain range each moved the player 0.00 m with no wall crossing (the camera tilted to frame). For 10× then undo, the player went from (0.22, 1.6, 2.99) to y 78.6, then back to (0.22, 1.6, 2.99). `tests/frame.test.ts` pins the cap, the wall stop and "colossus: stay and tilt".

**#5 The world listens.** `useIntent.capture()` (called on the first typed letter, browser-mic speech start, and realtime `speech-started`) now calls `renderer.anticipate(gaze)`. `build()` re-arms it, because a voice wish's speech-start glow may already have let go. It clears when something lands (the renderer already did this), at the end of `build` when nothing else is pending, when typing is cancelled, and on a realtime `response-done` that had no tool call (chit-chat). `useIntent.release()` is exported for that. The motes are a bit bigger and the ground pool brighter, so it reads at 15 m ([after_cam_glow_while_typing](loop2/after_cam_glow_while_typing.webp)).

**#7 Placeholder.** This is the new `fx/placeholder.ts`: about 260 warm motes in a slowly swelling spindle (2.4 m tall, growing to about 5 m over 8 s) with a bright core. `build()` shows it at the gaze point once 700 ms pass with no world-changing op, or as soon as a `define` op arrives. It fades in over about 0.5 s, so a quick edit barely shows it. When the first spawn lands, the renderer collapses it into the arrival with a flash. A modify, remove or teleport just fades it. Headless "a dragon": it was visible from about 0.7 s (it passed 0.3 opacity at 1.5 s under swiftshader), and the dragon arrived at 5.0 s ([after_cam_placeholder_dragon](loop2/after_cam_placeholder_dragon.webp)). This is client-only: I didn't add a server `defining` event, because `streamIntent` treats any non-op event as `done`.

**Creature define quality (sky's digest, one block).** I appended one worked example after the snowman in `server/utils/intent.ts`: "a dragon" as a 19-part define (body capsule along z, forward-leaning neck, head and snout, horns, glowing eyes, 4 legs, 2 raised wings, a tail and tail tip, 3 spine cones), followed by a short guidance note on creature anatomy and real sizes. Headless, Haiku produced a 19-part dragon in 5 s. It now reads as a dragon front-on (wings, horns, neck), not the loop 1 frog-blob. One caveat: for the literal phrase "a dragon" it mostly copies the example. **@sky:** feel free to move or reword the block; it's self-contained.

**Notes and gaps**
- The lanterns in the pool hall rise above the ceiling, so you can't see them from inside, even with the camera tilted up. That's for whoever owns altitude.
- The dragon spawns facing the player, so its wings are seen edge-on. A three-quarter `facing` would show off the silhouette.
- Typists slower than 350 ms per key who start with W, A, S or D lose that first letter (it was a step). Enter or / always opens the field empty.
- The verification script and its PNGs are in the session scratchpad `loop2_cam/`.

## Terrain & scale

Eval items #6 (colossal tier) and #11 (360° "around me").

**Terrain kit** (`app/world/kit/terrain.ts`, descriptors in `shared/world/kinds.ts`, height functions in the new pure `shared/world/terrain.ts`). Kinds: `mountain` (220 m, scale 0.4–1.8), `mountain_range` (one entity, 5–12 peaks up to 260 m along an 800 m arc that bows around the viewer), `hill`, `cliff` (mesa), `volcano` (240 m, glowing crater and lava streaks, a lit smoke plume), `waterfall` (scrolling sheet, foam, mist, its own rock backing), `river` (a meandering ribbon with banks and flow streaks), `island` (with its own sea), `canyon`, plus `giant_moon` and `planet` for the sky. Everything is faceted and flat-shaded. Recolouring works through slots (color = rock or grass, trim = snow, sand or the grass top), so "make the mountains purple" works. Every kind is tagged `terrain` and then by type (mountain, water and so on).
- **Aerial perspective:** terrain materials swap in their own fog chunk. They fade over about 7× the fog distance, and high faces fade less than low ones, so a range at 700 m reads as a hazy silhouette with bright snow. Each foot sinks into the same ground mist as everything else. During a teleport reveal the terrain veils fully. The camera far plane is now 3200 m (was 600) and the ground plane is 6 km. The atmosphere presets are untouched.
- **Arrival:** terrain heaves up out of the ground over 2.6–4 s, with a rumble shake for the whole rise, a dust burst, the summon swell and the existing impact (shockwave and thump). There's no sky beam (`renderer.arrive`, the `colossal` branch). Sky bodies grow into the sky.

**Placement** (`shared/world/layout.ts`, `ops.ts`):
- `at: { anchor: 'horizon', dir? }` places things 250–1400 m out (default `max(380, r + fitDistance(h)·1.15)`, about 680 m for a range) in the facing direction, turned by `dir`. A counted spawn spreads over up to 120° of view. `dir: 'around'` rings the player. `dist` max is now 1500, and the Director's `xz` range is now ±1500.
- `at: { anchor: 'player', dir: 'around' }` fills an annulus around the viewer, nearest first, so the build radiates outward.
- **Terrain snap:** `groundHeight` / `groundUnder` sample the same height functions the meshes use. Spawns over a hill, cliff or mountain settle onto its surface (taking the lowest of the centre and 4 edge points, so a castle sinks into the crown instead of overhanging it). `on_top` of a terrain target means its summit surface. Terrain is never a de-overlap obstacle, and terrain only keeps its edge clear of the player, not 1.5 footprints.
- Terrain's gaze clearance push is natural: "a volcano over there" lands about 500 m out because it needs that distance to be seen whole.

**Brains:**
- The intent digest has one appended "Terrain and scale" block (the horizon and around anchors, "on that hill" with and without a hill, and 8 worked examples). The "never claim terrain" clause is dropped from rule 10.
- The Director gets 360° guidance, landscape distances and **Worked example C**: a crossroads under the player, shops on all four arms with lamps on the corners, and two rings of towers.

**Verify:**
- `tests/terrain.test.ts` has 6 tests (horizon distance, direction, spread and ring; around-me in all 4 quadrants; summit and slope snap; zero outside the footprint; a raised hill raises what's on it). `npm test` passes 86/86. Lint is clean on the touched files.
- Bench: I added 6 terrain cases (43 total). Haiku and Sonnet both scored **43/43 (100%)**.
- Typecheck: the only errors left are in the in-progress motion code (`renderer.ts` `MotionTarget`), which isn't mine.
- Real Director run of "build a city around me": 36 ops, city in all four directions ([city grid](loop2/after_terrain_4_city_around_me_4dirs.webp)).
- Shots: [range at golden hour](loop2/after_terrain_1_range_golden.webp), [castle on a hill](loop2/after_terrain_2_castle_on_hill.webp), [waterfall off a cliff](loop2/after_terrain_3_waterfall.webp).

**Known gaps / for the other owners:**
- The player still walks *through* hills: camera y doesn't follow `groundHeight` (that's the camera owner's code; `groundHeight(state, x, z)` is ready to call).
- `frameWish` tilts far up while a range rises. The hover highlight ring draws a 90 m circle around a gazed hill.
- `settleLift`'s "tallest > 14 m" rule now always fires once a mountain exists. It should ignore `isTerrain` kinds.
- The new framing raycaster (`freeDist`) crashes on Sprites without `raycaster.camera`. I set `raycast = () => {}` on the terrain sprites, but other sprite users can hit it too.

## Sky, motion & weather

Eval items #3, #4, #8, #9 and #10, end to end (schema → digest → kernel → renderer). New files: `app/world/fx/motion.ts`, `app/world/fx/weather.ts`, `app/world/kit/sky.ts`, `shared/world/honesty.ts`, `tests/sky.test.ts`.

**The op language** (`shared/world/ops.ts`). The language adds optional props on spawn and modify: `altitude` (metres, or `"sky"`), `motion` (`hover | drift | orbit | fly | wander | gallop | spin | sway | none`), `around` (`self | player | gaze`), `range`, `speed` and `light`. Atmosphere gains `weather` (`clear | rain | snow | storm | fog | aurora`), a one-shot `event` (`lightning | meteors | eclipse | sunrise`) and `playerScale`. The Director's flat op passes `altitude`, `motion` and `weather` through. A bad weather word is dropped, never the whole atmosphere op. The test's optional-field budget is now 16; the Director writes text JSON, so there's no grammar limit to protect.

**Kernel** (`state.ts`, `layout.ts`)
- **Altitude** is the real `pos[1]` (above any terrain). For a spawn with `"sky"`, a flock spreads 15–45 m up and one thing floats at 24 m; a numeric altitude jitters ±20% within a group. Airborne spawns skip de-overlap and the fit-distance push-back, and a sky scatter defaults to a 30 m or wider radius. On modify, altitude sets the height, a relative altitude multiplies it, and `0` lands things.
- **Motion paths:** orbit, gallop and fly resolve a shared circle per op (`entity.path`). Around the player or the gaze, each thing keeps its own distance. Around `self`, the loop sits just beyond the group, away from you, so every horse starts on it and the herd runs one band. `motion: none` clears the path. Undo, save and load replay all of this.
- **Effects** now carry `facts` (what really happened, for example "40 lantern: in the sky 15–43 m up, drift, glowing", "weather → storm", "player scale → 0.1") and `events` (one-shots, never replayed on load).

**Honesty (#9)** (`honesty.ts`, applied in `commitOps` and `extendLastBatch`)
- Every `say` is checked against the batch's ops and the resulting world. Clauses that claim flight, drifting, galloping, spinning, rain, snow, storms, aurora, meteors, an eclipse or "moved" without the matching effect are stripped. Negated clauses ("It cannot fly… yet.") are kept.
- If a sentence tried to change the world and nothing matched, any triumphant line becomes "Alas, nothing here answers to that."
- `useIntent` adds `facts` to the tool-result summary (one line). `VOICE_INSTRUCTIONS` now builds the confirmation only from that result line, and `BUILD_TOOL` names flight, weather, lanterns ("never turn them into lamps") and size.

**Rendering**
- **`fx/motion.ts`:** a pure, seeded pose for each motion: hover bob, a wind-drift wander, orbit with bank, figure-eight flight, grazing wander, a gallop stride, spin, and sway about the base. It's applied to the item's `stretch` group in the holder's frame, so arrival and move tweens still run underneath. Each motion blends in over 1.4 s from where the thing stands, so a modify never teleports it. `renderer.moveItems` runs it every frame.
- **`fx/weather.ts`:**
  - **Precipitation:** GPU point clouds, 14k slanted rain streaks and 7k snowflakes, wrapped around the camera in the shader, with no per-frame writes.
  - **Clouds:** an fbm cloud dome for rain, storms and snow.
  - **Aurora:** two shader curtains.
  - **Lightning:** jagged ribbon bolts with a violet sheath and branches. A storm strikes every 3.5–10 s, and the `lightning` event strikes where you look (at least 45 m out).
  - **Meteors and eclipse:** camera-facing meteor streaks, and an eclipse disc sliding over a corona.
  - **Grading:** `grade(preset)` folds the weather into the time-of-day preset. A storm greys and dims the sky, rain darkens the ground and makes it reflective, snow whitens the ground and hides the grid, the aurora tints the light green, and a flash lights the whole world.
  - The renderer now keeps the ungraded `atmosBase` and reapplies the grade while it changes.
- **Sound** (`sound.ts`): a separate weather bed (rain hiss, a storm downpour with gusts, snow's hush), `sfxThunder` (a crack when close, then a rolling rumble delayed by distance) and `sfxStar`.
- **Sunrise:** a 7 s sweep through dawn to day.
- **Arrivals:** airborne things rise into place from below, so lanterns are released rather than dropped. Sky flocks don't trigger the framing glide (`frameable`).
- **Glow (#8):** `glow` now works on everything. A kind with no glow parts, or any learned kind, glows with its body: emissive in its own colour, leaning toward warm light, with a soft additive halo. A glow-only modify reaches the emissive and gets the shimmer. `light` adds a real point light that's counted by `budgetLights`.
- **New kinds:** `lantern` (a paper sky lantern with a flame, a flickering halo and no point light) and `bird` (a gull with beating and gliding wings).
- **Player size (#10):** `atmosphere.playerScale` scales eye height, stride and the near plane geometrically over 1.8 s, with a whoosh. A big shrink tips your gaze up. Undo restores you, and a teleport resets it.

**Brain.** The digest gains a "Sky, motion, weather and glow" section with 11 worked examples: lanterns (also by voice, with night), the dragon flying around me, galloping horses, circling birds, snow, a thunderstorm, a lightning strike, the castle glowing, 10× bigger becoming playerScale 0.1, and "make me tiny". Rule 6 has a carve-out for "everything N× bigger", rule 8 maps weather words to real weather, rule 10 is rewritten for honesty, and lantern and bird have synonyms. "Fill the sky" centres the scatter 18 m ahead so most lanterns are in view. The Director digest learned altitude, motion and weather, with birds circling and lanterns drifting as examples. The context line shows weather and player scale.

**Verification**
- 86 of 86 tests pass. 12 are new in `tests/sky.test.ts`: altitude layout, airborne skipping de-overlap, modify altitude, orbit around the player, the herd's shared loop, motion determinism across save/load replay, blended start and constant orbit radius, weather and events, playerScale with undo and teleport, the honesty filter, and the Director pass-through.
- Typecheck and lint are clean.
- `bench:intent` (Haiku): **57/58 (98%)**, with 15 new sky cases, all passing (lanterns ×2, birds, dragon orbit, gallop, honest no-dragon, snow, storm, rain, aurora, meteors, castle glow, trees glow gold, tiny, 10×). The one failure is the terrain case "castle on a hill that isn't there". In the first run "ten times bigger" still scaled `ref all`; the rule 6 carve-out fixed it (2/2). Latency was noisy today (887 ms–4.5 s for one-op edits) while other agents were also hitting the gateway.
- Screenshots: [lanterns](loop2/after_sky_lanterns_sky.webp) (50 warm lanterns over a night lake), [storm](loop2/after_sky_storm_lightning.webp) (a strike lights the clouds through the rain), [snow](loop2/after_sky_snow.webp) (overcast, a white ground, lamp pools), [aurora](loop2/after_sky_aurora.webp) (curtains plus a meteor). Also checked, in scratch: the dragon orbiting and banking overhead, the glowing castle, and the tiny view.

**Known gaps**
- The thunder and the rain bed were verified for graph errors only (headless runs can't hear).
- Learned creatures still look crude, so "a flying dragon" is a flying blob. Motion sells it but doesn't fix it.
- The gaze highlight ring stays at a moving thing's home spot.
- Lanterns don't reflect in water.
- "Tiny" works best with things nearby. Layout still keeps spawns a few metres off the player, so the effect reads more like a diorama than a blade-of-grass view.

## Integration

Seams between the three loop-2 owners, fixed in `app/world/renderer.ts`, `shared/world/layout.ts`, `shared/world/state.ts` and `bench/intent.ts`, with 2 new tests in `tests/terrain.test.ts`.

- **Walking on terrain.** The camera now rides on `groundHeight`: `groundY` eases toward the ground under you (fast going up, a bit slower coming down, and it snaps on a teleport or on any jump over 60 m), and eye height = `groundY + EYE·playerScale + lift`. Walking goes through `walk()`. The slope is measured over a 2.5 m stride, so a single steep facet doesn't stop you. Uphill steps slow down (`1 − 0.6·slope`, never below 0.35×). Anything steeper than 1.0 (45°) drops the uphill part of the step, so you slide along the contour, and if what's left is still too steep you stop. The god-view lift bypasses all of this. `solveFrame`, the god-view fallback and `freeDist` all measure eye height from the ground at that spot. The kernel's `fitDistance` uses your eye height above the ground, not your absolute y.
- **Raycasters.** Gaze and wall-stop now cast against a flat list of visible **meshes** (`rayTargets()`), never recursing into Sprites, Points or Lines, through a `safeHits` wrapper that catches errors. `wallRay.camera` is set as well. The terrain sprites' `raycast = () => {}` stays, because smoke shouldn't catch the gaze; they were never hidden. The real crasher was the unknown-kind blob's label Sprite, and that path is covered now.
- **God view.** The camera owner had already removed the old 14 m rule. On a non-undo wish you now stay aloft only if the landing spot is `engulfed()`: a non-terrain thing at least 6 m tall, standing on the ground, whose reach covers the spot. Terrain and distant mountains never count. Undo always lands you.
- **Interiors.** The new `ceilingOver()` finds the lowest ceiling or roof over a point. An airborne spawn under a ceiling, or by a player standing under one, re-samples any points outside the room to random spots inside it. `capAltitude()` re-spreads any altitude that would poke through, between 1.9 m and just below the beams. A modify that sets altitude is capped the same way.
- **Castle on a missing hill.** A kernel fallback: a spawn `on_top` of `{kind|tag: <a terrain kit kind>}` when none exists raises that landform at the gaze first. Before the fix this case passed 1 of 4 runs; Haiku dropped the hill.
- **Checks.** 88/88 tests, typecheck and lint all clean. `bench:intent` (Haiku): **58/58**.
- **Headless smoke** (`loop2_integ/smoke.mjs`):
  - Walked over a 16 m hill with the eye tracking the ground the whole way, up and down.
  - Running at a 220 m mountain for 12 s stalled at 23 m.
  - A blob sprite plus a tower being framed beside a volcano: 0 page errors.
  - A mountain range, then a bench: lift 0.
  - "Fill the room with floating lanterns" in the pool hall: 12/12 inside the room, highest top 3.28 m (the ceiling is about 3.7 m).
  - "Put a castle on that hill": hill → define → castle, with the castle at y 15.2.
