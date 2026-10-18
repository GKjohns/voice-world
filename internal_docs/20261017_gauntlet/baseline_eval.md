# Gauntlet baseline (2026-10-17)

**Run:** `node scripts/gauntlet.mjs` against the dev server on branch `gauntlet` at `e302755`. Headless Chromium on the real GPU (ANGLE Metal, M4 Pro), 1280×800, all 41 scenarios and 67 steps, typed input, about 24 minutes. Screenshots and `results.json` are in `baseline/`, with file numbers matching the per-scenario table.

**Spend:** **$0.36 tracked**: Director $0.125, forge $0.163, NPC $0.013, intent estimated at $0.059. NPC talk costs aren't reported to the client, so they're missing, but they are cents. That is well under the $2.50 budget. The forge library served one repeat (the lighthouse, from an earlier run), so forge timings for first-time objects are slightly understated.

**Errors:** 0 console errors and 0 page errors in all 41 scenarios.

## Scores

| Dimension | Score | Evidence |
|---|---|---|
| Genie magic / "holy shit" | **5** | Real gasps: the volcano erupting on the horizon (017), the aurora (026), the island sea (019), the cheese castle (057), the octopus (031). But a third of the asks produce something flat, wrong or invisible, so the spell breaks often. |
| Generalisation | **4** | The system is strong inside its kit and weak outside it. Haiku snaps novel asks to kit kinds ("log cabin" → house, "standing stones" → boulders, "picnic blanket with food" → three tables and a rug). Four of six teleports reuse the pool-hall or storefront-street templates: the spaceship bridge is a blue pool hall, the laundromat is a pool hall with a bookshelf, and the castle and Rome are neon storefronts. Physics asks, flight and flipping have no ops. |
| Visual quality / art cohesion | **4** | Every frame sits in the same grey-violet dusk void with a grid. PBR on flat colours reads as "clean tech demo". Forged objects (robot, octopus, cheese castle) are charming but don't match the faceted kit or the boxy Director rooms. Teleport interiors have flat lighting and floating rug rectangles. |
| Movement & camera feel | **5** | WASD is smooth at 60 fps, drag-look is responsive, and run is about 2.3× walk. But you walk straight through the lighthouse (no collision with entities), and framing is often wrong. The "right in front of me" piano lands about 15 m away and tiny. The cabin at ×3 and the cheese castle are cropped at the top, the canyon is a wall in your face, and the sky shots for the piano drop (044) and the dragon (064) show empty sky. |
| Physics / glitches | **3** | No physics anywhere. Five crates are stacked as a row on the ground (045), while the genie says "Five crates, stacked high." "Turn gravity off" and "flip it upside down" do nothing, and the genie says both that it worked and that it can't. Neither the dog nor the wizard is in view after you walk. After "start over", the next scenario's nonsense wish hung for 45 s, and **the forest from before the reset came back** (067). |
| Latency | **8** | Intent first op lands in 0.9–1.6 s on all but two of the 57 world sentences. The forge refines in 12–15 s and the Director finishes in 8.6–13.6 s, with its first op at 2.5–3.2 s. **60 fps average on every scenario**: the worst 1 s window was 53 fps (the sky island) and the worst single gap 133 ms. Outliers: "throw a ball" took 8.9 s, and the nonsense wish hung for 45 s. |
| **Overall** | **5** | The engine is fast and smooth, and its best beats are delightful. Breadth is the problem: the genie handles what the kit knows, and the rest gets mapped onto the nearest kit thing or onto the same two room templates. All of it renders in one dull dusk. |

## Per-scenario results

12 pass · 16 partial · 13 fail

| # | Scenario | Result | Note |
|---|---|---|---|
| 001 | create_robot | **pass** | A charming forged robot with antenna, screen chest and chrome joints, well framed. |
| 002 | create_piano | partial | A recognisable grand piano, but tiny and about 15 m away, not "right in front of me". |
| 003 | create_pancakes | partial | A golden cylinder stack with brown slabs and a butter pat. Reads as a cake or barrel more than pancakes, and the syrup is invisible. |
| 004 | sets_sunflowers | **pass** | 40 sunflowers with varied heights fill the view, though "a whole field" could be 150. |
| 005 | sets_stones | partial | Nine low boulders around you, not standing monoliths (kit snap to `rock`). |
| 006–009 | edit_cabin | partial | A kit cottage instead of a log cabin. Blue wipe ✓, ×3 ✓ but cropped and fills the frame, and "make it glow" is invisible (the caption says "It burns with light"). |
| 010–012 | edit_selective | **pass** | Trees and rocks. Only the rocks turn gold, then the trees leave. Exactly right. |
| 013–014 | god_giant | **pass** | A village with people, then the giant's-eye view looks down on toy roofs. Lands well. |
| 015–016 | god_tiny | fail | Three tables and a red rug with no food. The tiny view doesn't read because the props are far away and nothing is close to the eye. |
| 017 | god_volcano | **pass** | A big cone with a lava-flecked crater and a glowing plume, framed on the horizon. The best single "god" beat. |
| 018 | land_canyon | partial | You face a cliff wall from 2 m away, and the river isn't visible. Needs framing along or into the canyon. |
| 019 | land_islands | **pass** | Sea to the horizon with islands and pines. Pretty. |
| 020 | tp_spaceship | fail | A pool hall in blue light (hanging lamps, bar, windows, plants). Nothing sci-fi. |
| 021 | tp_underwater | partial | Rocks, coral-coloured bushes, reeds and fish schools, but the dusk sky stays, a grey floor slab sits in the middle, and the fish swim in the sky. Not underwater. |
| 022 | tp_castle | partial | The storefront street retitled SMITHY / TAVERN / CASTLE KEEP, with neon signs. Some walls and towers. |
| 023 | tp_rome | partial | Warm golden light, which is nice, but neon storefronts ("BASILICA"), pines, white fences and modern-dressed people. Not Rome. |
| 024 | tp_laundromat | fail | Pool hall shell with lamps, a bookshelf, a jukebox and a "SODA" neon. No washers or dryers. |
| 025 | tp_skyisland | fail | No teleport. Four waterfall slabs and black cones float in the dusk void. Reads as broken. |
| 026 | sky_aurora | **pass** | Night with bright green aurora curtains and a moon. Lovely. |
| 027 | sky_two_moons | partial | Two `giant_moon`s spawned on top of each other, and the sky isn't purple (no way to tint the sky). |
| 028–029 | sky_blizzard | partial | Snow ground and drifting flakes over dark clouds: winter, not a blizzard. No wind or white-out. |
| 030 | life_birds | partial | Nine birds circling overhead, but specks: too small and far to enjoy. |
| 031 | life_octopus | **pass** | A cute forged purple octopus with googly eyes and spotted arms. It's static, not crawling. |
| 032–033 | life_dog | fail | A small dog facing away. After walking 15 m it's nowhere in view, so it doesn't follow. |
| 034–037 | people_wizard | partial | The wizard appears off-centre. Replies arrive in about 4 s and are in character, but she calls herself a "lantern-keeper up here… mind the glass", which is stale context from an earlier world. She agrees to follow, but isn't in view after the walk. |
| 038 | people_dance | **pass** | 14 varied people dancing in a loose crowd. The arm-out pose is stiff, but it reads. |
| 039–043 | chain_campsite | partial | Fire ✓, five tents around it (flat lean-to slabs) ✓, night ✓ with the fire as the key light. The fireflies aren't visible, and the guitar player is off-frame. Nothing got replaced. |
| 044 | phys_drop | fail | The camera tilts to empty sky. No piano is visible falling or landing in the shot. |
| 045 | phys_stack | fail | Five crates in a **row** on the ground, while the caption says "Five crates, stacked high." |
| 046–047 | phys_gravity | fail | Seven balls, then nothing. The genie says "Gravity, suspended. Float." and then "That is beyond me… for now." |
| 048 | phys_throw | fail | A labelled placeholder blob ("ball") hangs in mid-air. The intent took 8.9 s, and the caption says "Off it sails." |
| 049–052 | nav_walk | partial | The glass lighthouse is framed nicely. Walking and running are smooth, but you **walk through the lighthouse** (found beside you, inside its radius, after 3 s), and then there's nothing ahead. |
| 053–054 | nav_top | fail | A striped kit tower, then a Director teleport to a plaza ringed by 37 towers labelled "SUMMIT". You aren't on top of the tower. |
| 055–056 | nav_fly | fail | An empty `atmosphere` op with no line. W just walks on the ground. |
| 057 | absurd_cheese | **pass** | A delightful forged cheese castle with holes, red roofs and a flag. Framed too close (the tower tops are cropped). |
| 058–059 | absurd_vangogh | partial | Recolours everything blue and yellow: a cute literal try, but the genie says "Swirling skies", which overclaims. |
| 060–061 | absurd_upside | fail | Nothing happens. The genie says "Turned on its head." and then "That is beyond me… for now." |
| 062–063 | fail_undo | **pass** | Seven houses, then all of them go and the whisper returns. |
| 064 | fail_vague | partial | Good instinct (a dragon), but the shot is empty sky. The dragon was out of frame when the screenshot was taken. |
| 065–066 | fail_reset | **pass** | A forest of 45 trees with a river (the river is barely visible). "Start over" wipes to the blank start. |
| 067 | fail_nonsense | fail | The intent hung for 45 s. Then the **previous scenario's forest reappeared** (46 entities) after a harness reset that followed a model `reset`. It looks like the "undo after reset restores the old world" path or a stale restore. The genie's line ("a banana, sideways, in purple") was never built. |

## Top 10 improvements, ranked by impact

1. **Give the Director real vocabulary for any place.** It should `define` novel props (washers and dryers, consoles and a viewport, columns and a temple, coral and kelp) through the forge, have genre shells beyond "room" and "street" (sci-fi corridor, courtyard walls, open plaza, underwater with water atmosphere, sky island with a void below), and stop reusing the storefront and pool-hall examples as templates. That fixes 5 of 6 teleports. Files: `server/utils/director.ts` (prompt and examples), `app/composables/useDirector.ts` plus `useForge.ts` (forge Director defines in the background), `shared/world/ops.ts` (Director `define`), and new kit shells in `app/world/kit/interior.ts`.
2. **Art direction pass, sprints S1–S3 in `art_direction.md`:** toon material with palette `stylize`, Neutral tone mapping, height fog plus clouds, a golden-hour default start, and one grade pass. Every one of the 67 frames is grey-violet dusk on a grid. This is the biggest jump in perceived quality, and it unifies forged, Haiku and kit objects. Files: `app/world/style/*`, `shared/world/palette.ts`, `app/world/renderer.ts`, `app/world/atmosphere.ts`, `app/world/kit/helpers.ts`, `app/world/parts.ts`.
3. **Framing that always shows the result.** Track moving and sky arrivals (piano drop, dragon, birds) until they're in frame. Back off or tilt for tall and large objects (cabin ×3, cheese castle, canyon). Make "in front of me" mean 3–5 m, and size small objects so they read. Files: `app/world/renderer.ts` `frameWish`, `app/world/fx/frame.ts`, `shared/world/layout.ts` (placement distance by size).
4. **Physics-lite ops:** `drop` (fall from height with gravity, a bounce, dust and a thud), a `stack` arrangement (vertical, resting on the top of the thing below), a world `gravity: off` flag (loose things float and turn), `throw` (a ballistic arc from the eye that lands and bounces), and `rot` on `modify` (flip or tilt). That turns 5 fails into spectacle. Files: `shared/world/ops.ts`, `shared/world/state.ts`, `shared/world/layout.ts`, `app/world/fx/motion.ts`, `server/utils/intent.ts` (rules and examples), and `bench/intent.ts` cases.
5. **Honesty gate on the genie's line.** If no op implements the claim, don't say it ("Five crates, stacked high", "Gravity, suspended", "Swirling skies"). Today the model says it worked, and then the fallback says it can't, in the same breath. Files: `shared/world/honesty.ts`, plus a "say only what your ops do" rule in `server/utils/intent.ts`.
6. **Player powers and solidity.** Add a `player` op for fly or hover, "take me to the top of X" (stand on the entity's top via `standAt`), and teleport-to-entity. Walking should collide with solid entities (`freeDist` already exists and isn't used by `walk`). Files: `app/world/renderer.ts` (`walk`, `standAt`, the lift), `shared/world/ops.ts`, `server/utils/intent.ts`.
7. **Stop kit-snapping novel asks.** Use a kit kind only when it really is that thing. "Log cabin", "standing stones" and "picnic blanket with food" should `define` (and forge), or compose kit pieces with new parts. Add bench cases for each. Files: `server/utils/intent.ts` (`KIT_NOTES`, define rule, examples), `bench/intent.ts`.
8. **Followers stay with you.** Add a `follow` motion for creatures (the dog) and make people's `follow` act keep them in the lower third of the view after you walk. Files: `shared/world/ops.ts` `MOTIONS`, `app/world/fx/motion.ts`, `app/world/npc/people.ts`.
9. **A creative sky.** The atmosphere op should accept a sky tint (top and horizon colours), moon count and placement (two moons spread apart, not stacked), and weather intensity (a blizzard means a white-out plus wind). Files: `shared/world/ops.ts`, `app/world/atmosphere.ts`, `app/world/renderer.ts` sky uniforms, `app/world/fx/weather.ts`.
10. **Reliability and state hygiene.** Investigate the 45 s intent hang and the old world coming back after a reset (067). Add an 8 s intent timeout with one retry (the "throw" took 8.9 s). Clear NPC memory and personas on reset, because the wizard brought in "lantern-keeper… mind the glass" from an earlier world. Files: `app/composables/useWorld.ts` (`reset`/`beforeReset`), `app/composables/useIntent.ts`, `app/composables/useNpc.ts`, `server/utils/npc.ts`.

**Re-run after each item:** `node scripts/gauntlet.mjs --out internal_docs/<date>_gauntlet/<label>` (or `--only teleport,phys` for a focused check), then compare the screenshots side by side with `baseline/`.
