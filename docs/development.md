# Development notes

Reference for working on Voice World: which model does what, where each piece lives in the code, and the
scripts used to test and benchmark it. The README covers running it.

## Models

All calls go through the Vercel AI Gateway on one `AI_GATEWAY_API_KEY`.

| Role | Model | Where |
|---|---|---|
| Realtime voice (the genie's ears and mouth) | `openai/gpt-realtime-mini`, transcriber `whisper-1` | `shared/voice.ts` |
| Intent (sentence to ops) | `anthropic/claude-haiku-5.5` | `server/utils/aiModels.ts` |
| Director (builds a new place on teleport) | `anthropic/claude-sonnet-5.5` | `server/utils/director.ts` |
| Forge refine / polish / judge | `anthropic/claude-opus-5.5`, `openai/gpt-6.1-sol`, `anthropic/claude-haiku-5.5` | `FORGE_MODELS` in `server/utils/aiModels.ts` |
| Forge reference image | `google/gemini-3.1-flash-lite-image` (about $0.034 per image) | same |
| People (minds) | `anthropic/claude-haiku-5.5` | `server/utils/npc.ts` |
| People (voices, TTS) | `spacexai/grok-tts`, falls back to `openai/tts-1` | `server/utils/npc.ts` |

## Code map

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

## Build notes

`internal_docs/` holds the working plans and evaluation notes from the build (written under the project's
earlier name, Conjure).
