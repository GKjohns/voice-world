# Gauntlet loop 1, track B: generalisation, behaviour, physics, movement

Track B covers items 1 and 3–10 from `baseline_eval.md`. Item 2, the art direction, was track A (`1f05e4b`). The runs are in `loop1B/run1` through `loop1B/run6`. Each has its own `results.json` and screenshots, and every run was reviewed shot by shot.

## What landed, per item

**1. The Director builds new kinds of place.**
- The Director digest is rewritten to cover any genre. It has five "shells": room, courtyard, open land, street and strange media (under the sea, in the clouds, in space).
- It defines 2–4 signature props per place in the intent part format. Director ops gain `define` with `tags`, `parts` and `hero`, plus `role` for people.
- The atmosphere op gains `sky`, `horizon` and `moons`.
- The pool-hall and storefront examples are gone. They are replaced by an observatory and a desert oasis, both built with defines.
- Two new rules: no rugs or homely pendant lamps in sci-fi or industrial places, and nothing tall within 6 m directly ahead of the player.
- The one `hero` define per teleport is forged at the good tier after the build. `useForge.forgeKind` does this, under the ledger's spend caps.
- The intent model sends whole settings to the Director. "Somewhere in the clouds" or "under the sea" is a teleport even when a word in it is a kit kind.
- The digests import the shared `STYLE_WITH_PALETTE`.

**3. Framing.**
- Outdoors, the framing dolly can back up to 30 m (`OUTDOOR_BACK`), and the vertical margin is stricter so the HUD doesn't crop the bottom.
- "In front of me" now means 3.5 m. The layout still pushes large things back until they fit in view.
- A small thing that lands far away gets an approach glide.
- Things that arrive moving (a thrown ball, a dragon taking off) are tracked for about 5 s.

**4. Physics-lite.**
- `arrange: 'stack'` builds a vertical column with a slight offset. When the real size arrives (a define after a placeholder, or a forged upgrade), the column re-settles onto it.
- `drop` falls with gravity onto the ground, or onto the top of whatever is under it (`supportAt`, using bounding boxes), then bounces, throws up dust and thuds.
- `throw` makes a ballistic arc from the eye toward the gaze, then bounces.
- `tip` flips or topples a thing about its edge.
- `atmosphere.gravity: false` makes loose things float up and tumble. Turning gravity back on drops them with a bounce.
- All of it is pure math in `app/world/fx/motion.ts`. The kernel resolves the resting spots (`Entity.launch`), so undo and replay stay deterministic.

**5. Honesty.**
- New claim checks for stacked, gravity, upside down or toppled, thrown, dropped, two moons and swirls. Swirls never hold.
- The intent rule now lists which ops back which words.

**6. Player powers.**
- `atmosphere.fly`: Space or PageUp rises, Shift+Space or PageDown sinks, and looking up or down while walking climbs or dives. Turning it off drops you onto whatever is below.
- `goto` (side `on_top` or `front`) glides you to a thing. On top, you stand at the real mesh top, perched near the far edge.
- Standing on things: the tops of solid things' bounding boxes are something you can stand on.
- Collision: solid things are cylinders sized from the footprint or the built mesh's extent, plus your body. You slide along them, and a step that leads out of one is always allowed, so you never get stuck. Walls use a knee-high ray.

**7. No quiet kit swaps.** A kit kind is used only when the words name that thing. A log cabin, a lighthouse, a barn, a windmill, monoliths or a picnic blanket each get a define. The new bench cases pass: a lighthouse, a barn, monoliths and a picnic blanket.

**8. Followers.**
- The new `follow` motion keeps a creature a few metres ahead of you and to one side, in view, at up to 18 m/s.
- People who are told to follow walk ahead of you and to one side, and sprint at up to 9.5 m/s.
- If you ask a person "can you follow me?" and they don't refuse, they follow, even when the model left out the action.

**9. A creative sky.**
- `sky`, `horizon` and `moons` tint the sky and fog over any preset (`app/world/fx/skymods.ts`). Moons rise where you were looking, spread apart and at different sizes.
- `intensity` controls how hard the weather comes down. At 1, snow is a blizzard: faster, wind-driven, bigger flakes, a closing white fog, grey sky and clouds.
- This needed a small addition to `fx/weather.ts`: an `intensity` field and a few lines in `tick` and `grade`.

**10. Reliability.**
- The 45 s hang and the old forest coming back were real bugs, not harness artefacts. A say-only batch counted as an "undo after reset" and restored the world from before the reset. The restore also left the pill stuck on "thinking", and the harness waited 45 s for it. Fixes:
  - A restore now needs a real `undo`.
  - A reset of an already blank world forgets the old world.
  - The pill can't stay on thinking.
- An intent call with no first op after 6 s is dropped and retried once.
- A persona answer that arrives after a wipe is dropped. Ids restart after a reset, so a late answer would have handed an old life to a new person.

**The start.** The starting world, which reset returns to, is now golden hour, to show off the painted look.

## Verification

- `npm test`: 163 pass, including 14 new tests in `tests/physics.test.ts` covering physics, collision, honesty, followers and the Director's defines.
- Typecheck and lint are clean.
- Haiku intent bench: 96–97 of 97 pass. The only failure is the known-flaky "five more" case (1 in 5).
- There are 22 new cases with held-out phrasings, such as "pile four boxes into a tower", "chuck a snowball as far as you can", "I wish I could fly", "a puppy that trails behind me wherever I go", "hang a second moon up there" and "a big red barn". All 22 pass.

Gauntlet subsets, judged shot by shot. "Before" is the baseline; "after" is the latest run that covered each scenario (run4 to run7):

| Subset | Before (pass / partial / fail) | After (pass / partial / fail) |
|---|---|---|
| Physics: drop, stack, gravity, throw | 0 / 0 / 4 | 4 / 0 / 0 |
| Navigation: walk, top, fly | 0 / 1 / 2 | 2 / 1 / 0 |
| Teleports (6) | 0 / 3 / 3 | 2 / 4 / 0 |
| Sky: aurora, two moons, blizzard | 1 / 2 / 0 | 2 / 1 / 0 |
| Followers and people: dog, wizard | 0 / 1 / 1 | 1 / 1 / 0 |
| Novel objects: piano, stones, cabin, picnic | 0 / 3 / 1 | 2 / 2 / 0 |
| Recovery: reset, nonsense, upside down, vague | 1 / 1 / 2 | 3 / 1 / 0 |

Notes on the "after" column:
- Physics: the drop landed in view, the stack is one column with no gaps, the balls lifted off the ground, and the camera tracked the thrown ball.
- Navigation: walking now stops outside the lighthouse. Standing outside, its glass beam volume can still look like you're inside it. The top-of-tower view and flight positions are right; in an empty world the shots show little.
- Teleports: the bridge and the castle courtyard are recognisable places. The other four have their own signature props but still have generic shells, and run5 used the floor kit on open ground. That rule is fixed after run5 but not re-run.
- Followers: the dog stays in view. The wizard follows when asked, but at the end of the walk they are at the edge of the frame.
- Novel objects: the piano drop still gets the library's old upright `piano`.
- Recovery: the nonsense wish builds seven purple "bananas" (capsules), there is no 45 s hang, and the old world never comes back.

## Remaining issues

- Director builds now take 15–21 s to finish, up from 9–14 s, because of the defines. The first op still lands in about 3 s.
- "Make it glow" is weak visually. That's rendering, so it's track A's.
- The two-moons sky, Rome's framing and the sky island depend on Director variance.
- Canyon framing (looking along the gorge) is not done.
- The forge library serves the old upright `piano` for the piano drop.
