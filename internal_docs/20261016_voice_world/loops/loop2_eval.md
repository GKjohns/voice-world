# Loop 2: experience evaluation (Oct 17, 2026)

**Lens:** the north star, not correctness. "I want the player to almost feel like they're god or they have a genie. It should be a 'holy shit' experience."

**How it was played:** headless Chromium (swiftshader) against the running dev server at :3091, real models, default (minimal) HUD with dev mode off. I ran three sessions:

- **Text run 1:** loop 1's 14-command script plus "undo that" and 5 new wishes, typed the way the HUD invites you to: just start typing with the canvas focused (no Enter first). 18 ms/key.
- **Text run 2:** an Enter-first rerun of the creature, sky, terrain and scale wishes, because run 1 surfaced an input bug (below) and then got stuck 160 m up after the 10× wish.
- **Voice:** a fake-mic realtime session with 4 spoken commands (`say` + ffmpeg, 24 kHz mono): a castle, a teleport ("take me somewhere tranquil"), "now make it night, and fill the sky with lanterns", and "make the trees glow gold".

In-page tracing ran every 40 ms (orb `data-phase`, a state signature, Director status, camera position) and checked whether new things were in the frustum. Model spend was about $0.25: roughly 35 Haiku calls, 3 Director builds (about $0.016–0.026 each), and about 60 s of realtime-mini.

Screenshots: `loops/loop2/` (8 webp files). Scratch PNGs and logs: session scratchpad `loop2_eval/`.

## Scores

| Dimension | L1 | L2 | Δ | Evidence |
|---|---|---|---|---|
| Speed / anticipation | 5 | 6 | +1 | Kit edits now take 0.95–1.4 s from Enter. The voice acknowledgement ("Hmm, yes…", "As you wish…", "Mm. Watch…") comes 0.5–0.8 s after you stop talking. But defines still take 2–4.4 s (and 12 s for the dragon in run 2), and the gathering glow is built but never called, so a voice castle has a 3 s inert wait with only the ghost ring. |
| Arrival spectacle | 4 | 7 | +3 | The sky beam on big arrivals ([02](loop2/02_voice_castle_beam.webp)), the ring flare on "make it huge", the shimmer sweep on recolours and the teleport light tunnel ([03](loop2/03_voice_teleport_vortex.webp)) all land. This is the biggest jump. |
| Scale and ambition | 3 | 4 | +1 | The mountains now read as a silhouette range, the tower is framed and the huge dragon is backed out. But the lanterns are still on the ground, "build a city around me" is still one street, and 10× is a grey fog screen ([06](loop2/06_ten_times_grey.webp)). |
| Understanding of intent | 6 | 5 | −1 | **Regression from the new HUD:** type-to-start eats every leading W, A, S, D, M and space. "a dragon" was sent as "ragon" ("The words are unclear", [01](loop2/01_typed_wish_eaten.webp)), "make…" became "ke…", and the M toggled mute. The model is otherwise as good as before. Voice turned "lanterns in the sky" into 12 street lamps, and "glow gold" became a plain recolour. |
| World aliveness | 3 | 3 | 0 | Nothing moves. The horses are frozen, the dragon is a statue, the volcano doesn't erupt ([08](loop2/08_volcano_horses_static.webp)), and the lanterns sit on the ground. |
| Sense of power / agency | 4 | 5 | +1 | Framing means you see what you asked for. But the camera now relocates you: 22 m, 40 m, then 100 m back, which yanks you out of the city ([05](loop2/05_mountains_pulled_out_of_city.webp)). After 10× and undo you stay 40–160 m up, and every later wish is invisible ([07](loop2/07_stuck_at_160m_horses_gone.webp)). All 5 weather wishes were refused or faked. |
| Voice and personality | 5 | 7 | +2 | The genie is a character now ("Behold, the mountain wakes!", "Gold through the groves."), and it speaks first. It mostly owns its limits ("It cannot fly… yet."). It still fibs sometimes: "Night falls, lanterns drift." (they're static street lamps) and "Moved. It cannot fly… yet." (nothing moved). |
| Visual beauty | 6 | 6 | 0 | The Director scenes are still lovely (dawn dock, neon street, pool hall). Learned kinds are still crude: a frog-blob dragon, floating lanterns as 3 m crayons ([run 1 #10]), and a volcano that's a cone with yellow "ears". |
| Immersion (HUD) | 4 | 8 | +4 | A settled frame is now the world, a crosshair, the orb and a serif caption. The orb's phases (thinking, building, summoning, speaking) read well. |
| **Overall "holy shit"** | **4** | **5** | **+1** | Voice teleports are now a real "oh wow": a spoken wish, "As you wish…" within 0.8 s, then the light tunnel, then the dawn dock. Everything that should be the climax (sky full of lanterns, a flying dragon, a storm, an erupting volcano, 10×) is still static, refused, or gets lost to the camera. |

## Timeline

Times are from Enter, or from VAD stop for voice. "Reaction" is the orb going to *thinking* (always 3–55 ms, so it's left out below). "First object" is the first state change; anything 8 m or taller then has about 2 s of beam and drop on top. "Cam" is when the framing move finished. Teleports show the Director's first op and done times.

### Text run 1 (type-to-start, from an empty world)

| # | Typed → sent | First object | Done / cam | What you see |
|---|---|---|---|---|
| 1 | put a castle on that hill | 4.43 s (define) | ~6.4 s with beam | A modest castle on flat ground. "A fortress crowns the hill." There's still no hill and it still claims one. |
| 2 | make a bunch… → "ke a bunch of trees" | 1.00 | ~2.5 | 9 pines with a glitter trail, planted in front of the castle again. |
| 3 | make all… → "ke all the trees red" | 1.21 | ~2.0 | Shimmer sweep and colour wipe. "Autumn, as you wish." |
| 4 | a dragon → **"ragon"** | — | — | "The words are unclear. Speak again." ([01](loop2/01_typed_wish_eaten.webp)) |
| 5 | make it huge → "ke it huge" | 1.0 (scale 3) | — | It scaled the nearest *tree* (there was no dragon) and gave a ring flare. "Hugeness, as you wish." |
| 6 | take me somewhere tranquil | fog 1.60 → [2.83] | [8.41] | A light tunnel, then a golden-hour lake: 124 things, 44 in view. Still the best moment. |
| 7 | make it night → "ke it night" | 0.95 | ~1.9 | Moon, stars, fireflies. Lovely. |
| 8 | take me to a pool hall | 1.60 → [3.23] | [11.3] | A warm hall, 39 things. |
| 9 | make all… → "ke all the lamps blue" | 1.1 | ~2.0 | The shades turn blue and the light tints cooler. Works, but subtle. |
| 10 | fill the sky with floating lanterns | 2.97 (define) | cam 4.29 | 30 "floating_lanterns" that are 3 m red and yellow crayons **on the floor**. The camera backs 22 m out *through the hall's wall*. Looking up shows an empty ceiling. |
| 11 | build a city around me | 1.19 → [2.52] | [11.98] | The neon street, looked at from below. Pretty. It's still a street, not 360°. |
| 12 | put a mountain range on the horizon | 1.95 (define) | cam 3.82 | The camera **dollies 100 m back out of the city** to fit 6 cones. The city shrinks to a grey block in fog ([05](loop2/05_mountains_pulled_out_of_city.webp)). |
| 13 | make it rain → "ke it rain" | — | — | "Rain is beyond my kit… for now." |
| 14 | make everything… → "ke everything ten times bigger" | 1.37 | cam 2.85 | God view to **y = 161 m**: dark abstract shapes. "Enormous. Behold." |
| 15 | undo that | 1.03 | — | "Unmade." **The camera stays at 161 m**, because the mountains are over 14 m tall, so `godView` never descends (`renderer.ts` ~L420). |
| 16 | summon a thunderstorm → "ummon…" | 1.27 | — | Fog 0.6 only. "The sky darkens… thunder, but no rain yet." It claims thunder, and there's no sound. |
| 17 | make the dragon fly… → "ke the dragon fly in circles…" | — | — | "Dragons cannot yet take flight here." (Honest. In loop 1 it spawned a second dragon.) |
| 18 | a herd of horses galloping… → "herd of…" | 3.22 | — | 8 horses spawned, invisible from 161 m ([07](loop2/07_stuck_at_160m_horses_gone.webp)). |
| 19 | raise a volcano that erupts right there | 1.96 | ~4 | The beam is visible from above. Then nothing you can make out. |
| 20 | make it snow → "ke it snow" | 1.16 | — | Fog only. "I cannot summon snow… yet." |

### Text run 2 (Enter first, empty world)

| # | Command | First object | Cam | What you see |
|---|---|---|---|---|
| 1 | a dragon | **12.04 s** | — | The same green frog-blob as loop 1. All 12 s of the define is inert. |
| 2 | make it huge | 1.18 | 2.10 (3 m back) | A big ring flare and a clean back-out. Good. |
| 3 | make the dragon fly in circles | — | — | "Moved. It cannot fly… yet." Nothing moved, so the first word is a fib. |
| 4 | make it night | 1.11 | — | Lovely. |
| 5 | fill the sky with floating lanterns | 2.28 | 3.72 (**40 m back**) | 30 tiny yellow squares on the ground at the horizon. The sky is empty ([04](loop2/04_lanterns_on_ground.webp)). |
| 6 | put a mountain range on the horizon | 2.90 | 4.58 (**100 m back**) | 7 dark cones that read as a range on the skyline. This is an improvement. |
| 7 | give me a herd of horses running across the field | 3.03 | — | 7 blocky horses, frozen. |
| 8 | raise a volcano that erupts right there | 2.28 | — | The beam, then a ~6 m cone with two yellow blobs. No smoke, no glow, no lava ([08](loop2/08_volcano_horses_static.webp)). "Behold, the mountain wakes!" |
| 9 | summon a thunderstorm | — | — | "Thunder I cannot yet summon, but night holds." |
| 10 | make everything ten times bigger | 1.48 | 2.76 (y = 40) | A flat grey fog screen with only the caption ([06](loop2/06_ten_times_grey.webp)). |
| 11 | undo | 1.14 | 2.78 | Stays at y = 40 and moves *further* back (z 61 → 161). A dark plain with toy horses far below. |

### Voice (realtime, fake mic, from VAD stop)

| # | Spoken | First audio | First object | Spoken line | Notes |
|---|---|---|---|---|---|
| V1 | "Put a castle over there." | **0.6 s** "Hmm, yes…" | 3.1 s (define, tool → op 2.88 s) | 4.1 s "A castle now stands tall. Behold." | VAD → tool 277 ms. The beam lands it in frame ([02](loop2/02_voice_castle_beam.webp)). Between "Hmm, yes" and the beam the world is inert. |
| V2 | "Take me somewhere tranquil." | **0.8 s** "As you wish…" | sky to dawn at 2.0 s, Director first op tool + 1.57 s | 2.6 s "Come. Somewhere still." | `teleport` tool fired (VAD → tool 431 ms) with a rich brief. The tunnel is immediate ([03](loop2/03_voice_teleport_vortex.webp)), and the dawn dock is done at ~8 s. **The best moment of loop 2.** |
| V3 | "Now make it night, and fill the sky with lanterns." | 0.5 s "Mm. Watch…" | night 1.4 s, lamps 2.0 s | 4.2 s "Night falls, lanterns drift." | One build call. It spawned **12 street lamps** on the ground, and the line claims they drift. |
| V4 | "Make the trees glow gold." | 1.3 s "As you wish…" | 2.5 s (72 changed) | 3.0 s "Gold through the groves." | A plain recolour with a shimmer sweep. Nothing glows. |

## Loop 1 changes: verification

| Change | Verdict | Evidence |
|---|---|---|
| Immersive HUD (orb, captions, no log) | **Worked** | Every frame is clean. The orb phases and the first-run whisper show, and backtick still brings back dev mode. |
| Type-to-start wish field | **Broken** | `HudPresence.vue` L18 `RESERVED = {w,a,s,d,m,' '}` consumes those keys before the field opens. "make", "a", "summon", "show", "draw", "spawn", "make it" all lose letters, and M toggles mute mid-wish. It works only if the sentence starts with any other letter, or you press Enter or `/` first. |
| Director-aware *summoning* phase | **Worked** | It appeared in every teleport, for both text and voice. |
| #1 Always frame the wish | **Partial** | Huge dragon: backed out 3 m, good. Tower-class placement: fine. But the dolly ladder in `fx/frame.ts` L123 (`backs` up to 100 m) moves the *player*, not just the view. It pushed 22 m through a pool-hall wall, then 40 m and 100 m out of the city. Over a session you end up 140–220 m from where you were standing. |
| #2 Light, sound, weight | **Worked** (visually) | Beam, ring, shimmer, glitter trails. I couldn't hear sound headlessly; there were no graph errors. |
| #9 Teleport without dead air | **Worked** | No flat-fog frame in 3 teleports. The tunnel spins up immediately. |
| #10 Lamp light follows colour | **Worked (subtle)** | The pool hall reads cooler and the light under the shades tints blue. |
| #11 God view for global scale | **Partial / regressed** | Never black now, but it's flat grey fog (run 2) or abstract shapes (run 1). After undo, `godView`'s "tallest > 14 → stay lifted" rule (`renderer.ts` L420) keeps you 40–160 m up whenever anything tall exists, and later wishes become invisible. |
| Gathering glow (`renderer.anticipate`) | **Not wired** | Only its definition exists (`renderer.ts` L437). Nothing in `useIntent.ts` or `useRealtimeVoice.ts` calls it. |
| Streaming intent | **Worked** | Kit ops 0.95–1.4 s from Enter, versus 1.2–1.7 s in loop 1. |
| Voice teleport tool | **Worked** | VAD → tool 431 ms, rich brief, Director first op 1.57 s after the tool. |
| Genie persona and speak-first | **Worked**, with small fibs | First audio 0.5–1.3 s, versus ~5 s in loop 1. Lines are in character. 2 fibs out of 9 lines ("lanterns drift", "Moved."). |

## Observations

**What's working now**
- **Voice teleport is the closest thing to the north star.** You speak, "As you wish…" comes in under a second, the light tunnel opens, the sky turns, and a scene builds outward around you. Show this one first.
- **Arrivals have weight.** The beam on a big thing is the first "oh" in a void world.
- **The HUD gets out of the way.** The screenshots now look like a game, not a dev tool.
- **Honesty improved.** It refuses flight, rain and snow instead of pretending, apart from the two fibs noted above.

**Top awe-killers now**
1. **The sky and motion half of wishes still does nothing.** In this run that was 5 weather wishes, 2 flight wishes, 1 gallop, 1 eruption, and lanterns 3 times. The genie now politely says "not yet" to most of the things a delighted user asks for first. That's honest, but every refusal is an anti-genie moment. `ops.ts` still has no altitude, no behaviour and no weather, and spawn y is always 0.
2. **The camera fights you.** Framing teleports you tens to hundreds of metres, sometimes through walls. The god view leaves you hovering after undo, and in run 1 that made the last 5 wishes invisible. Losing your footing is the opposite of feeling powerful.
3. **Typing breaks the first word.** The default input path mangles the most common wish openings ("make…", "a…", "summon…") and mutes the sound. Most text users will hit this on their very first sentence.

**Smaller notes**
- Learned creatures and props haven't improved since loop 1: the frog dragon (12 s to define), crayon lanterns, the mickey-ear volcano. Defines also have no placeholder, so they're 2–12 s of nothing.
- "Glow" has no vocabulary: no emissive modify and no glowing lantern kind.
- "Build a city around me" is still a street in front of you.
- 10× has no beautiful version. Scaling 45 things inside fog will always look like this. Shrinking the player would read better.

## Ranked improvements (awe per effort, on fresh evidence)

| # | Improvement | Impact | Effort | Status |
|---|---|---|---|---|
| 1 | Type-to-start keeps every letter | H | S | new (regression) |
| 2 | Camera restraint: frame without relocating; land after god view | H | S–M | new (from #1/#11) |
| 3 | Altitude and motion in the op language | H | M | carried (L1 #4), now top gap |
| 4 | Weather and sky events | H | M | carried (L1 #5) |
| 5 | The world answers while you speak (wire the gathering glow) | H | S | carried (L1 #7), half-built |
| 6 | Colossal tier: horizon anchor and terrain kit | H | M | carried (L1 #6) |
| 7 | Define placeholder and creature quality | M–H | M | carried (L1 #12) + new latency |
| 8 | Glow and light vocabulary (emissive modify, lantern kind) | M | S | new |
| 9 | Voice confirmations only claim what the tool result shows | M | S | new |
| 10 | 10× becomes "you shrink" | M | S | reworks L1 #11 |
| 11 | "Around me" means 360° for Director cities | M | M | carried (L1 note) |

**1. Type-to-start keeps every letter.** H / S.
- **Files:** `app/components/hud/HudPresence.vue` (the `RESERVED` set at L18 and its keydown handler), `app/components/WorldScene.client.vue` (`onKey` M mute).
- **How:** treat W, A, S, D, M and space as *maybe-typing*. Buffer them for about 250 ms. If a non-reserved printable key follows inside that window, open the field with the buffered text, cancel any walk impulse and don't toggle mute. Mute should fire on a lone M (keyup with nothing following). Holding a walk key (keydown repeat, or over 250 ms) stays movement.
- **Done looks like:** typing "a dragon", "make it night" and "summon a thunderstorm" into a focused canvas sends exactly those strings, the sound stays on, and WASD walking still feels instant.

**2. Camera restraint.** H / S–M.
- **Files:** `app/world/fx/frame.ts` (`solveFrame`, the `backs` ladder at L123), `app/world/renderer.ts` (`frameWish` L375, `godView` L395–420), `app/composables/useWorld.ts` (undo).
- **How:** cap the dolly at about 12 m and never cross a wall: raycast the step-back, and inside an interior just pitch and yaw. For wide or distant spawns (a range, 30 lanterns), solve with yaw, pitch and a temporary FOV widen up to 85° instead of moving the player. Store the pre-lift pose when `godView` lifts and restore it on undo of that batch, regardless of what else is tall.
- **Done looks like:** across this eval's script, the player never ends more than 15 m from where they stood (except on teleports), never ends outside a room they were in, and undo after 10× puts you back at eye height where you were.

**3. Altitude and motion in the op language.** H / M. Carried; still the single biggest gap.
- **Files:** `shared/world/ops.ts` (`set.altitude`, `set.behavior: float | bob | orbit | wander | gallop | fly | drift_up | erupt`), `shared/world/layout.ts` (a `sky` anchor spread over a hemisphere 12–60 m up; y from altitude), `app/world/renderer.ts` (per-item behaviour in the existing animate tick), `server/utils/intent.ts` (rule 10 and worked examples: lanterns → `anchor:'sky'`, `behavior:'drift_up'`, glow; "fly in circles" → modify `behavior:'orbit'`; "running/galloping" → `gallop`), `server/utils/realtimeTools.ts` / `shared/voice.ts` (so voice lanterns stop becoming street lamps).
- **Done looks like:** in a 3 s clip, 40 lanterns rise across the sky, the dragon circles overhead, and the herd gallops across the view. "Fill the sky with lanterns" by voice never spawns `lamp`.

**4. Weather and sky events.** H / M.
- **Files:** `shared/world/ops.ts` (atmosphere `weather: rain | snow | storm | clear`, one-shot `sky: lightning | shooting_stars | aurora`), `app/world/atmosphere.ts`, `app/world/renderer.ts` (instanced streaks around the player, an 80 ms lightning flash of the hemi light and sky), `app/world/sound.ts` (rain bed, delayed thunder), `server/utils/intent.ts` (rule 8 at L111 currently routes weather words to fog only).
- **Done looks like:** "make it rain", "make it snow" and "summon a thunderstorm" each visibly change the scene within 1.5 s, and the storm lights the world with a thunder roll. None of them answers "not yet".

**5. The world answers while you speak.** H / S. Half-built.
- **Files:** `app/composables/useIntent.ts` (call `world.renderer()?.anticipate(ctx.gaze.point)` next to `showGhost` in `build`), `app/composables/useRealtimeVoice.ts` (call it at VAD stop with the speech-start snapshot, and feed the mic level to the ghost ring while *hearing*), `app/world/fx/anticipate.ts`.
- **Done looks like:** in V1's 3 s define wait, a column of motes gathers where you looked from about 100 ms after you stop speaking, and the beam erupts out of it.

**6. Colossal tier: horizon anchor and terrain kit.** H / M.
- **Files:** a new `app/world/kit/terrain.ts` (mountain with displaced cones and snowcaps, hill, cliff, mesa; 40–200 m; rises from the ground), `shared/world/kinds.ts`, `shared/world/layout.ts` (`anchor: 'horizon'` 150–350 m out across 120° of view; `on_top`), `shared/world/ops.ts` (scale cap for terrain), `server/utils/intent.ts` ("on that hill" with no hill → hill, then castle `on_top`).
- **Done looks like:** from inside the city, "put a mountain range on the horizon" fills the skyline with no camera move. "Put a castle on that hill" makes the hill.

**7. Define placeholder and creature quality.** M–H / M.
- **Files:** `app/composables/useIntent.ts` (on a `define` stream start, spawn a shimmering silhouette at the gaze point; `server/utils/opStream.ts` could emit an early `{t:'defining', kind}`), `server/utils/intent.ts` (one creature worked example with neck, tail and wing parts; route creature defines to Sonnet), `app/world/parts.ts` (animated `glow`, `fire` and `water` materials).
- **Done looks like:** "a dragon" shows something forming in under 1.2 s, reads as a dragon at 20 m, and lands within 5 s.

**8. Glow and light vocabulary.** M / S.
- **Files:** `shared/world/ops.ts` (`set.glow` or emissive), `app/world/renderer.ts` (`applyLook`: emissive plus a sprite halo), kits (a real `lantern` kind with a warm point glow), `server/utils/intent.ts`.
- **Done looks like:** "make the trees glow gold" makes them luminous at night, not just yellow.

**9. Voice confirmations only claim what happened.** M / S.
- **Files:** `shared/voice.ts` (`VOICE_INSTRUCTIONS`: build the confirmation from the tool result's `result` and `notes`, never adding verbs like drift, fly, roar), `server/utils/intent.ts` rule 10 (forbid "Moved." when no move op was emitted).
- **Done looks like:** across 20 voice and text wishes, 0 lines claim motion or weather that didn't happen.

**10. 10× becomes "you shrink".** M / S.
- **Files:** `server/utils/intent.ts` (map `ref:'all'` scale ≥ 4 to a player-scale op), `app/world/renderer.ts` (lower eye height and walk speed, tween the FOV), `shared/world/ops.ts` (a `player` op or atmosphere `scale`).
- **Done looks like:** "make everything ten times bigger" leaves you ant-sized among towering trees, in a frame you'd screenshot. Undo restores you.

**11. "Around me" means 360°.** M / M.
- **Files:** `server/utils/director.ts` (the brief and placement guidance for "around me": blocks on all four sides), `shared/world/layout.ts` (an `around` ring anchor for streets).
- **Done looks like:** after "build a city around me", turning 180° shows city, not void.

**Suggested loop 3 bundle:** #1, #2, #5 and #9 first. They're all small, and they remove the self-inflicted awe-killers. Then #3 and #4 together: they flip the most common delighted-user wishes from "not yet" into the best moments.
