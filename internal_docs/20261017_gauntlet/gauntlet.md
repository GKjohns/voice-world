# The Conjure gauntlet (2026-10-17)

**Purpose:** a fixed set of things real people try in their first ten minutes once they learn "you're a god, or you have a genie". It is the regression and progress yardstick for every improvement loop. The scenarios are deliberately **not tailored to the kit**. They span domains, scales and kinds of asks, so a pass means the system generalises, not that a hand-built asset exists.

**How to run:** `node scripts/gauntlet.mjs [--out dir] [--only id-or-group,...] [--max-usd 2.5]`. Use `--list` to print the scenarios. The script holds the canonical scenario list, and this document mirrors it, so keep the two in sync. Each scenario starts from a real reset at the start view. Sentences are typed into the HUD field, which uses the same router a typed wish takes. Movement uses held keys and mouse drags. The harness waits for the intent model, Director builds and forge refines, then takes a JPEG of exactly what the player sees. `results.json` records ops, latencies, fps, spend and errors.

**Scoring per scenario:** **pass** (great or close to it), **partial** (did something sensible but missed the core of the ask, or looks bad), **fail** (wrong, nothing happened, or broke). Note the one thing that would most improve it.

**What "great" means everywhere:** (1) something visible starts within about 1.5 s; (2) the result is what was asked, at a sensible scale and spot, framed so you can see it; (3) it looks like it belongs in the same world as everything else; (4) 60 fps, no hitches, no glitches; (5) the genie's line is short and in character, and never claims something that didn't happen.

---

## A. Creating novel objects (things not in any kit)

| id | Spoken | Great looks like |
|---|---|---|
| `create_robot` | "Put a giant friendly robot over there." | A recognisable robot about 6–12 m tall, with a friendly face (round eyes, maybe a wave pose), lands where you're looking. The draft is in under 3 s, refines into something chunky and charming, and is fully framed. |
| `create_piano` | "A grand piano right in front of me." | A grand piano at real scale (about 1.5 × 2.7 m, open lid, three legs, keys), 2–3 m ahead and facing you. Unmistakable as a piano from the first draft. |
| `create_pancakes` | "A stack of pancakes the size of a car, with syrup dripping down." | A tall stack of golden discs about 4 m across, with glossy amber syrup runs down the sides and a butter pat on top. It reads as food, not as a cylinder tower. |

## B. Quantities and sets

| id | Spoken | Great looks like |
|---|---|---|
| `sets_sunflowers` | "Plant a whole field of sunflowers." | Dozens to hundreds of sunflowers filling the view out to the horizon, with variety in height and tilt, all facing roughly one way. They arrive in a satisfying wave. |
| `sets_stones` | "A circle of standing stones around me." | A ring of 8–12 tall weathered monoliths at about 8–12 m radius **centred on the player**, varied heights, maybe a lintel. The camera shows that you're inside the ring. |

## C. Edits to existing things

| id | Spoken (in order) | Great looks like |
|---|---|---|
| `edit_cabin` | "Build a little log cabin." → "Paint it blue." → "Make it three times bigger." → "Make it glow." | A log cabin (logs, roof, door, chimney). The main mass wipes to blue while the trim keeps its colour. It grows ×3 with a springy ease and stays framed. Then it glows softly. Each step lands in about 1 s, with no re-generation. |
| `edit_selective` | "Some trees and a few big rocks." → "Make only the rocks gold." → "Get rid of the trees." | Both trees and rocks appear. Only the rocks turn gold, and the trees keep their colour. The trees vanish with a nice exit and the gold rocks remain. |

## D. Scale and god powers

| id | Spoken | Great looks like |
|---|---|---|
| `god_giant` | "A little village." → "Make me a giant." | A village of 6–12 cottages, maybe paths and a well. Then the camera rises smoothly to a giant's eye height, the village becomes a toy at your feet, and walking strides. |
| `god_tiny` | "A picnic blanket with some food on it." → "Shrink me to the size of an ant." | A checked blanket with a basket, fruit and bread. Then the eye drops to a few centimetres and the apple is a boulder. The view holds and you stay on top of the blanket. |
| `god_volcano` | "Raise a volcano over there and make it erupt." | A big cone heaves up on the horizon where you look, with lava glow, a smoke plume, embers and maybe a rumble and a shake. Spectacle, at a distance that fits in frame. |

## E. Landscapes and terraforming

| id | Spoken | Great looks like |
|---|---|---|
| `land_canyon` | "Carve a deep canyon with a river running through it." | Layered rock walls rise or split open with a winding river at the bottom. You're positioned to see down into it or along it. |
| `land_islands` | "Turn all of this into an ocean with little islands." | The ground becomes water to the horizon with a few small islands (sand, palms, rocks). You stand on one island or a dock, not floating in the sea. |

## F. Teleports to wildly different places

| id | Spoken | Great looks like |
|---|---|---|
| `tp_spaceship` | "Take me to the bridge of a spaceship." | An enclosed sci-fi room: consoles with glowing screens, captain's chair, a big viewport onto stars or a planet, cool blue lighting. Built around you in under 10 s. |
| `tp_underwater` | "Take me to the bottom of the ocean." | A blue-green underwater mood: dim caustic light, sand, coral, kelp, fish schools and maybe a shipwreck. Fog reads as water. |
| `tp_castle` | "Take me to a medieval castle courtyard." | Stone walls and towers around you, a gate, banners, a well, carts, torches and maybe a few people. Daylight or torchlight. |
| `tp_rome` | "Take me to ancient Rome." | Columns, temples, a forum or Colosseum silhouette, warm stone, cypress trees and people in togas. Historic, not generic city. |
| `tp_laundromat` | "Put me in a laundromat at 2am." | A mundane, specific interior: rows of washers and dryers, fluorescent light, plastic chairs, a vending machine, night outside the window. Quiet. It should prove the Director isn't just fantasy. |
| `tp_skyisland` | "A floating island in the clouds with waterfalls pouring off the edges." | You stand on a grassy island in the sky, cloud sea below, waterfalls falling off the rim into mist, maybe other islands floating nearby. The fantasy postcard shot. |

## G. Weather, time, sky spectacle

| id | Spoken | Great looks like |
|---|---|---|
| `sky_aurora` | "Make it night with the northern lights." | The sky darkens through dusk, and green-violet aurora ribbons ripple over the stars, reflected in the mood of the ground. |
| `sky_two_moons` | "Turn the sky purple and give it two moons." | A purple gradient sky with two distinct moons of different sizes. A creative ask the presets don't cover. It should be honoured, not snapped to plain night. |
| `sky_blizzard` | "Some pine trees." → "Now a blizzard." | Pines, then heavy wind-driven snow, white fog closing in, and snow settling on the trees or ground. |

## H. Creatures and motion

| id | Spoken | Great looks like |
|---|---|---|
| `life_birds` | "A flock of birds circling overhead." | 10–30 birds wheeling in a loose circle above you with flapping wings. The camera glances up. |
| `life_octopus` | "A giant octopus crawling across the field." | A big, unmistakable octopus (bulbous head, eight curling arms) that actually moves across the ground, not a static blob. |
| `life_dog` | "A dog that follows me around." → walk forward 2.5 s | A dog appears, looks at you, and trots after you when you walk. It's still near you in the second shot. |

## I. People

| id | Spoken | Great looks like |
|---|---|---|
| `people_wizard` | "Put a wizard right in front of me." → "Hello! Who are you?" → "Can you follow me?" → walk forward 2.5 s | A wizard appears facing you. They answer in character, in a voice and a bubble, within about 2 s, without inventing scenery that isn't there. They agree to follow and are still near you after you walk. |
| `people_dance` | "A crowd of people dancing." | 8–20 varied people dancing (bobbing, arms up), clustered like a party, maybe with lights. |

## J. Chained multi-turn

| id | Spoken (in order) | Great looks like |
|---|---|---|
| `chain_campsite` | "A campfire." → "Put some tents around it." → "Make it night." → "Add fireflies." → "Someone playing guitar by the fire." | A cosy scene accumulates: a fire with flicker light, a ring of tents facing it, night falling with the fire as the key light, fireflies drifting, and a seated person with a guitar beside the fire. Each step builds on the last and nothing gets replaced. |

## K. Physics-ish asks

| id | Spoken | Great looks like |
|---|---|---|
| `phys_drop` | "Drop a piano from the sky." | A piano falls from high up, accelerating, and slams down with dust, a shake and a thud. Bonus: it bounces or breaks. |
| `phys_stack` | "Stack five wooden crates on top of each other." | Five crates in one vertical stack, each resting on the one below, slightly offset like a real stack. |
| `phys_gravity` | "A pile of beach balls." → "Turn gravity off." | A heap of colourful balls, then everything loose lifts off and drifts upward slowly, turning. The world feels weightless. |
| `phys_throw` | "Throw a ball as far as you can." | A ball launches from your viewpoint in an arc, lands far off and bounces. If it can't be done, an honest short line beats a fake. |

## L. Navigation

| id | Spoken / action | Great looks like |
|---|---|---|
| `nav_walk` | "A lighthouse over there." → hold W 3 s → drag to look right → Shift+W 2.5 s | The lighthouse is framed. Walking is smooth and toward it, with no clipping through it. Looking is responsive. Running is faster. No jitter, no falling through the ground, no getting stuck. |
| `nav_top` | "A really tall tower." → "Take me to the top of it." | A tall tower, then a smooth glide up to stand on its top, with a vista over the world below. |
| `nav_fly` | "Let me fly." → hold W 3 s | You rise off the ground and W carries you forward in the air (or an honest line if flight isn't a power yet). |

## M. Absurd and creative

| id | Spoken | Great looks like |
|---|---|---|
| `absurd_cheese` | "A castle made of cheese." | A recognisable castle (towers, crenellations, gate) in cheese yellow with holes. Material and form both honoured. |
| `absurd_vangogh` | "A few houses and trees." → "Make everything look like a Van Gogh painting." | A swirling, saturated starry-night look (sky swirls, bold blues and yellows), or at least a strong colour re-grade. Honest if it can't. |
| `absurd_upside` | "A big house." → "Flip it upside down." | The house rotates 180° and stands on its roof with a satisfying tween. |

## N. Failure and recovery

| id | Spoken | Great looks like |
|---|---|---|
| `fail_undo` | "A bunch of houses." → "Undo that." | Houses appear, then all of them leave together. The world is back to the start. |
| `fail_vague` | "Do something cool." | The genie takes initiative and makes one delightful, surprising thing (a sky event, a creature, a landmark). No clarifying question. |
| `fail_reset` | "A forest with a river." → "Start over." | The forest and river appear, then the world wipes back to the start (blank slate, start view, default sky). |
| `fail_nonsense` | "Purple seven banana sideways." | A playful, harmless interpretation (seven purple bananas tipped sideways) or a short in-character line. No error, no crash, no silence. |

---

**Coverage:** 41 scenarios and 67 steps across 14 groups. That is 6 teleports, 2 walking or running tests, 1 flight, 4 physics asks, 3 people interactions, a 5-turn chain, 3 god powers, 2 terraforms, 3 sky events, 3 creatures, 3 absurd asks and 4 recovery cases. A full run takes about 25 minutes and costs about $1–2 (the forge library makes repeat runs cheaper; see the note in `baseline_eval.md`).
