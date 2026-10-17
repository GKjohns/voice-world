# Loop 3: experience evaluation (Oct 17, 2026)

**Lens:** the north star, not correctness. "I want the player to almost feel like they're god or they have a genie. It should be a 'holy shit' experience."

**How it was played:** headless Chromium against the running dev server at :3091, with real models and the default minimal HUD (dev mode off). **This loop ran on the real GPU** (ANGLE Metal, M4 Pro, 60 fps idle). Loops 1 and 2 ran on swiftshader at about 16 fps, so this loop's latencies are a little cleaner, and FPS numbers mean something for the first time. Five sessions:

- **Text A:** loop 2's 20-command script, unchanged and typed type-to-start style (no Enter first, 18 ms/key), so the scores compare directly.
- **Text B:** the new capabilities plus 4 first-timer wishes (a sky whale, shooting stars, "turn the whole world purple", day plus a waterfall), 14 commands from an empty world.
- **Voice V:** fake mic, 4 spoken wishes: a teleport ("take me to a snowy mountain village"), a storm, a volcano, and "make me tiny".
- **Demo D:** the 60-second first-impression sequence, spoken as one continuous voice session, with a frame every 2 s.
- **Storm burst:** a 6.6 s, 30 fps capture of the storm's onset, to catch the lightning.

A 40 ms in-page tracer logged phase, state signature, camera, frame times, draw calls and frustum checks. Total model spend was about $0.40: around 40 Haiku calls, 5 Director builds ($0.017–0.033 each), and about 2.3 minutes of realtime.

Screenshots: `loops/loop3/` (8 webp files). Scratch, logs and PNGs are in the session scratchpad under `loop3_eval/`.

## Scores

| Dimension | L1 | L2 | L3 | Δ vs L2 | Evidence |
|---|---|---|---|---|---|
| Speed / anticipation | 5 | 6 | 7 | +1 | Kit edits land 0.93–1.7 s after Enter. The dragon define dropped from 12 s to 3.9–4.0 s, and the placeholder spindle fills that wait. Voice runs 0.35–1.1 s from VAD stop to tool call, then 1.0–1.2 s from tool call to built; first audio comes 0.5–1 s after you stop talking. A Director teleport still takes 9–10 s to finish, and builds hitch (see FPS). |
| Arrival spectacle | 4 | 7 | 8 | +1 | Terrain heaves up with a rumble. Lanterns rise from below. The volcano arrives smoking with a lava glow. The storm opens with a bolt and a whole-world flash 1.4 s after the weather lands ([02](loop3/02_storm_lightning.webp)). |
| Scale and ambition | 3 | 4 | 8 | **+4** | A mountain range fills the skyline without moving the camera. Volcano, castle on a hill and lanterns combine into one frame ([03](loop3/03_castle_on_hill_volcano_range.webp)). Three whales cross the sky ([04](loop3/04_sky_whales.webp)). Fifty lanterns spread across the night ([01](loop3/01_lanterns_fill_the_sky.webp)). |
| Understanding of intent | 6 | 5 | 7 | +2 | Typing is fixed: all 34 typed wishes arrived intact. Rain, snow, storm, lanterns (by voice too), tiny and 10× all do the right thing. Misses: "summon a dragon to fly around me" with no dragon present was refused by voice. "Put a castle on that hill" in an empty world asked "Shall I raise one?" instead of raising it. Two weather wishes also reset the time of day. |
| World aliveness | 3 | 3 | 7 | **+4** | Lanterns drift, the dragon orbits, horses gallop, gulls circle, whales fly, the volcano smokes, and rain and snow fall. The world is no longer a diorama. |
| Sense of power / agency | 4 | 5 | 7 | +2 | The camera never relocated you: it stayed at x/z (0, 0) for all 34 text wishes, and undo after 10× put you back at 1.6 m. But "make me tiny" on a dock drops the camera *under the deck*, and the rest of the demo was a brown screen ([07](loop3/07_demo_tiny_under_dock.webp)). |
| Voice and personality | 5 | 7 | 7 | 0 | Strong lines: "Small as a beetle. Look up." and "Night falls, thunder rolls." The honesty filter works on batches. But the refusal "Alas, nothing here answers to 'dragon'. Shall I summon one?" is a butler, not a genie ([06](loop3/06_demo_dragon_refused.webp)). A caption-only path still fibbed ("Circle the city, great wyrm!" with no dragon), and one stripped line came out as the fragment "and water falls." |
| Visual beauty | 6 | 6 | 7 | +1 | The lantern night over snowy peaks is the most beautiful frame the app has made ([05](loop3/05_demo_peak_frame.webp)). Against that: the dragon is still a green box with stick wings, pool-hall lanterns white out the room ([08](loop3/08_poolhall_lanterns_blowout.webp)), and snow at night reads as stars. |
| Immersion (HUD) | 4 | 8 | 8 | 0 | Still clean. The only immersion breaks were the brown under-dock screen and some 1 s frame hitches during teleports. |
| **Overall "holy shit"** | **4** | **5** | **7** | **+2** | There are real "oh wow" moments now: lanterns rising over mountains, a lightning bolt over the town, whales overhead. The demo still broke on 3 of its 6 beats, all for small, fixable reasons. |

## Timeline

Times are from Enter, or from VAD stop for voice. "First" is the first world change. "In view" counts new entities in the frustum. FPS is the average, then the worst 1-second window, then the largest single frame gap. Teleports show Director first op / done.

### Text A (loop 2's script, type-to-start)

| # | Wish | First | FPS (avg / min1s / gap ms) | What you see / says |
|---|---|---|---|---|
| 1 | put a castle on that hill | — | 56 / 43 / 123 | "No hill here. Shall I raise one?" Nothing is built. The onboarding whisper on the same screen suggests a castle on a hill. |
| 2 | make a bunch of trees | 1.40 | 59 / 52 / 167 | 9 pines, all in view. "A grove rises." |
| 3 | make all the trees red | 1.68 | 60 / 59 / 44 | Recolour with a shimmer. |
| 4 | a dragon | 4.01 (define) | 59 / 52 / 102 | Spawned behind the red trees, so it's hidden. "Behold, a dragon." |
| 5 | make it huge | (modify) | 59 / 56 / 90 | Scales the centre of the grove, so "it" isn't clearly the dragon. Ring flare. |
| 6 | take me somewhere tranquil | [2.74] / [8.90] | 54 / **13** / 795 | A golden lake with circling gulls and fireflies. 98 things. Lovely. |
| 7 | make it night | 1.01 | 60 | Night falls. |
| 8 | take me to a pool hall | [2.60] / [10.5] | 39 / **2** / **988** | A warm hall. The build hitches badly. |
| 9 | make all the lamps blue | ~1.1 | 60 | The shades turn blue. Works. |
| 10 | fill the sky with floating lanterns | 1.26 | 59 / 56 / 96 | 50 lanterns, capped inside the room at head height. The camera tilts up into blown-out white discs ([08](loop3/08_poolhall_lanterns_blowout.webp)). |
| 11 | build a city around me | [2.74] / [10.0] | 52 / **3** / 386 | A neon street at night with buildings on both sides. 93 things. |
| 12 | put a mountain range on the horizon | 1.13 | 58 / 49 / 209 | Peaks between the towers. No camera move. Faint behind the buildings. |
| 13 | make it rain | 1.52 | 59 | Rain streaks. "Let the rain fall." (Loop 2: "beyond my kit".) |
| 14 | make everything ten times bigger | 1.12 | 60 | playerScale 0.1: eye height 0.2 m. "Now the world towers over you." |
| 15 | undo that | 1.24 | 60 | Back to 1.6 m, same spot. **Fixed** (loop 2: stuck at 161 m). |
| 16 | summon a thunderstorm | 1.16 | 60 | Storm clouds and rain. "The heavens split open." |
| 17 | make the dragon fly in circles over the city | — | 60 | The dragon was lost in an earlier teleport, so nothing happens. The caption still reads "Circle the city, great wyrm!" **(fib)** |
| 18 | a herd of horses galloping across the street | 3.04 (define) | 60 | 6 horses galloping. "Hooves on asphalt. Run!" |
| 19 | raise a volcano that erupts right there | 1.17 | 59 | A volcano heaves up behind the city: lava glow and smoke under storm clouds. |
| 20 | make it snow | 1.34 | 60 | Snow, though it's faint at night. "Let it snow." |

### Text B (new capabilities and first-timer wishes, from an empty world)

| # | Wish | First | What you see / says |
|---|---|---|---|
| 1 | a dragon | 3.86 | The placeholder spindle from about 0.7 s, then the dragon. It's still crude: a box body with stick wings. |
| 2 | make it night | 1.19 | Night. |
| 3 | fill the sky with floating lanterns | 1.29 | 50 lanterns, 15–44 m up and drifting. **Only 1 of 50 is in frame at eye level.** Looking up, it's the money shot ([01](loop3/01_lanterns_fill_the_sky.webp)). |
| 4 | make the dragon fly around me | 1.35 | Orbits at 18 m. "Up, great wyrm. Circle!" It's mostly out of frame, so you catch a wing in the corner. |
| 5 | a thunderstorm | 1.01 | Clouds and rain. The bolt and flash come about 1.4 s after the weather lands (from the storm burst capture). |
| 6 | let it snow | 0.93 | Works, but at night the flakes read as stars. |
| 7 | put a mountain range on the horizon | 1.11 | The range heaves up across the skyline. Gorgeous with the lanterns. |
| 8 | raise a volcano over there | 1.07 | A horizon volcano with lava and smoke, framed. |
| 9 | put a castle on that hill | 1.25 | Hill, then define, then the castle on the summit. "First a hill. Then a fortress." |
| 10 | make me tiny | 1.30 | 0.2 m eye height. "Small as a beetle. Look up." Everything is far away, so it reads only as a lower camera. |
| 11 | a giant whale swimming through the sky | 3.38 (define) | 3 whales at 4× scale flying 60 m out. A genuine "whoa" ([04](loop3/04_sky_whales.webp)). |
| 12 | shooting stars | event | No caption line, and no meteor caught in the 1.5 s frame. Unclear payoff. |
| 13 | turn the whole world purple | 1.14 | Everything goes purple, mountains included. Silly and fun. |
| 14 | make it daytime and give me a waterfall right there | 1.79 | Day and a waterfall. The caption is the fragment "and water falls." |

### Voice V (fake mic, from VAD stop)

| Spoken | VAD → tool | First audio | Built | Line | Notes |
|---|---|---|---|---|---|
| "Take me to a snowy mountain village." | 700 ms (teleport) | ~0.9 s "Mm. Watch…" | Director first op +1.9 s; done ~10.6 s | "Come. Somewhere still." | Snow is set automatically. Houses, lamps and peaks. Cosy and beautiful. |
| "Summon a thunderstorm." | 1026 ms | 0.3 s "As you wish…" | +1.0 s | "Night falls, thunder rolls." | Storm plus night. Reads well. |
| "Raise a volcano over there." | 979 ms | 0.2 s "Yes…" | +1.0 s | "It is done: the earth rises." | Framed volcano, smoking in the rain. |
| "Make me tiny." | 1097 ms | 0.4 s | +1.1 s | "Small as a beetle. Look up." | Low camera with the volcano looming. Works on open ground. |

FPS dipped to 34 (worst 2 s window, 454 ms gap) during the village build and held 60 otherwise.

## The 60-second demo run

**Sequence as run (voice, one session):**
1. "Take me to a quiet lake at dusk."
2. "Make it night, and fill the sky with floating lanterns."
3. "Summon a dragon to fly around me."
4. "Put a mountain range on the horizon."
5. "Make me tiny."
6. "Now, a thunderstorm."

**Beat by beat (seconds since mic click):**

| t | Beat | Feel |
|---|---|---|
| 0–3.3 | Connecting | About 1.5 s of nothing before it's listening. Acceptable. |
| 5.3 → 6.1 | "Yes…" 0.7 s after speech ends | Instant. Feels like a genie. |
| 6–8 | Light tunnel, then the dock, lamp and boat appear | **Holy-shit beat #1.** |
| 8–15 | Hills, then snowcapped peaks, then fireflies, built outward | Good build theatre. Done at 14.7 s. |
| 21.0 | Night plus 50 lanterns (1.6 s after speaking) | **Payoff missed:** only 3–4 lanterns are in frame at eye level. The line says "The lanterns drift up, glowing," but you can't see them. |
| 29.6 | "Alas, nothing here answers to 'dragon'. Shall I summon one?" | **Dead spot at the midpoint.** The sparkle spindle appears and nothing arrives. |
| 41.4 | Mountain range (1.9 s) | The range heaves up, framing tilts the camera up, and the sky is suddenly full of lanterns over snowy peaks. **The best frame Conjure has produced** ([05](loop3/05_demo_peak_frame.webp)). Holy-shit beat #2, partly by accident. |
| 49.5 | "Make me tiny" | **Breaks the demo.** The eye drops to 0.16 m, *under the Director's dock deck*, and the screen goes brown ([07](loop3/07_demo_tiny_under_dock.webp)). |
| 59.0 | Thunderstorm | It also flips night to dusk ("light → dusk"). Rain and lightning play out under a brown ceiling. The climax is invisible. |

**Verdict:** about 5/10 as run. The good beats (teleport, then mountains under lanterns) are genuinely awe-inducing, and there was almost no dead air between wish and response (first audio under 1 s every time, things built within about 2 s). But 3 of the 6 beats failed for small, specific reasons: sky flocks aren't framed, a "fly around me" with no dragon is refused, and tiny goes under the dock. With items 1–4 below fixed, this same sequence should be an 8–9.

**Recommended first-impression sequence (best that works today):**
1. "Take me to a quiet lake at dusk."
2. "Make it night, and fill the sky with floating lanterns." Then *look up*.
3. "Put a mountain range on the horizon."
4. "A giant whale swimming through the sky."
5. "Now, a thunderstorm."
6. Optional: "Make me tiny", but only on open ground.

After fixes #1–#3 land, put the flying dragon back in as beat 4.

## Loop 2 changes: verification

| Change | Verdict | Evidence |
|---|---|---|
| #1 Type-to-start keeps every letter | **Worked** | All 34 typed wishes arrived intact, including "make…", "a dragon" and "summon…". |
| #2 Camera restraint (`MAX_BACK` 7, wall stop, tilt) | **Worked** | x/z stayed (0, 0) for every non-teleport wish. The mountains tilted the view instead of dollying. There were no wall crossings. |
| God-view landing / undo | **Worked** | 10× now shrinks the player instead of using the god view. Undo restored 1.6 m at the same spot. |
| #5 Gathering glow while speaking/typing | **Worked** | Motes at the gaze point during *hearing*/*thinking* in every voice frame. |
| #7 Define placeholder | **Worked** | The spindle shows from about 0.7 s, and the dragon lands at 3.9 s. **Minor:** it also shows on the refused dragon (a sparkle with no arrival). |
| Creature define example | **Partial** | 4 s instead of 12 s, and recognisably a dragon front-on, but still a box body with stick wings. It's the weakest-looking thing in the demo. |
| Terrain kit + horizon anchor | **Worked** | The range, volcano, hill and waterfall all land. Aerial haze reads well. |
| Castle on a missing hill (kernel fallback) | **Partial** | Worked in B (hill, then castle). In A (empty world, typed) Haiku asked "Shall I raise one?" and the fallback never ran, because no op was emitted. |
| 360° "around me" city | **Partial** | Buildings flank both sides of the street. I didn't turn 180° to check behind. |
| Walking on terrain (`groundHeight`) | **Partial / new break** | It ignores Director structures. Combined with `playerScale`, the eye sinks under the dock deck. |
| Altitude + motion ops | **Worked** | Lanterns drift at 15–44 m, the dragon orbits, horses gallop, whales fly. |
| Weather (rain/snow/storm) + lightning | **Worked** | All 5 weather wishes changed the scene within about 1.5 s. The first bolt comes about 1.4 s after onset with a full-screen flash (brightness 15 → 132). Snow is weak at night. **New bug:** the storm wish reset night to dusk in D. |
| Glow + lantern kind (#8) | **Worked** | Real paper lanterns with halos, by voice too, never lamps. Indoors they blow out. |
| Honesty filter (#9) | **Partial** | Batched lines are clean and the "Alas" fallback works. **The no-batch caption path bypasses it:** `useIntent.ts` ~L221–226 captions the raw `say` when the sentence changed nothing, which is exactly when fibs happen (A17). The stripper can also leave fragments ("and water falls."; "pours" probably matched the rain claim). |
| Player size (#10) | **Partial** | Works on open ground. Under-dock bug above. With everything far away, "tiny" barely registers. |
| Sound (thunder, rain bed, rumble) | **Unverified** | Headless runs can't hear. No audio graph errors were logged. Kyle should listen once. |

**Regressions:** under-dock tiny (new interaction), storm resets time of day, and Director-build frame hitches. Hitches were measurable for the first time on a real GPU: min 2–3 fps and up to 988 ms single frames during the pool-hall and city builds, 13 fps at the lake.

## Observations

- **The sky is the hero now.** Lanterns, whales, lightning and mountains-on-horizon are what make people gasp. Every one of them happens *above the eye line*, and the camera doesn't go there unless something else happens to tilt it.
- **The genie's remaining anti-genie moments are all "you didn't set it up right":** no dragon to fly, no hill to build on. A genie should assume and conjure: "make the dragon fly around me" with no dragon means *summon one, flying*.
- **Teleport is still the best opener.** It now hands off into weather (a snowy village auto-snows) and arrivals with motion (circling gulls).
- **Performance is the polish blocker.** Steady 60 fps on an M4 Pro except during Director builds, where single frames reach 0.4–1 s. On a typical laptop GPU that will feel like a freeze, right at the moment of the reveal.
- **First-timer wishes landed:** sky whales (the best), whole-world purple (fun), daytime plus waterfall. Shooting stars were silent and hard to see.

## Ranked improvements (what moves "holy shit" most now)

| # | Improvement | Impact | Effort | Main files |
|---|---|---|---|---|
| 1 | Tiny never goes under structures | H | S | `app/world/renderer.ts`, `shared/world/terrain.ts` |
| 2 | Missing subject means conjure it | H | S | `server/utils/intent.ts`, `shared/voice.ts`, `shared/world/state.ts` |
| 3 | Look up for sky arrivals | H | S | `app/world/renderer.ts`, `shared/world/layout.ts`, `app/world/fx/motion.ts` |
| 4 | Weather keeps the time of day | H | S | `server/utils/intent.ts`, `shared/world/state.ts` |
| 5 | No teleport hitches | H | M | `app/world/renderer.ts`, `app/world/kit/*`, `app/composables/useDirector.ts` |
| 6 | A hero dragon (and whale) | M–H | M | new `app/world/kit/creatures.ts`, `shared/world/kinds.ts`, `app/world/fx/motion.ts` |
| 7 | Honesty on every path, no fragments | M | S | `app/composables/useIntent.ts`, `shared/world/honesty.ts` |
| 8 | Indoor lanterns without white-out | M | S | `shared/world/layout.ts`, `app/world/kit/sky.ts` |
| 9 | Storm cadence and readable snow | M | S | `app/world/fx/weather.ts`, `app/world/sound.ts` |
| 10 | One ear test of the demo | M | S | `app/world/sound.ts` |

**1. Tiny never goes under structures.** H / S.
- **Files:** `app/world/renderer.ts` (`groundAt` ~L508, `setPlayerScale` ~L375/L1381, eye height at L1203), `shared/world/terrain.ts`.
- **How:** make eye height ride the top of the walkable surface under you (dock deck, floor, rug, road: a short downward ray against `rayTargets()`), not just terrain. Also, when shrinking, spawn or bring near a few close-up props (grass blades, a pebble) so the scale reads.
- **Done looks like:** "make me tiny" on the Director lake dock shows the lake and sky from deck level, and demo beats 5 and 6 are visible.

**2. Missing subject means conjure it.** H / S.
- **Files:** `server/utils/intent.ts` (a rule plus 2 worked examples), `shared/voice.ts` (`BUILD_TOOL`), and optionally a `shared/world/state.ts` fallback (a modify carrying motion or altitude on a missing kind becomes a spawn).
- **How:** "make the dragon fly around me" with no dragon → spawn the dragon with `motion: orbit`. "Castle on that hill" with no hill → always emit hill plus castle; never ask "Shall I…?".
- **Done looks like:** from an empty world, by voice and by text, 5/5 each.

**3. Look up for sky arrivals.** H / S.
- **Files:** `app/world/renderer.ts` (`frameable` ~L400, `frameWish`), `shared/world/layout.ts` (sky scatter), `app/world/fx/motion.ts`.
- **How:** for sky flocks and airborne creatures, glide the pitch up about 20–30° over 1.5 s, hold, then ease back. Alternatively, release lanterns low ahead (4–10 m) so they rise *through* the eye line.
- **Done looks like:** 3 s after "fill the sky with floating lanterns" at eye level, at least 20 of 50 are in frame. The orbiting dragon is in frame at least 50% of the first 5 s.

**4. Weather keeps the time of day.** H / S.
- **Files:** `server/utils/intent.ts` (rule 8 examples: no `time` unless asked), `shared/world/state.ts`.
- **How:** remove `time` from the weather examples. Or have the kernel ignore `time` on a weather-only sentence unless the text names a time.
- **Done looks like:** night plus lanterns, then "a thunderstorm", stays night with lanterns glowing, 5/5.

**5. No teleport hitches.** H / M.
- **Files:** `app/world/renderer.ts` (spawn/arrive path), `app/world/kit/*`, `app/composables/useDirector.ts`.
- **How:** call `renderer.compileAsync` when a kind first appears, share geometry and materials per kind, instance repeated props, and cap mesh builds per frame (queue the rest).
- **Done looks like:** "take me to a pool hall" and "build a city around me" keep the worst 1 s window at 45 fps or above and frame gaps under 100 ms on the M4 Pro. Check once on a weaker GPU.

**6. A hero dragon (and whale).** M–H / M.
- **Files:** a new `app/world/kit/creatures.ts`, `shared/world/kinds.ts`, `app/world/fx/motion.ts` (wing flap in `fly`/`orbit`), and an `intent.ts` synonym routing "dragon" to the kit.
- **How:** a hand-built kit dragon with neck, tail and membrane wings that flap in flight, spawned at a three-quarter facing.
- **Done looks like:** at 20–30 m in orbit it reads as a dragon in a still, with visible wing beats.

**7. Honesty on every path, no fragments.** M / S.
- **Files:** `app/composables/useIntent.ts` (~L221–226, run `honestSay` on captioned says), `shared/world/honesty.ts` (drop "pour" from the rain claim, trim a leading "and"/"then", capitalise what's left).
- **Done looks like:** 0 fibs and 0 dangling fragments across this eval's script.

**8. Indoor lanterns without white-out.** M / S.
- **Files:** `shared/world/layout.ts` (`capAltitude`), `app/world/kit/sky.ts` (lantern halo).
- **How:** scale lanterns to about 0.4 indoors, dim the halo, and keep them above head height.
- **Done looks like:** the pool-hall lantern shot reads as warm lanterns under the beams.

**9. Storm cadence and readable snow.** M / S.
- **Files:** `app/world/fx/weather.ts`, `app/world/sound.ts`.
- **How:** give a storm 2–3 strikes in its first 6 s, then 3.5–10 s gaps. Make near flakes larger and softer, with motion blur, so night snow doesn't read as stars. Give "shooting stars" a visible 3–5 s shower plus a caption.
- **Done looks like:** snow is obvious in a night still, and a storm shows at least 2 bolts in its first 6 s.

**10. One ear test of the demo.** M / S.
- **Files:** `app/world/sound.ts`.
- **How:** thunder, the rain bed, the terrain rumble and the lantern release have only been checked for graph errors. Kyle plays the recommended sequence once with headphones and notes levels and timing.
- **Done looks like:** a short list of level and timing fixes from that one listen.

**Suggested bundle if there's one more pass:** #1–#4 (all small) turn the demo from 3/6 working beats into 6/6. #5 is the polish item most likely to undercut a live showing on someone else's laptop.
