# Loop 1: changes

## Immersive HUD

Eval improvement #3 ("hide the machine") plus the HUD notes. By default the screen is the world, the crosshair and one orb.

**Default view** (`app/components/hud/HudLayer.vue`, `HudPresence.vue`, `HudOrb.vue`)
- **The orb** sits at the bottom centre: a canvas sphere whose colour, size, glow, swirl and sigil ease toward the current state. It breathes when idle (warm gold, with a slow ripple every few seconds). It swells and ripples with your real mic level while the realtime voice hears you (an AnalyserNode on the voice's mic stream). It swirls violet motes while thinking, flares with a double ring burst when building, wears a turning gold sigil while the Director summons a place, and pulses teal while the genie speaks. The genie's playback level isn't exposed by the SDK, so speaking uses a synthetic speech-like envelope.
- **Captions** float above it in Cormorant Garamond, with no panels, just a soft dark text bloom. Your words show in italic at 70% white (the pending sentence, or the voice transcript). The genie's line shows larger in warm white (`world.caption`, `voice.said` or the Director's "Taking you to…"). Errors appear in soft rose. They fade with a blur after about 5 s, and a new wish clears the old answer at once.
- **The wish field** appears only when you type or click the orb. Any printable key except W A S D M starts the sentence with that letter. Enter or `/` opens it empty, Esc clears and closes it, and it fades back after sending. While you compose it sits over the caption area, and the captions hide. When closed it's invisible but still clickable, so `click [data-intent-input]` still works.
- **Tiny icons:** a mic beside the orb (it's `data-mic`, with the same realtime-then-browser-speech fallback), the camera toggle bottom-left (no preview panel; recenter appears while it's on), and `{}` bottom-right for developer mode.
- **First run:** on an empty world (no entities, no log) a whisper fades in: "Speak, and it shall be. / Try: 'raise a castle on a hill'" with a small "just start typing · tap the mic to speak · drag to look · W A S D to walk". It fades after the first command. The mic is a toggle, not hold-to-talk, so the copy says "tap".

**Lifecycle** (`app/composables/useHud.ts`): `phase` folds the voice presence, the typed intent phase and the Director together. While `useDirector().current.status === 'building'` and nothing louder is happening, it reads **`summoning`**, so the orb and the dev pill no longer say "ready" through a 10 s teleport build. The orb carries `data-pill` / `data-phase`.

**Developer mode:** backtick or the `{}` corner button brings back the full HUD (status bar and kind chips, op log, the text bar with its pill, model toggle and raw-op console, and the camera preview panel). It's saved in `localStorage['conjure.devHud']`. The dev pill uses the same `useHud().phase`, so it now has `summoning` too.

**Small edits outside the HUD**
- `useRealtimeVoice.ts`: exposes a read-only `micStream` shallowRef for the orb's analyser.
- `HudIntent.vue`: one `PILL` map keyed by `HudPhase`. The mic and voice no longer stop when the bar unmounts; `HudLayer` owns that now, so switching modes never hangs up.
- `WorldScene.client.vue`: the four HUD tags became `<HudLayer />`, and the crosshair is smaller and softer.
- `main.css`: adds `--font-display` (auto-fetched by @nuxt/fonts) and a `hud-glow` text-shadow utility.

**Heads-up for scripts:** `scripts/shoot.mjs sprint1` clicks `[data-console-toggle]` and the example chips, which now exist only in dev mode. Set `localStorage.setItem('conjure.devHud','1')` before loading, or press backtick first. `voice-shoot.mjs` (`[data-pill]`, `[data-mic]`) and `ask()` (`[data-intent-input]`) work unchanged in the default view.

Screenshots: [idle](loop1/hud_idle.webp), [summoning](loop1/hud_summoning.webp) (Director build in progress, with caption and sigil), [onboarding](loop1/hud_onboarding.webp).

## Spectacle & framing

Eval improvements #1, #2, #9, #10 and #11, plus the optional "world listens" glow. Files: `shared/world/layout.ts`, `app/world/renderer.ts`, `app/world/sound.ts`, and the new `app/world/fx/` (`common.ts`, `arrival.ts`, `frame.ts`, `vortex.ts`, `anticipate.ts`). There's also a one-line change in `shared/world/state.ts`: spawn passes `props: op.set` to `layout`.

**#1 Always frame the wish**
- **Size-aware placement** (`layout.ts`): footprint × `set.scale` now drives spacing, clearance and de-overlap. Gaze-anchored spawns (and player-anchored ones with no `dist`) also get pushed back until foot-to-top fits 86% of the 65° vertical FOV (`fitDistance(height, eye)`, exported with `VIEW_VFOV`). "A giant tower right there" with gaze at 3 m now lands about 50 m out with its top in shot. There are 4 new tests in `tests/world.test.ts`.
- **Camera glide** (`fx/frame.ts` `solveFrame`, `renderer.frameWish`): after a spawn, or a modify that changes size or position, it samples each thing's footprint ring and top. If anything sits outside 92% of the frame, it eases yaw and pitch toward the spread, and steps back (3 m up to 100 m) until it fits. The move is 1.05–1.6 s, ease-in-out. It skips flat things, particles and tiny single props. It never starts while you drag or walk (or within 250 ms of input), and any look or WASD input cancels it instantly. "Make it huge" with the camera inside the dragon backs you out smoothly (z 0 → 22 m).
- Page loads and restores get no fanfare and no camera move (a batch counts as a wish only when the log grows or shrinks by one).

**#2 Light, sound and weight** (`renderer.arrive`, `fx/arrival.ts`, `sound.ts`). Tiers come from the scaled height:
- **Small (< 3 m):** a sparkle and a soft pop.
- **Mid (3–8 m):** a sparkle, dust and a pop, plus a small ground ring when it's a single.
- **Big (≥ 8 m):** a beam of light from the sky that swells about 420 ms before the thing appears. It drops through the beam (accelerating, 12 m + 0.9 × height up) or grows inside it. On touchdown: a beam flare, a shockwave ring, a billowing dust cloud, a squash, a bass thump with a rumble, and a camera shake scaled by size and nearness.
- **Batches:** chimes climbing a pentatonic run in the tk-tk-tk rhythm.
- **Modify:** a shimmer band sweeps up each changed thing (up to 32 per batch) in step with the colour wipe, with one whoosh per batch (rising for growth, falling for shrink). Growth past 8 m lands with a thump and a ring (at most 4 rings per batch).
- **Remove:** dissolves into rising sparks with a glittering fall.
- **Audio:** all synthesized in WebAudio. Beds and sfx feed one master gain (M still mutes), then a compressor-limiter, with a synthetic convolver reverb on the one-shots. A polyphony cap means a 200-thing teleport can't pile up.

**#9 Teleport without dead air** (`fx/vortex.ts`, `beginReveal`)
- On teleport, the old world dissolves upward into motes (16 m drift) and a portal rush plays.
- A two-layer swirling light tunnel with 520 spiralling motes spins up within 300 ms around the player. It fades as the fog pulls back about 14 m from its tightest point.
- An open chord blooms when the first Director arrival lands.
- No frame is plain fog anymore: [after_teleport_vortex](loop1/after_teleport_vortex.webp).

**#10 Lamp light follows colour** (`renderer.lampTint`): for `lamp` kinds and non-fire `light` kinds, `color` (or `trim`) tints the real light and the bulb glow. The tint keeps the hue and is lifted to light-level lightness, and it tweens with the wipe. Undo restores the original light colour.

**#11 Global scale-ups become a god view** (`renderer.godView`):
- When at least 6 things grow ≥ 1.5× in one batch, the camera rises first, to about 1.45× the scene's tall-ish height and about 1.7× that back from the scene's middle. It pitches down at the scene, and the world swells 450 ms later beneath you.
- WASD speed scales with the lift. When nothing taller than 14 m is left (after an undo), you drift back down to standing height. A teleport also lands you standing.
- The screen never goes black.

**Gathering glow, for agent "brain":** `useWorld().renderer()?.anticipate(point)` (where `point` is a `Vec3`, e.g. `ctx.gaze.point`) starts a breathing pool of light with motes spiralling into a column. `anticipate(null)` fades it. You may not need the null call: any batch that spawns, modifies or removes something clears it automatically. The natural place to call it is in `useIntent.build`, next to `showGhost`.

**Also fixed:** two atmosphere tweens fired back to back (clear, then "make it day") used to fight, and the older one won. The newer one now takes over.

**How it looks now (headless, swiftshader):**
- **Giant tower:** a bright column from the sky, then the tower comes down through it and lands with a ring and dust, in full frame ([after_giant_tower_beam](loop1/after_giant_tower_beam.webp)).
- **Huge dragon:** a smooth back-out to a full view ([after_huge_dragon_framed](loop1/after_huge_dragon_framed.webp)).
- **Blue lamps:** the pool turns blue-lavender under the blue shades ([after_blue_lamps](loop1/after_blue_lamps.webp)).
- **9 pines:** a glitter trail and chimes.

**Known gaps:**
- The 10× god view frames correctly, but 10× of a tight village is just overlapping giants seen through fog. It's never black, but it isn't beautiful.
- Big-arrival timing is about 2 s from op to touchdown. That's good drama, but it adds to perceived latency.
- The beam is a camera-facing quad, so it looks flat if you look straight up.
- There are no real light flashes, because adding lights forces shader recompiles. Beams and glows are additive meshes instead.
- Sound was verified for graph errors only: headless runs have no ears. It needs a listen on real speakers.

## Brain & voice

Covers loop1_latency.md recommendations 1–5 and eval improvement #8. Files: `server/utils/gateway.ts` (rewritten), the new `server/utils/opStream.ts`, `server/utils/intent.ts`, `server/utils/director.ts`, `server/api/intent.post.ts`, `server/utils/realtimeTools.ts`, `shared/voice.ts`, `app/composables/useIntent.ts` and `useRealtimeVoice.ts`, `bench/intent.ts` and `bench/realtime_check.ts`. I also added `tests/opstream.test.ts` and deleted `server/plugins/directorWarmup.ts`.

**Intent: JSON in text, streamed**
- No more `Output.object`. The model writes plain JSON, pinned with the gateway's `only: ['anthropic']`. `streamOps` (in gateway.ts) runs `opScanner`, which understands strings and escapes and yields each element of the first JSON array the moment its object closes. When the stream ends, a full-text parse picks up anything the scanner missed (for example a stringified envelope), so the `parseOps` recovery still works. The cached digest is unchanged.
- `/api/intent` now returns NDJSON: `{t:'op'}` per strict op, `{t:'drop'}`, then `{t:'done', firstOpMs, ms, model, error?}`. `interpret()` still exists as a collector for the bench.
- **One sentence is still one undo batch.** In `useIntent.build`, the first op that changes the world opens the batch with `world.run`. Later ops join it through `world.extend`, the same way the Director fills a teleport. `undo` and `teleport` always run on their own. If the batch is no longer last, the rest continues in a "(cont.)" batch. The model, latency and server-side drops are stamped onto the history entry at `done`.
- The outcome now carries `notes`, `firstOpMs` and `firstAppliedMs`.

**Director:** the same text-JSON streaming. The `Output.array` grammar and its warm-up plugin are both gone. `DirectorEvent.op` is now `unknown`, and the client still runs `directorToOp` + `parseOps`.

**Voice**
- The new `teleport({ world, brief })` tool starts the Director straight from the voice. It goes through a teleport batch via `useWorld().run`, so undo, save and replay behave as usual. The tool result waits up to 3 s for the first Director op, so the welcome lines up with the first arrival.
- VAD silence is now 400 ms.
- The tool results are honest: `{ outcome: 'done' | 'NOTHING CHANGED' | 'started', result, notes?, dropped?, builderLine? }`.

**Genie persona**
- One character across the realtime instructions and intent rule 10, and the worked-example `say` lines were rewritten to match: an ancient, warm, theatrical genie, at most 8 words, never sycophantic.
- It may only claim what its ops or the tool result actually show. Example: "make the dragon fly" on an empty scene gets "Alas, nothing here answers to 'dragon'. Shall I summon one?"
- Voice: `cedar` (deep and warm). `ballad` is the more theatrical alternative.

**Numbers** (Haiku, concurrency 2)

| | Before | After |
|---|---|---|
| `bench:intent` | 37/37 | **37/37 twice**, all served by anthropic, 37/37 cache hits |
| Intent, same-run A/B (6 sentences × 3) | structured, done **1,339 ms** | first op **886 ms**, done 982 ms |
| Intent bench medians | done 1,066 ms (latency doc) | first op 932 / 999 ms (plain 896 / 960, define 2,047 / 1,969); done 994 / 1,056 ms |
| Director first op | grammar 1,360–1,782 ms (doc) | **1,234–1,607 ms**, done 7.4–10.5 s, 0 dropped across 3 places + 2 probes |
| Voice: VAD stop → tool call | — | 241–499 ms |
| Voice: speech end → first audio | ~5.1 s (eval) | **1.0–1.8 s** (the acknowledgement) |
| Voice: speech end → first op, plain | ~2.1 s (doc), ~4 s (eval) | **~1.7–2.1 s** |
| Voice: speech end → teleport tool call | — | 1.15 s, then Director first op ~1.2–1.6 s later |

Today the gateway ran about 100–300 ms slower than the doc's (b)/(c) runs, which is why the same-run A/B is the fair comparison.

**Deviations**
- **The genie speaks first through a client-triggered line, not by talking before the tool call.** When I asked gpt-realtime-mini to talk before calling the tool, the call was 600–900 ms later. It also read the arguments aloud (`{ "request": … }`, "(functions.teleport called)") and sometimes skipped the tool entirely. Now, when the response containing the tool call closes, `useRealtimeVoice` sends `requestResponse({ instructions: ACK_INSTRUCTIONS })`, which is the full persona plus "say 1–3 words, no tools". The tool result is held until that line finishes, so the SDK's confirmation request can't collide with it. Tool calls made by the acknowledgement response itself are answered `IGNORED`: in one run it re-called `build` with an embellished wish, and that wish turned into a teleport. The SDK's TypeScript type only allows `modalities` here, but the gateway forwards `instructions` (verified in the bench), so the code casts.
- **The teleport tool takes `world` as well as `brief`.** The Director and the batch need a place name.
- **The throwaway `bench/latency_*.ts` files were removed**, because they no longer compiled or linted against the new API. Copies are in the session scratchpad.

**For the next evaluator**
- Plain edits finish about 60–200 ms after their first op, so streaming mostly pays off on multi-op sentences, defines (a placeholder could go first; not done yet) and teleports.
- Teleport briefs from the voice push the tool call up to ~1.1 s after speech end, and once 1.6 s.
- VAD at 400 ms is untested with real hesitant speech. If sentences get clipped, use 500.
- In `voice-shoot.mjs` both build turns worked: VAD → tool 370–388 ms and tool → first op 936–955 ms. After that the socket closed with code 1006, probably an HMR reload from a concurrent edit, and the script crashed reading `__conjureVoice`.
