# People, loop 1: what changed (Oct 17, 2026)

This loop works through the top 8 items in [`loop1_eval.md`](loop1_eval.md), which scored the feature 5.5/10 for feeling alive, 1 for people talking to each other and 4 for routing. Items 1–6 landed in full. Items 7 and 8 landed in a simpler form, and the gaps are listed at the end.

**Verification:**
- Headless Chromium on the real GPU against the dev server at :3091, typed through the real text field, so every line went through `routeUtterance`.
- Five scripted runs: town (banter, chime-ins, wish shouts, acts, night), lake (prompt leaks, follow, lava, split wishes, genie names), pool hall (gender, cast ties, follow ending), routing, and faces.
- The scripts and logs are in the session scratchpad under `npc/after/`.
- Screenshots are in [`loop1_after/`](loop1_after/).

## What changed

### 1. People talk to each other
- **New endpoint `POST /api/npc/banter`** (`server/utils/npc.ts`: `banterPrompt` and `generateBanter`; parsed by `shared/npc/reply.ts` `parseBanter`). It is one Haiku call, JSON in text, and has three kinds:
  - **wish:** the 1–3 people nearest the player (within 15 m) react to a wish about 0.9 s after it lands. They shout at each other by name, gasp, or turn on you.
  - **idle:** two settled people standing within 3.6 m of each other, with the player within 12 m, pass the time in 2–4 lines. They stop walking and face each other (`People.chat`).
  - **chime:** after you talk to someone, a bystander within 4.5 m sometimes adds a line about what was just said.
- **Overhearing:** anyone within 5 m of you keeps an `overheard …` memory of your line and the answer.
- **Shared memory:** every banter line goes into the memory of everyone within 6 m of the speaker (`Hilde said to Ines: "…"`). So "she told me" is true when it happens, and the prompts forbid claiming it otherwise.
- **Display:** a second, dimmer bubble channel (`<HudNpc side />`, `sideBubble`) and a separate voice queue, so banter never covers your own conversation. Speaking to anyone cuts banter off.
- **Cost bounds:**
  - idle banter at most once per 35 s, and only with ready personas, at least 8 s after spawn, and within earshot
  - wish shouts at most once per 6 s
  - chime-ins at most once per 45 s, with probability 0.3
  - each call costs about $0.0003

### 2. Routing on ordinary speech (`shared/npc/routing.ts`, plus 4 new test groups)
- **Talking about someone:** a name counts as addressed only at the start ("Mara, …") or as a tail vocative after a comma ("…, Mara?"), and never after an object word (of, to, about, know, meet…). "What do you think of Mara?" stays with whoever you're talking to.
- **Asking about someone when nobody is in focus:** "what's Mara up to?" goes to a neighbour, never to the genie.
- **Idioms said to a person in focus stay with them** ("fill me in", "make yourself…", "let it go", "set the table", "change the subject"). So do genie verbs whose object is "your…" ("put your rod down", "remove your hat"), unless the sentence is plainly magic ("make your hat glow", "turn your rod into gold").
- **"Take/show/bring me to your/his/her/their…" is a walk, never a teleport.** With nobody in focus but someone within 8 m, a "your" question goes to them.
- **Facing someone else and speaking now talks to them,** even mid-conversation. Before, the open conversation won.
- **A wish wrapped in talk is split:** "Let me show you something. Make the table glow." sends the wish to the genie, and the rest goes to the person once it's granted. It works in the typed path and in voice (after a 3.5 s delay).
- **Fuzzy genie names for voice:** jeannie, jeanie, jeanne, jinny, gene, jean, genie's, djinni and similar. A person who is really called Gene wins over the fuzzy form. `isGenieHail` replaces the voice code's own regex.

### 3. Prompt leaks
- **No seeded lake:** the persona prompt no longer says "the dock, the lake" or "a fisherman fishes at the dock". It says only things listed exist, and never to invent a lake, sea, dock or river. The cast prompt has the same rule.
- **Examples:** the talk example is now one of three neutral examples, picked per person, with no storm and no hat.
- **"Stranger" is gone:** the player is "the visitor" in the prompts. Once a person knows your name (from their facts or summary, via `playerNameOf`), the prompt uses that name, and "stranger" by habit is banned. The persona `speech` field no longer asks how they address people.
- **Echo openers:** HOW forbids them ("Lighthouse?", "Gossip, is it?") and there's a reminder right before `You:`. `openings()` also names the specific repeat: an echo, "...", or the same first word twice ("Mm").
- **Distances:** distances are words (`howFar`: "a few steps away", "a short walk off"), and HOW bans numbers and metres.
- **Length:** spoken lines are capped at about 34 words at a sentence end (`capSpoken`, also applied while streaming).
- **The scene digest** lists the nearest 8 people plus anyone named in this person's ties, backstory or recent turns, plus a "(and N more people about)" count.
- **Seeding:** temperament and age nudges are salted with the name and place, so a reused id in a new world is someone new.

### 4. Acts end (`app/world/npc/people.ts`, `shared/npc/behavior.ts`)
- **Genie acts time out:** the genie's dance lasts 15–25 s and sit 35–50 s (`ACT_SECONDS`), then the routine takes over. A person's own sit or dance also times out. A person who was already sitting or dancing when the page loads no longer stays that way forever.
- **Reactions win:** a commanded act now ranks below flee and react, so a dancer stops for a dragon.
- **Following ends:** a follower stops after 60 s without a word from you, or when they're more than 20 m behind. They say a line on the side channel ("Well, I've things to do. Back to the pool I go."), wave, and the conversation ends. `People.touch` is called only on real talk.
- **Walk-up greetings:** someone walking past is noticed in a looser view cone, so a walk-up greeting fires.
- **Nights:** the routine prompt says night is for sleeping at home unless the job says otherwise, and a "make it night" wish triggers the shouts.

### 5. A crowd is cast as a group
- **New endpoint `POST /api/npc/cast`.** Any batch of 2 or more people gets one call that sees the whole group plus the people already living there. It gives each person a different job, spread ages and temperaments, and 2–6 ties that appear on both sides (siblings, debts, rivals, confidants).
- **Persona calls build on the cast:** each person's persona call waits for their entry. The cast's age, occupation and ties win, and `Persona.ties` feeds the talk prompt ("Your people here: …") and banter.
- **"Others" now includes ties**, so a single new person can know the residents.

### 6. Wish events say what happened
- **Concrete changes:** `describeChange` diffs every modified entity: colour (named from hex), material, glow, size, motion, text, act, moved, lit. `wishEvent` groups them into something like `Kyle said "Turn the dock into lava." and the dock turned orange and began to glow`.
- **Named spawns:** people who appear are named ("a child called Tova appeared"), and removed things are named.
- **Relative time:** memory events carry it ("just now", "a minute or two ago"), so a storm that just began is never one "since dawn".
- **Only seen wishes:** HOW says to only talk about wishes in "what you've seen happen", and to wait and see when a wish is only announced.
- **Lava is scary:** a fiery-worded wish that turns something glowing orange makes nearby people flee or stare (`witness(…, scaryAt)`).

### 7. Mood (simple)
- **Where it comes from:** `"mood"` in the `>>` JSON (happy, amused, curious, afraid, annoyed, sad, calm, with aliases) and on banter lines. Flee, startle and scare events set it automatically.
- **The face:** brows angle and lift, eyes widen for fright or squint when amused, and the mouth swaps between a smile arc, a frown arc, an open "o" and the talking box.
- **Posture:** a hunch when afraid or sad, arms folded when annoyed, a head tilt when curious. Mood fades after 6–10 s.

### 8. Rig and role fidelity (partial)
- **Gender from the request:** a new `gender` prop. `genderOfWords` reads the sentence in the kernel (`genderFromLabel`, stored in the logged ops so replay agrees) and person words ("old_woman", "guy"). Names, and therefore the rig and the voice, follow it. "two guys" gave Silas and Gideon, both `m`.
- **Visible age:** once the persona is ready, age 60+ greys hair and brows and adds a stoop, and age under 13 shrinks the body for a non-child role (`setAge`).
- **Held poles** (spear, staff, cane) stay upright through the grip pivot.
- **Small rig changes:** a rounded chin beard replaces the black triangle, the apron is a tapered front panel, eyes are matte (firelight made them glow), and elder women are never bald.
- **New activities:** `play` (a cue drawn back and forth over the table) and `serve` (wiping the counter). Both stay put. A routine place that names part of a compound kind now finds it ("pool" → `pool_table`, "counter" → `bar_counter`). Before, it fell back to wandering.
- **walk_to by name:** `cleanTarget` turns "maeve the villager" into "maeve".
- **Fixes from a screenshot review:** the brow sign was swapped (annoyed read as worried), the spear tip floated above the shaft, and the apron sat sideways. A side bubble now hops above the main bubble instead of overlapping it.

## Measured

| | Loop 1 eval | Now |
|---|---|---|
| People talking to each other | none | wish shouts every time a wish lands near people; idle banter and chime-ins fire on schedule (town: 2 idle, 1 chime, 4 wish exchanges) |
| "stranger" in replies | 19/46 (41%) | **0/30** |
| Echo-question openers | 23/46 (50%) | about 7/30 (23%), counting "X, is it?". Most come from one persona habit per run |
| Metres spoken | yes | **0/30** |
| Lake or dock words in a non-lake world | pool hall and town both | pool 0/4; town 1/8 (a cast-invented "ferry across the river", now forbidden in the cast prompt) |
| Crowd of 14: distinct jobs | 7 of 12 were lamplighters | **14 distinct**, 12 with ties, ages 15–67 |
| Routing (in-game, the eval's transcripts) | 5 misroute classes, one teleport | **13/13 pass**, no teleport; the 30-phrase probe sends every idiom to the person |
| "Make everyone dance" | danced for 3+ min | 14 dancing at +3 s, **0 at +30 s** |
| Following | never ended | ended at **59 s** of silence, with a line |
| Night | nobody went home (lake) | town at +25 s: 6 inside, 9 going home or asleep, out of 14 |
| Wish memory | "1 thing changed" | "Kyle said "Turn the dock into lava." and the dock turned orange and began to glow" |
| Split wish | a person faked the wish | Mara, after it happened: "Oh, look at the dock. It's gone orange and glowing. Kyle, is that you doing that?" |
| "Did Hilde tell you about me?" | invented an answer | "Arlo? Not a word, as far as I heard." |
| Line length | median 33, max 54 words | median 22–29, max 34 |

**Latency.** Talk is unchanged. First text arrived at a median of 0.78 s (runs ranged from 0.61 to 1.36 s, n = 30), and first audio at 1.3–2.0 s. Banter calls take 0.9–2.6 s (wish shouts at a median of about 1.6 s), all off the conversation path.

**Checks:** `npm test` passes 132/132 (10 new test groups). Typecheck and lint are clean. The intent bench passes 75/75 on both Haiku and Sonnet. The bench ran both models; that run cost $0.47, most of the spend.

**Spend:** about $0.6 in total: $0.47 for the bench, and about $0.1–0.15 for all the browser runs (Haiku calls plus TTS).

**Sample banter, unedited:**
- Town, after "make a dragon land": *Rosa → Ines: "Ines, get back from the road, now!"* · *Edith: "Did you just ask for a dragon? Goodness."*
- Lake, after the lava dock: *Ines → Greta: "Mind you, the whole dock's glowing like a lamp, Greta!"* · *Tova → Ines: "Is it hot? Is it going to burn?"* · *Greta → Tova: "Who taught you to ask questions like that?"*
- Idle (cast relatives): *Ines → Bram (her uncle): "Well, obviously that wasn't a kite, Uncle!"*
- Chime: you told Fitz your name, and Tova, 3 m off, said *"Welcome, Kyle. The road's rough, I suppose, but Fitz is right about the river."*

**Screenshots** (`loop1_after/`):
- Town: `town_01_crowd_wide`, `town_02_idle_banter`, `town_03_chime`, `town_04_dragon_barks`, `town_05_everyone_dances`, `town_06_night_town`.
- Lake: `lake_01_lake_people`, `lake_02_elder_closeup`, `lake_03_guard_spear`, `lake_04_fisher_face_mood`, `lake_05_lava_dock`.
- Pool hall: `pool_01_pool_players`, `pool_02_bartender`, `pool_03_follow_end`. The pool shots are from the rerun, where the players were off-frame and the bartender declined to follow; the 59 s follow ending was measured in the first pool run. `poolplay_01_players_0` shows "two guys": one playing with a cue at the table.
- Faces: `faces_01..05_mood_*`, `faces_06_guard_spear_side`, `faces_07_shopkeeper_apron`, `faces_08_elder_age` (a 74-year-old with a grey bun and an upright cane). These were reshot after the fixes.
- Routing: `routing_01_routing_end`.

## What didn't get done, and known issues

- **Voice:**
  - The "≤ 3 words mid-conversation hands back to the realtime genie first" rule is not in. Fuzzy names cover the eval's "Jeannie. May." case.
  - The split wish in voice uses a fixed 3.5 s delay, not the genie's tool result.
- **Echo openers persist as a persona habit** ("X, is it?"). They're down from 50% to about 23%, but Haiku still leans on a persona's "answers questions with questions". The next step is to stop the persona writer producing that habit, or to trim a leading echo client-side before the voice starts.
- **"Introduce me to X"** walks to X, but X doesn't yet greet you with the introduction as context.
- **Two people on one bench spot** are not deconflicted. There's still no pathfinding across water.
- **Mood:** a new reply's mood overwrites the current one. Folded arms (annoyed) only show when idle, and a gesture or talking hands win. Faces are simple primitives, and the eval's "mannequin A-pose" critique still mostly applies. The cue in `play` angles up rather than lying level. The lake close-up `lake_02` predates the elder-hair, eye and brow fixes (see `faces_08`).
- **Child size from age** applies only when a non-child role gets an age under 13. Hair stays the role's colour until the persona lands (about 4 s).
- **The intent model answered "two guys playing pool at the far table" with only a `say`, twice** in a pool hall that already had pool tables. "put two guys at the far pool table, playing pool" worked. This is an intent prompt issue I didn't touch, and the bench didn't catch it.
- **Persona timing:** crowd personas are still lazy (loaded within 16 m), but the cast is eager, so their jobs and ties are known at once.
- **Names still recur across worlds,** because names are seeded from the entity id plus the sentence seed.
