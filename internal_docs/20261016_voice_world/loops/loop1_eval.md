# Loop 1: experience evaluation (Oct 17, 2026)

**Lens:** the north star, not correctness. "I want the player to almost feel like they're god or they have a genie. It should be a 'holy shit' experience."

**How it was played:** headless Chromium (swiftshader) against the running dev server at :3091, real models through the text bar (Haiku 5.5 intent, Sonnet Director), plus one fake-mic realtime voice session with two spoken commands (`say` + afconvert, 24 kHz mono). I typed at 25 ms/key, started from an empty world, and didn't move the camera between commands unless noted, so the screenshots show what a first-time user would actually see. In-page tracing ran every 40 ms (phase, visible items, state diff, Director status). Two text sessions: the full script (17 commands), then a second run in an open void (10 commands), because the first run's "make everything ten times bigger" blacked out the screen and hid the last three results. Model spend was about $0.35: roughly 30 Haiku calls, 3 Director builds at about $0.015 each, and about 40 s of realtime-mini.

Screenshots are in `loops/loop1/` (8 webp files, referenced below).

## Scores

| Dimension | Score | Evidence |
|---|---|---|
| Speed / anticipation | 5 | Kit edits land 1.2–1.7 s after Enter and `define`s 2–4 s. With voice, the first object lands about 4 s after you stop talking. The ghost ring appears instantly, but nothing else anticipates you, and a teleport shows a blank fog with a "ready" pill for about 1 s. |
| Arrival spectacle | 4 | The drop and bounce, the dust puff and the grow-in are tidy but small. There's no light, no per-arrival sound and no camera move. The outward Director reveal is the one moment with real choreography. |
| Scale and ambition | 3 | "Build a city around me" gave one street. "A mountain range" gave 6 knee-high grey cones. "Make it huge" gave scale 3, with the camera now inside the dragon's legs. Nothing in view was ever much taller than about 25 m. |
| Understanding of intent | 6 | Sets, colours, teleports and moods were all right. But it fibs: "A castle on the hill" (there's no hill), "Wheeee, it's flying" (it doesn't move), "Thunder rolls in" (nothing visible changed). "Make the dragon fly in circles" spawned a *second* dragon off-screen. |
| World aliveness | 3 | Fireflies, embers and lamp flicker exist. Nothing else moves. The horses are frozen mid-"running", the dragon is a statue, and the lanterns sit on the floor. |
| Sense of power / agency | 4 | Small edits feel obedient and quick. Big wishes (storm, flight, 10×, horizon) either do nothing you can see or wreck the view. |
| Voice and personality | 5 | The lines are warm and short ("Autumn came early.", "Stay a while. The lake's in no hurry.") but sound like a generic contractor, not a genie. The spoken confirmation arrives about 5 s after you stop talking. |
| Visual beauty | 6 | The Director's scenes are genuinely pretty: the golden-hour lake, the neon street, the warm pool hall. The void and learned kinds are crude: the dragon is a green frog-blob with stick wings, and the waterfall is a white slab. |
| Immersion (HUD) | 4 | The op log is open by default with raw JSON top-right, kind chips sit top-left, and the bar has a two-line hint row. The pill says "ready" for the whole 10 s Director build. |
| **Overall "holy shit"** | **4** | The teleports earn an "oh, nice." No moment came close to awe, and the two biggest wishes ("10× everything", "a giant tower right there") produced the two ugliest frames. |

## Timeline

Times are from Enter, or from the end of speech for voice. "First reaction" is the pending caption plus the pill moving to *thinking*. The ghost ring appears on the first keystroke, before Enter. "First object" is when ops are applied and the first arrival starts animating. "Done" is the last visible change plus the arrival tween (about 0.6–0.85 s). For teleports, the Director's first op and done times are in brackets.

| # | Command | First reaction | First object | Done | What you see |
|---|---|---|---|---|---|
| 1 | put a castle on that hill (empty world) | 0.02 s | 3.43 s | ~4.3 s | `define castle` (11 parts) on flat ground. Says "A castle on the hill." No hill is made, and it claims one anyway. The castle is pleasant but modest, about 8 m. |
| 2 | make a bunch of trees | 0.03 | 1.73 | ~3.1 | 9 pines, staggered tk-tk-tk. They're planted *in front of* the castle and hide it. |
| 3 | make all the trees red | 0.05 | 1.43 | ~2.3 | Colour wipe ripples outward. Reads well. "Autumn came early." |
| 4 | a dragon | 0.06 | 4.08 | ~4.9 | 12-part green blob with yellow eyes and stick wings ([01](loop1/01_dragon_blob.webp)). Cute, not fearsome. |
| 5 | make it huge | 0.01 | 2.44 | ~3.2 | Scale 3. The dragon grows around the player, leaving the camera between its legs ([02](loop1/02_huge_camera_inside.webp)). No reframing. |
| 6 | take me somewhere tranquil | 0.02 | 1.56 fog → [2.58] | [12.1] ~12.5 + fog lift | Blank beige fog with "ready" pill for ~1 s ([03](loop1/03_teleport_dead_air_fog.webp)), then a lovely golden-hour lake with dock, boat, reeds and 78 pines building outward ([04](loop1/04_tranquil_lake_settled.webp)). The best moment of the session. |
| 7 | make it night | 0.06 | 1.16 | ~2.1 | 0.9 s light fade, stars, fireflies glow, the lamp lights. Lovely. |
| 8 | take me to a pool hall | 0.06 | 1.20 → [2.45] | [11.8] ~15.7 | Navy void for ~1.3 s, then the hall builds outward. It's warm and good, and nearly identical to the Sprint 4 shot. |
| 9 | make all the lamps blue | 0.06 | 1.31 | ~2.0 | The shades turn blue, but the light pools on the tables stay warm amber, so the room doesn't change mood. |
| 10 | fill the sky with floating lanterns (pool hall) | 0.05 | 2.22 | ~3.8 | 20 red-and-white wedges on the *floor* that look like cake slices. 9 of 20 are out of view. |
| 10b | same, outdoors at night (run 2) | 0.05 | 1.89 | ~3.5 | 30 tiny yellow squares at ground level along the horizon ([07](loop1/07_lanterns_on_ground.webp)). The sky is empty. |
| 11 | build a city around me | 0.02 | 1.46 → [2.81] | [11.0] ~11.8 | A good neon street: 10 storefronts, 5 towers, cars, signs ([05](loop1/05_city_street_settled.webp)). It's a street in front of you, not a city around you. |
| 12 | put a mountain range on the horizon (in city) | 0.06 | 1.97 | ~2.7 | Nothing visible, because the street blocks them. "A range on the horizon." |
| 12b | same, empty void (run 2) | 0.06 | 2.06 | ~2.6 | 6 small grey cones on discs, 2 of 6 in view. They read as hills or tents, not a range. |
| 13 | make the dragon fly in circles over the city | 0.06 | 1.38 | ~1.5 | Spawns a **new** dragon off-screen and says "Circling the skyline." Nothing moves. |
| 13b | make the dragon fly around (run 2) | 0.06 | 0.99 | — | A `move` to the gaze point. Nothing visible, and it says "Wheeee, it's flying." |
| 14 | summon a thunderstorm | 0.04 | 2.18 | ~2.2 | A static `thundercloud` define plus an atmosphere op. Nothing is visible: no rain, no flash, no thunder. In run 2 it changed only the fog: "Clouds rolling in." |
| 15 | make everything ten times bigger | 0.06 | 1.30 | ~2.0 | Scale 10 on all 45 entities. The screen goes black because the camera is inside geometry ([06](loop1/06_ten_times_blackout.webp)). The world is wrecked, and there's no hint to undo. |
| 16 | a waterfall pouring off a cliff right there | 0.06 | 2.09 | ~2.9 | A glowing white rectangular slab on a blue base, with no cliff. It reads as a doorway or monolith. |
| 17 | give me a herd of horses running across the field | 0.02 | 2.93 | ~3.6 | 7 blocky brown horses, 5 of 7 in view. The best learned kind, but frozen. |
| 18 | put a giant tower right there | 0.01 | 1.17 | ~2.0 | A scale-3 tower lands about 3 m away. It fills the left half of the screen and you can't see the top ([08](loop1/08_giant_tower_clipping.webp)). |
| 19 | make it rain | 0.04 | 0.97 | — | Fog only. "Rain is not in my kit yet." Honest, but deflating. |
| V1 | Voice: "Put a castle over there." | VAD +0.6 s → *thinking* | **4.0 s** | ~4.8 | The tool call fires about 0.3 s after VAD, and the castle is built 3.1 s later. The pill shows *thinking* for 3.4 s with only the ghost ring. The voice says "A castle, standing proud." **5.1 s** after you stop talking. |
| V2 | Voice: "Now make it night, and fill the sky with lanterns." | VAD +0.7 s | night **1.9 s**, lanterns **4.5 s** | ~5.3 | The voice model split it into two tool calls: night first (nice), then 30 lanterns on the ground. It spoke once: "Lanterns across the sky." (They aren't in the sky.) |

## Observations

**What works**
- **Teleports are the product's best moment.** The fog-tight-then-outward reveal, the ambient bed and the Director's taste (golden hour, fireflies, "Hush now. The lake is holding the light.") are close to the dream. Night transitions are gorgeous.
- **Set edits are reliable.** "All the trees red" and "all the lamps blue" work every time and ripple nicely.
- **Haiku is fast for kit ops** (about 1.0–1.5 s), and the first-keystroke snapshot means "there" lands where you were looking.
- **The voice pipeline is solid.** VAD to tool call takes 0.3–0.5 s, and multi-intent sentences get split correctly.

**Awe-killers, ranked**
1. **Results land out of frame, inside the camera, or too small to matter.** Huge dragon: camera between its legs. Giant tower: 3 m away, top cut off. 10×: black screen. Mountains: hidden behind the street or knee-high. Lanterns: half off-screen, on the floor. A genie that grants your wish where you can't see it isn't a genie. The engine never reframes. `layout.ts` sizes the clearance disc from the descriptor footprint and ignores `set.scale`, and `modify` scale never re-checks clearance at all.
2. **Nothing moves, and nothing comes from the sky.** No flight, no float, no orbit, no gallop, no weather. The op language has no altitude and no behaviours (spawn y is always 0, and entities are static except kit particles). Half of what a delighted user asks for ("fill the sky", "make it fly", "a storm", "running horses", "rain") silently degrades. Worse, the `say` line then claims it worked.
3. **Arrivals are polite, not divine.** A 7 m drop with a bounce and a dust ring is the same for a chair and a castle. There's no light from above, no sound on arrival (`sound.ts` only has ambient beds), no camera shake, and no scaling of the drama to the size of the wish. During the 1–4 s model wait there's only a faint ghost ring, and during the Director's 10 s the pill says "ready".

**Smaller notes**
- **The HUD reads as a dev tool.** The op log (open by default, raw JSON, about 360 px tall) competes with every screenshot. The kind chips add to it.
- **The voice personality is a polite builder.** It's never a genie ("As you wish", "Behold"), and it never reacts to the *scale* of the request. And because the instructions forbid speaking before the tool call, there's 3–5 s of silence after every command.
- **Learned kinds are hit-and-miss.** Horses are fine, the castle is OK, the dragon is a frog, the waterfall is a slab. No animated materials (water, fire on learned kinds).
- **"Build a city around me"** produces a street *in front* of you. "Around me" should mean 360°.
- **"Make the lamps blue"** recolours the shades but not the light they cast, so the mood never changes.

## Ranked improvements (awe per effort)

| # | Improvement | Impact | Effort |
|---|---|---|---|
| 1 | Always frame the wish | H | M |
| 2 | Summoning cue: light, sound and weight on every arrival | H | S–M |
| 3 | Hide the machine | H | S |
| 4 | Altitude and motion in the op language | H | M |
| 5 | Weather and sky events | H | M |
| 6 | Colossal tier: horizon anchor and terrain kinds | H | M |
| 7 | The world answers while you speak | H | M |
| 8 | Genie voice that speaks first | M–H | S |
| 9 | Teleport without dead air | M | S–M |
| 10 | Light colour follows lamp colour | M | S |
| 11 | Global scale edits become a god-view, not a blackout | M | S |
| 12 | Better learned creatures and animated materials | M | M |

**1. Always frame the wish.** H / M.
- **Files:** `app/world/renderer.ts` (new `frame(ids)` that tweens yaw, pitch and a short dolly-back using the existing `look()` math), `app/composables/useWorld.ts` (call it after `run` with `effects.spawned` or scaled ids when less than 80% are in the frustum or the bounding box is within 1.5× of the camera), `shared/world/layout.ts` (make `PLAYER_CLEAR` use footprint × `set.scale`; re-push scaled entities on `modify`).
- **Done looks like:** every command in this eval ends with 100% of new or changed things in view, nothing within arm's reach of the camera, and the top of tall things visible. A soft 600 ms camera glide feels deliberate, not like a snap.

**2. Summoning cue: light, sound and weight on every arrival.** H / S–M.
- **Files:** `app/world/renderer.ts` (`arrive`, `puff`: a 300 ms additive light shaft and a spotlight flash from above at the spawn point, drop height and puff radius scaled by size, a camera shake for anything with scaled height over 8 m), `app/world/sound.ts` (synth one-shots `sfx(kind)`: a rising shimmer on summon, a thud pitched by mass on landing, a glassy tick for each staggered group member, a chord when a teleport finishes).
- **Done looks like:** with the sound on, you could tell a tree from a castle landing with your eyes shut. Every arrival has a visible beam or flash in the mid screenshot.

**3. Hide the machine.** H / S.
- **Files:** `app/components/hud/HudLog.vue` (`open = ref(false)`, shown only with `{}` dev mode), `app/components/hud/HudStatus.vue` (drop the kind chips outside dev), `app/components/hud/HudIntent.vue` (fade the hint row after the first successful command; make the pill director-aware via `useDirector().current` so it says *summoning…* until `status !== 'building'`).
- **Done looks like:** a settled screenshot shows the world, the crosshair, a slim bar and a caption. Nothing else.

**4. Altitude and motion in the op language.** H / M.
- **Files:** `shared/world/ops.ts` (props `altitude`, `behavior: float | bob | orbit | wander | gallop | fly | drift_up`), `shared/world/layout.ts` (y from altitude, with a `sky` anchor spreading spawns over a hemisphere 12–60 m up), `app/world/renderer.ts` (per-item behaviour in the existing `userData.animate` tick at ~L698), `server/utils/intent.ts` (rules and worked examples: "fill the sky with lanterns" → 40 lanterns, `anchor: 'sky'`, `behavior: 'drift_up'`, glow; "make it fly" → `modify behavior: 'orbit'`; "running" → `gallop`). Tell the `say` rule never to claim motion or terrain the ops didn't make.
- **Done looks like:** the lanterns, the circling dragon and the galloping herd all visibly move in a 3 s clip, and nothing ever says "it's flying" while it's standing still.

**5. Weather and sky events.** H / M.
- **Files:** `shared/world/ops.ts` (atmosphere `weather: rain | snow | storm | clear`, plus one-shot `sky: lightning | shooting_stars | aurora`), `app/world/atmosphere.ts` (presets), `app/world/renderer.ts` (instanced rain and snow streaks around the player, lightning that flashes the hemi light and sky for 80 ms), `app/world/sound.ts` (rain bed, thunder after a 0.4–2 s delay), `server/utils/intent.ts` (catalog line and an example).
- **Done looks like:** "summon a thunderstorm" darkens the sky in 1 s, rain streaks the view, and lightning lights the whole scene, followed by a thunder roll. "make it rain" works.

**6. Colossal tier: horizon anchor and terrain kinds.** H / M.
- **Files:** `shared/world/kinds.ts` and a new `app/world/kit/terrain.ts` (hill, mountain with low-poly displaced cones and snowcaps, cliff, mesa; heights 40–200 m; `fall: 'rise'` from below ground), `shared/world/layout.ts` (`anchor: 'horizon'` puts a range 120–300 m out across 120° of the view; `on_top` of a hill), `shared/world/ops.ts` (raise the scale cap to 50 for terrain), `server/utils/intent.ts` ("on that hill" with no hill → spawn a hill at gaze, then the thing `on_top`). Keep the camera far plane at 600 m and the fog per preset.
- **Done looks like:** "put a mountain range on the horizon" fills the skyline even from inside the city, rising slowly out of the ground. "put a castle on that hill" in an empty world builds the hill, then the castle on top.

**7. The world answers while you speak.** H / M.
- **Files:** `app/composables/useRealtimeVoice.ts` (expose the mic input level and the VAD start and stop), `app/composables/useIntent.ts` (the typing equivalent), `app/world/renderer.ts` (the ghost ring pulses with your voice; on speech end a shimmering "gathering" column of motes at the gaze point holds until the first op; the light dims slightly towards the gaze).
- **Done looks like:** something at the target spot visibly reacts within 150 ms of you starting to speak and keeps building tension until arrival. There's no 3 s *thinking* frame where the world is inert.

**8. Genie voice that speaks first.** M–H / S.
- **Files:** `shared/voice.ts` (`VOICE_INSTRUCTIONS`: allow a 1–3 word anticipatory line *with* the tool call, such as "As you wish…" or "Mm, watch…", then a reaction scaled to the wish; give it a persona; try a deeper or warmer `VOICE_NAME`), `server/utils/intent.ts` rule 10 (say lines in the same persona, scaled to the size of the change, and honest when the ops fell short).
- **Done looks like:** the voice is heard within about 1 s of you stopping talking, it has a recognisable character, and the lines never claim things that didn't happen.

**9. Teleport without dead air.** M / S–M.
- **Files:** `app/composables/useDirector.ts` and `app/world/renderer.ts` (`beginReveal`: apply the teleport's time and atmosphere client-side the moment the intent returns, from the brief or a fast keyword map, so the sky, ground colour and ambient bed change at once; the old world dissolves upward into particles instead of a flat fog; a slight rise of the camera, then a settle as the first op lands).
- **Done looks like:** no frame between Enter and the first Director op is a flat single colour. The destination's sky appears within 300 ms.

**10. Light colour follows lamp colour.** M / S.
- **Files:** `app/world/renderer.ts` (`applyLook`: when `color` or `trim` changes on a `light`-tagged kind, tint its `THREE.Light` and glow sprite), and maybe `app/world/kit/interior.ts`.
- **Done looks like:** "make all the lamps blue" turns the pool hall blue.

**11. Global scale edits become a god-view, not a blackout.** M / S.
- **Files:** `shared/world/state.ts` (or an intent rule: clamp `ref: 'all'` scale-ups to 3× per step), `app/world/renderer.ts` (after a large global scale, raise the camera eye height or step back proportionally).
- **Done looks like:** "make everything ten times bigger" leaves you standing among giants, looking up. The screen is never black.

**12. Better learned creatures and animated materials.** M / M.
- **Files:** `server/utils/intent.ts` (one creature worked example with neck, tail and wing parts; route `define` of creatures to Sonnet, the "polish pass" from the plan's Later list), `app/world/parts.ts` (material `water` with scrolling UVs, `fire` and emissive `glow` that animates).
- **Done looks like:** the dragon reads as a dragon at 20 m, and the waterfall visibly pours.

**Suggested loop 2 bundle:** do #1, #2, #3 and #8 together. They're mostly S, and they attack framing, spectacle, chrome and voice all at once. Then do #4 and #5, which unlock the "sky and motion" half of what users ask for.
