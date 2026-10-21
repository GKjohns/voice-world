# Gen loop 7: painterly darks, painted meadow, soft gaze rings, crouch framing (2026-10-20)

Run: `npm run gen:gauntlet -- --loop loop7` (6 prompts, 2.1 min, ~$0.21 gateway). An earlier full run was discarded (~$0.23). It ran on a cold intent prompt cache (the first three drafts took 2.5–4.2 s, a 2.4 s mean) and before the metal floor below existed. Look work was iterated for free in a harness (forge-library parts injected as upgrades, plus a primitive define to trigger the landed framing, with page-side probes of the style uniforms). Loop total: ~$0.45.

## Changes

- **No near-black masses** (`shared/world/palette.ts` `stylize(…, mass, metal)`, `darkFloor`). After the palette snap, darks get a lightness floor that rises with the part's share of the object's summed part volume: OKLCH L 0.27 for trim, smoothly up to 0.42 for the main mass (a share of 25% or more). It is 1.3× for metal, because the metal preset (metalness 0.55) halves diffuse. Near-greys get a little chroma: achromatic darks lean blue-slate (h 252), and tinted darks keep their own hue, so a warm charcoal stays warm. Mid and light values are untouched. The volume share is computed per merged mesh in `buildFromPartsMerged`, per part in `buildFromParts`, and from the parts so far for streamed draft and refine parts (`massShare`). `lookTargets` passes it on. Test in `tests/palette.test.ts`.
- **Painted meadow** (`style/ground.ts` `MEADOW_GLSL`). A world-space colour multiplier made of warm ochre swaths (~20 m), cooler blue-green hollows (~16 m), and long soft strokes stretched 6:1 along the wind (light dabs, darker drags). The ground and the grass blades share it, so blades carry the patch they grow in. It scales with `groundPatch`, so interiors stay calm.
- **Green-gold grass, not straw** (`sunFixGlsl`, ground + grass). Probing showed the straw was the ground itself (olive under the orange `golden` sun, #ffb463 × 2.6), as well as the blade tips. For the ground and grass programs only, part of the sun's hue (luminance-normalised, × `litHue`) is divided back out of `directDiffuse`: 0.4 on the ground, and 0.4–0.65 base to tip on the blades. Props keep the full warm light. Blade normals tilt 0.18 (was 0.25), so fewer blades blow out in the top band, and the tips are a cooler green.
- **Gaze rings restyled** (`sceneHelpers.ts` `softRing`, renderer). The hover highlight and the reticle were flat white `RingGeometry` decals. They are now additive quads with a soft ring map (peak mid-band, zero at both edges), tinted from `hemiSky`/`skyHorizon`. The highlight fades in over 0.2 s, holds for 1 s, then settles to 22% over 0.9 s. A gaze flickering through gaps (tripod legs) doesn't restart the fade unless the highlight has been off for more than 4 s. Same program as the arrival glow discs, so there is no new variant.
- **Small props framed from a crouch** (`frameWish`). For a single landed design under 2.2 m tall, `fitFrame` solves with eye height `clamp(0.72 × top, 0.8, 1.6)` via a negative `lift`, so the telescope is seen side-on instead of from above. Walking eases the lift back to 0.
- **Speed**: no deliberate change. Nothing cheap stood out on the client side; the remaining time is model TTFT (draft ~1.5 s, refine first part ~2 s after the spawn).
- Programs: 60 before and after (harness), and 60 fps (worst gap 17 ms) on every prompt.

## Timings (means, s from Enter) and quality

| | draft | first refined | 50% parts | settled good | settled hero | avg quality |
|---|---|---|---|---|---|---|
| loop 0 | 4.5 | 10.2 | 15.2 | 19.4 | 82.9 | 5.8 |
| loop 1 | 2.1 | 5.5 | 10.8 | 12.9 | 89.8 | 5.0 |
| loop 2 | 2.0 | 5.5 | 9.8 | 12.5 | 20.1 | 6.7 |
| loop 3 | 1.8 | 4.1 | 9.1 | 12.7 | 31.7 | 6.5 |
| loop 4 | 2.2 | 4.6 | 9.4 | 10.1* | 15.1 (no polish) | 6.0 |
| loop 5 | 1.8 | 4.2 | 8.5 | 11.1 | 35.1 (polished) | 6.3 |
| loop 6 | 1.8 | 3.7 | 8.6 | 11.1 | 28.4 (polished) | 6.8 |
| **loop 7** | **1.6** | 3.7 | **7.7** | **10.7** | 12.2 (polish lost the judge) | **7.0** |

All 5 good-tier prompts refined, settling at 9.0–12.6 s. The hero polish lost the judge ("rounder dome roof and spout-with-chimney echo the teapot silhouette better"), so the refine stood at 12.2 s. That number isn't comparable to loop 6's polished 28.4 s. The speed differences are within run-to-run noise.

| prompt | l6 | l7 | note |
|---|---|---|---|
| flytrap | 7 | 7 | Toothed trap, two side traps, pot. Big in frame |
| locomotive | 7 | 8 | The boiler and stack are now deep blue-slate with a readable lit side and highlight; this was the main ask. Smoke puffs, red wheels, rods, cowcatcher |
| pagoda | 7 | 7 | Roofs are slate with visible form instead of black discs. Still square-on, flat disc roofs |
| triceratops | 6 | 6 | Horns, beak and eye read. The frill is still a flat orange slab and the legs are blocky |
| telescope | 6 | 7 | Seen side-on from a crouch (the horizon sits behind the tube); brass tube, rings, tripod, finder |
| teapot_house | 8 | 7 | Refine only (polish lost): handle, spout, lid and knob, door, window. The window cuts through the body |

## Remaining

- **Distance haze over the grass** still reads warm-yellow at 15–24 m under `golden`: the warm fog (`fogWarm` #ffcf96) plus the shadow-lift grade. Next: cool the far grass toward the sky (distance hue, the art addendum's item 5).
- The meadow strokes are subtle from eye height. Tufts cover most of the ground, so most of the variation shows as blade colour. Try stronger value contrast in the strokes or a darker drag at object contact.
- Big flat model shapes (pagoda disc roofs, the triceratops frill slab) are a prompt or forge issue now, not lighting.
- The hover highlight still shows for about 2 s after each landing. If it's still distracting in video, hide it entirely while a forge job is focused on that entity.
