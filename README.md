# Conjure

Speak, and a genie builds a world around you. Conjure is a first-person 3D world in the browser that you
change by talking. Say "put a castle on that hill", "make it a stormy night" or "take me to a pool hall",
and it happens around you in a painted, chunky toy-world style.

What it can do:

- **Objects and sets.** Spawn things one at a time or by the dozen ("a bunch of pine trees over there"),
  then change, move, recolour or remove them as a group ("make all the houses red").
- **Teleport.** "Take me to a tranquil lake" replaces the world with a newly built place.
- **Sky and weather.** Time of day, fog, rain, snow, storms, lightning, aurora, meteors, eclipses.
- **Creatures.** Dragons, sky whales, birds and horses that fly, circle, gallop or follow you.
- **People.** Each one has a persona, a routine, memory of what you told them, and their own voice.
  Face someone and talk to them; they remember you after a reload.
- **The forge.** Anything not in the built-in kit is drafted in about a second. Then, in the background, it is
  rebuilt as a more detailed version that replaces the draft (draft, reference image, Opus refine,
  Sol polish, judge). Results go into a local library, so the second dragon costs nothing.

## Bring your own key

Conjure needs a **Vercel AI Gateway** key. Every model call goes through the gateway on that one key.

| Role | Model | Where |
|---|---|---|
| Realtime voice (genie's ears and mouth) | `openai/gpt-realtime-mini`, transcriber `whisper-1` | `shared/voice.ts` |
| Intent (sentence to ops) | `anthropic/claude-haiku-5.5` | `server/utils/aiModels.ts` |
| Director (builds a new place on teleport) | `anthropic/claude-sonnet-5.5` | `server/utils/director.ts` |
| Forge refine / polish / judge | `anthropic/claude-opus-5.5`, `openai/gpt-6.1-sol`, `anthropic/claude-haiku-5.5` | `FORGE_MODELS` in `server/utils/aiModels.ts` |
| Forge reference image | `google/gemini-3.1-flash-lite-image` (~$0.034 per image) | same |
| People (minds) | `anthropic/claude-haiku-5.5` | `server/utils/npc.ts` |
| People (voices, TTS) | `spacexai/grok-tts`, falls back to `openai/tts-1` | `server/utils/npc.ts` |

Rough costs: a plain edit on Haiku costs a fraction of a cent. A forged novel object costs about 6¢ (a
detailed "hero" object about 13¢), and anything already in the library is free. The forge enforces spend caps
in `server/utils/forgeLedger.ts`: `FORGE_CAP = $12` total across sessions and `SESSION_CAP = $1.50`
per session, tracked in `.data/forge/ledger.jsonl`. Realtime voice is billed per minute while the mic is
open. Set a budget on the key in the Vercel dashboard as well.

## Setup

```bash
nvm use 22                 # Node 22+
npm install                # if npm 10 crashes (arborist bug), use: npx npm@11 install
cp .env.example .env       # then paste your AI_GATEWAY_API_KEY
npm run dev                # http://localhost:3091
```

Use desktop Chrome. Allow the microphone when asked; you can also type (press Enter or `/`). A webcam is
optional: turn on head tracking to look and point hands-free.

## Things to say

- "Put a bunch of trees over there." / "Make them all red." / "Undo that."
- "Make it night and let lanterns rise into the sky."
- "A dragon circling the mountain." / "A whale swimming through the sky."
- "Take me somewhere tranquil." / "Take me to a neon city street."
- "Make it storm." / "Make me tiny." / "Let me fly."
- "A fisherman on the dock who knows everything about this lake." Then walk up and ask him about it.
- "Start over."

## Controls

- **WASD / arrows** walk, **Shift** runs, **drag** to look (double-click locks the mouse).
- **Flying** (once you've asked to fly): **Space** / PageUp rises, **Shift+Space** / PageDown sinks.
- **Enter** or **/** opens the text field, **Esc** closes it, **Cmd/Ctrl+Z** undoes.
- **Backtick (`)** toggles the developer HUD: status, op log, model toggle and raw-op console.
- The **reset** button (corner icon) starts the world over; undo right after brings it back.

The world saves to localStorage, and the console's menu can export and import it as JSON.

## Architecture

- **Op language.** Models never do coordinate math. They emit flat ops (`spawn | define | modify | move |
  remove | undo | atmosphere | teleport | say`) with set selectors and arrangements; a pure, deterministic
  kernel applies them. `shared/world/ops.ts` (schema, strict parser), `shared/world/state.ts`, `select.ts`, `layout.ts`.
- **Intent.** `server/utils/intent.ts` (cached digest: language, catalog, rules, examples) and
  `server/api/intent.post.ts`, which streams ops as NDJSON as each one closes. The client entry point is `app/composables/useIntent.ts`.
- **Voice.** `app/composables/useRealtimeVoice.ts` plus `server/api/realtime/token.post.ts`. The genie has two
  tools, `build` and `teleport` (`shared/voice.ts`).
- **Director.** `server/utils/director.ts` turns "take me to X" into a whole scene, streamed in as it is written.
- **Forge.** `server/utils/forge.ts`, `forgeRun.ts`, `forgeLedger.ts` and `server/api/forge/*` run progressive
  generation, spend caps and the library under `.data/forge/`. The client side is `app/composables/useForge.ts`.
- **People.** `shared/npc/*` covers personas, routines, routing and replies; `server/utils/npc.ts` and
  `server/api/npc/*` handle minds, memory summaries and TTS; `app/world/npc/people.ts` renders them.
- **Renderer and style.** three.js in `app/world/renderer.ts`, the object kit in `app/world/kit/`, effects
  in `app/world/fx/`, and the toon look (banded lighting, bevels, grass, water, sky, post) in `app/world/style/`.
- **Head tracking.** MediaPipe in `app/composables/useHeadTracking.ts`.

## Scripts, tests, bench

```bash
npm test                    # node --test over the pure kernel, NPC, forge, physics, sky
npm run typecheck && npm run lint
```

Everything below talks to real models through your key, so it spends real money. The `scripts/` checks
drive headless Chromium against the running dev server (`npm run dev` first) and write PNGs to `--out`
(default: the OS temp dir).

| Command | What it checks |
|---|---|
| `npm run shoot [scenario]` | Screenshots of the canned example chips (`scripts/shoot.mjs`). |
| `npm run gauntlet -- --list` | Scripted "what people try" scenarios, with `--only`, `--max-usd` (`scripts/gauntlet.mjs`). |
| `node scripts/forge-shoot.mjs` | Novel-object wishes through the forge: draft, refine, polish timings, cost and fps. |
| `node scripts/voice-shoot.mjs` | Realtime voice with a fake mic (a wav), each mic state, and the browser-speech fallback. |
| `node scripts/npc-shoot.mjs` | People end to end: spawn, talk, world commands mid-conversation, memory after walking away. |
| `node scripts/npc-calm-shoot.mjs` | Calm mode: nobody speaks first, follow / go-somewhere requests, one line at most for a dragon. |
| `node scripts/npc-voice-shoot.mjs` | Spoken lines reach the person you face; "Genie, …" reaches the genie. |
| `npm run bench:intent` | Utterances through Haiku and Sonnet: pass rate, latency, cost. |
| `npm run bench:director` | A few teleport places through the Director: first op, done, op count, cost. |
| `npm run bench:realtime` | Realtime voice minus the browser, using `bench/fixtures/*.wav` (needs the dev server for intent). |

The `bench/fixtures/*.wav` files are synthetic speech made with macOS `say`.

## Status

Experimental. This is a personal research project, built quickly with lots of AI help. Expect rough edges, and
check your gateway spend. `internal_docs/` holds the working plans and evaluation notes from the build.

## License

MIT. See `LICENSE`.
