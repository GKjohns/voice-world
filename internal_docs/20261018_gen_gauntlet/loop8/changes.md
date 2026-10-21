# Gen loop 8: roof and shell primitives, poke-through trim, cool far field, fair judge render (2026-10-21)

Run: `npm run gen:gauntlet -- --loop loop8` (6 prompts, 2.2 min, ~$0.23 gateway; tracked $0.21). An earlier full run died when the machine went into battery sleep mid-run, so its timings were invalid and it was discarded. This run was wrapped in `caffeinate -i`. No stalls, no errors, 60 fps (worst gap 17 ms) on every prompt. Code is in 8d4a66e; see `../art_direction_botw.md` ("What loop 8 implemented").

## Changes

- **`roof` primitive** (`shared/world/shapes.ts`, `parts.ts`, `ops.ts`). A unit hip roof with four crisp hips, a concave pitch that flattens toward the eaves, and flicked-up tips, scaled by `size` like a box. Haiku drafts and the forge both get it as a new shape enum value (no new optional fields). Tests in `tests/shapes.test.ts` (closed, outward-wound geometry).
- **`shell` primitive** (same files). A cupped, rounded plate: open side +z, `d` is the cup depth, 30% of it thickness. For frills, petals, ears, trap lobes, shields and bowls.
- **Classic-form guidance** (`server/utils/forge.ts` API text, `intent.ts`, `director.ts`). Roofs are `roof()` (never stacked discs), frills and trap lobes are tilted `shell()`s, windows and doors are thin panels on the wall's outer face, and curved bodies are lathe or sphere. It gives a pagoda line and a frill line as examples.
- **Poke-through trim** (`shared/world/forge.ts` `fixPierce` / `fixPiercing`). A small unrotated part that comes out of both sides of a much bigger host keeps only its front (or leaning) side. It runs on each streamed refine part against the parts before it, and again on the final list and on the polish (same answer, so the hand-over doesn't change what the player saw). CPU only. Tests in `tests/forge.test.ts`.
- **Far-field cool hue** (`style/ground.ts` `FAR_GLSL`, ground + grass). Past ~9 m the meadow leans toward the sky hue: a zenith/sky-fill mix with luminance kept and a little desaturation, up to 40% at 26 m, scaled by `groundPatch`. Two uniforms, no new programs.
- **Fair judge render** (`renderer.candidate(parts, id)`). The polish candidate now gets the instance's look (palette snap, slots, glow, jitter), the same as the current build. Before this, the judge compared raw model colours against a snapped current. The judge also reports its vote count (`polish 2/2`).
- **Gaze highlight hidden while refining** (`renderer.ts`). There is no highlight on a kind that is still being refined. When the refine ends, the highlight comes back already settled to its faint glow instead of flashing.

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
| loop 7 | 1.6 | 3.7 | 7.7 | 10.7 | 12.2 (polish lost the judge) | 7.0 |
| **loop 8** | 1.9 | 4.3 | 8.1 | 11.4 | 27.4 (polished) | 6.8 |

All 5 good-tier prompts refined, settling at 9.5–13.1 s. The hero polish won 2/2 ("clearer teapot form with spout, handle, and readable windows and door"), so it settled at 27.4 s. That isn't comparable to loop 7's unpolished 12.2 s. Everything ran slower by 0.3–0.6 s. The server-side refine TTFT was 2.4–3.4 s, up from 2.1–2.8 s, which fits the longer refine prompt (the API text grew by the two shapes plus the classic-forms block). The flytrap refine paid a cache write ($0.037, up from $0.026). Drafts took 1.9 s, up from 1.6 s: the triceratops (2.1 s) and the telescope (2.5 s) drafts were slow, likely because the intent prompt cache was cold after the `intent.ts` edit.

| prompt | l7 | l8 | note |
|---|---|---|---|
| flytrap | 7 | 6 | The trap lobes are now cupped shells with teeth, plus four side traps. But 46 parts is a crowded clump, and the main trap is cut off at the top of the frame (it fills the view and the dolly doesn't back off enough) |
| locomotive | 8 | 7 | Boiler, stack, dome, cab, red wheels and rods all read. The boiler came out olive-gold rather than blue-slate, it has no smoke puffs this run, and the cowcatcher is a flat red slab |
| pagoda | 7 | 8 | The main ask landed: real hip roofs with overhanging, slightly upturned eaves instead of disc stacks, windows on the tier faces, stone lanterns at the base. The pitch still reads mostly straight rather than concave from this distance |
| triceratops | 6 | 7 | The frill is a curved shell instead of a flat slab, and it has back spots and a pale belly. The head is half out of frame at the left edge, and the legs are still stumpy cylinders |
| telescope | 7 | 6 | Still side-on, with a brass tube, rings and a thin tripod, but smaller in frame than loop 7 and thinner, so it reads less as a hero prop |
| teapot_house | 7 | 7 | Polished (won 2/2): window box, door with steps, lantern, handle. But the model put a hip `roof()` where the teapot lid should be, which weakens the teapot read, and the spout is hidden behind the body from this yaw. The window is now on the surface (no cut-through) |

## Remaining

- **The roof guidance over-applies.** On the teapot house it replaced the lid with a pagoda roof. Scope it in the prompt to buildings with walls ("not lids, domes or caps; a teapot lid is a lathe").
- **Big-object framing.** The flytrap (top clipped) and the triceratops (head out of frame left) overflow the landed frame. Check `fitFrame` against the final silhouette after the refine swap, not only at the draft.
- **Refine TTFT is up about 0.5 s** from the longer API text. Trim the classic-forms block (one example line, shorter bullets) or move it after the cache breakpoint so it's cached with the rest.
- **The far field now reads cooler**, but with a slightly grey band just below the horizon under `golden`. The 40% at 26 m may be a touch strong; try 0.3, or more saturation in the cool tint.
- The concave pitch of `roof` hardly shows at 15–20 m. A slightly stronger eave flick would read better from gauntlet distance.
- This run didn't check whether `fixPierce` fired: the dev server's `[forge] … trimmed` log lines weren't captured. No window was seen poking out the back in the stills.
