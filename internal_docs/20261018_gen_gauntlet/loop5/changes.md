# Gen loop 5: snap floating parts, hard polish deadline (2026-10-19)

Run: `npm run gen:gauntlet -- --loop loop5` (6 prompts, 2.3 min, ~$0.22 gateway). Checks before it: `--only flytrap,teapot_house` and `--only locomotive` (discarded). Cross-loop page: `../index.html`, now built by `../mkindex.py` from each `timings.json` + `../quality.json`.

## Changes

- **Snap, don't reject** (`shared/world/forge.ts` `snapFloating`, used by the refine in `server/utils/forge.ts`). A floating island under 20% of the total box volume moves by the shortest per-axis gap to the nearest attached part. If that move is over 35% of the object's span, the island is dropped. Big floating islands are left for the existing gate, so a broken core still keeps the draft. Test in `tests/forge.test.ts`.
- **Drift cause** (refine prompt). "Slightly exaggerated" now reads "exaggerate size, never distance": small features sink about 20% into their host, and with `z`/`x` the size is still given standing and `at` is the centre. The flags themselves were applied correctly (`forgeRun.ts`).
- **Hard polish deadline.** In loop 4 the reference image was awaited outside the abort signal. Now `forgePolish` races the whole job (reference image + gateway call) against a 28 s timer, which also aborts the call. On timeout the refine stays. The client caps the polish fetch at 33 s and the judge at 14 s (the server judge at 12 s), so a late answer can't swap the result.

## Timings (means, s from Enter) and quality

| | draft | first refined | 50% parts | settled good | settled hero | avg quality |
|---|---|---|---|---|---|---|
| loop 0 | 4.5 | 10.2 | 15.2 | 19.4 | 82.9 | 5.8 |
| loop 1 | 2.1 | 5.5 | 10.8 | 12.9 | 89.8 | 5.0 |
| loop 2 | 2.0 | 5.5 | 9.8 | 12.5 | 20.1 | 6.7 |
| loop 3 | 1.8 | 4.1 | 9.1 | 12.7 | 31.7 | 6.5 |
| loop 4 | 2.2 | 4.6 | 9.4 | 10.1* | 15.1 (no polish) | 6.0 |
| **loop 5** | 1.8 | 4.2 | 8.5 | **11.1** | **35.1** (polished) | **6.3** |

\*Loop 4's good-tier mean includes the rejected flytrap at 2.0 s. Without it, the mean is 12.2 s. Loop 5 refined all 5 good-tier prompts, at 9.0–12.5 s.

| prompt | l4 | l5 | note |
|---|---|---|---|
| flytrap | 3 | 6 | Refine kept: toothed trap, side traps, pot. Small in frame |
| locomotive | 7 | 7 | Boiler, stack, dome, cab, red wheels, cowcatcher |
| pagoda | 6 | 7 | Five tiers, now with a finial. Slender in frame |
| triceratops | 7 | 6 | Horns, frill and beak read. Blockier legs |
| telescope | 7 | 5 | Brass tube on a tripod, but small in frame |
| teapot_house | 6 | 7 | Polished: polish 18.6 s, judge won both orders, settled 35 s. Door, round windows, lid roof. No spout visible from this view |

## Remaining

- Thin or slender objects (telescope, pagoda) land small in frame. `fitFrame` targets the worst |NDC|, so a tall, thin box doesn't fill the view.
- The hero settles at 35 s when the polish wins. The deadline bounds it at about 28 + 14 + sweep, under 45 s.
