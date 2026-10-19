# Gen loop 3: faster refine, hero in parallel, framing polish (2026-10-18)

Run: `npm run gen:gauntlet -- --loop loop3` (6 prompts, 2.4 min, ~$0.24 on the gateway). Before it: one `--only telescope,pagoda` check and a Sonnet A/B on the same two (both discarded).

## Changes

- **Refine prompt caching** (`server/utils/forge.ts`). The static brief (`REFINE`: frame, part API, style) now goes in the first user content part with an Anthropic ephemeral `cacheControl`, the same pattern `gateway.ts` uses. `instructions` is a short role line. Usage is now logged per refine: cache read/write tokens and ms to the first part go to `ledger.jsonl` (`server/utils/forgeLedger.ts`) and the server console.
- **Hero reference image in parallel** (`forge.ts`). The refine no longer waits about 5 s for the Gemini reference. The draw is fired at the start, and the polish and judge pick it up through the in-flight de-dupe. The hero refine now designs from the words, like good tier.
- **Bounded polish** (`aiModels.ts`, `forge.ts`, `forgeLedger.ts`). The polish moved from Sol (reasoning low, 40–65 s for about 2.5k tokens) to Opus 5.5 with reasoning none, pinned to Anthropic. It has a hard 28 s budget (`POLISH_BUDGET_MS`), `maxRetries: 0` and 8k max tokens. The estimate went from $0.05 to $0.08. The swap still uses the existing crossfade.
- **Framing**
  - A newly landed design is framed with margin 0.80 instead of 0.92 (`LANDED_MARGIN` in `renderer.ts`, the `margin` option in `fx/frame.ts`).
  - A new kind with a known size is placed as if it were 1.15 S tall, with a 0.5 S footprint (`state.ts`).
  - Tall, radially symmetric kinds skip the three-quarter yaw. These are tagged `upright` by `isUpright()` in `shared/world/size.ts` (pagoda, tower, tree, plants, lamp…) and checked in `layout.ts`.

## Timings (means, s from Enter)

| | draft | first refined | 50% parts | settled good | settled hero |
|---|---|---|---|---|---|
| loop 0 | 4.5 | 10.2 | 15.2 | 19.4 | 82.9 |
| loop 1 | 2.1 | 5.5 | 10.8 | 12.9 | 89.8 |
| loop 2 | 2.0 | 5.5 | 9.8 | 12.5 | 20.1 (polish lost, so no swap) |
| **loop 3** | **1.8** | **4.1** | **9.1** | **12.7** | **31.7 (polish won and swapped)** |

- The hero now settles about 58 s sooner than the last hero whose polish actually swapped (loop 1, 89.8 s). The polish took 15.6 s, the judge 1.4 s, and the reference image (4.7 s) finished well before it was needed.
- Opus time to its first part, server side: 1.9–2.5 s on 5 of 6 prompts. Before this loop it was 2.7–6.1 s. The telescope was the outlier at 5.6 s.
- The good-tier settle did not improve (12.7 vs 12.5 s, within noise). It is bound by Opus's output rate: 750–1400 tokens at about 100 tok/s.
- fps was 60 throughout.

## Cache evidence

The refine sends 2.07k input tokens per call. Cold, it writes 1838 tokens to the cache (`cacheWrite: 1838`). Every refine after that reads them: `cacheRead: 1838`, `cacheWrite: 0` on all 6 loop 3 refines (`.data/forge/ledger.jsonl`, 03:30–03:32Z). So about 89% of the prompt is cached. The cost per refine fell to $0.016–0.029, from $0.029–0.040.

## Model A/B (good-tier refine, Sonnet 5.5 vs Opus 5.5)

| | pagoda | telescope |
|---|---|---|
| Sonnet: first part / result | 1.8 s / **rejected** (18 floating parts, kept the draft) | 2.3 s / settled 9.5 s, crude tube and plain cylinders (6) |
| Opus: first part / result | 2.1 s / settled 9.6 s, 5 tiers (6) | 2.5 s / settled 11.0 s, detailed brass tube (7) |

Sonnet is about 0.3 s faster to its first part and about 40% cheaper, but its quality is not equal: one of the two failed the structural gate, and the other is visibly cruder. **I kept Opus.**

## Quality (final stills, loop 3)

| prompt | l2 | l3 | why |
|---|---|---|---|
| flytrap | 8 | 7 | Whole plant, pot, toothy trap, side traps. Smaller in frame, so it reads less "giant" |
| locomotive | 6 | 6 | A good three-quarter model, but it is still close and the cowcatcher clips at the bottom right |
| pagoda | 6 | 6 | Square-on (no yaw), five tiers, finial, whole height in frame. The plinth sits under the HUD |
| triceratops | 6 | 6 | Horns, frill and face read, and it is fully framed, but now small and far |
| telescope | 7 | 6 | It reads as a telescope, but it is too far: small in frame |
| teapot_house | 7 | 8 | Polished and swapped: handle, lid roof, chimney, arched door, window box, shrubs |
| **avg** | **6.7** | **6.5** | |

## Regressions / open

- **Placing at 1.15 S overshoots for small and long-low things.** The telescope and triceratops land too far away. S is the largest dimension, so treating it as a height pushes wide, low things back too far. Next: place by the projected size (height ≈ S for upright kinds, about 0.5 S otherwise), or re-frame closer after the land (`approach` currently only moves when the frame fails).
- **The locomotive is still close and clipped.** The landed-frame margin did not move the camera. The suspected cause is that `solveFrame` samples the footprint circle at 0.85 r, which misses a yawed, long body's corners. The other suspect is the spawn's `approach` fallback.
- The good-tier settle is limited by output tokens. The next real speed win is a shorter program (fewer, chunkier lines), or showing the stream earlier rather than a faster model.
