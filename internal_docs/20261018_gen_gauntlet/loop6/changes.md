# Gen loop 6: painterly light, silhouette framing (2026-10-20)

Run: `npm run gen:gauntlet -- --loop loop6` (6 prompts, 2.2 min, ~$0.22 gateway). Check before it: `--only telescope,pagoda` (discarded; its pagoda draft took 12 s because the STYLE edit invalidated the intent prompt cache once). Look work was iterated with a zero-spend harness (library parts injected as forge upgrades, screenshots under dusk/day/golden). Loops 6–8 move the look toward Breath of the Wild / Studio Ghibli: see `../art_direction_botw.md`.

## Changes

- **The toon bands were never on** (`app/world/style/toon.ts`). The patch matched three's direct-light line plus a blank line, but the bundled build (`three.module.js`) strips blank lines, so the match failed and every loop so far rendered smooth Lambert (the console said `toon bands off`). The match is now a regex on the line alone.
- **Painterly bands.** The 2-step ramp is now brush-broken: a world-space, two-octave stroke noise is computed once per fragment (`lights_fragment_begin`) and offsets N·L at the band edges, so terminators wobble like paint and don't swim with the camera. The top band is capped at 0.92 so cream and white masses don't blow out.
- **Warm light, cool shade.** Direct light is multiplied by `litHue` (warm gold) and the sky fill/ambient by `shadeHue` (blue-violet). Both are normalised to luminance 1 (`setHue`), so they shift hue without changing brightness. A narrow warm band is added at the terminator (`term`). Rim falloff is a little wider and +0.08 stronger outdoors. Dusk ground is more saturated and its sun is 10% lower, so the meadow stays green under the brighter banded light. New preset fields: `litHue`, `shadeHue`, `term`, `brush`.
- **Painterly sky** (`style/sky.ts`). The cumulus is domain-warped (billowing brush edges, softer but still readable), with a silver lining on the sun side, a paler far layer behind it, and a high layer of wind-combed streaks. All in the same one-draw-call dome shader.
- **Wind-swept grass** (`style/grass.ts`). The field leans downwind a little, and gust bands show as a light sheen on the tips.
- **Framing on the real silhouette** (`shared/world/forge.ts` `silhouettePoints`, `renderer.corners`). `fitFrame` used to sample the 8 corners of one box round the whole object. For a tapered pagoda or a telescope on splayed legs, those corners sit in thin air, so the dolly stopped short. It now samples points on each part: box corners, rims for round shapes, and path points ± radius for tubes, on the 64 biggest parts. Test in `tests/forge.test.ts`.
- **Prompts** (`shared/world/style.ts`). STYLE now describes the painted world. It asks for broad, gently curved masses that catch light and shade, big masses in mid values (never near-black or near-white), and natural sun-warmed hues. The reference-image style asks for a hand-painted storybook look with warm light and cool shade.
- No new lights, no new material programs (`renderer.info.programs` is 60 before and after in the harness), 60 fps on every prompt.

## Timings (means, s from Enter) and quality

| | draft | first refined | 50% parts | settled good | settled hero | avg quality |
|---|---|---|---|---|---|---|
| loop 0 | 4.5 | 10.2 | 15.2 | 19.4 | 82.9 | 5.8 |
| loop 1 | 2.1 | 5.5 | 10.8 | 12.9 | 89.8 | 5.0 |
| loop 2 | 2.0 | 5.5 | 9.8 | 12.5 | 20.1 | 6.7 |
| loop 3 | 1.8 | 4.1 | 9.1 | 12.7 | 31.7 | 6.5 |
| loop 4 | 2.2 | 4.6 | 9.4 | 10.1* | 15.1 (no polish) | 6.0 |
| loop 5 | 1.8 | 4.2 | 8.5 | 11.1 | 35.1 (polished) | 6.3 |
| **loop 6** | 1.8 | **3.7** | 8.6 | 11.1 | **28.4** (polished) | **6.8** |

There was no deliberate speed change; the first-refined gain (3.7 s against 4.2 s) is within run-to-run noise. All 5 good-tier prompts refined, settling at 9.9–12.8 s. The hero polish won and settled at 28.4 s.

| prompt | l5 | l6 | note |
|---|---|---|---|
| flytrap | 6 | 7 | Big in frame: toothed trap, four side traps, pot, banded shading. An odd pearl in the mouth |
| locomotive | 7 | 7 | Fills the view: boiler, stack, dome, cab, red wheels, rods. The boiler is still near-black, despite the new STYLE line |
| pagoda | 7 | 7 | Five tiers, finial and door, and now much taller in frame. Square-on, flat disc roofs, no windows |
| triceratops | 6 | 6 | Horns, beak and eyes read. The frill is a flat slab and the legs are blocky |
| telescope | 5 | 6 | Larger than loop 5: brass tube, rings, lens, tripod. Still seen from above, about 55% of the frame height |
| teapot_house | 7 | 8 | Polished: spout, lid knob, chimney, door, window box, steps. The painterly bands read best here |

## Remaining

- **Grass tips read straw-gold at mid-distance** under the dusk low sun in the gauntlet view: banded light plus warm `litHue` on up-facing blades. Next: the grass's own band or lit-hue weight, or a cooler tip.
- **Near-black masses** (locomotive boiler, pagoda roofs) still come from the model and lose the painted light. The palette snap clamps L ≥ 0.2, which may be too low for this look. Try ≥ 0.28 for primary-slot parts.
- **Small props are framed from eye height**, so they're seen from above (telescope). Next: a lower eye lift or a pitch cap for things under about 2 m.
- The look addendum lists the next painterly steps (ground strokes, bounce light, distance hue).
