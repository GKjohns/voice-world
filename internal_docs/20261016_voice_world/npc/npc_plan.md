# People: the NPC feature (Oct 17, 2026)

**Ask (Kyle):** spawn people from one canonical character, adjusted only as needed. Each should be "almost like the perfect NPC": someone who remembers things, walks around, has behaviors and a daily routine, answers through an LLM, and can be interacted with. The north star is that talking to one feels like meeting someone alive.

**Branch:** `npc-people`, local only.

## Design

**One rig, many people.** `app/world/kit/people.ts` is a faceted low-poly humanoid with head, hair, torso, arms, hands and legs. Every joint hangs off a named pivot.
- It's dressed by a role preset: villager, fisherman (bucket hat, vest, rod when fishing), shopkeeper (apron, broom), child (smaller, bigger head), elder (stoop, cane, grey hair), guard (helmet, tabard, spear), wizard (cone hat, robe, staff with a glowing orb) or farmer (straw hat, straps).
- The entity id seeds the rest: skin, hair style and colour, height, build, beard. Gender is the same seed the name and voice come from, so "her" is never bearded.
- Geometry is shared by every person. Materials are per person (primary = shirt or robe, trim = trousers), and there are no lights.
- Poses are procedural: breathing, a walk/run cycle, head look-at, wave, bow, cheer, point (with the arm on the target's side), sit, dance, flinch, talk gestures with a moving mouth, and routine work (fish, sweep, read, cast, tend).

**In the op language.** I added a `person` kind plus a `dog` (the quadruped rig at dog size). Role words are rewritten in the kernel (`asPerson`, `shared/npc/people.ts`): "a fisherman", "some villagers", "a crowd", "an old woman" all become `person` with `props.role`.
- The kernel names everyone at birth. Names are seeded and unique, so replay gives the same names.
- Role and name are added to the tags, so `{kind:"fisherman"}` and `{kind:"mara"}` both select.
- New props: `role` (free text, mapped to the nearest preset), `name`, `persona` (the genie's hint, such as "knows everything about this lake") and `act` (wave | bow | cheer | dance | sit | follow | none). Every act stamps `actId` with the sentence seed, so "wave again" replays.
- The intent context lists people by name. The digest has a people rule and 9 worked examples.
- If you mention someone who doesn't exist ("make the fisherman wave"), the kernel conjures one already doing it.

**The mind.**
- **Persona.** On spawn, one Haiku call (`/api/npc/persona`) writes the persona: age, occupation, personality, speech, a backstory tied to the scene, a secret, and a 5–6 block routine whose places are kinds in the scene. To keep a crowd varied, each call gets a seeded temperament and age band plus the list of people already living there. Until the call lands (about 4 s, in the background), a seeded stand-in built from the role runs the person.
- **Memory.** Each person keeps their conversation turns, a rolling summary (Haiku folds the oldest turns in once there are more than 12), facts they chose to remember, and events they witnessed. Every wish you make becomes an event for everyone standing there, for example: `the stranger said "a thunderstorm" and a storm broke out of nowhere`. Memory persists in localStorage under `conjure:npc:v1`, keyed by id plus name.
- **Talking.** `/api/npc/talk` streams the spoken line as plain text first, then a `>> {"do":[…],"remember":…}` line. Actions are walk_to, follow, stay, wave, sit, stand, bow, cheer, dance, point, look_at and give (a kit item spawns in front of you; anything else goes through the builder) and remember. The prompt includes the scene from their point of view (`shared/npc/scene.ts`), the time slot, the weather, other people, what they're doing, and how their last replies began (to stop verbal tics repeating).

**Voice.**
- The genie keeps OpenAI realtime `cedar`.
- People use gateway speech `spacexai/grok-tts` (voices ara, eve, una, leo, rex, sal, picked from the seed by gender). A sentence takes about 0.65 s; `openai/tts-1` is the fallback, then browser `speechSynthesis` with per-person pitch and rate.
- The first sentence is voiced while the model is still writing the rest.
- Their words appear in a bubble by their head (`HudNpc.vue`). When they're off screen, it pins to the edge and says "behind you".

**Behaviour** (`app/world/npc/people.ts`, priorities in `shared/npc/behavior.ts`):
- **Priority order:** flee > genie-commanded dance/sit > talk > act (follow, their own sit/dance) > react > notice > routine.
- **Routine:** the world's coarse time maps to day slots (a "day" walks morning → midday → afternoon on a 50 s shared clock). Each slot's block resolves to a place: the nearest kind or tag, a person by name, or the nearest house as home. They walk to a stand point (the far end of a dock facing the water; just outside anything else) and do the activity. Asleep at home means they go inside.
- **Walking:** analytic ground (`shared/npc/ground.ts`). They stand on dock and floor decks (with a margin, so they're never half over the edge), never step into the lake, and steer around footprints. "The lake" as a place means its nearest shore.
- **Noticing:** come within 4 m and look at someone, and they turn to you. After 0.8 s they greet you, at most once every 90 s. If you've met before, they remember it.
- **Reacting:** dragons, big or sky arrivals and sky changes make them stop and look up, even mid-conversation. Thunder makes them flinch. Fire or a dragon landing within about 7 m sends them running.
- **Following:** they keep off your shoulder and run to catch up.
- **Leaving:** a conversation ends when you walk more than 9 m away (unless they're following you) or after 75 s of silence.

## The routing rule (genie or person)

One pure function serves typed text, the browser mic and realtime voice: `shared/npc/routing.ts` `routeUtterance`. In order:

1. Addressed to the genie ("genie, …", "…, genie") → genie.
2. A person addressed by name within 30 m ("Mara, …", "hey Tomas") → that person, unless the rest is a world command ("Mara, make it night" still goes to the genie).
3. A world command → genie, even mid-conversation. That means a build imperative (make, put, add, spawn, remove, undo, take me, turn the…, paint, give her/him/them…) or a bare scene or weather wish ("a thunderstorm", "night").
4. Otherwise it goes to a person in focus:
   - the one you're mid-conversation with (≤ 6 m, or ≤ 15 m if they're following you),
   - the one you're looking at (≤ 8 m),
   - anyone within 3 m,
   - or someone following you.
5. A greeting or hail ("hello", "hey you", "excuse me") with someone ≤ 15 m away → the nearest one, preferring whoever you're looking at.
6. Otherwise → genie.

**Why a client router rather than a `talk_to_person` realtime tool:** the realtime model can't see gaze or distance, so it can't know who's in focus, and a tool call would still leave the genie speaking after the tool result. The router uses a single deterministic rule for every input path, and it's tested.

**On voice:**
- If speech starts while someone is in focus, the genie's automatic reply is cancelled at `response-created`, before it speaks or calls a tool. The Whisper transcript is then routed.
- If it routes to the person, they answer.
- If it routes to the genie, the turn is handed back with `requestResponse()`. The realtime genie heard the audio itself, so it grants the wish with its own tools and voice, even when Whisper cut the transcript short ("Genie." for "Genie. Make it night.").
- Outside focus, a name or a hail takes the turn from the genie the same way.
- An echo guard drops transcripts that repeat a person's last line (speaker bleed).

## Measured (headless, real GPU, dev server)

- **Talk, typed:** across 28 replies, first spoken text appears at a median of **0.79 s** (p90 1.08 s), first audio plays at **1.62 s** (p90 2.07 s), and the whole reply finishes at 1.28 s.
- **Server-side Haiku:** first token in 0.64–0.81 s. Persona calls take about 4 s, in the background.
- **Talk, voice:** the transcript arrives 0.39–1.39 s after speech ends, then the person's first text follows 0.70–0.98 s later. Speech end to first audio is about 2–3 s. Whisper is the main cost.
- **Genie handback in focus** ("Genie. Make it night."): VAD to tool in 1.75 s, versus 0.26–0.56 s normally, because it waits for the transcript.
- **Intent bench:** Haiku 75/75, including 8 new people cases. Plain-edit median is 1.0 s.
- **Tests:** `npm test` 122/122 (22 new in `tests/npc.test.ts`). Typecheck and lint are clean.

## Files

- **New, shared** (pure; tested where it matters): `shared/npc/people.ts` (role words, presets, names, tags), `persona.ts` (persona and memory types, seeded stand-in, lenient parse), `reply.ts` (streamed line plus `>>` actions, voice cut points), `routine.ts` (slots, blocks, places, stand points), `routing.ts`, `behavior.ts`, `ground.ts`, `scene.ts`.
- **New, server:** `server/utils/npc.ts` (prompts, persona, streamTalk, summary, speech), `server/utils/npcKey.ts`, `server/api/npc/{persona,talk,summary,voice}.post.ts`.
- **New, client:** `app/world/kit/people.ts` (rig), `app/world/npc/people.ts` (runtime), `app/composables/useNpc.ts` (minds, talk, voice queue, router entry, persistence, `window.__conjureNpc`), `app/components/hud/HudNpc.vue` (bubble).
- **New, verification:** `tests/npc.test.ts`, `scripts/npc-shoot.mjs` (typed end to end), `scripts/npc-voice-shoot.mjs` plus `bench/fixtures/npc_session.wav` (voice pass).
- **Changed:**
  - `shared/world/{ops,kinds,state,context,honesty}.ts`: props, the person and dog kinds, naming and act cues, the people line, and "dance" now counts as honest.
  - `server/utils/intent.ts`: people rule and examples, plus a "never answer a wish with only a say" line that fixed a regression on the castle case.
  - `shared/voice.ts`: genie instructions and the build tool now cover people.
  - `useRealtimeVoice.ts` (voice routing), `useIntent.ts` (live person positions in the builder's scene; the mic routes), `HudPresence`/`HudIntent` (typed text routes), `renderer.ts` (`people()`, `toScreen`, `onFrame`, `onThunder`, `gazeNow`; people skip `moveItems`; the highlight follows live positions), `kit/creatures.ts` + `fx/motion.ts` (dog), `bench/intent.ts` (people scenes and cases).

## Deviations

- People's walking positions are runtime-only (on the stretch group, the way motion poses are). The world state keeps their spawn spot, and only a genie `move` changes it. This keeps the op log replayable.
- "Give her a dog" uses `at: { anchor: "gaze" }`, the live hit point on her, not `target of ref:gaze`, which would resolve to her spawn spot.
- The genie's acts are props, so they're undoable and replayed. A person's own decisions from conversation (follow, sit, walk_to) stay runtime-only. A person can talk their way out of a genie act ("I'll stay here") until the next cue.
- Personas are eager only for batches of up to 4 people. A crowd's personas load when you come within 16 m or talk to someone.

## Known gaps

- **Voice latency:** Whisper transcription (0.4–1.4 s) dominates the speech-to-reply time. A streaming transcriber or the realtime model's own turn would cut about 1 s. TTS isn't streamed, so first audio is about 0.8 s after the first text.
- **Placement next to a person** ("a bench next to Mara") uses their spawn spot, because selectors read the world state, not live positions.
- **Verbal tics:** a persona whose speech style names a habit ("says sorry a lot") still overuses it. The "began differently" hint helps but doesn't cure it.
- **Routine places** are resolved crudely, with no pathfinding. Someone whose route crosses the lake stalls at the shore and picks the next goal.
- **Sound** (the voices' loudness against the ambience) hasn't been listened to by a person. Echo cancellation against person TTS on real speakers is untested; the echo guard is the only defence.
- **Undo:** after an undo, a reused id with a different name gets a fresh mind, by design. Minds of removed people stay in storage (the 60 most recently spoken to).

Screenshots: `build/` (webp): fisherman on the dock, a greeting bubble, the whole town waving, dancing, "give her a dog", and a voice conversation. `build/npc_timings.json` holds the last typed run's timings and log.

## Final cleanup (Oct 17, 2026)

Bugs only; no new behaviour.

**Fixed:**
- **Removing a person mid-reply** (undo, remove, or a teleport that replaces the world): their reply kept streaming and their voice kept playing, the bubble hung for up to 14 s, and `busy` stayed set to the removed id, which blocked greetings and idle banter until someone else was spoken to. `useNpc` `forget()` now runs on every world change. It aborts the talk, stops the voice, clears the bubble, `busy` and `speakingId`, and ends the conversation. Banter involving the removed person is stopped, and the echo guard forgets their last line. Their mind stays in storage, so a redo brings them back.
- **Duplicate world watcher:** `attach()` registered a `watch(world.state)` that `detach()` never stopped. On a remount (HMR, or a route back to the scene), every wish was witnessed twice, which doubled the wish-shout banter calls. The watcher is now stopped on detach, and detach also clears the conversation and bubble state.
- **Blob-URL leak in the voice queue:** lines that were fetched but never played after a barge-in (and the line playing when it was cut off) never had their object URLs revoked. A `release()` helper now detaches the element first and then revokes, which avoids an `ERR_FILE_NOT_FOUND` console error.
- **Two people on one bench spot:** a routine stand point that another person is already heading for (within 0.75 m) is re-jittered, up to 5 tries (`People.freeStandPoint`).
- **"two guys playing pool at the far table" was answered with only a say:** I added one worked example to the intent digest, plus the bench case `people: two guys playing pool` with a `poolHall` scene.
- **Echo-question openers:** the persona writer's `speech` field now forbids the "answers questions with questions, repeats what was said" habit at the source.

**Checks:**
- `npm test`: 132/132. Typecheck and lint are clean.
- Intent bench, Haiku: 76/76 ($0.03).
- Headless smoke on the real GPU covered:
  1. spawn three people through the genie
  2. a greeting, then a typed talk
  3. undo the speaker while their reply is still pending: the bubble, the conversation and `busy` all clear, with no late reply
  4. talk to another person
  5. "take me to a quiet beach": everything clears, and there were 0 console errors

**Still known (not fixed, out of scope):**
- The voice split-wish still uses a fixed 3.5 s delay.
- There's no pathfinding across water.
- Placement next to a person uses their spawn spot.
- Mood overwrite and the simple faces are unchanged.
- Names recur across worlds.
- The `casts` map and in-session `minds` grow with every person spawned in a session. They're small, and storage keeps only 60.
- `VoiceQueue.stop()` calls `speechSynthesis.cancel()`, which also cuts the other channel's browser-fallback voice. That only matters when gateway TTS is down.

## Calm mode (Oct 17, 2026)

**Ask (Kyle):** keep most of it, but don't have people come up and talk to you and crowd you. They stand there, do what you ask, and aren't so proactive; people shouldn't be the whole game, just clearly a little smarter than you'd expect.

**Turned off (and removed, not flagged):**
- **Greetings and noticing.** The `notice` mode, `shouldGreet`, the `onNotice` hook, the `greet` talk mode (client, `/api/npc/talk`, prompt) and `lastGreetAt` are gone. People never speak first. Stand within 3.5 m (`GLANCE_RANGE`) and look at someone for 0.6 s and they glance at you, head only; they keep doing what they were doing. The old periodic "glance at you within 12 m" is gone too.
- **Idle banter and chiming in.** `idleBanter`, the `chime` path, `People.chat` and `chatWith` are gone, as are `banterNow`/`setChime` on `window.__conjureNpc`. Bystanders still *overhear* your conversation (a memory line), but never reply to it.
- **Wish chorus.** `wishBark` (up to three people shouting) became `wishLine`: only a startling or scary spawn (dragon, whale, monster, volcano and so on) draws one line of 2–8 words from the nearest bystander within 12 m, at most once every 90 s, and never while you're in a conversation or a reply is streaming. Everyone still stops and looks (`People.witness`). `/api/npc/banter` now takes one speaker and writes one line.

**Gentler days:** routine places resolve only within 6 m of where the genie put them (`ROUTINE_RANGE`; home within 12 m). Anything further is done where they stand. Pottering is 2.5 m (`POTTER_RADIUS`), lingering is 18–40 s (`LINGER_S`), their own errands are at a stroll, and pottering never ends within 2 m of you.

**Sharper when engaged:** replies are one or two sentences, 20 words at most, answer first, with one concrete detail they would notice or remember. There are no catchphrases, and they only ask back when they need to. The examples are rewritten in that register. Asked to come along, go or wait somewhere, sit or show you something, they agree briefly and do it, without stalling ("give me a minute"). They don't offer to tag along unasked.

**Kept:** talking when addressed, follow/walk_to/sit/give/point, memory and overhearing, personas and casts, moods, flee and react, genie commands over people, the routing rule, and the follower's "heading back" line.

**Checks:**
- `npm test`: 133/133 (the behaviour test now asserts that standing close stays `routine`; a new test covers the routine range and the one-line wish prompt). Typecheck and lint are clean.
- Intent bench: Haiku 76/76 and Sonnet 76/76 (unchanged; intent wasn't touched).
- Smoke: `scripts/npc-calm-shoot.mjs --gpu` (new). It spawns three villagers, stands 2 m from them looking for 20 s, talks, asks one to follow and one to wait by the well, then makes a dragon.
  - Across 7 runs, there was no unprompted speech in any 20 s window: 0 talk, voice or banter calls and no bubbles.
  - Before `PERSONAL_SPACE`, one run had a person potter to 0.7 m.
  - Before the compliance wording, follow requests were refused in 2 of 4 runs. After it, follow and walk_to were obeyed in 3 of 3 runs. One walk had a 9 s timeout before it was raised to 12 s.
  - The dragon drew 0 or 1 line per run, for example "Hm. Dragon. Didn't need that today."
- `scripts/npc-shoot.mjs` now says hello instead of waiting for a greeting.

**Still known:** Haiku sometimes opens with a persona's filler ("Mm."). Everyone in a fresh hamlet tends to share the same routine theme (the cast writes it). Mid-conversation, a bare creature wish like "a dragon circling overhead" goes to the person you're talking to, because the unchanged routing rule only treats imperatives and sky or weather words as world commands; "make a dragon…" goes to the genie.
