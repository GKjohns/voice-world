# Voice World

A first-person 3D world in the browser that you change by talking.

![A lake at golden hour with paper lanterns rising over snowy mountains](docs/screenshots/lake-lanterns.webp)

Say "put a castle on that hill", "make it a stormy night" or "take me to a neon city street", and it happens
around you in a painted, chunky toy-world style. A voice assistant (the "genie") listens, a language model turns
each sentence into a small set of world operations, and a deterministic kernel applies them. Nothing is
pre-built per scene: every place in the screenshots below came from one or two spoken sentences.

## What you can do

| You say | What happens |
|---|---|
| "Put a bunch of pine trees over there." / "Make them all red." / "Undo that." | Spawn things one at a time or by the dozen, then change, move, recolour or remove them as a group. |
| "Take me to a medieval castle courtyard." | Teleport: the world is replaced by a newly built place, streamed in as the model writes it. |
| "Make it night with the northern lights and two moons." | Time of day, fog, rain, snow, storms, lightning, aurora, meteors, eclipses. |
| "A dragon circling the mountain." / "A whale swimming through the sky." | Creatures that fly, circle, gallop or follow you. |
| "Put a baker right in front of me." Then: "Hello, who are you?" | People with a persona, a routine, their own voice, and memory of what you told them (it survives a reload). |
| "A vintage hot air balloon floating in front of me." | Anything not in the built-in kit is forged: a draft in about a second, then a detailed version that replaces it. |
| "Let me fly." / "Make me tiny." / "Start over." | Movement and scale powers, and a clean reset. |

## Screenshots

All captured headless at 1600×900 from the current build. Each caption is the sentence that made the scene.

| | |
|---|---|
| ![Castle courtyard with towers, banners, a well and two guards](docs/screenshots/castle-courtyard.webp) | ![Rainy neon street with RAMEN and CYBER BAR signs, cars and pedestrians](docs/screenshots/neon-city.webp) |
| "Take me to a medieval castle courtyard." | "Take me to a neon city street at night." |
| ![A red dragon over a snowy peak in a rainstorm](docs/screenshots/dragon-storm.webp) | ![Northern lights and two moons over pine trees](docs/screenshots/aurora-two-moons.webp) |
| "A dragon circling over there", then "make it a stormy evening with lightning." | "Make it night with the northern lights and two moons." |
| ![A villager named Caspar answering in a speech bubble in front of houses](docs/screenshots/village-baker.webp) | ![Three stages of a forged hot air balloon: draft, gold ghost, refined](docs/screenshots/forge-balloon.webp) |
| A baker answers "hello! who are you?" in his own voice. | The forge: draft, gold ghost while the detailed version grows through it, final. |

## Bring your own key

Voice World needs a **Vercel AI Gateway** key. Every model call goes through the gateway on that one key.

| Role | Model | Where |
|---|---|---|
| Realtime voice (the genie's ears and mouth) | `openai/gpt-realtime-mini`, transcriber `whisper-1` | `shared/voice.ts` |
| Intent (sentence to ops) | `anthropic/claude-haiku-5.5` | `server/utils/aiModels.ts` |
| Director (builds a new place on teleport) | `anthropic/claude-sonnet-5.5` | `server/utils/director.ts` |
| Forge refine / polish / judge | `anthropic/claude-opus-5.5`, `openai/gpt-6.1-sol`, `anthropic/claude-haiku-5.5` | `FORGE_MODELS` in `server/utils/aiModels.ts` |
| Forge reference image | `google/gemini-3.1-flash-lite-image` (about $0.034 per image) | same |
| People (minds) | `anthropic/claude-haiku-5.5` | `server/utils/npc.ts` |
| People (voices, TTS) | `spacexai/grok-tts`, falls back to `openai/tts-1` | `server/utils/npc.ts` |

Rough costs:

- A plain edit ("make them red") on Haiku: a fraction of a cent.
- A teleport (Director build): about 3 to 5¢.
- A forged novel object: about 3 to 6¢ (a detailed "hero" object about 13¢). Anything already in the local
  library is free, so the second dragon costs nothing.
- Realtime voice is billed per minute while the mic is open.

The forge enforces spend caps in `server/utils/forgeLedger.ts`: `FORGE_CAP = $12` total across sessions and
`SESSION_CAP = $1.50` per session, tracked in `.data/forge/ledger.jsonl`. Set a budget on the key in the Vercel
dashboard as well.

## Quick start

```bash
nvm use 22                 # Node 22+
npm install                # if npm 10 crashes (arborist bug), use: npx npm@11 install
cp .env.example .env       # then paste your AI_GATEWAY_API_KEY
npm run dev                # http://localhost:3091
```

Use desktop Chrome. Allow the microphone when asked; you can also type (press Enter or `/`). A webcam is
optional: turn on head tracking to look and point hands-free.

## Controls

- **WASD / arrows** walk, **Shift** runs, **drag** to look (double-click locks the mouse).
- **Flying** (once you've asked to fly): **Space** / PageUp rises, **Shift+Space** / PageDown sinks.
- **Enter** or **/** opens the text field, **Esc** closes it, **Cmd/Ctrl+Z** undoes.
- Face a person and talk to them; start with "Genie, ..." to talk to the genie instead.
- **Backtick (`)** toggles the developer HUD: status, op log, model toggle and raw-op console.
- The **reset** button (corner icon) starts the world over; undo right after brings it back.

The world saves to localStorage, and the developer console can export and import it as JSON.

## How it works

```
voice / text ──► intent (Haiku) ──► flat ops ──► kernel (pure, deterministic) ──► three.js renderer
                    │                                 ▲
                    ├── "take me to X" ──► Director (Sonnet) streams a whole scene as ops
                    └── unknown kind ──► forge: draft now, refine/polish/judge in the background
```

- **Op language.** Models never do coordinate math. They emit flat ops (`spawn | define | modify | move |
  remove | undo | atmosphere | teleport | say`) with set selectors and arrangements; a pure kernel applies them.
  `shared/world/ops.ts` (schema, strict parser), `shared/world/state.ts`, `select.ts`, `layout.ts`.
- **Intent.** `server/utils/intent.ts` (cached digest: language, catalog, rules, examples) and
  `server/api/intent.post.ts`, which streams ops as NDJSON as each one closes. Client: `app/composables/useIntent.ts`.
- **Voice.** `app/composables/useRealtimeVoice.ts` plus `server/api/realtime/token.post.ts`. The genie has two
  tools, `build` and `teleport` (`shared/voice.ts`).
- **Director.** `server/utils/director.ts` turns "take me to X" into a whole scene, streamed in as it is written.
- **Forge.** `server/utils/forge.ts`, `forgeRun.ts`, `forgeLedger.ts` and `server/api/forge/*` run progressive
  generation, spend caps and the library under `.data/forge/`. Client: `app/composables/useForge.ts`; the studio
  shots the judge compares come from `app/world/studio.ts`.
- **People.** `shared/npc/*` covers personas, routines, routing and replies; `server/utils/npc.ts` and
  `server/api/npc/*` handle minds, memory summaries and TTS; `app/composables/useNpc.ts` runs minds and
  conversations on the client, `app/world/npc/people.ts` renders them and `app/world/npc/voice.ts` speaks for them.
- **Renderer and style.** three.js in `app/world/renderer.ts`, the object kit in `app/world/kit/`, effects in
  `app/world/fx/`, and the toon look (banded lighting, bevels, grass, water, sky, post) in `app/world/style/`.
- **Head tracking.** MediaPipe in `app/composables/useHeadTracking.ts`.

## Scripts, tests, bench

```bash
npm test                    # node --test over the pure kernel, NPC, forge, physics, sky
npm run typecheck && npm run lint
```

Everything below talks to real models through your key, so it spends real money. The `scripts/` checks drive
headless Chromium against the running dev server (`npm run dev` first) and write screenshots to `--out`
(default: the OS temp dir). They use the `window.__voiceWorld` debug handle the app exposes.

| Command | What it checks |
|---|---|
| `npm run shoot [scenario]` | Screenshots of the canned example chips (`scripts/shoot.mjs`). |
| `npm run gauntlet -- --list` | Scripted "what people try" scenarios, with `--only`, `--max-usd`, `--w/--h` (`scripts/gauntlet.mjs`). |
| `node scripts/forge-shoot.mjs` | Novel-object wishes through the forge: draft, refine, polish timings, cost and fps. |
| `node scripts/voice-shoot.mjs` | Realtime voice with a fake mic (a wav), each mic state, and the browser-speech fallback. |
| `node scripts/npc-shoot.mjs` | People end to end: spawn, talk, world commands mid-conversation, memory after walking away. |
| `node scripts/npc-calm-shoot.mjs` | Calm mode: nobody speaks first, follow / go-somewhere requests, one line at most for a dragon. |
| `node scripts/npc-voice-shoot.mjs` | Spoken lines reach the person you face; "Genie, ..." reaches the genie. |
| `npm run bench:intent` | Utterances through Haiku and Sonnet: pass rate, latency, cost. |
| `npm run bench:director` | A few teleport places through the Director: first op, done, op count, cost. |
| `npm run bench:realtime` | Realtime voice minus the browser, using `bench/fixtures/*.wav` (needs the dev server for intent). |

The `bench/fixtures/*.wav` files are synthetic speech made with macOS `say`.

## Status and limitations

Experimental. This is a personal research project, built quickly with a lot of AI help.

- Desktop Chrome only; no mobile or VR controls.
- Single player. The world, people's memories and the forge library live in your browser and in `.data/`.
- Model output varies: the same sentence can build a different place twice, and forged objects are sometimes
  odd (parts that float, proportions that are off). "Undo that" and "start over" are the escape hatches.
- Check your gateway spend. The forge has caps; the Director, intent, people and realtime voice do not.

`internal_docs/` holds the working plans and evaluation notes from the build (written under the project's
earlier name, Conjure).

## License

MIT. See `LICENSE`.
