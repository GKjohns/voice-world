# Generation gauntlet, loop 0: baseline (2026-10-18)

Branch `gen-gauntlet`, no product changes. Run with `npm run gen:gauntlet -- --loop loop0` (`scripts/gen-gauntlet.mjs`). The 6 prompts are in `../prompts.json`. Each one runs in a new browser context with empty storage and `?fresh=1`, typed into the HUD field. The review page is `index.html` in this folder, and the raw timeline (every stream event and every renderer state change, per frame) is in `timings.json`.

## 1. Pipeline map: one object request, end to end

Times are the means over the 5 good-tier prompts in this run, measured from pressing Enter. The hero prompt is called out separately.

| # | What you see | What data exists at that moment | Where it comes from | Honest or theatrical |
|---|---|---|---|---|
| 0 | While typing: blue "world listens" motes and a pool of light at the gaze point, plus a ground ring | Nothing yet. Only the gaze snapshot | `useIntent.ts:71-78` `capture()` → `renderer.anticipate`, `showGhost` (`renderer.ts:1785`), `fx/anticipate.ts` | Honest as "I heard you". No model has run yet |
| 1 | At 0.7 s: warm swirling mote "forming" silhouette | Nothing. Haiku is still thinking | `useIntent.ts:65,149-152` (fixed 700 ms timer) → `fx/placeholder.ts` | Theatrical filler. It is a fixed timer and doesn't reflect progress |
| 2 | At about 2.0 s: a labelled blob holds the spot, with the motes swirling round it | The `spawn` op only (kind name and position). Haiku is now writing the define's parts | Intent rules 4/11 ("spawn first") `server/utils/intent.ts:118,125`. Applied at `useIntent.ts:203-206` | Half honest. Something real (the spot) has landed, but the parts Haiku is writing **are being withheld**: the define is one JSON object and is applied only when it closes |
| 3 | At **4.5 s**: the draft morphs in (scale ease-back 520 ms plus a puff) | The full Haiku draft, 7–14 primitive parts | `define` op closes in `opStream.ts` → `useIntent.ts:226` → `renderer.rebuild(morph)` `renderer.ts:1234-1260` | Honest that the data is here, but late. Haiku spent about 2.5 s writing parts that were never shown |
| 4 | At **5.3 s**: the draft turns into a **translucent gold ghost** (opacity 0.55, gold emissive), a dim mote swirl, then "…let me perfect it." | **Only the draft.** The refined object does not exist yet: this is the moment the Opus request is *sent* | `useForge.ts:163` (sleep until 750 ms after the draft) → `:167` studio shot (a 640×480 render of the draft, sent to Opus) → `:171` `beginRefine` → `renderer.ts:1285-1301` → `fx/refine.ts:47` `ghost()`. Caption `useForge.ts:173` | **Misleading.** It looks like an outline of the final, but it is the old draft dimmed. The refine often redesigns the object (the flytrap's red petals become a pot and a toothed trap), so the ghost doesn't predict the result |
| 5 | Dead air under the ghost | Opus is reading the prompt plus the image. Time to first line: **2.7–6.1 s** (mean 3.9 s; 11.6 s in an earlier run) | `server/utils/forge.ts:166-226` `forgeRefine` → `streamText` Opus, reasoning none, pinned to Anthropic | Honest, just slow |
| 6 | From **10.2 s**: refined parts pop in one by one (elastic scale 520 ms, a gold flash, a sparkle every third part) while the ghost thins from 0.55 to 0.12 | Parts arrive **as Opus closes each program line**. The server re-runs the program prefix in `node:vm` and sends only the new parts | `forge.ts:221-227` + `forgeRun.ts:110` `streamRunner` → NDJSON → `useForge.ts:186-189` → `renderer.ts:1304` queue → `:1339` `growRefined` (at most 4 per frame) | **Honest streaming.** The queue is nearly always empty (`timings.json` samples: queue 0–2), so pop-in pacing = model pacing, about 3.5–4 parts/s. The elastic pop and flash are dressing on real arrivals. Parts inside a `for` loop arrive in a burst when the loop closes |
| 7 | 50% of the final parts on screen ("recognizable") at **15.2 s** | Half of the refined parts | (same) | Honest |
| 8 | Stream ends at 18.6 s, then a **350 ms hold**, then the **light-band sweep** (1.8 s): the old ghost fades out below a climbing band and the new merged body fades in | **Everything is in hand.** The final parts are fitted to the draft's bounds (`fitToDraft`, `forge.ts:265`), so the streamed overlay can be at a different scale and gets cross-faded | `useForge.ts:203` (sleep 350) → `:205` `upgradeKind` → `renderer.ts:404-412` → `:1382` `refineSwap` → `fx/refine.ts:155` `sweep` (`SWEEP_MS` `renderer.ts:69`) | **Theatrical.** 2.15 s of animation on data already fully in hand, and a visible jump when the fit rescales |
| 9 | **Settled at 19.4 s** (good tier) | The final object | | |
| H | Hero only ("intricate", "detailed", "make it better"): reference image **before** Opus, then a background polish and a judge, then *another* sweep | Ref image: Gemini 3.1 flash-lite image, **5.8 s, serial before Opus starts**. Polish: GPT-6.1 Sol, reasoning low, **non-streaming, about 52 s**. Judge: Haiku × 2 (A/B both orders) | `forge.ts:178-186` (ref), `useForge.ts:222-260` (polish: 2.2 s sleep, studio shot, `/api/forge/polish`, 2 studio shots, `/api/forge/judge`, swap) | The ref image is invisible serial latency. The polish is a whole-object replacement 55 s after the first result. Here it won and swapped at **81 s** (settled 82.9 s): a second surprise transformation |

**Models and latency per stage** (`server/utils/aiModels.ts:7-47`):

| Stage | Model | Latency (this run) | $ |
|---|---|---|---|
| Voice (when spoken) | `openai/gpt-realtime-mini`, `build` tool → `useIntent().build` (`useRealtimeVoice.ts:225`) | not measured (text path) | per minute |
| Intent + draft | `anthropic/claude-haiku-5.5` (streamed JSON ops) | first op (spawn) 1.4–2.4 s, define lands 3.3–5.4 s (one outlier in run A: 20.7 s) | ~$0.003 |
| Refine (good + hero) | `anthropic/claude-opus-5.5`, reasoning none, 6k max output | first part 2.7–6.1 s after the request, then about 6–11 s of streaming | $0.029–0.040 |
| Reference image (hero) | `google/gemini-3.1-flash-lite-image` | 5.8 s | ~$0.035 |
| Polish (hero) | `openai/gpt-6.1-sol`, reasoning low | ~52 s | ~$0.01–0.05 |
| Judge (hero) | `anthropic/claude-haiku-5.5` × 2 | ~3 s | <$0.001 |

### Kyle's question: why is there a translucent outline, then shapes popping in?

The translucent gold outline is **not** a preview of the final object. The final object doesn't exist yet when the outline appears. The outline is the **Haiku draft** from step 3, dimmed to 55% and tinted gold (`fx/refine.ts:47`) at the moment the Opus request is sent (`useForge.ts:171`). For the next ~4 s nothing changes, because Opus hasn't written its first line. After that, the shapes that pop in **are real streaming**: each one appears within a frame of Opus finishing that line of its program, at about 4 parts a second. The draft ghost fades as they arrive.

So the pop-in is honest, and it is the only honest progress signal in the refine. The confusing parts are around it:

- **The draft is a different design.** A dimmed draft promises a shape that the refine then ignores (the flytrap and telescope change completely).
- **The draft itself is withheld while it streams.** Haiku writes the draft parts from ~2 s to ~4.5 s, but they are applied as one block when the JSON closes. Meanwhile you see motes and a labelled blob.
- **Theatre after the data is complete:** the 350 ms hold plus the 1.8 s sweep, the cross-fade jump from `fitToDraft`, and on hero tier a second whole-object swap ~1 minute later.

In total there are seven visual stages for one object: glow, motes, blob, draft morph, ghost, pop-in, sweep (plus a polish swap on hero). Only the last three or four are tied to real data.

## 2. Baseline numbers (clean run, 6 prompts, 3.8 min wall time)

Times are seconds from Enter.

| prompt | tier | draft (first object px) | ghost | first refined part | 50% parts | swap | settled | parts | $ |
|---|---|---|---|---|---|---|---|---|---|
| flytrap | good | 4.8 | 5.6 | 11.6 | 16.5 | 18.7 | 20.5 | 8→28 | 0.032 |
| locomotive | good | 5.1 | 5.9 | 8.6 | 14.3 | 19.0 | 20.8 | 11→35 | 0.043 |
| pagoda | good | 4.7 | 5.5 | 8.7 | 14.1 | 18.0 | 19.8 | 12→37 | 0.040 |
| triceratops | good | 5.4 | 6.1 | 10.0 | 14.5 | 18.1 | 19.9 | 14→28 | 0.037 |
| telescope | good | 3.3 | 4.1 | 7.6 | 11.2 | 14.0 | 15.8 | 7→18 | 0.034 |
| teapot_house | hero | 3.9 | 4.7 | 15.0 | 20.7 | 26.0 | 82.9 (polish won) | 11→48→82 | 0.083 |
| **mean** | | **4.5** | **5.3** | **10.2** | **15.2** | **19.0** | **19.4 good / 82.9 hero** | | **0.045** |

- fps: 60 average on every prompt, worst frame gap 17–33 ms. Rendering is not the bottleneck; model latency is.
- Variance: an earlier run on the same prompts (`loop0_runA` numbers, not kept) had the locomotive draft at 20.7 s and the telescope's first refined part at 16.5 s (Opus took 11.6 s to its first line). Treat ±3 s per prompt as noise, and compare means.
- **Cost per gauntlet run: ~$0.29.** Tracked $0.269, forge ledger +$0.285, gateway account +$0.288. A good-tier object costs $0.03–0.04; hero costs $0.08.

## 3. Quality of each final object (from the stills)

| prompt | score | why |
|---|---|---|
| flytrap | 7 | A clear Venus flytrap: orange pot, curved stem, open red trap with white teeth, side leaves. Charming and readable |
| locomotive | 5 | A good model, but it faces the camera nose-on (`facing: player`, +z front), so you see only a boiler disc, a smokestack and a cowcatcher. It doesn't read as a train |
| pagoda | 7 | Three tiers, upturned eaves, a finial spire, a door and lit windows. Recognisable. A little boxy and only 3 tiers |
| triceratops | 3 | It landed too close and off to the right of the frame (half out of view, not re-framed). What shows is a green blob body with stumpy legs and a frill. The horns are hard to see |
| telescope | 5 | A tripod and a brass tube, but the tube points straight at the camera, so it reads as a round blue lens on sticks |
| teapot_house | 8 | A teapot body with a lid roof, spout, handle, arched green door, shuttered windows with flower boxes and stone steps. The best of the set (hero, polished) |
| **average** | **5.8** | Two of the three low scores are about **framing and orientation**, not geometry |

## 4. Highest-leverage ideas, ranked

1. **One honest build instead of draft → ghost → rebuild.** Stop dimming the draft into a gold ghost (`renderer.ts:1295`, `GHOST_LEVEL` `:70`). Pick one model of progress. Either (a) the draft stays solid and is replaced part by part as refined parts land, or better (b) when the forge will run, skip showing a separate draft design and let the refine stream *be* the build. Delete the 350 ms hold (`useForge.ts:203`) and the 1.8 s sweep (`SWEEP_MS`, `refineSwap` `renderer.ts:1382`). Remove the fit-to-draft jump by fixing the scale up front: send the target envelope and scale each streamed part on the server, instead of `fitToDraft` at the end (`forge.ts:265`). This answers Kyle's complaint directly and saves ~2.2 s per object.
2. **Start Opus at the spawn, not after the draft.** Today the refine waits for the intent stream to end, then 750 ms, then a studio shot (`useForge.ts:163-167`, `useIntent.ts:272`). Starting Opus from the text the moment the `spawn` names the kind (~2 s), with no draft render, would bring the first refined part from ~10.2 s to roughly 5–6 s. Test whether quality holds without the draft image (bench it on these 6).
3. **Stream the Haiku draft per part.** Teach the op scanner (`server/utils/opStream.ts`) to emit `define.parts[]` elements as each closes, and apply them incrementally. First object pixels go from 4.5 s to about 2.3 s, and the labelled blob and the 700 ms mote timer (`useIntent.ts:65`) become unnecessary. If idea 2 lands, the draft becomes a ~2 s sketch that the Opus parts grow over.
4. **Fix framing and orientation (the cheapest quality win).** Long things spawn nose-on (`facing: player`). Turn them about 30–40° so a three-quarter view shows. Re-frame after the forged upgrade on width or depth, not only height (`renderer.ts:418-419` reframes only if the object is 1.3× taller), and when the object lands partly off-screen (triceratops). That would take the locomotive, telescope and triceratops from 3–5 to about 6–7, and the average from 5.8 to about 6.7.
5. **A faster refine model, or cache its prompt.** Opus takes 2.7–11.6 s to its first line and writes ~4 parts/s. Bench Sonnet 5.5 and Haiku 5.5 on the same program API (`FORGE_MODELS.refine`, `aiModels.ts:43`) for time to first part, parts/s and the judged score. Also give the static `REFINE` system prompt (~2k tokens, `forge.ts:44-47`) an Anthropic cache breakpoint the way the intent digest has one (`gateway.ts`); the refine call sets none today.
6. **Hero: make the tier not double the wait.** The reference image is serial (5.8 s before Opus, `forge.ts:178-186`). Start it at the spawn, in parallel with Haiku, or drop it. The Sol polish (~52 s, non-streaming) produces a second full-object swap at ~80 s. Either stream it as a visible "second pass" or drop it in favour of a better first pass.
7. **Prompt and vocabulary.** Ask Opus to unroll short loops (parts inside a `for` only appear when the loop closes, in bursts) and to state the front/long axis. Allow the Haiku draft the forge shapes (tube, lathe) so the draft and the refine share a design language and the swap is less of a jump (`shared/world/forge.ts`, `intent.ts` define rules).
8. **Caching is already solved outside Fresh.** The library makes repeat wishes $0 at about 0.9 s after the draft (`useForge.ts:151-160`). Leave it as is; the gauntlet runs Fresh on purpose so it measures generation.

## Budget

- This run: ~$0.29. All gauntlet work today, including the smoke test, run A and one rerun: about $0.72 on the gateway account.
- The gateway API only exposes account-wide credits (balance $93.50 after the run). The **per-key $30 cap is not visible through the API**, so check remaining spend on the key in the Vercel dashboard.
- The forge's own ledger is at $2.94 of its $12 cap (`server/utils/forgeLedger.ts:14`).
