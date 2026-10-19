# Gen loop 4: bbox framing, compact refine, comparison page (2026-10-18)

Run: `npm run gen:gauntlet -- --loop loop4` (6 prompts, ~$0.24 on the gateway). Before it: `--only telescope,triceratops,locomotive` and `--only locomotive,pagoda` checks (discarded). Cross-loop page: `../index.html`.

## Changes

- **Placement by real height** (`shared/world/state.ts`). A new sized kind is laid out with baseHeight S for `upright` kinds and 0.5 S for everything else (loop 3 used 1.15 S for all of them).
- **Framing from the real box** (`app/world/fx/frame.ts`, `renderer.ts`). `FrameBox.pts` carries the 8 world-space corners of the kind's parts bounds after scale and yaw (`renderer.corners`). When they are present, `samples()` uses them instead of the 0.85 r footprint circle. A newly landed design outdoors goes through the new `fitFrame`, which dollies along the line from the object's middle to you, closer or further back, to the closest spot where the worst |NDC| is ≤ 0.74 (`LANDED_FILL`). Walls stop the dolly and you never get nearer than r + 1.5. If the object can't be fitted, it falls back to `solveFrame`.
- **Compact refine encoding** (`server/utils/forgeRun.ts`, `forge.ts` API text). The options argument can be a flag string, or an object's `f` field: `m` mirror, `p/t/g` slot, `z/x` lay along an axis, `W M G S A` material. Colours are single-letter consts on the first code line. Wheels are spelt out (`cylinder([0.9,0.15,0.9],at,C,'xm')`, with the size given standing). Output per refine was 580–1222 tokens, against 750–1400 in loop 3.
- **Silhouette first** (refine prompt). The prompt asks Opus to name the 3–5 defining features and build them in the first third of the lines, in their true colours and slightly exaggerated.

## Timings (means, s from Enter)

| | draft | first refined | 50% parts | settled good | settled hero | avg quality |
|---|---|---|---|---|---|---|
| loop 0 | 4.5 | 10.2 | 15.2 | 19.4 | 82.9 | 5.8 |
| loop 1 | 2.1 | 5.5 | 10.8 | 12.9 | 89.8 | 5.0 |
| loop 2 | 2.0 | 5.5 | 9.8 | 12.5 | 20.1 (no swap) | 6.7 |
| loop 3 | 1.8 | 4.1 | 9.1 | 12.7 | 31.7 (swap) | 6.5 |
| **loop 4** | 2.2 | 4.6 | 9.4 | 10.1 (**12.2** without the rejected flytrap) | 15.1 (polish never returned) | **6.0** |

The good-tier settle on the 4 refined prompts was 12.2 s, against 12.7 s. That is about 0.5 s better and within noise. The pagoda settled at 9.5 s. fps was 60 throughout.

## Quality (final stills)

| prompt | l3 | l4 | why |
|---|---|---|---|
| flytrap | 7 | **3** | The refine was **rejected** (7 floating tooth cones), so the crude draft stayed |
| locomotive | 6 | 7 | The whole train is in frame in three-quarter view, with no cowcatcher clip. Wheels, rods, cab, dome and stack all read. A little small |
| pagoda | 6 | 6 | Five tiers, filling the view nicely. No finial, and it is square-on |
| triceratops | 6 | 7 | It fills the view comfortably, and the horns, frill, beak and toes read |
| telescope | 6 | 7 | Much larger in frame: brass tube, eyepiece, lens and tripod |
| teapot_house | 8 | 6 | Refine only (the polish hung, see below): spout, lid roof, chimney, windows. Less detail |
| **avg** | **6.5** | **6.0** | Framing goals met (telescope, triceratops, locomotive). The average fell because of two model-side failures |

## Regressions / known issues

- **Flytrap refine rejected for floating teeth.** In the check runs a locomotive also had floating wheels, before the wheel example was added. The silhouette guidance or the flags may make small attached features drift. Next: snap tiny floating parts to their nearest neighbour instead of rejecting the whole refine, or relax the gate for parts under 2% of the volume.
- **Polish budget didn't fire.** The hero polish ran for 538 s and then failed (`ledger.jsonl`, 04:06Z). `AbortSignal.timeout(28_000)` on the gateway call was ignored. Next: `Promise.race` it with a hard timer in `forge.ts`.
- `nuxt typecheck` while a gauntlet is running reloads the dev page, and the harness then retries that prompt.
