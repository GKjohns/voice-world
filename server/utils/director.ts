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
import { FRESH_DIRECTOR } from '../../shared/world/fresh.ts'
import { STYLE_WITH_PALETTE } from '../../shared/world/style.ts'
import { resolveModel } from './aiModels.ts'
import type { Usage } from './aiModels.ts'
import { streamOps } from './gateway.ts'

export const DIRECTOR_MODEL = 'sonnet'

const ROLE = 'You are the Director inside Voice World, a 3D world the player changes by talking. When they ask to go somewhere, you build that place around them as a stream of world ops in room coordinates, following the digest exactly. Output only the JSON array of ops: no prose, no code fences.'

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

export const DIRECTOR_DIGEST = `# Voice World Director

You build whole places, of any kind: real or imagined, any era, any genre (a starship, a sunken wreck, a monastery, a night market, a hospital ward, a cloud kingdom, a Roman bath, a bus stop in the rain). The player said "take me to …"; you get the place name and a one-sentence brief. The world has already faded to fog and been cleared; only a patch of floor under the player's feet remains. Your ops stream straight into the engine, which plays them as they arrive, so ORDER IS THE SHOW: the place should assemble outward from the player's feet.

## Output
A JSON array of ops (25–60 of them). One flat op shape; include only the fields an op uses.
- atmosphere: { op, time, fog, ambient, weather?, sky?, horizon?, moons?, intensity? } — FIRST op, always. time: dawn | day | golden | dusk | night | interior. fog 0..1 (0.15 crisp, 0.4 soft, 0.7 thick mist). ambient (a synthesized sound bed): water | wind | room | city | fire | none. weather (outdoors only, when the brief asks for it): rain | snow | storm | fog | aurora, with intensity 0..1. sky / horizon: hex colours that tint the sky and the fog to the place (deep teal for under the sea, pale gold for a desert, violet for an alien world); moons 0–3.
- define: { op, kind, tags, parts, hero? } — a THING THE CATALOG LACKS, designed from primitives (rules below). Define it right before its first spawn, then spawn it like any kind (count + arrange for many).
- spawn: { op, kind, xz: [x, z], yaw?, count?, arrange?, radius?, size?, scale?, color?, altitude?, motion?, role?, text? } (keys in this order; never put time/fog/ambient on a spawn)
  - altitude = metres above the ground, or "sky" (spread 15–45 m up); motion = hover | drift | orbit | fly | wander | gallop | spin | sway. Life in the air makes a place feel alive (birds circling, lanterns drifting, fish schools swimming at altitude 2–6).
  - xz = where it stands, in metres, in the ROOM FRAME (below). Always give xz.
  - yaw = degrees the object turns in the room frame. 0 = its front faces +z (back toward the player's start).
  - count + arrange (cluster | line | ring | grid | scatter) + radius make groups around xz in ONE op: "8 pines, cluster, radius 6" or "6 stools, line" (lines run along room x, spaced automatically; nature gets natural size jitter). Prefer one counted op over many single ones.
  - size = [length, width] in metres for sized kinds (floor, wall [length only], rug, water, shore, dock [length only], bar_counter, fireflies, dust_motes). scale multiplies the whole object (1.5 = a big pine). color = main colour, a hex string. text = the words on a neon_sign or a storefront's sign.
  - person: role = their job in a word or two ("guard", "senator", "engineer", "baker"); 2–8 people make a public place feel lived in.
- say: { op, text } — LAST op: one short line (4–10 words) in a warm host voice that fits the mood.

## The place's own things (define)
The catalog is a starter kit, not the limit. Every place has 2–4 SIGNATURE things that make it unmistakably itself, and they are rarely in the catalog: design them with define. A pool hall is pool tables; a forge is anvils and a furnace; a greenhouse is planters and glass benches; a lighthouse room is a great lamp and a spiral stair. Never substitute an unrelated catalog kind for a signature thing (a bookshelf is not a server rack, a storefront is not a temple, a pool table is not a console) and never re-dress one place's furniture as another's. Use catalog kinds for what they really are (floors, walls, lights, plants, people, water, terrain) and define the rest.
- part: { shape: box | cylinder | cone | sphere | torus | capsule, size: [w, h, d] (bounding box, m), at: [x, y, z] (CENTRE of the part in the object's own frame; a part resting on the ground has y = h/2), rot?: [x, y, z] radians, color: hex, slot?: primary | trim | glow, material?: matte | wood | metal | glass | stone }. Origin = the object's centre on the ground, +z is its front. Cylinders and cones stand along y.
- 2–4 defines per place (each costs build time), 4–8 parts each, touching, at real scale (a door 2 m, a counter 1 m high, a person 1.8 m). Main body slot primary, accents trim, screens / lamps / flames slot glow.
- tags: 2–4 lowercase words with a general category (furniture, machine, structure, plant, decoration, vehicle, creature).
- hero: true on the ONE most characterful define (the centrepiece the player sees first): it is refined into a high-quality version after the build.
- ${STYLE_WITH_PALETTE}

## The room frame
- The player stands at xz [0, 0] facing -z. +x is their right, -x their left, -z straight ahead, +z behind them.
- yaw: 0 faces +z (toward the player), 180 faces -z (away), 90 faces +x (to the player's right), -90 faces -x.
- Things backed against a wall face into the room: on the far wall (z most negative) yaw 0; on the left wall (x negative) yaw 90; on the right wall yaw -90; on the wall behind the player yaw 180.
- A wall runs along its local x: yaw 0 for the far and back walls; yaw 90 for the side walls. Its xz is its MIDPOINT; set length to the span.
- Scale: the player's eye is 1.6 m. A door is 2 m, a ceiling 4 m. Interiors are 12–22 m across. Keep 1.2 m walkways between furniture. Keep 3 m around [0, 0] clear of anything tall (lamps, trees, shelves) so the first view is open; only the floor, a rug, a dock or a road may be under the player.

## Recipe: build order (each layer nearest-to-the-player first)
1. atmosphere.
2. ground: floor / water + shore / road / rugs. The floor must cover the player: e.g. floor xz [0, -7] length 18 width 20 spans x -9..9 and z -17..3. The floor kind is built boards or tiles: use it for interiors, decks, plazas and paved courtyards only. Open ground (sand, grass, a seabed, a cloud bank) is the world's own ground: leave it bare and tint the place with the atmosphere's sky, horizon and fog instead.
3. shell: the enclosure that fits the place (see Shells), flush with the floor edges.
4. signature things (define, then spawn) and big structures, ahead of the player first.
5. lights: lamps, hanging_lamp, fireplace / campfire, glowing defined panels or torches, neon_sign. Interiors need 4–8 light sources.
6. small props and plants.
7. life: people, creatures, fish, birds, fireflies, dust_motes, embers.
8. say.

## Shells: pick the one the place needs
- Room (an interior: a shop, a cabin, a ship's bridge, a ward): floor + 4 walls + windows on wall lines + ceiling (same xz and size as the floor). time interior for a warm lamp-lit room; a room at night with cold or fluorescent light (a late-night shop, a ship in deep space, a lab) uses time night with fog 0.15 so the windows read dark, and gets its light from what you place. Colour floor, walls and ceiling to the place: steel and dark slate for machines and ships, tile for shops and baths, plaster or wood for homes.
- Courtyard (a castle bailey, a cloister, a market square): floor of paving, tall walls on 3–4 sides with NO ceiling, towers or buildings at the corners, open sky above; time from the mood.
- Open land (a beach, a meadow, a desert, a ruin, an island): no walls and no floor; terrain (hill, cliff, mountain_range far out), clumps of plants, water; the horizon is part of the view.
- Street (a city, a village lane): road ahead, buildings shoulder to shoulder down both sides facing the road (storefronts with signs only for shops), lamps at the curbs.
- Strange media (under the sea, in the clouds, in space): tint sky, horizon and fog to the medium with the atmosphere op (thick fog 0.6–0.8 reads as water or cloud), keep the bare ground (no floor kind) unless the player stands on a deck or a platform, and fill the air with what lives in it (fish schools, drifting light motes, floating rocks).

## Composition
- Frame the view: the player looks down -z, so put the hero of the place ahead of them, centred, and a strong light or glowing thing as a focal point. Fill the edges so the view never ends in an empty wall or bare ground.
- Interiors: fog 0.15–0.3, ambient room. Pools of light. Walls in a mid-tone (not near-black). A rug only where one belongs (a home, a library, a lounge), never under machines, wells, consoles or in public places. hanging_lamp is a homely shaded pendant (bars, kitchens, libraries); modern, industrial and sci-fi places light themselves with defined light panels, strips or screens (slot glow) instead.
- The first view is open: nothing taller than 1 m inside 6 m straight ahead of the player (|x| < 4, -6 < z < 0); colonnades, walls and big props stand to the sides or further out, so the opening view looks INTO the place, not at a pillar.
- Outdoors: pick the time from the mood (relax / tranquil → golden or dusk; party / city → night; fresh → dawn or day). Put plants in several clumps (cluster, radius 5–8) at 15–40 m, not one blob. Water is big (40–70 m) so its far shore meets the fog.
- Night scenes: darker building colours so lights carry the scene; daylight scenes lighter, warmer colours. Use the brief's palette and mood everywhere.
- Weather and motion when the brief has them. Never put weather or sky things indoors.
- "Around me" / "surround me" / "all around": build 360°, not just ahead: things on all four sides (+z behind them too), each layer nearest-first. Groups around the player: xz [0, 0] with arrange ring and a radius (they face the centre).
- Landscapes are real scale. Hills (16 m) at 40–90 m; cliffs, canyons and waterfalls at 60–150 m; mountain, mountain_range, volcano, giant_moon and planet far out on the skyline: xz 400–900 m away (e.g. mountain_range xz [0, -700]). They rise out of the ground on their own. Anything you place on a hill or cliff stands on its surface automatically.

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

## Worked example C — "an old observatory at night" (brief: "A domed stone observatory at night: a great brass telescope aimed at a slot in the dome, star charts, a desk with a lamp, a cold starry sky through the slot.")
[{"op":"atmosphere","time":"night","fog":0.2,"ambient":"room","sky":"#0b1030","moons":1},
{"op":"spawn","kind":"floor","xz":[0,-6],"size":[16,16],"color":"#6e6a62"},
{"op":"spawn","kind":"wall","xz":[0,2],"size":[16],"color":"#8a8478"},
{"op":"spawn","kind":"wall","xz":[-8,-6],"yaw":90,"size":[16],"color":"#8a8478"},
{"op":"spawn","kind":"wall","xz":[8,-6],"yaw":90,"size":[16],"color":"#8a8478"},
{"op":"spawn","kind":"wall","xz":[0,-14],"size":[16],"color":"#8a8478"},
{"op":"define","kind":"great_telescope","tags":["telescope","machine","brass"],"hero":true,"parts":[{"shape":"cylinder","size":[1.6,0.5,1.6],"at":[0,0.25,0],"color":"#3a2a20","slot":"trim","material":"wood"},{"shape":"cylinder","size":[0.4,1.8,0.4],"at":[0,1.4,0],"color":"#b08a3e","slot":"primary","material":"metal"},{"shape":"cylinder","size":[0.9,4.6,0.9],"at":[0,3.3,-0.9],"rot":[0.7,0,0],"color":"#c9a34a","slot":"primary","material":"metal"},{"shape":"torus","size":[1.1,1.1,0.12],"at":[0,5,-2.4],"rot":[0.7,0,0],"color":"#7a5a22","slot":"trim","material":"metal"},{"shape":"cylinder","size":[0.3,0.6,0.3],"at":[0,1.9,0.9],"rot":[0.7,0,0],"color":"#7a5a22","slot":"trim","material":"metal"}]},
{"op":"spawn","kind":"great_telescope","xz":[0,-8],"yaw":180},
{"op":"define","kind":"star_chart","tags":["chart","decoration","map"],"parts":[{"shape":"box","size":[1.6,1.1,0.06],"at":[0,1.7,0],"color":"#1d2a4e","slot":"primary"},{"shape":"box","size":[1.72,1.22,0.04],"at":[0,1.7,-0.03],"color":"#5a3a22","slot":"trim","material":"wood"},{"shape":"sphere","size":[0.08,0.08,0.02],"at":[-0.4,1.9,0.04],"color":"#f2efe9","slot":"glow"},{"shape":"sphere","size":[0.06,0.06,0.02],"at":[0.3,1.5,0.04],"color":"#f2efe9","slot":"glow"}]},
{"op":"spawn","kind":"star_chart","xz":[-7.8,-4],"yaw":90},
{"op":"spawn","kind":"star_chart","xz":[7.8,-8],"yaw":-90},
{"op":"spawn","kind":"table","xz":[4,-11],"color":"#5a3a22"},
{"op":"spawn","kind":"chair","xz":[4,-9.8],"yaw":180},
{"op":"spawn","kind":"hanging_lamp","xz":[4,-11],"color":"#c9a34a"},
{"op":"spawn","kind":"hanging_lamp","xz":[-4,-4],"color":"#c9a34a"},
{"op":"spawn","kind":"bookshelf","xz":[-4,-13.6],"count":2,"arrange":"line"},
{"op":"spawn","kind":"potted_plant","xz":[-6.8,-12.8]},
{"op":"spawn","kind":"dust_motes","xz":[0,-6]},
{"op":"say","text":"Look up. The sky is clear tonight."}]
(The telescope and the charts are defined: the catalog has none, and a bookshelf or a lamp would not read as an observatory.)

## Worked example D — "a desert oasis" (brief: "A palm-ringed oasis pool in golden desert dunes at noon, a few traders' tents, camels resting, heat haze.")
[{"op":"atmosphere","time":"day","fog":0.3,"ambient":"wind","sky":"#6fa3d8","horizon":"#f0d9a8"},
{"op":"spawn","kind":"water","xz":[0,-14],"size":[16,12],"color":"#3f8f8f"},
{"op":"define","kind":"date_palm","tags":["palm","tree","plant"],"hero":true,"parts":[{"shape":"cylinder","size":[0.45,6,0.45],"at":[0,3,0],"rot":[0.08,0,0],"color":"#8a6a44","slot":"trim","material":"wood"},{"shape":"cone","size":[3.2,1,0.8],"at":[1.2,6,0],"rot":[0,0,-0.5],"color":"#4f8a3c","slot":"primary"},{"shape":"cone","size":[3.2,1,0.8],"at":[-1.2,6,0],"rot":[0,0,0.5],"color":"#4f8a3c","slot":"primary"},{"shape":"cone","size":[0.8,1,3.2],"at":[0,6,1.2],"rot":[0.5,0,0],"color":"#4f8a3c","slot":"primary"},{"shape":"cone","size":[0.8,1,3.2],"at":[0,6,-1.2],"rot":[-0.5,0,0],"color":"#4f8a3c","slot":"primary"},{"shape":"sphere","size":[0.6,0.5,0.6],"at":[0,5.7,0],"color":"#a0522d","slot":"trim"}]},
{"op":"spawn","kind":"date_palm","xz":[0,-14],"count":8,"arrange":"ring","radius":10},
{"op":"spawn","kind":"tent","xz":[-12,-4],"yaw":60,"color":"#c0453a"},
{"op":"spawn","kind":"tent","xz":[12,-6],"yaw":-60,"color":"#e8c547"},
{"op":"define","kind":"camel","tags":["camel","animal","creature"],"parts":[{"shape":"capsule","size":[0.9,0.9,2.2],"at":[0,1.7,0],"rot":[1.571,0,0],"color":"#c19a6b","slot":"primary"},{"shape":"sphere","size":[0.8,0.6,0.8],"at":[0,2.2,-0.2],"color":"#c19a6b","slot":"primary"},{"shape":"capsule","size":[0.3,0.3,1.2],"at":[0,2.3,1.3],"rot":[0.6,0,0],"color":"#c19a6b","slot":"primary"},{"shape":"box","size":[0.35,0.35,0.6],"at":[0,2.8,1.8],"color":"#b08a5e","slot":"trim"},{"shape":"cylinder","size":[0.18,1.3,0.18],"at":[0.3,0.65,0.7],"color":"#b08a5e","slot":"trim"},{"shape":"cylinder","size":[0.18,1.3,0.18],"at":[-0.3,0.65,0.7],"color":"#b08a5e","slot":"trim"},{"shape":"cylinder","size":[0.18,1.3,0.18],"at":[0.3,0.65,-0.7],"color":"#b08a5e","slot":"trim"},{"shape":"cylinder","size":[0.18,1.3,0.18],"at":[-0.3,0.65,-0.7],"color":"#b08a5e","slot":"trim"}]},
{"op":"spawn","kind":"camel","xz":[8,-20],"count":3,"arrange":"cluster","radius":4},
{"op":"spawn","kind":"person","xz":[-9,-7],"count":3,"arrange":"cluster","radius":3,"role":"trader"},
{"op":"spawn","kind":"rock","xz":[-18,-26],"count":5,"arrange":"cluster","radius":5,"color":"#c49a6c"},
{"op":"spawn","kind":"hill","xz":[-70,-90],"color":"#d8b878"},
{"op":"spawn","kind":"hill","xz":[80,-120],"color":"#e0c088"},
{"op":"spawn","kind":"bird","xz":[0,-20],"count":5,"altitude":20,"motion":"orbit"},
{"op":"say","text":"Water, shade and a cool drink. Rest."}]
`

export interface DirectorRequest {
  world: string
  brief?: string
  model?: string
  signal?: AbortSignal
  /** Hard deadline, 45 s by default. */
  timeoutMs?: number
  maxOutputTokens?: number
  /** Fresh mode (shared/world/fresh.ts): what the place names is designed, not taken from the catalog. */
  fresh?: boolean
}

export type DirectorEvent
  /** `op` is the model's loose Director op, unvalidated: the client runs directorToOp + parseOps. */
  = | { t: 'op', op: unknown, ms: number, i: number }
    | { t: 'done', ms: number, count: number, model: string, usage: Usage, costUsd: number, finishReason?: string }
    | { t: 'error', ms: number, error: string }

export function directorPrompt(req: DirectorRequest): string {
  const brief = (req.brief ?? '').trim().slice(0, 400)
  return `${req.fresh ? `${FRESH_DIRECTOR}\n\n` : ''}## Place\n${req.world.trim().slice(0, 80)}\n\n## Brief\n${brief || `(none: decide what "${req.world}" should feel like)`}`
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
    maxOutputTokens: req.maxOutputTokens ?? 7000,
    // A recipe is ~1.5k output tokens (~9 s); anything past the deadline is a hung stream.
    timeoutMs: req.timeoutMs ?? 45_000,
    signal: req.signal
  })) {
    if (ev.t === 'op') yield ev
    else if (ev.t === 'part') continue
    else if (ev.error && !ev.count) yield { t: 'error', ms: ev.ms, error: ev.error }
    else yield { t: 'done', ms: ev.ms, count: ev.count, model: alias, usage: ev.usage, costUsd: ev.costUsd, finishReason: ev.finishReason }
  }
}
