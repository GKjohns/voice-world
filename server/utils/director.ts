/**
 * The Director (Teleport mode): a place name + a one-sentence brief → a streamed scene recipe in the same
 * op language, laid out in room coordinates. Sonnet writes the ops in build order (atmosphere → ground →
 * shell → big things → lights → small props → life) and `streamText` + `Output.array` hands each op over
 * the moment it closes, so the client builds the room while the model is still writing.
 *
 * Same cached-digest shape as gateway.ts: the digest (language, room frame, catalog, recipes) rides in
 * its own user part with an Anthropic cache breakpoint; `instructions` stays short. Plain module (explicit
 * imports, no Nitro globals) so scripts can run it directly.
 */
import { Output, streamText } from 'ai'
import { KIT } from '../../shared/world/kinds.ts'
import { DirectorOpSchema } from '../../shared/world/ops.ts'
import type { DirectorOp } from '../../shared/world/ops.ts'
import { costUsd, resolveModel } from './aiModels.ts'
import type { Usage } from './aiModels.ts'

export const DIRECTOR_MODEL = 'sonnet'

const ROLE = 'You are the Director inside Conjure, a 3D world the player changes by talking. When they ask to go somewhere, you build that place around them as a stream of world ops in room coordinates, following the digest exactly. Output only the JSON array of ops.'

function catalog(): string {
  return Object.values(KIT)
    .filter(k => k.kind !== 'blob')
    .map(k => `- ${k.kind} [${k.tags.slice(0, 3).join(', ')}]: ${k.note ?? NOTES[k.kind] ?? ''}`)
    .join('\n')
}

const NOTES: Record<string, string> = {
  house: 'small cottage 4.4 m square; floors',
  tower: 'glass office tower 4.8 m square, 3 m per floor (default 8 floors), lit window bands at night',
  pine: 'conifer 4.5 m', oak: 'leafy tree 5 m', rock: 'boulder ~1.6 m', bush: 'shrub ~1 m',
  road: 'straight road 5 m wide, 40 m long along its local z (yaw 0 runs straight ahead), with curbs',
  lamp: 'street lamp 4.3 m, real light', bench: 'park bench 2 m', fence: '3 m fence section along local z',
  table: 'wooden table 1.6 × 0.95 m', chair: 'wooden chair'
}

export const DIRECTOR_DIGEST = `# Conjure Director

You build whole places. The player said "take me to …"; you get the place name and a one-sentence brief. The world has already faded to fog and been cleared; only a patch of floor under the player's feet remains. Your ops stream straight into the engine, which plays them as they arrive, so ORDER IS THE SHOW: the place should assemble outward from the player's feet.

## Output
A JSON array of ops (25–60 of them). One flat op shape; include only the fields an op uses.
- atmosphere: { op, time, fog, ambient } — FIRST op, always. time: dawn | day | golden | dusk | night | interior. fog 0..1 (0.15 crisp, 0.4 soft, 0.7 thick mist). ambient (a synthesized sound bed): water | wind | room | city | fire | none.
- spawn: { op, kind, xz: [x, z], yaw?, count?, arrange?, radius?, size?, scale?, color?, text? } (keys in this order; never put time/fog/ambient on a spawn)
  - xz = where it stands, in metres, in the ROOM FRAME (below). Always give xz.
  - yaw = degrees the object turns in the room frame. 0 = its front faces +z (back toward the player's start).
  - count + arrange (cluster | line | ring | grid | scatter) + radius make groups around xz in ONE op: "8 pines, cluster, radius 6" or "6 stools, line" (lines run along room x, spaced automatically; nature gets natural size jitter). Prefer one counted op over many single ones.
  - size = [length, width] in metres for sized kinds (floor, wall [length only], rug, water, shore, dock [length only], bar_counter, fireflies, dust_motes). scale multiplies the whole object (1.5 = a big pine). color = main colour, a hex string. text = the words on a neon_sign.
  - Only catalog kinds exist. If the brief names something the catalog lacks, use the closest kind (a lounge chair → sofa, a counter → bar_counter) or leave it out.
- say: { op, text } — LAST op: one short line (4–10 words) in a warm host voice that fits the mood.

## The room frame
- The player stands at xz [0, 0] facing -z. +x is their right, -x their left, -z straight ahead, +z behind them.
- yaw: 0 faces +z (toward the player), 180 faces -z (away), 90 faces +x (to the player's right), -90 faces -x.
- Things backed against a wall face into the room: on the far wall (z most negative) yaw 0; on the left wall (x negative) yaw 90; on the right wall yaw -90; on the wall behind the player yaw 180.
- A wall runs along its local x: yaw 0 for the far and back walls; yaw 90 for the side walls. Its xz is its MIDPOINT; set length to the span.
- Scale: the player's eye is 1.6 m. A door is 2 m, a ceiling 4 m. Interiors are 12–22 m across. Keep 1.2 m walkways between furniture. Keep 3 m around [0, 0] clear of anything tall (lamps, trees, shelves) so the first view is open; only the floor, a rug, a dock or a road may be under the player.

## Recipe: build order (each layer nearest-to-the-player first)
1. atmosphere.
2. ground: floor / water + shore / road / rugs. The floor must cover the player: e.g. floor xz [0, -7] length 18 width 20 spans x -9..9 and z -17..3.
3. shell: walls (all four for an interior, flush with the floor edges), then windows on wall lines, then a ceiling (same xz and size as the floor) for an interior.
4. big furniture and structures: tables, counters, sofas, shelves, buildings, docks, tents, boats, cars.
5. lights: hanging_lamp over every table, lamps along streets, fireplace / campfire, neon_sign on walls and shop fronts. Lights are what make a place read; interiors need 4–8 light sources.
6. small props: stools, chairs, plants, rocks, reeds, cue racks, benches.
7. life: fireflies outdoors at dusk/night or golden hour, dust_motes in lamp-lit interiors, embers over any fire.
8. say.

## Composition
- Frame the view: the player looks down -z, so put the hero of the place (the tables, the dock, the street) ahead of them, centred, and a strong light or sign on the far wall as a focal point. Fill the edges so the view never ends in an empty wall or bare ground.
- Interiors: time interior, fog 0.15–0.3, ambient room. Warm, dim, pools of light. Floor + 4 walls + ceiling + furniture in rows or clusters + lights over each + something glowing on the far wall. Walls in a mid-tone (not near-black), rugs under 6 m.
- Outdoors: pick the time from the mood (relax / tranquil → golden or dusk; party / city → night; fresh → dawn or day). Put trees in several clumps (cluster, radius 5–8) at 15–40 m, not one blob. Water is big (40–70 m) so its far shore meets the fog.
- City streets: road straight ahead (xz [0, -16], yaw 0), dark floors as sidewalks either side (x ≈ ±5.5, size [6, 44], color #2a2d34), storefronts shoulder to shoulder every 6.5 m down both sides facing the road (left side yaw 90 at x ≈ -9, right side yaw -90 at x ≈ 9), each with its own text (the sign over its door) and color, towers behind them, 4–6 lamps along the curbs (x ≈ ±3.4, staggered, 10 m apart), 3–5 cars parked at the curbs (x ≈ ±1.8, yaw 0 or 180), and a big neon_sign or two on the far facades. Nothing else stands on the road.
- Night scenes: give buildings, towers and storefronts dark colours (#1e222c–#3a3e4a) so lit windows, lamps and neon carry the light; daylight scenes use lighter, warmer colours.
- Use the brief's palette and mood: tint walls, floors and neon with color.

## Catalog
${catalog()}

## Worked example A — "a cozy library at night" (brief: "A small wood-panelled library at night: tall bookshelves, a fireplace, two sofas on a rug, warm lamps.")
[{"op":"atmosphere","time":"interior","fog":0.2,"ambient":"fire"},
{"op":"spawn","kind":"floor","xz":[0,-6],"size":[14,16],"color":"#5a3a24"},
{"op":"spawn","kind":"rug","xz":[0,-6],"size":[5,4],"color":"#6a2a2a"},
{"op":"spawn","kind":"wall","xz":[0,2],"size":[14],"color":"#4a3326"},
{"op":"spawn","kind":"wall","xz":[-7,-6],"yaw":90,"size":[16],"color":"#4a3326"},
{"op":"spawn","kind":"wall","xz":[7,-6],"yaw":90,"size":[16],"color":"#4a3326"},
{"op":"spawn","kind":"wall","xz":[0,-14],"size":[14],"color":"#4a3326"},
{"op":"spawn","kind":"window","xz":[6.8,-4],"yaw":-90},
{"op":"spawn","kind":"sofa","xz":[0,-3.6],"yaw":180},
{"op":"spawn","kind":"sofa","xz":[0,-8.4]},
{"op":"spawn","kind":"bookshelf","xz":[-6.6,-3],"yaw":90},
{"op":"spawn","kind":"bookshelf","xz":[-6.6,-5],"yaw":90},
{"op":"spawn","kind":"bookshelf","xz":[-4,-13.6],"count":3,"arrange":"line"},
{"op":"spawn","kind":"fireplace","xz":[3,-13.5]},
{"op":"spawn","kind":"hanging_lamp","xz":[0,-6],"color":"#c9a34a"},
{"op":"spawn","kind":"hanging_lamp","xz":[-3.5,-10],"color":"#c9a34a"},
{"op":"spawn","kind":"table","xz":[0,-6]},
{"op":"spawn","kind":"potted_plant","xz":[6,-12.8]},
{"op":"spawn","kind":"chair","xz":[4.5,-3],"yaw":-90},
{"op":"spawn","kind":"embers","xz":[3,-13.2]},
{"op":"spawn","kind":"dust_motes","xz":[0,-6]},
{"op":"say","text":"Pull up a chair. The fire's going."}]
(Lines run along room x, so the far-wall shelves use one counted op; side-wall things are single spawns at different z.)

## Worked example B — "a campsite in the pines" (brief: "A small campsite in a pine forest at dusk: a tent, a crackling campfire, logs to sit on, fireflies.")
[{"op":"atmosphere","time":"dusk","fog":0.45,"ambient":"fire"},
{"op":"spawn","kind":"campfire","xz":[0,-5]},
{"op":"spawn","kind":"tent","xz":[-4,-8],"yaw":30},
{"op":"spawn","kind":"bench","xz":[2.6,-5],"yaw":-90,"color":"#6b4a30"},
{"op":"spawn","kind":"rock","xz":[-2.4,-3.6],"count":3,"arrange":"cluster","radius":1.5},
{"op":"spawn","kind":"pine","xz":[-14,-12],"count":9,"arrange":"cluster","radius":7},
{"op":"spawn","kind":"pine","xz":[12,-16],"count":9,"arrange":"cluster","radius":7},
{"op":"spawn","kind":"pine","xz":[0,-28],"count":12,"arrange":"cluster","radius":10},
{"op":"spawn","kind":"pine","xz":[-16,6],"count":6,"arrange":"cluster","radius":6},
{"op":"spawn","kind":"pine","xz":[15,5],"count":6,"arrange":"cluster","radius":6},
{"op":"spawn","kind":"bush","xz":[6,-10],"count":4,"arrange":"cluster","radius":3},
{"op":"spawn","kind":"embers","xz":[0,-5]},
{"op":"spawn","kind":"fireflies","xz":[0,-10],"size":[30,24]},
{"op":"say","text":"Fire's lit. Stay as long as you like."}]
`

export interface DirectorRequest {
  world: string
  brief?: string
  model?: string
  signal?: AbortSignal
  /** Hard deadline. 45 s by default; the grammar warm-up needs longer on a cold schema. */
  timeoutMs?: number
  maxOutputTokens?: number
}

export type DirectorEvent
  = | { t: 'op', op: DirectorOp, ms: number, i: number }
    | { t: 'done', ms: number, count: number, model: string, usage: Usage, costUsd: number, finishReason?: string }
    | { t: 'error', ms: number, error: string }

export function directorPrompt(req: DirectorRequest): string {
  const brief = (req.brief ?? '').trim().slice(0, 400)
  return `## Place\n${req.world.trim().slice(0, 80)}\n\n## Brief\n${brief || `(none: decide what "${req.world}" should feel like)`}`
}

/** Stream a scene recipe. Never throws: failures come back as an `error` event. */
export async function* directScene(req: DirectorRequest): AsyncGenerator<DirectorEvent> {
  const started = Date.now()
  const { alias, id } = resolveModel(req.model ?? DIRECTOR_MODEL)
  const anthropic = id.startsWith('anthropic/')
  const ctrl = new AbortController()
  const onOuter = () => ctrl.abort(req.signal?.reason)
  req.signal?.addEventListener('abort', onOuter, { once: true })
  // A recipe is ~1.5k output tokens; anything past the deadline is a hung stream (or a cold grammar).
  const deadline = req.timeoutMs ?? 45_000
  const timer = setTimeout(() => ctrl.abort(new Error(`director deadline (${Math.round(deadline / 1000)} s)`)), deadline)
  let count = 0
  try {
    const result = streamText({
      model: id,
      instructions: ROLE,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: DIRECTOR_DIGEST, ...(anthropic ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } } : {}) },
          { type: 'text', text: directorPrompt(req) }
        ]
      }],
      output: Output.array({ element: DirectorOpSchema }),
      maxOutputTokens: req.maxOutputTokens ?? 5000,
      abortSignal: ctrl.signal,
      maxRetries: 1,
      reasoning: 'none',
      // Pin Anthropic: it streams Output.array as plain JSON text. Other routes use tool mode, which streamed nothing.
      ...(anthropic ? { providerOptions: { gateway: { only: ['anthropic'] } } } : {})
    })
    for await (const op of result.elementStream) {
      yield { t: 'op', op, ms: Date.now() - started, i: count++ }
    }
    const u = await result.usage
    const usage: Usage = {
      input: u?.inputTokens ?? 0,
      output: u?.outputTokens ?? 0,
      cacheRead: u?.inputTokenDetails?.cacheReadTokens ?? 0,
      cacheWrite: u?.inputTokenDetails?.cacheWriteTokens ?? 0
    }
    yield { t: 'done', ms: Date.now() - started, count, model: alias, usage, costUsd: costUsd(id, usage), finishReason: await result.finishReason }
  } catch (err) {
    yield { t: 'error', ms: Date.now() - started, error: ((err as Error)?.message ?? String(err)).slice(0, 300) }
  } finally {
    clearTimeout(timer)
    req.signal?.removeEventListener('abort', onOuter)
  }
}
