/**
 * The Director (Teleport mode): a place name + a one-sentence brief → a streamed scene recipe in the same
 * op language, laid out in room coordinates. Sonnet writes the ops in build order (atmosphere → ground →
 * shell → big things → lights → small props → life) as plain JSON text (no structured-output grammar since
 * Loop 1: ~450 ms sooner to the first op and no 25–60 s cold-grammar compile), and `streamOps` hands each op
 * over the moment its object closes, so the client builds the room while the model is still writing.
 *
 * Same cached-digest shape as gateway.ts: the digest (language, room frame, catalog, recipes) rides in
 * its own user part with an Anthropic cache breakpoint; `instructions` stays short. Plain module (explicit
 * imports, no Nitro globals) so scripts can run it directly.
 */
import { KIT } from '../../shared/world/kinds.ts'
import { resolveModel } from './aiModels.ts'
import type { Usage } from './aiModels.ts'
import { streamOps } from './gateway.ts'

export const DIRECTOR_MODEL = 'sonnet'

const ROLE = 'You are the Director inside Conjure, a 3D world the player changes by talking. When they ask to go somewhere, you build that place around them as a stream of world ops in room coordinates, following the digest exactly. Output only the JSON array of ops: no prose, no code fences.'

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
- atmosphere: { op, time, fog, ambient } — FIRST op, always. time: dawn | day | golden | dusk | night | interior. fog 0..1 (0.15 crisp, 0.4 soft, 0.7 thick mist). ambient (a synthesized sound bed): water | wind | room | city | fire | none. weather? (outdoors only, when the brief asks for it): rain | snow | storm | fog | aurora.
- spawn: { op, kind, xz: [x, z], yaw?, count?, arrange?, radius?, size?, scale?, color?, altitude?, motion?, text? } (keys in this order; never put time/fog/ambient on a spawn)
  - altitude = metres above the ground, or "sky" (spread 15–45 m up); motion = hover | drift | orbit | fly | wander | gallop | spin | sway. Life in the air makes a place feel alive: birds circling (bird, count 6–9, altitude 20, motion orbit), lanterns drifting over a festival or lake at night (lantern, count 20–40, scatter, radius 30–40, altitude "sky", motion drift).
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
- Weather and motion when the brief has them: "rainy" / "stormy" / "snowy" / "under the northern lights" → atmosphere weather; a "festival of lights" → drifting lanterns; a beach or harbour → a few circling birds. Never put weather or sky things indoors.
- "Around me" / "surround me" / "all around" (a city, a forest, a crowd, a ring of mountains): build 360°, not a street ahead. The player must see the place when they turn around: put things on all four sides (+z behind them too), each layer nearest-first so it radiates outward. For a city use a crossroads at [0, 0] (Worked example C). Groups around the player: xz [0, 0] with arrange ring and a radius (they face the centre).
- Landscapes are real scale. Hills (16 m) at 40–90 m; cliffs, canyons and waterfalls at 60–150 m; mountain, mountain_range, volcano, giant_moon and planet far out on the skyline: xz 400–900 m away (e.g. mountain_range xz [0, -700]; a ring of ranges at [0, -700], [650, 250], [-650, 250]). They rise out of the ground on their own; "anchor horizon" in the notes means exactly this. Anything you place on a hill or cliff stands on its surface automatically.

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

## Worked example C — "build a city around me" (brief: "A neon city at night that surrounds the player: a crossroads, shops on every corner, towers all around.")
[{"op":"atmosphere","time":"night","fog":0.3,"ambient":"city"},
{"op":"spawn","kind":"road","xz":[0,-22]},
{"op":"spawn","kind":"road","xz":[0,22]},
{"op":"spawn","kind":"road","xz":[-22,0],"yaw":90},
{"op":"spawn","kind":"road","xz":[22,0],"yaw":90},
{"op":"spawn","kind":"lamp","xz":[-3.6,-3.6]},
{"op":"spawn","kind":"lamp","xz":[3.6,-3.6]},
{"op":"spawn","kind":"lamp","xz":[-3.6,3.6]},
{"op":"spawn","kind":"lamp","xz":[3.6,3.6]},
{"op":"spawn","kind":"storefront","xz":[-9,-11],"yaw":90,"color":"#2a2f3c","text":"NOODLES"},
{"op":"spawn","kind":"storefront","xz":[9,-11],"yaw":-90,"color":"#3a2a3c","text":"ARCADE"},
{"op":"spawn","kind":"storefront","xz":[-9,11],"yaw":90,"color":"#23303a","text":"RAMEN"},
{"op":"spawn","kind":"storefront","xz":[9,11],"yaw":-90,"color":"#30283a","text":"KARAOKE"},
{"op":"spawn","kind":"storefront","xz":[-17,-9],"color":"#2c2a36","text":"BAR"},
{"op":"spawn","kind":"storefront","xz":[17,-9],"color":"#26323a","text":"TATTOO"},
{"op":"spawn","kind":"storefront","xz":[-17,9],"yaw":180,"color":"#342a30","text":"DINER"},
{"op":"spawn","kind":"storefront","xz":[17,9],"yaw":180,"color":"#2a3034","text":"HOTEL"},
{"op":"spawn","kind":"storefront","xz":[-9,-24],"yaw":90,"color":"#2a2d3a","text":"BOOKS"},
{"op":"spawn","kind":"storefront","xz":[9,-24],"yaw":-90,"color":"#2e2a3a","text":"PHO"},
{"op":"spawn","kind":"storefront","xz":[-9,24],"yaw":90,"color":"#2a3238","text":"VINYL"},
{"op":"spawn","kind":"storefront","xz":[9,24],"yaw":-90,"color":"#382a30","text":"SUSHI"},
{"op":"spawn","kind":"car","xz":[1.8,-14]},
{"op":"spawn","kind":"car","xz":[-1.8,15],"yaw":180,"color":"#3a6fc0"},
{"op":"spawn","kind":"car","xz":[14,1.8],"yaw":90,"color":"#e8c547"},
{"op":"spawn","kind":"tower","xz":[0,0],"count":16,"arrange":"ring","radius":50,"color":"#1e222c"},
{"op":"spawn","kind":"tower","xz":[0,0],"count":20,"arrange":"ring","radius":78,"scale":1.4,"color":"#1a1d26"},
{"op":"spawn","kind":"neon_sign","xz":[0,-40],"color":"#ff4fa3","text":"TOKYO 9"},
{"op":"say","text":"Turn around. It's all yours."}]
(Lamps stand on the four corners, never on a road. Four arms of road meet under the player; shops line both sides of every arm; two rings of towers close the skyline in every direction.)
`

export interface DirectorRequest {
  world: string
  brief?: string
  model?: string
  signal?: AbortSignal
  /** Hard deadline, 45 s by default. */
  timeoutMs?: number
  maxOutputTokens?: number
}

export type DirectorEvent
  /** `op` is the model's loose Director op, unvalidated: the client runs directorToOp + parseOps. */
  = | { t: 'op', op: unknown, ms: number, i: number }
    | { t: 'done', ms: number, count: number, model: string, usage: Usage, costUsd: number, finishReason?: string }
    | { t: 'error', ms: number, error: string }

export function directorPrompt(req: DirectorRequest): string {
  const brief = (req.brief ?? '').trim().slice(0, 400)
  return `## Place\n${req.world.trim().slice(0, 80)}\n\n## Brief\n${brief || `(none: decide what "${req.world}" should feel like)`}`
}

/** Stream a scene recipe. Never throws: failures come back as an `error` event. */
export async function* directScene(req: DirectorRequest): AsyncGenerator<DirectorEvent> {
  const { alias, id } = resolveModel(req.model ?? DIRECTOR_MODEL)
  for await (const ev of streamOps({
    model: id,
    role: ROLE,
    digest: DIRECTOR_DIGEST,
    prompt: directorPrompt(req),
    reasoning: 'none',
    maxOutputTokens: req.maxOutputTokens ?? 5000,
    // A recipe is ~1.5k output tokens (~9 s); anything past the deadline is a hung stream.
    timeoutMs: req.timeoutMs ?? 45_000,
    signal: req.signal
  })) {
    if (ev.t === 'op') yield ev
    else if (ev.error && !ev.count) yield { t: 'error', ms: ev.ms, error: ev.error }
    else yield { t: 'done', ms: ev.ms, count: ev.count, model: alias, usage: ev.usage, costUsd: ev.costUsd, finishReason: ev.finishReason }
  }
}
