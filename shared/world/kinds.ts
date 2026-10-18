/**
 * Kind descriptors: the plain-data half of every kind. The three.js builders live in app/world/kit;
 * everything the pure engine needs (tags, footprint, height, defaults) lives here so tests and the
 * server context builder never import three.
 */
import type { Part, Props } from './ops.ts'
import { partBounds } from './forge.ts'
import type { Quality } from './forge.ts'
import type { Surface } from './terrain.ts'

export type Fall = 'drop' | 'grow' | 'rise' | 'flicker'

export interface KindDescriptor {
  kind: string
  tags: string[]
  /** Collision radius on the ground in metres. 0 = flat, never collides (roads, rugs). */
  footprint: number
  fall: Fall
  /** Height at default props, used for sort:'height' and on_top placement. */
  baseHeight: number
  /** Kinds with floors grow by this much per floor (house, tower). */
  floorHeight?: number
  defaults: Props
  /** Long thin kinds (roads, fences) know their length along local z, so 'along' can follow them. */
  length?: number
  width?: number
  /** Nature kinds face a random way by default; built things face the player. */
  randomYaw?: boolean
  label?: string
  learned?: boolean
  parts?: Part[]
  /** Learned kinds: how good the parts are (a Haiku draft, or forged at the good / hero tier). */
  quality?: Quality
  /** Learned kinds: the hash of the `define`'s own (draft) parts, which a forged upgrade must match. */
  basis?: string
  /** One line for the model catalogs: what it is, its size, the props that matter. */
  note?: string
  /** Gets a soft contact-shadow blob on the floor (furniture indoors, where the sun casts nothing). */
  contact?: boolean
  /** Builds from props.length / props.width (floors, walls, rugs, water), so those rebuild it. */
  sized?: boolean
  /** Terrain you can stand things on: its height function (shared/world/terrain.ts). Never an obstacle. */
  surface?: Surface
}

export const KIT: Record<string, KindDescriptor> = {
  house: { kind: 'house', tags: ['building', 'home'], footprint: 3.2, fall: 'drop', baseHeight: 4.8, floorHeight: 2.8, defaults: { floors: 1, color: '#d9c8a9', trim: '#7a3b2e' } },
  tower: { kind: 'tower', tags: ['building', 'skyscraper', 'office'], footprint: 3.6, fall: 'drop', baseHeight: 24, floorHeight: 3, defaults: { floors: 8, color: '#8fa3bf', trim: '#33404f', material: 'glass' } },
  pine: { kind: 'pine', tags: ['tree', 'plant', 'nature', 'conifer'], footprint: 1.2, fall: 'grow', baseHeight: 4.5, defaults: { color: '#2f5d3c', trim: '#5a3d28' }, randomYaw: true },
  oak: { kind: 'oak', tags: ['tree', 'plant', 'nature'], footprint: 1.8, fall: 'grow', baseHeight: 5, defaults: { color: '#4f7a3a', trim: '#5a3d28' }, randomYaw: true },
  rock: { kind: 'rock', tags: ['rock', 'stone', 'nature'], footprint: 0.9, fall: 'grow', baseHeight: 0.9, defaults: { color: '#6e6a62', material: 'stone' }, randomYaw: true },
  bush: { kind: 'bush', tags: ['plant', 'nature', 'shrub'], footprint: 0.8, fall: 'grow', baseHeight: 1, defaults: { color: '#3e6b3a' }, randomYaw: true },
  road: { kind: 'road', tags: ['road', 'street', 'path'], footprint: 0, fall: 'rise', baseHeight: 0.06, defaults: { color: '#3b3d42', trim: '#e8d27a' }, length: 40, width: 5 },
  lamp: { kind: 'lamp', tags: ['light', 'street', 'lamp'], footprint: 0.5, fall: 'flicker', baseHeight: 4.3, defaults: { color: '#2a2d33', trim: '#fff1c4', glow: 1 } },
  bench: { kind: 'bench', tags: ['furniture', 'seat', 'street'], footprint: 1.1, fall: 'drop', baseHeight: 1, defaults: { color: '#8a5a38', trim: '#2a2d33', material: 'wood' } },
  fence: { kind: 'fence', tags: ['fence', 'barrier'], footprint: 0.4, fall: 'rise', baseHeight: 1.1, defaults: { color: '#c9b79a', material: 'wood' }, length: 3, width: 0.2 },
  table: { kind: 'table', tags: ['furniture', 'table'], footprint: 1, fall: 'drop', baseHeight: 0.78, defaults: { color: '#8a5a38', trim: '#3a2618', material: 'wood' } },
  chair: { kind: 'chair', tags: ['furniture', 'seat', 'chair'], footprint: 0.5, fall: 'drop', baseHeight: 0.95, defaults: { color: '#7c5236', material: 'wood' }, contact: true },

  // ---- interior set (Sprint 4) ----
  floor: { kind: 'floor', tags: ['floor', 'interior', 'structure'], footprint: 0, fall: 'rise', baseHeight: 0.1, defaults: { color: '#6b4a30', length: 16, width: 16 }, sized: true, note: 'plank floor slab; length (x) × width (z) in m, default 16×16; color = boards' },
  wall: { kind: 'wall', tags: ['wall', 'interior', 'structure'], footprint: 0, fall: 'rise', baseHeight: 4, defaults: { color: '#6e4a3a', trim: '#3a2618', length: 8 }, sized: true, note: 'wall slab 0.25 m thick, 4 m tall, runs `length` m (default 8) along its local x; trim = baseboard and crown' },
  ceiling: { kind: 'ceiling', tags: ['ceiling', 'interior', 'structure'], footprint: 0, fall: 'rise', baseHeight: 4.1, defaults: { color: '#2a1d14', trim: '#1a120c', length: 16, width: 16 }, sized: true, note: 'flat ceiling at 4 m with beams; give it the same spot and size as the floor' },
  window: { kind: 'window', tags: ['window', 'interior', 'glass'], footprint: 0, fall: 'rise', baseHeight: 2.5, defaults: { color: '#3a2618', trim: '#9fc3e8', glow: 1 }, note: 'framed window pane 1.6 × 1.4 m, sill at 1 m; put it on a wall line, facing into the room; the pane glows' },
  rug: { kind: 'rug', tags: ['rug', 'carpet', 'decoration', 'interior'], footprint: 0, fall: 'rise', baseHeight: 0.02, defaults: { color: '#7a2e2e', trim: '#8a6a3a', length: 3, width: 2 }, sized: true, note: 'flat rug with a border; length × width, default 3×2 m (keep rugs under 6 m)' },
  pool_table: { kind: 'pool_table', tags: ['table', 'pool_table', 'billiards', 'furniture', 'game'], footprint: 1.6, fall: 'drop', baseHeight: 0.95, defaults: { color: '#1f6b45', trim: '#4a2a18' }, contact: true, note: 'billiard table 2.9 × 1.7 m (long side along x) with racked balls; color = felt, trim = wooden rails' },
  hanging_lamp: { kind: 'hanging_lamp', tags: ['light', 'lamp', 'pendant', 'interior'], footprint: 0, fall: 'flicker', baseHeight: 4, defaults: { color: '#2f7d4a', trim: '#151515', glow: 1 }, note: 'pendant lamp hanging from a 4 m ceiling, shade at 2 m, casts a pool of light; put one over each table; color = shade' },
  bar_counter: { kind: 'bar_counter', tags: ['bar', 'counter', 'furniture', 'interior'], footprint: 1.2, fall: 'drop', baseHeight: 1.15, defaults: { color: '#4a2a18', trim: '#2a1a10', length: 6 }, sized: true, contact: true, note: 'bar counter with bottles; runs `length` m (default 6) along x, 0.8 m deep; its front (+z) is the customer side' },
  stool: { kind: 'stool', tags: ['seat', 'stool', 'furniture'], footprint: 0.35, fall: 'drop', baseHeight: 0.8, defaults: { color: '#8b1e2b', trim: '#9a9ea4' }, contact: true, note: 'bar stool with a padded seat; line them up 0.4 m in front of a bar' },
  jukebox: { kind: 'jukebox', tags: ['jukebox', 'music', 'furniture', 'interior'], footprint: 0.7, fall: 'drop', baseHeight: 1.75, defaults: { color: '#6d2a14', trim: '#d4a537', glow: 1 }, contact: true, note: 'glowing arched jukebox 1.1 × 1.75 m; against a wall' },
  neon_sign: { kind: 'neon_sign', tags: ['sign', 'neon', 'decoration'], footprint: 0, fall: 'flicker', baseHeight: 3.6, defaults: { color: '#ff4fa3', text: 'OPEN', glow: 1 }, note: 'glowing neon text, props text (≤ 18 chars) and color; floats 2.6–3.6 m up, about 4 m wide: mount it on a wall or a shop front' },
  sofa: { kind: 'sofa', tags: ['seat', 'sofa', 'couch', 'furniture'], footprint: 1.1, fall: 'drop', baseHeight: 0.9, defaults: { color: '#7a3b3b', trim: '#3a2618' }, contact: true, note: 'three-seat sofa 2.2 m wide, front (+z) is where you sit' },
  bookshelf: { kind: 'bookshelf', tags: ['bookshelf', 'shelf', 'books', 'furniture'], footprint: 0.6, fall: 'drop', baseHeight: 2.2, defaults: { color: '#5a3a22' }, contact: true, note: 'tall shelf of books 1.2 × 2.2 m; back it onto a wall' },
  fireplace: { kind: 'fireplace', tags: ['fireplace', 'fire', 'light', 'interior'], footprint: 1, fall: 'rise', baseHeight: 4, defaults: { color: '#7a6a5e', trim: '#3a2a20', glow: 1 }, note: 'stone fireplace and chimney breast 2 m wide with a live fire; back it onto a wall' },
  cue_rack: { kind: 'cue_rack', tags: ['rack', 'cue', 'decoration', 'game'], footprint: 0, fall: 'rise', baseHeight: 2, defaults: { color: '#4a2a18', trim: '#d9c8a9' }, note: 'wall rack of pool cues 1.2 m wide; against a wall' },
  potted_plant: { kind: 'potted_plant', tags: ['plant', 'decoration', 'interior'], footprint: 0.4, fall: 'grow', baseHeight: 1.4, defaults: { color: '#3e7a3a', trim: '#a0522d' }, randomYaw: true, contact: true, note: 'leafy plant in a pot, 1.4 m' },

  // ---- outdoor / nature set ----
  water: { kind: 'water', tags: ['water', 'lake', 'pond', 'nature'], footprint: 0, fall: 'rise', baseHeight: 0.05, defaults: { color: '#3f6f8f', length: 60, width: 60 }, sized: true, note: 'still water surface, an oval length × width m (default 60×60); a lake, pond or sea' },
  shore: { kind: 'shore', tags: ['shore', 'beach', 'sand', 'nature'], footprint: 0, fall: 'rise', baseHeight: 0.04, defaults: { color: '#b9a27a', length: 60, width: 60 }, sized: true, note: 'a 4 m band of sand around an oval of length × width: give it the same spot and size as its water' },
  dock: { kind: 'dock', tags: ['dock', 'pier', 'wood', 'structure'], footprint: 0, fall: 'rise', baseHeight: 0.6, defaults: { color: '#8a6a48', trim: '#5a4330', length: 10 }, sized: true, note: 'plank dock 2.4 m wide on posts, starting at its spot and running `length` m (default 10) out its BACK (-z): yaw 0 at the player runs straight ahead' },
  boat: { kind: 'boat', tags: ['boat', 'rowboat', 'vehicle'], footprint: 1.4, fall: 'drop', baseHeight: 0.7, defaults: { color: '#c9b79a', trim: '#7a3b2e' }, note: 'wooden rowboat 3.2 m long (along z), floats; tie it beside a dock' },
  campfire: { kind: 'campfire', tags: ['fire', 'campfire', 'light'], footprint: 0.8, fall: 'flicker', baseHeight: 0.9, defaults: { color: '#6e6a62', glow: 1 }, note: 'stone ring with burning logs and a warm light' },
  tent: { kind: 'tent', tags: ['tent', 'camping', 'shelter'], footprint: 1.6, fall: 'drop', baseHeight: 1.8, defaults: { color: '#d07a3a', trim: '#5a4330' }, contact: true, note: 'A-frame tent 2.4 × 2.6 m, door at the front' },
  reeds: { kind: 'reeds', tags: ['reeds', 'plant', 'nature', 'water'], footprint: 0.4, fall: 'grow', baseHeight: 1.3, defaults: { color: '#6b7a3a', trim: '#5a3d28' }, randomYaw: true, note: 'clump of cattails for water edges' },

  // ---- city set ----
  storefront: { kind: 'storefront', tags: ['building', 'shop', 'storefront', 'city'], footprint: 3, fall: 'drop', baseHeight: 7.2, defaults: { color: '#3a3e4a', trim: '#24262c', glow: 1 }, note: 'two-storey shop 6 m wide, 6 m deep, with a lit shop window, awning, upstairs windows and a glowing sign of its text over the door (text ≤ 12 chars); front faces +z (the street)' },
  car: { kind: 'car', tags: ['car', 'vehicle', 'street'], footprint: 2.2, fall: 'drop', baseHeight: 1.5, defaults: { color: '#c0453a', trim: '#1f1f22', glow: 1 }, contact: true, note: 'parked car 4.4 × 1.8 m (long along z), head- and tail-lights glow' },

  // ---- life (particles) ----
  fireflies: { kind: 'fireflies', tags: ['particles', 'fireflies', 'life', 'ambient'], footprint: 0, fall: 'flicker', baseHeight: 3, defaults: { color: '#fff1a0', length: 24, width: 24 }, sized: true, note: 'a drifting swarm of fireflies over length × width m (default 24×24), 0.5–3 m up' },
  dust_motes: { kind: 'dust_motes', tags: ['particles', 'dust', 'life', 'ambient'], footprint: 0, fall: 'flicker', baseHeight: 3.5, defaults: { color: '#ffe2b0', length: 14, width: 14 }, sized: true, note: 'dust motes hanging in lamplight over length × width m (default 14×14)' },
  embers: { kind: 'embers', tags: ['particles', 'embers', 'smoke', 'fire', 'life'], footprint: 0, fall: 'flicker', baseHeight: 5, defaults: { color: '#ff8a3c' }, note: 'rising sparks and a wisp of smoke; put it on a campfire, fireplace or brazier' },

  // ---- sky (Loop 2): things that live in the air ----
  lantern: { kind: 'lantern', tags: ['lantern', 'light', 'sky', 'decoration', 'paper'], footprint: 0.5, fall: 'grow', baseHeight: 1.15, defaults: { color: '#ff9440', glow: 1 }, note: 'a glowing paper sky lantern with a warm flame inside, 1.1 m; THE floating lantern: give it altitude sky + motion drift; color = paper' },
  bird: { kind: 'bird', tags: ['bird', 'animal', 'creature', 'sky', 'life'], footprint: 0.4, fall: 'grow', baseHeight: 0.4, defaults: { color: '#f2efe9', trim: '#2a2d33' }, note: 'a gull-like bird, 1.2 m wingspan, wings beat and glide; flocks circle: altitude 15–30, motion orbit or fly' },

  // ---- creatures (Loop 3): hand-built and articulated; wings, tails and legs move with their motion ----
  dragon: { kind: 'dragon', tags: ['dragon', 'creature', 'animal', 'beast', 'monster', 'flying'], footprint: 3, fall: 'grow', baseHeight: 4, defaults: { color: '#8e2a1f', trim: '#e6cf9a' }, note: 'THE dragon: a 16 m horned dragon, 16 m wingspan, glowing eyes, breathes embers; arrives diving from the sky with a roar; flies: altitude 15–25 + motion orbit or fly; standing it folds its wings; color = scales, trim = horns and spines' },
  whale: { kind: 'whale', tags: ['whale', 'creature', 'animal', 'sky', 'flying', 'sea'], footprint: 6, fall: 'grow', baseHeight: 6, defaults: { color: '#4b6585', trim: '#cfc8b8', glow: 1 }, note: 'a 25 m sky-whale, barnacled, with soft glowing lights on its belly; it swims through the air: altitude 25–40 + motion orbit or drift; color = skin, trim = barnacles, glow = its lights' },
  horse: { kind: 'horse', tags: ['horse', 'creature', 'animal', 'mammal'], footprint: 1.2, fall: 'grow', baseHeight: 2.2, randomYaw: true, defaults: { color: '#7a4a2a', trim: '#24180f' }, note: 'a horse 2.4 m long, 1.6 m at the back, legs that walk and gallop, grazes when still; herds: count 4–8 + motion gallop or wander; color = coat, trim = mane, tail and hooves' },
  deer: { kind: 'deer', tags: ['deer', 'stag', 'creature', 'animal', 'mammal', 'forest'], footprint: 0.8, fall: 'grow', baseHeight: 1.9, randomYaw: true, defaults: { color: '#a8703f', trim: '#d9c7a4' }, note: 'an antlered deer 1.6 m long, grazes and looks up at you; motion wander; color = coat, trim = antlers' },
  fish_school: { kind: 'fish_school', tags: ['fish', 'school', 'creature', 'animal', 'water', 'life'], footprint: 0, fall: 'grow', baseHeight: 2.8, defaults: { color: '#e2a24a', trim: '#b9562a' }, note: 'a school of 28 golden fish wheeling around a 3–4 m loop, 1–2.6 m up (they swim in air too); altitude to lift it; color = fish' },
  dog: { kind: 'dog', tags: ['dog', 'pet', 'creature', 'animal', 'mammal'], footprint: 0.5, fall: 'grow', baseHeight: 0.75, randomYaw: true, defaults: { color: '#b07a45', trim: '#3a2618' }, note: 'a friendly dog 0.9 m long, wags, sniffs about and looks up at you; "give her a dog" → spawn it beside that person; color = coat, trim = ears, nose and tail tip' },
  butterflies: { kind: 'butterflies', tags: ['butterfly', 'butterflies', 'insect', 'creature', 'animal', 'life'], footprint: 0, fall: 'grow', baseHeight: 2.4, defaults: { color: '#f08a24' }, note: 'a cloud of 18 fluttering butterflies over a 5 m patch; color = wings' },

  // ---- people (NPC): one canonical rig, dressed by role; each has a mind (a persona, a routine, a memory) ----
  person: { kind: 'person', tags: ['person', 'people', 'human', 'npc', 'villager', 'townsfolk', 'everyone'], footprint: 0.35, fall: 'grow', baseHeight: 1.75, contact: true, defaults: { color: '#7a5a8a', trim: '#3a3f4a' }, note: 'THE person: a living villager 1.75 m tall who walks about on a daily routine, remembers, and talks back when spoken to. props role (villager | fisherman | shopkeeper | child | elder | guard | wizard | farmer, or any job word), name (optional; one is given), persona (one short phrase they are grounded in: "knows everything about this lake"), act (wave | bow | cheer | dance | sit | follow | none); color = shirt, trim = trousers' },

  // ---- terrain (Loop 2): real scale; they rise out of the ground. Things spawned on them stand on their surface. ----
  mountain: { kind: 'mountain', tags: ['terrain', 'mountain', 'peak', 'rock', 'nature'], footprint: 150, fall: 'rise', baseHeight: 220, surface: 'mountain', randomYaw: true, defaults: { color: '#6f6a72', trim: '#f3f5fa' }, note: 'a faceted 220 m mountain (scale 0.4–1.8 = 90–400 m) with snow above its upper slopes; color = rock, trim = snow. Big: put it at anchor horizon' },
  mountain_range: { kind: 'mountain_range', tags: ['terrain', 'mountain', 'range', 'mountains', 'rock', 'nature'], footprint: 120, fall: 'rise', baseHeight: 260, surface: 'range', sized: true, defaults: { color: '#66647a', trim: '#f3f5fa', length: 800 }, note: 'ONE entity: a snow-capped ridge of 5–12 peaks up to 260 m along an 800 m arc (length 400–1600); color = rock, trim = snow. Put it at anchor horizon' },
  hill: { kind: 'hill', tags: ['terrain', 'hill', 'grass', 'nature'], footprint: 45, fall: 'rise', baseHeight: 16, surface: 'hill', randomYaw: true, defaults: { color: '#5f8046', trim: '#7a7466' }, note: 'a grassy rounded hill 16 m tall, 90 m across; things placed on it stand on its slope or top (side on_top = the summit). "raise the hill" → height relative' },
  cliff: { kind: 'cliff', tags: ['terrain', 'cliff', 'rock', 'mesa', 'nature'], footprint: 30, fall: 'rise', baseHeight: 45, surface: 'mesa', defaults: { color: '#8a6e58', trim: '#5f7d45' }, note: 'a sheer-sided rock plateau 45 m tall, 100 m wide, its flat top grassy (trim); its face looks at the player; a mesa' },
  volcano: { kind: 'volcano', tags: ['terrain', 'volcano', 'mountain', 'fire', 'lava', 'nature'], footprint: 300, fall: 'rise', baseHeight: 240, surface: 'volcano', randomYaw: true, defaults: { color: '#3d3533', trim: '#26201f', glow: 1 }, note: 'a 240 m volcano with a glowing crater, lava streaks and a smoke plume; glow = how hot. Huge: anchor horizon or gaze far away' },
  waterfall: { kind: 'waterfall', tags: ['terrain', 'water', 'waterfall', 'nature'], footprint: 2, fall: 'rise', baseHeight: 40, defaults: { color: '#cfe8f6', trim: '#6b6460' }, note: 'a 40 m animated waterfall pouring over its own rock lip into a misty pool; against a cliff: at target cliff, side front, gap 0' },
  river: { kind: 'river', tags: ['terrain', 'water', 'river', 'stream', 'nature'], footprint: 0, fall: 'rise', baseHeight: 0.08, sized: true, length: 240, width: 14, defaults: { color: '#3f7396', trim: '#b9a27a', length: 240, width: 14 }, note: 'a flowing river ribbon that winds `length` m (default 240) along its local z, `width` m wide (default 14), with sandy banks; facing player runs it toward you' },
  island: { kind: 'island', tags: ['terrain', 'island', 'sand', 'water', 'nature'], footprint: 40, fall: 'rise', baseHeight: 14, surface: 'island', randomYaw: true, defaults: { color: '#5f8a46', trim: '#d8c38f' }, note: 'a grassy island 80 m across with a sand beach (trim), ringed by its own sea 200 m wide' },
  canyon: { kind: 'canyon', tags: ['terrain', 'canyon', 'cliff', 'rock', 'nature'], footprint: 0, fall: 'rise', baseHeight: 70, surface: 'canyon', sized: true, defaults: { color: '#b0623e', trim: '#d89a6a', length: 320 }, note: 'two banded red-rock walls 70 m tall either side of a 40 m channel running `length` m (default 320) along its local z; at the player it surrounds you' },
  giant_moon: { kind: 'giant_moon', tags: ['sky', 'moon', 'celestial'], footprint: 0, fall: 'grow', baseHeight: 420, defaults: { color: '#e9e6dc', glow: 1 }, note: 'a huge cratered moon hanging 300 m up in the sky (90 m across); anchor horizon' },
  planet: { kind: 'planet', tags: ['sky', 'planet', 'celestial'], footprint: 0, fall: 'grow', baseHeight: 460, defaults: { color: '#d9925a', trim: '#e8d6b0', glow: 1 }, note: 'a giant ringed planet in the sky, 120 m across, 330 m up; color = bands, trim = rings; anchor horizon' }
}

/** The fallback for kinds nobody has defined yet: a labelled crystal holding the spot. */
export const BLOB: KindDescriptor = {
  kind: 'blob', tags: ['placeholder'], footprint: 1.2, fall: 'drop', baseHeight: 2.2, defaults: { color: '#9b8cff', glow: 0.4 }
}

/** Terrain (mountains, hills, cliffs…): rises from the ground, ignores clearance from other things. */
export function isTerrain(desc: KindDescriptor): boolean {
  return desc.tags.includes('terrain') || desc.tags.includes('celestial')
}

export function isKitKind(kind: string): boolean {
  return Object.hasOwn(KIT, kind)
}

/** A descriptor for a learned kind, computed from its parts so footprint and height are honest. */
export function learnedKind(kind: string, tags: string[], parts: Part[]): KindDescriptor {
  let top = 0
  let reach = 0
  // Bounds per part (rotations, tubes, lathes and extrudes included), so footprint and height are honest.
  for (const p of parts) {
    const b = partBounds(p)
    top = Math.max(top, b.max[1])
    reach = Math.max(reach, Math.hypot(Math.max(Math.abs(b.min[0]), Math.abs(b.max[0])), Math.max(Math.abs(b.min[2]), Math.abs(b.max[2]))))
  }
  return {
    kind,
    tags: [...new Set([...tags, kind])],
    footprint: Math.max(0.3, reach),
    fall: 'drop',
    baseHeight: Math.max(0.1, top),
    defaults: {},
    learned: true,
    contact: true,
    parts
  }
}

/** Unknown kinds still exist (as blobs) and keep their requested name, so a later define morphs them. */
export function placeholderKind(kind: string): KindDescriptor {
  return { ...BLOB, kind, tags: ['placeholder', kind], label: kind.replace(/_/g, ' ') }
}

/** Height in metres for an instance, honouring floors, vertical stretch and uniform scale. */
export function kindHeight(desc: KindDescriptor, props: Props): number {
  let h = desc.baseHeight
  if (desc.floorHeight && desc.defaults.floors) {
    const floors = props.floors ?? desc.defaults.floors
    h = desc.baseHeight + (floors - desc.defaults.floors) * desc.floorHeight
  }
  return h * (props.height ?? 1) * (props.scale ?? 1)
}

/** Catalog lines for the model's instructions: `pine: tree, plant, nature`. */
export function catalogLines(kinds: Record<string, KindDescriptor>): string[] {
  return Object.values(kinds).map(k => `${k.kind}: ${k.tags.filter(t => t !== k.kind).join(', ')}${k.learned ? ' (learned)' : ''}`)
}
