# People, loop 1: a fresh-eyes evaluation (Oct 17, 2026)

**Lens:** Kyle's ask was "the perfect NPC, like a real person that remembers stuff... walks around, has behaviors, maybe a routine like a normal person." The north star for people is that meeting someone should feel like meeting someone alive.

**How it was played:** headless Chromium on the real GPU (`--use-angle=metal`) against the running dev server at :3091, branch `npc-people`, commit `d99f92d`. There were three typed scenes, each driven through the real text field, so every line went through `routeUtterance`:
- **Lake at dawn:** a fisherman, an old woman and a kid, all spawned by typing to the genie.
- **Town street:** a shopkeeper, a guard and a 12-person crowd.
- **Pool hall interior:** a bartender and "two guys playing pool". This scene included a **page reload**.

Then one voice pass with `scripts/npc-voice-shoot.mjs --gpu` and its fixture. A pure routing probe ran 30 phrases through `shared/npc/routing.ts`.
- **Volume:** 54 person replies, about 30 personas, about 25 genie intents and roughly 50 s of realtime voice.
- **Spend:** an estimated **$0.5**.
- **Scripts and logs:** in the session scratchpad under `npc/` (`lib.mjs`, `lake.mjs`, `town.mjs`, `pool.mjs`, `route_probe.mjs`, `*.log`).
- **Screenshots:** `npc/loop1/` (26 webp files).

## Verdict

**Feels alive: 5.5 / 10.** One-on-one, these people are often very good. After a page reload, Ezra the bartender greeted me with *"Kyle, back again. ... Your world-building done for the day?"*, and when I asked what had happened to the pool table, he said *"You made it glow like lava, Kyle. Felt went orange, the balls started humming. Gave me a turn."* That is a real "oh" moment. The personas are specific and give up their secrets when asked. They reference each other (the kid Edith was "raised by Pia at the dock"), and they correctly refuse things that aren't there ("Lighthouse? Not out here, Kyle. That's the mountain range").

What keeps it from feeling alive is everything **between** conversations:
- **Nobody talks to anybody but you.** A dragon landed in a crowded street and twelve people fled in total silence.
- **Commanded acts never end.** The kid "playing by the campfire" danced for over three minutes, through a storm and a dragon, and the old woman never left the bench.
- **Routing misfires on ordinary speech.** It sent a question *about* Mara *to* Mara and ended the conversation I was in. It sent "show me your favorite spot" to the Director, which **teleported me out of the world I had built**.
- **Every person sounds like the same writer.** 19 of 46 replies say "stranger", and 23 of 46 open by echoing my word back as a question ("Lighthouse?", "Dance?", "Fishing? In this?").

## Scores

| Dimension | Score | Evidence |
|---|---|---|
| Personality depth and consistency | **7** | Personas are concrete, with a secret, a backstory tied to the place and cross-references ("Gideon still owes her three rounds"; Gideon's own persona agrees). Voice holds across a session. But: crowds collapse into one job (7 of 12 villagers were **lamplighters**), the seeded temperament repeats across worlds ("Maeve, retired stage actress" appeared in two worlds), and the prompt's own examples leak "lake/dock/ferry" into a pool hall and a town. |
| Memory accuracy | **7.5** | Recalled my name and four earlier topics on request, and survived a full page reload with the right details. But it conflates: Maeve claimed the dragon "nearly tore my dock off its posts" (the dock was turned to lava; the dragon never touched it), and said the storm had been "trying to take my hat since dawn" (it had just started, and that line is the prompt's own example). There is no shared knowledge: the guard invented *"Hilde told me you're new and asking questions"*. |
| Grounding in the scene | **6** | Good with what's in the scene list: other people by name and activity, the boat, the reeds, the jukebox, time of day ("the clock says midday"). Bad at the edges: Maeve **narrated a wish before it happened** ("Look at that, the felt's going orange", because the wish was routed to her). The shopkeeper said "I don't know any Ines" about the guard 6 m away (the scene lists only the nearest 6 people). Distances leak as metres ("Maeve's over there by the lamp, three metres off"). |
| Conversational naturalness | **6** | Spoken-length lines (median 33 words, max 54, so over the prompt's 40-word cap). Some lines land beautifully. Tics dominate: "stranger" in 41% of lines, even after they know your name. An echo-question opener on 50%. A shy man opened all 3 lines with "...". The guard referred to herself in the third person ("Ines is not ready for dragons"). |
| Reactions and body language | **5** | Flee works: a landed dragon scattered the street ([town_05](loop1/town_05_dragon_lands_town.webp)). Storm and dragon trigger a "staring up" react, and look_at/point are used on almost every line. But reactions are silent. Commanded sit/dance overrides react and flee: the kid kept dancing under the dragon ([lake2_09](loop1/lake2_09_kid.webp)). Faces have no expression, and "give" works (tinned peaches appeared at my feet, [town_03](loop1/town_03_shop_talk.webp)). |
| Routine believability | **5** | Town: genuinely nice. Slots advance every 50 s, people walk to the bench, the shop and the oak with matching activity text, form a lunch rush at the storefront at midday, and go home at night. Lake: dead, because every person spawned with a lasting act (sit, dance) or was asked to follow, and none of those ever expire. Two people sat on the same bench spot (4.04, 0.21 and 4.08, 0.68). Nobody actually plays pool (Gideon's "lines up shots" used the `cast` activity, the wizard pose). |
| Visual look | **5.5** | The crowd reads as a lively, varied street ([town_02](loop1/town_02_crowd_closer.webp)), and the hats, apron and bubbles are charming. Up close it's a mannequin ([closeup](loop1/closeup_fisherman_rig.webp)): a stiff A-pose and a blank face. Pale skin with a black triangle beard reads like a mask. The guard's spear sticks out horizontally ([town_07](loop1/town_07_routine_later.webp)), and the apron is a flat white board. A 74-year-old villager looks 25, because age only shows for `role: elder`. "Two guys" spawned a woman. |
| Latency | **8** | First text arrived at a median of **0.77 s** (p90 1.15 s, n = 54), and first audio at 1.5–1.9 s. Voice: transcript 0.6–1.4 s after speech end, then the first text 0.6–1.1 s later. One outlier: 5.7 s ("Gideon, is that true?"). Personas take about 4 s, in the background. |
| Routing correctness | **4** | Genie commands while facing someone ("a thunderstorm", "make a dragon fly around us", "turn the dock into lava") were all correct, and "Hey you!" in a crowd picked someone. But 5 classes of misroute (below). One of them destroyed the world, and the voice genie hand-off failed on the fixture. |
| Bugs and console | **7** | No page errors in any run. Bugs found: `walk_to "maeve the villager"` fails because the model copies the scene label; following never ends, so the walk-away and return-greeting path never fires; a walk-up greeting doesn't fire when the person is walking (gaze breaks as they move); one dropped op warning (mine). |
| People ↔ people | **1** | Absent. The `chat` activity is a pose. No NPC ever says a word to another, or overhears you talking to their neighbour 2 m away: "Maeve, do you agree with that?" got *"Agree with what, darling?"*. |
| **Overall "feels alive"** | **5.5** | Great one-on-one memory and voice, but a silent, frozen or monotone world around it. |

## What went wrong, with transcripts

### 1. Routing: five ways a normal sentence goes to the wrong ear

**a) Talking *about* someone goes *to* them.** The tail-name match in `addressed()` treats any name at the end as a vocative.
```
(mid-conversation with Pia, looking at her; Mara is 8 m away)
YOU → addressed Mara: "What do you think of Mara?"
  Mara: Oh, darling, you're asking the old bench-sitter her own opinion of herself? Brave of you...
  [npc] conversation with Pia ended (talked to someone else)
YOU → addressed Hilde: "Can you introduce me to Hilde?"         (said to Maeve)
  Hilde: Hilde's the one with the rope, you mean? Fine. Name's Hilde.
YOU → addressed Maeve: "Hello. Do you know Maeve?"              (said while facing Wren)
  Maeve: Maeve? That's me, stranger.
```
**b) Conversational idioms that start with a genie verb.** The probe sent all of these to the genie, even mid-conversation: "Take me to your favorite spot", "Fill me in on the gossip", "Make yourself comfortable", "Put your rod down", "Light up your pipe", "Remove your hat", "Raise your hand", "Let it go", "Set the table", "Change the subject…".
```
YOU → GENIE: "Fill me in on the town gossip."   → modify {kind:"hilde"} act: wave
```
**c) Once the conversation drops (after a misroute), a "your" question becomes a teleport.**
```
YOU → GENIE (no one is being spoken to): "Can you show me your favorite spot?"
  → {"op":"teleport","world":"favorite spot", ...}      ← the whole lake, its 3 people and their minds are gone
```
**d) A wish after a lead-in goes to the person, and the person fakes it.**
```
YOU → Maeve: "Let me show you something. Make the pool table glow like lava."
  Maeve: Lava? Now that's a wish with some heat in it, stranger. Look at that, the felt's going orange
         and the lamps are catching it.                            ← nothing had happened
```
**e) Voice: "Genie, make it night" became "Jeannie. May."** It went to the fisherman mid-conversation, night never came (0 tool calls), and he took it as my name:
```
heard "Jeannie. May." → person (mid-conversation with Tomas)
  Tomas: Jeannie, May. Good names, both of them. Friend, you've got a name worth keeping, so I'll stop calling you that now.
```
The plan says this case worked. With this fixture it didn't, because the realtime hand-back only happens if the Whisper text routes to the genie ([voice_after_genie_misroute](loop1/voice_after_genie_misroute.webp)).

### 2. One writer behind every face (prompt leaks and tics)

- **"stranger":** the prompts call the player "the stranger" 18 times, and the persona schema asks "what they call strangers". So every persona's speech habit is a stranger-address, and it survives learning your name: *"Your name's Kyle, stranger."*
- **The echo opener:** 23 of 46 replies open this way. *"Lighthouse? Not out here, Kyle." / "Favourite spot? Hm." / "Okay? Ha," / "Sorry? Ha." / "Miss you? Stranger," / "Fishing? In this?" / "Dance? Stranger,"*. `openings()` only bans the first three words, so the pattern survives.
- **The prompt example leaks verbatim:** "That storm nearly took my hat clean off" became *"this storm's been trying to take my hat since dawn"*.
- **The persona prompt seeds a lake into every world:** "name real things in the scene: the dock, the lake, the houses" and "A fisherman fishes at the dock". Results:
  - Pool hall: the bartender "took over the hall after the lake froze… keeps the old dock lamps lit", and both pool players are "retired ferry pilots".
  - Town: the shopkeeper sells bait and has "my uncle's old tide chart… if you're headed for the lake".
- **Metres:** *"Maeve's over there by the lamp, three metres off."* The scene lines give distances in metres, and the model reads them aloud.

### 3. A frozen world: acts that never end

```
"a little kid playing by the campfire" → act: dance
routine t+12s … t+48s:  Hilde act "dancing" | Wren act "sitting down" | Maeve act "following the stranger"
```
The kid danced through the storm, the dragon and nightfall. Wren never left the bench, and at night nobody went home. Maeve followed me for more than 3 minutes after the conversation was over. Her "walked away" never fired, so her return greeting never happened.

### 4. No shared world knowledge

```
(Town, 14 people; Ines the guard is on the road nearby)
YOU → Hilde: "What's Ines like?"
  Hilde: Ines? I don't know any Ines, stranger. Is she from the lake side…
YOU → Ines: "Did Hilde just tell you anything about me?"
  Ines: Oh, um, a bit, yes. Nothing bad, I promise, just that you're new and asking questions.   ← never happened
```
Personas in a batch are generated in parallel, so "others" doesn't include the people spawned with them, and the scene lists only the nearest 6. Hence a crowd of lamplighters who don't know each other.

### 5. Wish events too vague to remember correctly

"turn the dock into lava" was stored as `the stranger said "turn the dock into lava" and 1 thing changed before your eyes`. The model then filled in the gap: *"The dock's had worse than a dragon's tail… planks will dry out."* The modify only recoloured the dock orange with a glow. It got no `lava` tag, so nobody fled from the "lava" dock either.

### What's genuinely good (keep it)

- **Memory across a reload** (Ezra above), and accurate recall on request: *"Your name's Kyle. You asked me about Wren, what's biting, who lives out here, and whether you could see my favourite spot. Took you to the bench, didn't I."*
- **Secrets on request:** *"I've been saving up for the cabin by the bench, Kyle. Want out of this cold lake for good. Don't tell Wren."*
- **Grounded neighbour gossip:** *"Hilde's over there dancing like she's got nowhere else to be, and Wren's parked on the bench, pretending she isn't watching us."*
- **Personality:** in character and in context. A kid refused fishing because of the storm: *"Fishing? In this? Thunder's still rolling over the water and you've got a dragon circling the sky. You'd be the one I'm pulling out of the lake."*
- **Actions do what they say:** "show me your favorite spot" gave walk_to bench plus follow; "dance with me" gave dance; "can I buy something" gave tinned peaches at my feet.
- **The town's day:** slots advance, there's a midday rush at the shop, and everyone heads home at night.
- **Bubbles:** the "behind you" edge-pinned bubble works ([lake2_05](loop1/lake2_05_dragon_reaction.webp)).

## Top changes, ranked by "holy shit" / aliveness

1. **Let people talk to each other: banter, barks, overhearing.** This is the holy-shit moment that's missing. You summon a dragon, and the street erupts: "Ines! Do something!" / "I'm a *night* guard, Hilde!". Then they argue about you.
   - **Wish barks:** after a wish event (`useNpc.ts`, where `wishEvent` is recorded), take the 1–3 people nearest the player within 15 m and make one Haiku call to a new `/api/npc/banter` endpoint. It returns `[{who, line, act}]` (a gasp, a shout, a joke at a neighbour), and each line plays through the existing voice queue and bubble.
   - **Idle banter:** when two people share a `chat` or same-place block within 3 m and the player is within 12 m (and at most once every 30–40 s), the same endpoint writes a 2–4 line exchange from both personas, the time slot and recent events.
   - **Memory:** every line is added to both participants' memory as an event ("Hilde told Ines the stranger asked about her"), and to the memory of anyone within 5 m when *you* speak. This also fixes "Agree with what, darling?". Files: `server/utils/npc.ts` (new `banterPrompt`), `server/api/npc/banter.post.ts`, `app/composables/useNpc.ts` (scheduler plus the overhear event in `talk()`).
2. **Fix routing on ordinary speech** (`shared/npc/routing.ts`; add the transcripts above as tests in `tests/npc.test.ts`).
   - (a) A tail name counts as a vocative only after a comma or at a pause ("…, Mara?"). Never after a preposition or verb object (`of|to|about|know|meet|introduce me to|with|and`).
   - (b) When a conversation is open, drop the COMMAND match for idioms whose object is the person or the player ("your …", "yourself", "me in", "me to your") and for a fixed idiom list ("fill me in", "let it go", "make yourself", "set the table", "change the subject").
   - (c) Never let a mid-conversation utterance teleport. Route "take me to your/their X" to the person as walk_to.
   - (d) Split multi-sentence input. If any sentence is a world command, send that sentence to the genie and the rest to the person, who then reacts to the real event.
   - (e) Voice: fuzzy-match the genie name (`jeannie|jinny|gene|jean|djinn|genie's`) in `GENIE` and `GENIE_TAIL`. In `useRealtimeVoice.ts`, when the transcript is very short (≤ 3 words) mid-conversation, hand the turn back to the realtime genie first.
3. **Remove the prompt leaks that make everyone one writer** (`server/utils/npc.ts`, `shared/npc/scene.ts`).
   - Replace "the dock, the lake, the houses" and "A fisherman fishes at the dock" in `personaPrompt` with the scene's own top kinds.
   - Swap the HOW example for a neutral one, and rotate 3 examples by seed.
   - Once a name is known (a fact or `met > 0` with a name), write the player as that name throughout `talkPrompt`, not "the stranger". Remove "what they call strangers" from the persona `speech` field.
   - Extend `openings()`: if 2 of the last 3 replies began with "<word>?", add "Do not open by echoing their words back as a question."
   - In `npcScene`, turn metres into words ("right beside you", "a few steps away", "across the street").
   - Lower the cap to 30 words and enforce it by trimming at a sentence boundary in `parseReply` (`shared/npc/reply.ts`).
4. **Make acts end and let the routine take over** (`app/world/npc/people.ts`, `shared/npc/behavior.ts`).
   - Spawn-time `act: dance|sit` gets an `actUntil` (dance 15–25 s; sit until the next slot), then `suppressAct = true`.
   - `commanded` drops below `flee` *and* `react`, so a dancer stops for a dragon.
   - A follower ends `following` after 60 s with no talk, or at > 20 m, with a line ("I'll head back to the dock").
   - Pause a walking person when the player stops within 4 m and looks, so a walk-up greeting actually fires. Today `lookedFor` resets as they walk off.
5. **Shared world knowledge for crowds** (`app/composables/useNpc.ts` `ensurePersona` / `othersOf`, `shared/npc/scene.ts`).
   - Generate a batch's personas in one call, or sequentially, so each sees the others ("12 villagers, give them 12 different jobs and 3 relationships"). That ends the 7-of-12-lamplighters crowd.
   - In the scene's "other people", always include anyone named in this person's backstory or routine, plus anyone the player mentioned this conversation, then the nearest 6.
   - Add a rule: "Never claim someone told you something unless it's in your memory."
6. **Make wish events say what actually happened, and forbid narrating unseen wishes** (`useNpc.ts` ~L205–213 and `shared/npc/scene.ts` `wishEvent`).
   - Name the changed kinds and the change: color/glow gives "the dock turned glowing orange like lava", scale gives "grew huge", motion gives "began to fly".
   - Add relative time ("just now", "a little while ago") so nothing becomes "since dawn".
   - In HOW, add "only describe a wish that appears in what you've seen".
   - Tag lava-like modifies (`glow` plus a lava or fire label) so SCARY flee applies.
7. **Faces and mood** (`shared/npc/reply.ts`, `server/utils/npc.ts` HOW, `app/world/kit/people.ts`).
   - Add `"mood": "happy|afraid|annoyed|sad|curious|amused"` to the `>>` JSON, driving brows (two small boxes), mouth shape and posture (shoulders up when afraid, hands on hips when annoyed).
   - Add a startled gasp pose on react.
   - Today every face is the same blank mask, so a scared or delighted line has no visible counterpart.
8. **Rig and role fidelity** (`app/world/kit/people.ts`, `shared/npc/people.ts` `asPerson`).
   - Persona age ≥ 60 gets grey hair and a slight stoop whatever the role, and the age band gets rerolled to match.
   - Respect gendered words ("two guys", "a woman") in the person props.
   - Hold the guard's spear vertical, shape the apron, and soften or tint the triangle beard on pale skin.
   - Add `play` (pool cue / cards) and `serve` (wipe the counter) activities, so a pool hall's people actually play pool instead of using the wizard `cast` pose.
   - Strip " the <role>" from walk_to targets in `walkTo` / `resolvePlace`; the bug was `no "maeve the villager" to walk to`. Make "introduce me to X" a walk_to X plus X greeting you with the introduction as context.

## Smaller notes

- Seeded names and temperaments come from the entity id, and ids restart after `clear()`, so Maeve, Mara, Pia, Hilde and Gideon recur in every world, often with the same archetype. Salt the seed with the world or place label.
- One talk took 5.7 s to first text; the rest were under 1.4 s. Worth a retry-on-slow, or a filler ("Hm—").
- The lake scene with a `mountain_range` 90 m ahead put snowy peaks right in the camera's face ([lake2_05](loop1/lake2_05_dragon_reaction.webp)). That's not people-related, but it ruined that scene's framing.
- Audio played for the voice pass, with first audio 1.5–1.9 s after text. Loudness against the ambience is still unheard by a person.
