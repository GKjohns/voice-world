# Gen loop 1: one honest build (2026-10-18)

Run: `npm run gen:gauntlet -- --loop loop1` (6 prompts, 3.4 min, ~$0.27 on the gateway). Review page: `index.html` here.
Plus one check rerun of triceratops with the scale fix, in `../loop1_scalefix/`.

## What changed

- **No theatre.** The gold ghost, the refine motes, the 350 ms hold, the 1.8 s light sweep, the fixed 700 ms "forming" motes and the "…let me perfect it." caption are all gone (the hero tier keeps its caption). The soft gaze glow is the only cue until data arrives. Files: `app/world/renderer.ts`, `app/world/fx/refine.ts` (new `crossfade` and `growIn`), `app/composables/useIntent.ts`.
- **Opus starts at the spawn.** When the spawn names a kind nobody has designed, `useForge().early` starts the refine right away, alongside Haiku: no draft, no studio shot, no wait. The upgrade waits for the draft's define, because it replaces a defined kind. `/api/forge` takes `draft` as optional, and with no draft the prompt says "design it from scratch at real-world scale". Files: `useForge.ts`, `server/utils/forge.ts`, `server/api/forge/index.post.ts`.
- **The Haiku draft streams part by part.** `opScanner().partials()` hands out each part of a define that is still open. These go out as `{"t":"part"}` NDJSON events (`gateway.ts`, `intent.ts`, `intent.post.ts`), and `renderer.draftPart` grows them on the spawn's spot. The define then lands as an in-place exchange (`rebuild(..., still)`), not a morph.
- **The hand-over.** The refined parts grow into an overlay. Once 3 parts (the biggest masses) are on screen, the draft cross-fades out over 350 ms. When the stream ends, the overlay is swapped for the merged body in one frame. The server no longer runs `fitToDraft` afterwards, so there is no resize jump. Other instances, and the hero polish swap, use the 350 ms cross-fade.
- The harness (`scripts/gen-gauntlet.mjs`) logs `draft` as the first streamed part (`draftDefine` keeps the old meaning), and `settled` is now swap + 0.35 s.

## Timings (means over 6 prompts, s from Enter)

| | draft (first object px) | first refined part | 50% parts | swap | settled (good) | settled (hero) |
|---|---|---|---|---|---|---|
| loop 0 | 4.5 | 10.2 | 15.2 | 19.0 | 19.4 | 82.9 |
| **loop 1** | **2.1** | **5.5** | **10.8** | **14.1** | **12.9** | 89.8 |

The good tier settles 6.5 s sooner (34%). The hero still waits on the 5.8 s reference image before Opus (first refined part at 11.1 s) and on the Sol polish (~65 s later). fps held at 60 on every prompt, with the worst frame gap 17–33 ms, the same as loop 0.

## Quality (final stills)

| prompt | loop 0 | loop 1 | why |
|---|---|---|---|
| flytrap | 7 | 6 | Richer (spiked trap, pot, side traps), but it is giant and the top is cut off |
| locomotive | 5 | 3 | Nose-on and real-scale: a black boiler disc fills the frame |
| pagoda | 7 | 8 | Five tiers, finial, well framed: the best of the run |
| triceratops | 3 | 2 | Real-scale and "right in front of me": the camera is inside it, and an orange frill fills the shot |
| telescope | 5 | 5 | A readable tripod and brass tube, still pointing at the camera |
| teapot_house | 8 | 6 | Lots of detail (polish won, 140 parts), but too big and cropped |
| **avg** | **5.8** | **5.0** | |

## What got worse: scale

Without the draft's envelope, Opus builds at real-world scale, and nothing fits it afterwards. Big things ("giant", locomotive, triceratops, cottage) now come out 2–4× larger than the draft and overflow the frame from the spot the spawn chose. I tried a fix in this loop: fix `k` once at the hand-over by fitting the first refined masses to the draft, then scale the rest of the stream and the final parts by the same `k` (`renderer.handOff` / `refineScale`). The triceratops rerun was still too big. The first three masses fall inside `fitToDraft`'s 0.8–1.25 dead zone, and the head and tail come later. **Loop 2 must fix this first.** Options: give Opus a target envelope at the start (a `size` on the spawn, or start it after the first 2–3 streamed draft parts at about 2.3 s), or reframe the camera on the final bounds. Framing and orientation (baseline idea 4) also matter more now.
