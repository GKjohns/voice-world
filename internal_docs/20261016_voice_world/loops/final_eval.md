# Final: integration and demo evaluation (Oct 17, 2026)

**Lens:** the north star. "The player feels like a god, or has a genie. A holy-shit experience."

**How it was played:** headless Chromium on the real GPU (ANGLE Metal, M4 Pro, `--use-angle=metal --ignore-gpu-blocklist --enable-gpu`) against the running dev server at :3091, with the default minimal HUD. The recommended demo ran as **one continuous voice session**: a fake mic WAV of six `say` utterances spaced about 10 s apart (`--use-file-for-fake-audio-capture`). The two typed wishes followed in the same page. A frame was captured every 2 s, and a rAF tracer logged frame times. Scripts and logs are in the session scratchpad under `final/` (`demo.mjs`, `run1.log`, `run1/`).

Screenshots: `loops/final/` (8 webp files).

## Part A: integration fixes

| # | Fix | Files | Verified |
|---|---|---|---|
| 1 | **Kit creatures in the digest.** The "a dragon" `define` example is now a plain kit `spawn`. The "make the horses gallop" (none) example spawns the kit `horse` instead of defining a 9-part one. The creature note now says that dragon, whale, horse, deer, fish_school, butterflies and bird are kit kinds that are never defined. The context lines in the examples no longer call dragon or horse "(learned)". The bench scenes now use kit spawns, the conjure checks accept kit kinds, and 4 new cases were added: "a dragon", "a giant whale swimming through the sky", "a herd of horses galloping across the field" and "make a dragon fly around me", each requiring the kit kind and no `define`. | `server/utils/intent.ts`, `bench/intent.ts` | `bench:intent` Haiku: **66/67 (99%)**. All 4 new kit cases pass. Define-path median 2.4 s, everything else 0.96 s, $0.025 total. The one miss was "make the dragon fly in circles" in a grove with no dragon: it emitted `modify ref:gaze` instead of a spawn. That case passed 8/8 in loop 3, so it looks flaky. |
| 2 | **The view after "make me tiny".** The shrink path itself never resets the view. With raw ops and with the real model ("make me tiny" through `ask`), yaw and pitch held exactly, and pitch 0.64 stayed 0.64. The reset the camera agent saw was the constructor default (yaw 0, pitch −0.12) coming back when the scene was **re-mounted** (a hot reload while other agents edited `renderer.ts`, or a page reload). `world.restore()` brought back the tiny world, but the view started over. The view (yaw, pitch, x, z) is now saved on `pagehide` and on unmount, then restored after `world.restore()`. Storage is guarded with try/catch and skipped for an empty world. | `app/components/WorldScene.client.vue` | Headless: tiny on a dock, then a reload. Before: `x-2.88 z-5.27 p-0.232 yaw3.620`, eye 0.71. After: identical. In the demo, "make me tiny" kept pitch 0.62 / yaw 0.31 while the eye dropped from 1.52 to 0.16. |
| 3 | **No stepping out of rooms.** When a ceiling is over the player (`ceilingOver`), `frameWish` passes `maxBack: 0`, so it only turns and tilts. It also skips the god view and leaves the room's own shell (floor, wall, ceiling, roof) out of the framing set. New test: `final: inside a room (maxBack 0) …`. | `app/world/renderer.ts`, `tests/frame.test.ts` | Headless: a floor and ceiling with pool tables, a lamp and a bench built around the player left x/z at **(0, 0)** for 4 s. Framing only turned and tilted (yaw −0.6, pitch 0.27). |
| 4 | **Suite clean.** The lantern-ceiling test (`terrain.test.ts`, "lanterns in a room stay under its ceiling") passes, and it passed 3/3 repeated runs. Loop 3's typecheck error in `kit/creatures.ts` is gone. | — | `npm test` **100/100**, `npm run typecheck` clean, `npm run lint` clean. |
| + | **Teleports arrive level (found in the demo).** After the lantern tilt (pitch 0.62), "build a city around me" revealed the city looking at the sky, with only rooftops in frame. `beginReveal` now eases pitch into [−0.2, 0.1] while the vortex spins up, not only when you are lifted. | `app/world/renderer.ts` | Re-run of the city teleport from pitch 0.62: the pitch levels to 0.10 by 4 s, and the street, neon and towers are in frame ([08](final/demo_08_city_around_me.webp)). |

## Part B: the demo

### Timeline

Times are seconds since the mic click. "Built" is when the world changed: the first Director op / done for a teleport, and the op apply for a build. FPS shows the average, the worst 1-second window, and the largest single frame gap for that beat.

| t (speech end → built) | Wish | VAD → tool | First audio | Built | FPS (avg / min1s / gap) | What you see / hear |
|---|---|---|---|---|---|---|
| 0 → 1.4 | (mic connects) | — | — | — | 60 / 60 / 22 ms | Listening in 1.4 s. |
| 6.0 → 8.5 / 14.4 | "Take me somewhere tranquil." | 509 ms | 0.9 s "Mm. Watch…" | first op +2.5 s, done +8.4 s | 59 / 54 / 126 ms | Light tunnel, then a dock, a boat and reeds at dawn. Hills, snowcapped peaks, birds, fish, butterflies and fireflies build outward. 122 things. "Come. Somewhere still." ([01](final/demo_01_lake_arrival.webp)) |
| 22.8 → 24.7 | "Make it night, and fill the sky with floating lanterns." | 561 ms | 0.9 s | +1.9 s | 60 / 60 / 21 ms | Night falls, and 50 lanterns rise as the view glides up to pitch 0.55. The sky fills, peaks below. "Night falls. The lanterns rise." **Holy-shit beat.** ([02](final/demo_02_night_lanterns_rise.webp)) |
| 32.7 → 34.2 | "Put a mountain range on the horizon." | 268 ms | 0.5 s | +1.5 s | 60 / 60 / 22 ms | A nearer range heaves up under the lanterns. "Peaks rise on the skyline." It adds less than it could, because the Director's lake already had a range. ([03](final/demo_03_mountains_under_lanterns.webp)) |
| 42.9 → 44.3 | "A giant whale swimming through the sky." | 383 ms | 0.8 s | +1.4 s | 60 / 60 / 28 ms | A barnacled sky-whale with glowing flank lights sinks in 32 m up. It enters at the top edge and is fully in frame by +9 s. "A sky-whale surfaces. Swim on." ([04](final/demo_04_sky_whale.webp)) |
| 52.6 → 54.4 | "Make a dragon fly around me." | 295 ms | 0.6 s | +1.8 s | 60 / 60 / 21 ms | The kit dragon (kit spawn, no define) dives in and orbits at 18 m: red, horned, wings spread. It's in frame in most stills. "Wings unfurl. Circle me!" ([05](final/demo_05_dragon_arrives.webp)) |
| 61.8 → 63.3 | "A thunderstorm." | 445 ms | 0.7 s | +1.5 s | 60 / 60 / 23 ms | Rain and storm clouds, **and it stays night** with the lanterns glowing. The dragon and whale cross through the rain. "The heavens split open." **The best frame Conjure has made** ([06](final/demo_06_storm_dragon_whale.webp)). |
| 78.3 (Enter) → 79.7 | typed "make me tiny" | — | — | +1.4 s | 60 / 60 / 22 ms | The eye drops from 1.52 m to 0.16 m and **the view holds** (pitch 0.62, yaw 0.31). The dock's end looms like a building over you, with the dragon above. "Small as a beetle. Look up." ([07](final/demo_07_tiny_dock_looms.webp)) |
| 87.8 (Enter) → 90.3 / 99.2 | typed "build a city around me" | — | — | first op +2.5 s, done +11.4 s | 60 / 59 / 34 ms | A neon street at night with storefronts, towers, cars and lamps. 100 things. Player scale resets to 1. In the run it revealed looking up at rooftops, which led to the teleport-level fix above. After the fix it reads as a street ([08](final/demo_08_city_around_me.webp)). |

**Totals:** 8/8 beats did what was asked. There were 7 voice tool calls and no errors or page errors. The camera never moved off (0, 0) for a non-teleport wish. The frame rate held **60 fps through every beat** with a worst gap of 126 ms (the lake build). In loop 3 it fell to 2–13 fps with frames of up to 988 ms. Spend was about **$0.30**: the bench $0.025, about 80 s of realtime voice, 2 Director builds (plus 1 re-run of the city), a few Haiku calls, and the earlier test calls.

### Verdict

**About 8.5/10 as run, and the first run where every beat landed.** The arc works: arrive, the lanterns rise, peaks, a whale, a dragon, then the storm over all of it. The response is close to instant: speech end to first audio in 0.5–0.9 s, and to a built world in 1.4–1.9 s. The storm at 63 s, with the dragon and whale in the rain under 50 lanterns, is the holy-shit frame. What keeps it from a 9 to 10: the mountain beat is redundant after a Director lake, the whale enters at the frame edge, the view stays tilted at the sky for the rest of the demo once the lanterns arrive, and nobody has listened to the sound yet.

## Scores

| Dimension | L1 | L2 | L3 | Final | Δ vs L3 | Evidence |
|---|---|---|---|---|---|---|
| Speed / anticipation | 5 | 6 | 7 | 8 | +1 | VAD → tool takes 268–561 ms, first audio comes 0.5–0.9 s after speech, and builds land 1.4–1.9 s after speech. There were no hitches: 60 fps on every beat (loop 3 dropped to 2 fps during builds). A Director build still takes 8–11 s to finish. |
| Arrival spectacle | 4 | 7 | 8 | 9 | +1 | The dragon dives in, the whale sinks in, lanterns rise through a glide-up, and the range heaves up. The teleport light tunnel is still the opener. |
| Scale and ambition | 3 | 4 | 8 | 9 | +1 | A 25 m whale, a 16 m dragon, 50 lanterns, two ranges and a storm all share one frame ([06](final/demo_06_storm_dragon_whale.webp)). |
| Understanding of intent | 6 | 5 | 7 | 9 | +2 | 8/8 demo wishes were exact. "Make a dragon fly around me" from nothing gave a kit dragon in orbit. The storm kept night. Bench: 99%. |
| World aliveness | 3 | 3 | 7 | 8 | +1 | Lanterns drift, the dragon orbits and breathes embers, the whale swims, and birds, fish, butterflies and fireflies fill the lake. |
| Sense of power / agency | 4 | 5 | 7 | 8 | +1 | The camera never relocated you. Tiny keeps the view and stays above the dock. Undo behaviour carries over from loop 3. A teleport still owns the camera for 8–11 s. |
| Voice and personality | 5 | 7 | 7 | 8 | +1 | No refusals, offers or fibs. Lines: "Night falls. The lanterns rise.", "Wings unfurl. Circle me!", "The heavens split open." The fillers ("As you wish…", "Mm. Watch…") repeat, and the city caption doubled. |
| Visual beauty | 6 | 6 | 7 | 8 | +1 | The storm with lanterns, dragon and whale is the best frame yet. The dragon finally reads as a dragon, and the whale's lights glow. Night rain is a little thin. |
| Immersion (HUD) | 4 | 8 | 8 | 8 | 0 | The HUD stays clean. There were no brown screens and no freezes. |
| **Overall "holy shit"** | **4** | **5** | **7** | **8.5** | **+1.5** | The full 60-second sequence runs end to end with no broken beats, and several of its beats are genuine gasps. |

## Remaining issues (ranked by what they cost the demo)

1. **The sky tilt never eases back.** After the lanterns, pitch sits at 0.55–0.62 for the rest of the session. Ground-level arrivals (the second range, anything on the lake) are half out of frame until you drag. Fix: when the next wish is ground-level, `frameWish` or a decay should bring pitch back toward 0–0.15. (`app/world/renderer.ts` `skyLook`/`frameWish`.)
2. **Sky arrivals at the frame edge.** `skyTilt` returns null when you're already looking high enough, so the whale entered at the top edge and needed about 9 s to swim into view. Turn toward a single big arrival even when the pitch is already high. (`app/world/fx/frame.ts`.)
3. **Sound is still unverified.** Thunder, the whale song, the dragon's roar and the rain bed have only been checked for graph errors. Kyle should listen to one run with headphones.
4. **The mountain beat is redundant after a Director place** that already has a range. Either have the Director keep the horizon open for a later wish, or swap beat 3 for "raise a volcano over there".
5. **Director teleports take 8–11 s** (city: first op at 2.5 s, done at 11.4 s). They are hitch-free now, but long.
6. **The city caption doubled** ("Turn around. It is all yours." then "Turn around. It's all yours."). The Director's say and the voice line both get captioned. (`useDirector.ts` / caption de-dup.)
7. **The teleport-level fix needs a voice re-run.** It is verified on a typed city teleport after a sky tilt. It changes `beginReveal` for every teleport.
8. **Tiny needs close-up props** (grass blades, a pebble) to sell the scale on open ground. On the shore it works only because the dock happened to be beside you.
9. **Indoors, framing still tilts up toward hanging lamps** (about 0.27 rad). Minor, and it never moves you.
10. **One flaky bench case** ("make the dragon fly in circles" in a grove with no dragon → `modify ref:gaze`). Not yet tested on a weaker GPU.
