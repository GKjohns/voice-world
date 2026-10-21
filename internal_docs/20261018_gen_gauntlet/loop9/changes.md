# Gen loop 9: scoped roof guidance, trimmed refine prompt, big-object framing, wander hold, slate iron (2026-10-21)

Run: `npm run gen:gauntlet -- --loop loop9` (6 prompts, 2.4 min, ~$0.25 gateway), wrapped in `caffeinate -i`. No stalls, no errors, 60 fps (worst gap 17 ms) on every prompt. This is the second full run. Run A came first (~$0.23, same code except one restored sentence, see Speed): draft 1.7, first refined 4.7, 50% 9.8, settled good 13.0, hero 31.2, avg quality 7.3. Before that, two `--only` probes (~$0.21) and a TTFT A/B bench (~$0.05) ran. Loop total: ~$0.81 (gateway balance 83.50 → 82.69).

## Changes

- **Roof guidance scoped to buildings** (`server/utils/forge.ts` API, `intent.ts`). `roof()` is now "Buildings only (roofs, pagoda/temple tiers, gazebos, lamp hoods)". `shell()` frills are for creatures and plants. One "Forms" line replaces the loop 8 block and its two code examples, and adds "Anything else, whimsical or novel, follows its own form (a teapot's lid is a lathe dome with a knob, not a roof)". The Haiku intent line says the same in one sentence. Result: both runs gave the teapot a real lid (a blue dome in run A, a shingled orange dome with a knob in run B), not a hip roof.
- **Refine prompt trimmed** (same file). The static prefix went from **3034 to 2301 cached tokens** (loop 7: 2354). FRAME, the API lines and the silhouette paragraph were all tightened. Everything that drives quality was kept: silhouette-first with the triceratops and locomotive examples, sink ~20%, the flags, single-letter colours, and the order rule. It is still one stable prefix behind the Anthropic cache breakpoint (`cacheRead 2301`, `write 0` on every refine after the first).
- **Big-object framing** (`renderer.ts` `frameWish`, `fx/frame.ts` `fitFrame`):
  - A landed design over 2.4 m tall or 3.5 m across is fitted to `LANDED_FILL_BIG` 0.68 (others stay at 0.74).
  - `fitFrame`'s "already close enough, don't move" test is now relative (10% of the distance, at least 0.35 m). The fixed 1 m left a small prop landed 3–4 m away at about two-thirds of its fill, which is why the loop 8 telescope was small.
- **Wandering creatures hold still while forged** (`renderer.ts` `moveItems`, `wanderHold`). The triceratops was framed correctly at the swap, then walked off (`motion: wander, range 3`). This was found with a frame log from the probe run. A `wander` motion's clock is now held at rest while its kind is drafting or refining and for 3 s after the refine ends, then blends in as before. (A framing ring round the wander range was tried first: it kept the creature in shot but made it tiny.)
- **Polish held to the target size** (`useForge.ts`). One probe polish came back a quarter size (1.05 m) and still won the judge, because the studio shot auto-frames. The polish now gets the same `refineFinalK` as the refine, before the judge render and before the upgrade. The server logs `fitted ×k` when `fitToDraft` rescales.
- **Deep iron reads slate, not khaki** (`shared/world/palette.ts` `darkFloor`). A dark olive or green lifted more than 0.04 L (big metal masses lift to L 0.55) used to keep its yellow-green hue and turn khaki, then gold under `golden`. It now leans toward slate (h 235) for near-greys and blue-green (h 178) for real greens, with calmer chroma. For example, `#3b3b2e` metal went from `#72725e` to `#5c767a`, and `#1b3a1b` metal from `#597b50` to `#527a6b`. Mid greens are untouched. Test in `tests/palette.test.ts`. In run B the boiler was charcoal metal and reads as deep blue-slate.
- **Harness** (`scripts/gen-gauntlet.mjs`, `WorldScene.client.vue`):
  - Each prompt now saves its final design as `stills/<id>_parts.json`.
  - `__voiceWorld.upgrade(kind, parts, basis)` replays one as a forged upgrade, so framing and look fixes can be checked for free.
  - The final still waits (up to 2 s) for a landing camera move to finish.
- Programs: no shader or material changes, so no new programs; 60 fps.

## Speed

The prompt is 24% shorter, but the speed targets were **not** met. Per-refine data (ledger):

- Output grew to ~1120 tokens, from ~940 in loop 8 and ~970 in loop 7. Throughput was unchanged (~137 tok/s), so the stream ran ~1.3 s longer.
- Server time to the first part was 2.2–4.5 s (loop 8: 2.4–3.4).

Restoring "More parts are not better" before run B did not bring the output back down (1089–1158 tokens).

A side-by-side TTFT bench of the loop 7, 8 and 9 prefixes (16 output tokens, 6–8 alternating calls each) showed provider noise larger than any prefix effect:
- First batch: medians l8 1.56 s, l9 1.78 s.
- Second batch: l7 1.6, l8 2.4, l9 1.8 s.

So the slower times this loop are mostly gateway latency today, plus longer programs, not prompt length.

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
| loop 8 | 1.9 | 4.3 | 8.1 | 11.4 | 27.4 (polished) | 6.8 |
| **loop 9** | 1.7 | 4.8 | 9.4 | 13.4 | 30.9 (polished) | **7.3** |

All 5 good-tier prompts refined, settling at 11.6–15.7 s. The hero polish won 2/2 and settled at 30.9 s. The draft target was met (1.7). First refined and settled good were not (see Speed).

| prompt | l8 | l9 | note |
|---|---|---|---|
| flytrap | 6 | 6 | The whole plant is now in frame with its top inside the margin (run A: 7, a big toothed trap facing you with side traps). Run B's design hangs four pale shell "leaves" under the trap that read as discs, and the main trap is small |
| locomotive | 7 | 8 | The boiler is charcoal metal that reads deep blue-slate with a highlight (no olive). Red frame and wheels, brass bands and dome, smoke puffs, cab, red cowcatcher |
| pagoda | 8 | 8 | Real overhanging roofs on four tiers, a lantern pair, windows, a finial. Still square-on, and the upper roofs are a little small |
| triceratops | 7 | 7 | The whole creature is in frame (it no longer walks off). Three horns, a frill with spikes, a beak and big eyes. The legs are still blocky cylinders, and two small parts float off its back |
| telescope | 6 | 7 | Side-on and back to a hero size in frame: brass tube, eyepiece, finder, tripod with a spreader |
| teapot_house | 7 | 8 | It reads as a teapot now: a domed lid with a knob (no hip roof), spout, window, door, stones and shrubs. The door is turned side-on to the camera |

## Remaining

- **Refine speed.** The cut prompt didn't pay off on the wall clock: programs got ~18% longer and gateway TTFT was high today. Next: a firmer part budget for good tier ("30–60 parts") and a check that quality holds. A repeat bench at another time of day would separate prompt from provider.
- **Gaze rings after landing** are large and bright in the final stills (locomotive, telescope, teapot). They distract in video. Fade them more, or keep them off until the player looks away and back.
- The flytrap's form varies a lot from run to run (side lobes, dangling shells). Its frill/lobe guidance might need one concrete lobe-pair line back, kept inside the creature/plant scope.
- Triceratops legs are still plain cylinders, and small back plates float.
- The fixed 3 s wander hold is a heuristic. A creature defined without a refine (draft only) still wanders from the start.
