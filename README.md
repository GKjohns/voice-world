# Conjure

Speak a world into existence. A first-person, low-poly 3D world (Nuxt 4 + three.js) that you change in
plain English: type into the bar at the bottom (or press the mic), and a fast model (Haiku 5.5 through
the AI Gateway) turns the sentence into tiny JSON ops that a deterministic engine places and animates.
The raw-op dev console is still there behind the `{}` toggle.

## Run

```bash
nvm use 22
npm install            # npm 10 hits an arborist bug here; add packages with `npx npm@11 install <pkg>`
npm run dev            # http://localhost:3091
npm test               # node --test over the pure world kernel
npm run typecheck && npm run lint
npm run shoot          # Playwright screenshots of the canned examples (dev server must be running)
node scripts/shoot.mjs sprint2   # the same, typing real sentences through the model
npm run bench:intent   # ~34 utterances × small scenes through haiku and sonnet: pass rate, latency, cost
```

`.env` needs `AI_GATEWAY_API_KEY`. `POST /api/intent?model=haiku|sonnet` takes `{ text, state, ctx }`
(the trimmed scene from `trimScene` and the gaze snapshot) and returns `{ ops, dropped, ms, model }`.

Drag to look, WASD to walk (shift runs), double-click to lock the mouse, Enter to type. Where you
were looking when you started typing (or started speaking) is what "there" and "that" mean. The
world saves to localStorage; export/import JSON from the console's ⋯ menu (loading replays the op log).

## The op language

Models never do coordinate math or set logic. They emit one flat op shape:
`spawn | define | modify | move | remove | undo | atmosphere | teleport | say`, with selectors for
sets (`{ tag: 'tree' }`, `{ tag: 'house', near: 'gaze', within: 15 }`), counts and arrangements for
spawns (`count: 9, arrange: 'cluster'`) and `define` + primitive parts for anything not in the kit.

- Spec and worked examples: `internal_docs/20261016_voice_world/implementation_plan.md`
  ("Revised after the storyboard").
- Schema and strict parser: `shared/world/ops.ts` (`OpsEnvelope`, `parseOps`).
- Kernel: `shared/world/state.ts` (`applyOp`, `applyBatch`, `replayLog`), `select.ts`, `layout.ts`,
  `kinds.ts`. All pure, no three.js.
- Renderer and kit: `app/world/` (`renderer.ts`, `kit/*`, `parts.ts`).
- The op brain: `shared/world/context.ts` (the per-sentence context block), `server/utils/intent.ts`
  (the cached digest: language, catalog, rules, worked examples), `server/api/intent.post.ts`, and
  `app/composables/useIntent.ts` (`build(request, ctx)`: the one client entry point for text and voice).
