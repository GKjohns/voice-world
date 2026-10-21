# Art direction addendum: toward Breath of the Wild / Ghibli (gen loops 6–8)

This evolves `../20261017_gauntlet/art_direction.md` ("Painted Toy World"). It keeps everything there: chunky toy forms, one palette, Neutral tone mapping, one post pass, the fixed light pool and no per-object shaders. It moves the *light and paint* toward a hand-painted look.

## The target in one paragraph

Forms are lit like a gouache painting. There are two or three soft value bands whose edges wobble like brush strokes rather than tracing clean CG terminators. Light is **warm** (gold, peach at dusk) and shade is **cool** (blue-violet, sky-filled), so the hue shifts as well as the value. A thin, saturated warm line sits where light turns to shade. Silhouettes catch a soft rim of sky colour. Skies are big and layered: billowing cumulus with brushy edges and silver linings, a paler far layer, and high wind-combed streaks. Grass is a wind-swept field where gusts roll across as a moving sheen. Distance melts into warm-near / cool-far haze. Generated objects use broad, gently curved masses in **mid values** with natural, sun-warmed hues, so the light has room to paint them.

## What loop 6 implemented

| Piece | Where | How (cost) |
|---|---|---|
| Bands actually on | `app/world/style/toon.ts` | The direct-light chunk match is a regex (the bundled three strips blank lines; the bands had been silently off) |
| Brush-broken band edges | `toon.ts` (`cjBrush`, `lights_fragment_begin`) | 2-octave world-space value noise, once per fragment, offsets N·L ±0.1 at the band edges. Needs `USE_FOG` (the world-position varying). About 10 ALU per fragment |
| Warm light / cool shade | `toon.ts` (`uCjLitHue`, `uCjShadeHue`), `atmosphere.ts` (`litHue`, `shadeHue`) | Multiplies on direct and indirect diffuse, normalised to luminance 1 (`setHue`). Keep these subtle: a strong shade hue turns green grass grey (see the loop 6 iteration notes) |
| Warm terminator | `toon.ts` (`cjTermK`, `uCjTerm`, preset `term`) | A narrow bump on the lit side of the shade edge, orange-red, × light colour |
| Stronger rim | `toon.ts`, presets `rim` +0.08 | pow 3 → 2.6 |
| Painterly sky | `app/world/style/sky.ts` | Domain-warped cumulus, silver lining, far pale layer, high streaks: about 3 extra fbm per sky pixel, one draw call |
| Wind-swept grass | `app/world/style/grass.ts` | Steady downwind lean, plus a gust sheen on the tips |
| Prompt nudge | `shared/world/style.ts` `STYLE`, `STYLE_IMAGE` | Broad curved masses, mid values (no near-black or near-white), sun-warmed natural hues, and a storybook reference image |

Every change is a global chunk patch or a uniform. There are no new program variants and no new lights (programs: 60 before and after in the harness, 60 fps).

## What loop 7 implemented

| Piece | Where | How (cost) |
|---|---|---|
| Slate darks, not black | `shared/world/palette.ts` `darkFloor`, `parts.ts` `massShare`, `look.ts` | After the snap, the L floor rises with the part's volume share: 0.27 for trim up to 0.42 for the main mass, ×1.3 for metal (whose diffuse the metalness halves). Achromatic darks lean blue-slate (h 252); tinted darks keep their hue. CPU only, cached |
| Painted meadow | `style/ground.ts` `MEADOW_GLSL` (also used by `grass.ts`) | Warm ochre swaths, cool hollows and wind-stretched strokes as one world-space multiplier on the ground and the blades: about 6 value-noise lookups (per fragment on the ground, per vertex on the grass) |
| Green-gold meadow light | `ground.ts` `sunFixGlsl` | The ground and grass programs divide part of the sun's hue out of `directDiffuse` (0.4 ground, 0.4–0.65 base to tip on the blades). Props keep the full warm sun. Blade normal tilt 0.18; cooler tips |
| Gaze rings | `sceneHelpers.ts` `softRing` | Additive soft-ring map on a quad, sky-tinted; the hover highlight settles to 22% after about 2 s. Same program as the glow discs |
| Product-shot framing | `renderer.ts` `frameWish` | A single landed design under 2.2 m is framed from a crouch (eye at 0.72 × its height, via a negative lift); walking stands you up |

There were no new program variants (60) and no new lights, and 60 fps held.

## What loop 8 implemented

| Piece | Where | How (cost) |
|---|---|---|
| `roof` primitive | `shared/world/shapes.ts`, `parts.ts`, `ops.ts` | A unit hip roof (four crisp hips) with a concave pitch that flattens toward the eaves and flicked-up tips; scaled by `size` like a box. Haiku drafts and the forge both get it (a new enum value, no new optional fields). Pagoda tiers, temples, gazebos, lanterns, cottages |
| `shell` primitive | same | A cupped, rounded plate (open side +z, `d` = cup depth, 30% of it is thickness). Frills, petals, ears, trap lobes, shields, bowls |
| Classic-form guidance | `server/utils/forge.ts` API, `intent.ts`, `director.ts` | Roofs are `roof()`, frills a tilted `shell()`, windows and doors thin panels on the surface, curved bodies lathe or sphere, with a pagoda and a frill line as examples |
| Poke-through trim | `shared/world/forge.ts` `fixPierce` / `fixPiercing` | A small unrotated part that comes out of both sides of a much bigger host keeps only its front (or leaning) side. Applied per streamed part and again on the final list (same answer). CPU only |
| Far-field cool hue | `style/ground.ts` `FAR_GLSL` (ground + grass) | Past ~9 m the meadow leans toward the sky hue (zenith/sky fill mix, luminance kept, slightly desaturated), up to 40% at 26 m. Two uniforms, no new programs |
| Fair judge render | `renderer.candidate(parts, id)` | The polish candidate gets the instance's look (palette snap, slots, jitter) like the current build; before, it showed raw model colours |

No new lights and no new material programs (the harness logged 60), 60 fps held.

## Next (loops 9+), in impact order

1. **Distance hue over the meadow.** Far grass (15–24 m) still reads warm-yellow under `golden`, from the warm fog plus the shadow-lift grade. Cool the far field toward the sky colour (see item 5) rather than adding more warmth.
2. **Grass under low sun.** Loop 7 fixed the near and mid field (see above). Check `dusk` and `day` from the gauntlet camera too; the probes used `golden`.
3. **Painted ground.** Loop 7 added the swaths and strokes. What's left: a soft darker band at object contact (the contact shadows exist; tint them `shadeHue`), and more value contrast in the strokes, which tufts mostly cover from eye height.
4. **Bounce light.** Warm ground bounce on down-facing surfaces (mix `hemiGround` toward the ground colour × the sun's strength), so undersides glow like BotW's warm bounces instead of reading flat violet.
5. **Distance hue.** Push far fog more toward blue-violet by day (BotW's blue mountains). This is one colour per preset (`fog` vs `fogWarm`), already plumbed.
6. **Post.** A faint paper/canvas grain and a 2–3% saturation lift in the mids (`post.ts`, the same pass). No bloom.

## How to check a look change for free

Inject saved forge-library parts as upgrades and screenshot under each preset. No model calls are needed: spawn each kind with a placeholder define through `__voiceWorld.run`, write `upgrades: { kind: { basis: state.kinds[kind].basis, parts, quality: 'good' } }` into the saved world in localStorage, and reload. Loop 6 used this with robot, hot_air_balloon, lighthouse, cow and lemonade_stand from `.data/forge/lib/`. It also logs `renderer.info.programs.length` and fps.
