/**
 * The world language: the single seam between the models, the engine and the renderer.
 *
 * Models emit one flat op shape (`op` is an enum, everything else optional) as plain JSON text, and
 * `parseOps` checks each op strictly on its own and drops the bad ones. One bad op never loses the batch.
 */
import { z } from 'zod'
import { balancedJson } from '../json.ts'

export type Vec3 = [number, number, number]

export const MATERIALS = ['matte', 'wood', 'metal', 'glass', 'stone'] as const
export const SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'torus', 'capsule'] as const
/**
 * The forge's extra shapes (progressive generation): a swept tapered tube, a lathe profile and an extruded
 * outline. Only forged (high-quality) kinds use them; Haiku's `define` keeps the six primitives above.
 */
export const FORGE_SHAPES = ['tube', 'lathe', 'extrude'] as const
export const SLOTS = ['primary', 'trim', 'glow'] as const
/** stack: one on top of another, each resting on the one below ("stack five crates"). */
export const ARRANGEMENTS = ['cluster', 'line', 'ring', 'grid', 'scatter', 'along', 'stack'] as const
export const FACINGS = ['player', 'center', 'along', 'random'] as const
export const TIMES = ['dawn', 'day', 'golden', 'dusk', 'night', 'interior'] as const
/** goto (Gauntlet loop 1): carry the player to a thing ("take me to the top of the tower", "stand on the roof"). */
export const OP_NAMES = ['spawn', 'define', 'modify', 'move', 'remove', 'undo', 'reset', 'atmosphere', 'teleport', 'goto', 'say'] as const
/** Ambient noise beds (synthesized, no files). Director-only: the intent model never sets them. */
export const AMBIENTS = ['none', 'water', 'wind', 'room', 'city', 'fire'] as const
/** Loop 2: how a thing moves (rendered per frame by app/world/fx/motion.ts, never stored as positions). */
/** follow (Gauntlet loop 1): a creature trails the player and keeps up ("a dog that follows me"). */
export const MOTIONS = ['none', 'hover', 'drift', 'orbit', 'fly', 'wander', 'gallop', 'spin', 'sway', 'follow'] as const
/** What an orbit, gallop loop or flight circles: its own group's centre, the player, or the gaze point. */
export const AROUNDS = ['self', 'player', 'gaze'] as const
/** Persistent weather (atmosphere.weather) and one-shot sky events (atmosphere.event). */
export const WEATHERS = ['clear', 'rain', 'snow', 'storm', 'fog', 'aurora'] as const
export const SKY_EVENTS = ['lightning', 'meteors', 'eclipse', 'sunrise'] as const
/** People (NPC): the role presets the canonical person rig dresses for. */
export const ROLES = ['villager', 'fisherman', 'shopkeeper', 'child', 'elder', 'guard', 'wizard', 'farmer'] as const
/**
 * What a person does when the genie tells them to ("make everyone wave at me", "make them all dance").
 * wave, bow and cheer are one-shots (they play once, then the person goes back to their day); dance, sit
 * and follow last until changed; none stops whatever they were told to do.
 */
export const ACTS = ['wave', 'bow', 'cheer', 'dance', 'sit', 'follow', 'none'] as const

export type Material = typeof MATERIALS[number]
export type Shape = typeof SHAPES[number]
export type ForgeShape = typeof FORGE_SHAPES[number]
export type Slot = typeof SLOTS[number]
export type Arrangement = typeof ARRANGEMENTS[number]
export type Facing = typeof FACINGS[number]
export type TimeOfDay = typeof TIMES[number]
export type OpName = typeof OP_NAMES[number]
export type Ambient = typeof AMBIENTS[number]
export type Motion = typeof MOTIONS[number]
export type Around = typeof AROUNDS[number]
export type Weather = typeof WEATHERS[number]
export type SkyEvent = typeof SKY_EVENTS[number]
export type Role = typeof ROLES[number]
export type Act = typeof ACTS[number]

// Hard caps keep a confused model from planting ten thousand trees or a 500-part clock.
export const MAX_COUNT = 80
export const MAX_PARTS = 32

// ---------- the universal property bag ----------

/**
 * A bounded number that CLAMPS instead of failing: one oversized dimension (a Director floor of length 240)
 * becomes the bound rather than dropping the whole op. Non-numbers still fail.
 */
const num = (min: number, max: number, int = false) => z.preprocess(
  v => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, int ? Math.round(v) : v)) : v),
  z.number()
)
const POS = 0.01

const color = z.string().trim().min(1).max(32)

export const PropsSchema = z.object({
  scale: num(POS, 20).optional(),
  height: num(POS, 20).optional(),
  color: color.optional(),
  trim: color.optional(),
  glow: num(0, 10).optional(),
  material: z.enum(MATERIALS).optional(),
  floors: num(1, 40, true).optional(),
  text: z.string().max(40).optional(),
  // Dimensions in metres for sized kinds (floor, wall, rug, water): length along local x, width along z.
  length: num(POS, 200).optional(),
  width: num(POS, 200).optional(),
  // Loop 2: the sky and motion. altitude = metres above the ground, or 'sky' (a spread 15–45 m up).
  altitude: z.union([num(0, 150), z.literal('sky')]).optional(),
  motion: z.enum(MOTIONS).optional(),
  speed: num(POS, 5).optional(), // motion speed multiplier (1 = natural)
  around: z.enum(AROUNDS).optional(), // what orbit / gallop / fly circles
  range: num(POS, 150).optional(), // motion radius in metres (orbit, gallop loop, flight, wander)
  light: num(0, 10).optional(), // casts real light (0 = off); glow is how bright it looks
  // People (NPC): a role preset, a name, a persona hint the mind is grounded in, and something to do now.
  // Free text (a "baker" is fine): the rig dresses the nearest preset (shared/npc/people.ts rolePreset).
  role: z.string().trim().min(1).max(32).transform(r => r.toLowerCase()).optional(),
  name: z.string().trim().min(1).max(32).optional(),
  persona: z.string().trim().min(1).max(240).optional(),
  act: z.string().trim().transform(toAct).optional(),
  /** A person's gender when the sentence says ("two guys", "an old woman"): f | m. */
  gender: z.string().trim().transform(g => (/^(f|female|woman|women|girl|lady|she)/i.test(g) ? 'f' as const : 'm' as const)).optional(),
  /** Set by the kernel on every act (the sentence's seed), so "wave again" replays even when act is unchanged. */
  actId: z.number().optional(),
  // Gauntlet loop 1, physics-lite. drop: it falls from this many metres up ('sky' = 25 m) and settles on the
  // ground or on top of whatever is under it. throw: thrown from the player's eye toward the gaze, landing
  // this many metres away. tip: degrees it is turned over (90 = toppled on its side, 180 = upside down).
  drop: z.union([num(0.5, 120), z.literal('sky')]).optional(),
  throw: num(1, 150).optional(),
  tip: num(-360, 360).optional()
})
export type Props = z.infer<typeof PropsSchema>

// Relative modifies multiply, so the strict check for `set` can't reuse the absolute caps above.
const RelativePropsSchema = PropsSchema.extend({
  scale: num(POS, 20).optional(),
  height: num(POS, 20).optional(),
  floors: num(POS, 40).optional(),
  length: num(POS, 200).optional(),
  width: num(POS, 200).optional()
})

// ---------- selectors, placement, parts ----------

export const SelectorSchema = z.object({
  ref: z.enum(['gaze', 'last', 'all']).optional(),
  kind: z.string().min(1).optional(),
  tag: z.string().min(1).optional(),
  near: z.enum(['gaze', 'player']).optional(),
  within: num(POS, 500).optional(),
  sort: z.enum(['distance', 'height']).optional(),
  limit: num(1, 500, true).optional()
})
export type Selector = z.infer<typeof SelectorSchema>

export const PlacementSchema = z.object({
  anchor: z.enum(['gaze', 'player', 'target', 'horizon']),
  of: SelectorSchema.optional(),
  // 'around' (with anchor player or horizon) spreads the spawn 360° around the player.
  dir: z.enum(['ahead', 'left', 'right', 'behind', 'around']).optional(),
  side: z.enum(['left', 'right', 'front', 'behind', 'on_top', 'around']).optional(),
  dist: num(0, 1500).optional(),
  gap: num(0, 50).optional()
})
export type Placement = z.infer<typeof PlacementSchema>

// Arrays are described rather than tuple-typed so strict-mode JSON schema stays portable; we pad here.
const vec = (min: number) => z.array(z.number()).min(min).max(3)
const toVec3 = (v: number[], fill: number): Vec3 => [v[0] ?? fill, v[1] ?? v[0] ?? fill, v[2] ?? v[0] ?? fill]

export const PartSchema = z.object({
  shape: z.enum(SHAPES),
  size: vec(1),
  at: vec(3),
  rot: vec(3).optional(),
  color,
  slot: z.enum(SLOTS).optional(),
  material: z.enum(MATERIALS).optional()
})
export interface Part {
  shape: Shape | ForgeShape
  size: Vec3 // bounding box [w, h, d] of the primitive (for tube / lathe / extrude: their local bounds, informational)
  at: Vec3 // centre offset from the object's ground origin (tube / lathe / extrude: their local origin)
  rot?: Vec3
  color: string
  slot?: Slot
  material?: Material
  /** tube: the swept path, relative to `at`, and a radius per point (tapers). */
  points?: Vec3[]
  radii?: number[]
  /** lathe: [radius, y] pairs bottom → top, turned around local y. */
  profile?: [number, number][]
  /** extrude: a 2D outline in local x–y, `depth` thick along local z. */
  outline?: [number, number][]
  depth?: number
}

/**
 * The Director's loose op (Sprint 4): one flat object for spawn / atmosphere / say, placed by room
 * coordinates. `xz` is [x, z] in metres in the room frame (origin = the player's feet at teleport time,
 * -z = the way they faced, +x = their right); `yaw` is degrees in that frame (0 = front faces +z, back toward
 * the player); `size` is [length, width]. `directorToOp` turns it into a normal op before `parseOps`.
 *
 * Why so flat and string-typed: Anthropic compiles structured-output schemas into a grammar, and compile
 * time explodes with optional fields (measured: 4 → 2.5 s, 10 → 11.5 s, 13 → 45 s, 20 → "Schema is too
 * complex"). Since Loop 1 the Director writes JSON in plain text (no grammar), so this schema is now the
 * documented shape and the test's guard, not a model constraint. The intent model never sees this schema
 * or room coordinates.
 */
export const DirectorOpSchema = z.object({
  // Key order is the grammar's order: atmosphere keys first, then spawn keys, `text` last (say, neon),
  // so a model that has just written a sign's text isn't walked back through atmosphere keys.
  op: z.enum(['atmosphere', 'define', 'spawn', 'say']),
  time: z.string().optional(),
  fog: z.number().optional(),
  ambient: z.string().optional(),
  weather: z.string().optional(),
  kind: z.string().optional(),
  xz: z.array(z.number()).optional(),
  yaw: z.number().optional(),
  count: z.number().optional(),
  arrange: z.string().optional(),
  radius: z.number().optional(),
  size: z.array(z.number()).optional(),
  scale: z.number().optional(),
  color: z.string().optional(),
  altitude: z.union([z.number(), z.string()]).optional(),
  motion: z.string().optional(),
  // define (Gauntlet loop 1): a signature prop the catalog lacks, in the intent language's part format.
  tags: z.array(z.string()).optional(),
  parts: z.array(z.unknown()).optional(),
  /** The one signature prop per place that is worth forging into a high-quality version. */
  hero: z.boolean().optional(),
  /** person spawns: their job ("guard", "trader"). */
  role: z.string().optional(),
  text: z.string().optional()
})
export type DirectorOp = z.infer<typeof DirectorOpSchema>

/**
 * A Director op → the normal op shape (still unvalidated: run the result through `parseOps`). Spawn props
 * (color, size, scale, text) move into `set`; neon text stays text. Never throws.
 */
export function directorToOp(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const d = raw as Partial<DirectorOp> & Record<string, unknown>
  if (d.op === 'say') return { op: 'say', text: d.text }
  if (d.op === 'define') {
    const out: Record<string, unknown> = { op: 'define', kind: d.kind, tags: d.tags ?? [], parts: d.parts }
    if (d.hero === true) out.hero = true
    return out
  }
  if (d.op === 'atmosphere') {
    const out: Record<string, unknown> = { op: 'atmosphere' }
    if (d.time !== undefined) out.time = d.time
    if (typeof d.fog === 'number') out.fog = Math.min(1, Math.max(0, d.fog))
    if (d.ambient !== undefined) out.ambient = d.ambient
    if (typeof d.weather === 'string' && (WEATHERS as readonly string[]).includes(d.weather)) out.weather = d.weather
    for (const k of ['sky', 'horizon', 'moons', 'intensity', 'gravity'] as const) if ((raw as Record<string, unknown>)[k] !== undefined) out[k] = (raw as Record<string, unknown>)[k]
    return out
  }
  if (d.op !== 'spawn') return raw
  const set: Record<string, unknown> = {}
  if (d.color) set.color = d.color
  if (d.text) set.text = String(d.text).slice(0, 40)
  if (typeof d.scale === 'number' && d.scale > 0) set.scale = d.scale
  if (d.altitude === 'sky' || (typeof d.altitude === 'number' && d.altitude >= 0)) set.altitude = typeof d.altitude === 'number' ? Math.min(150, d.altitude) : 'sky'
  if (typeof d.motion === 'string' && (MOTIONS as readonly string[]).includes(d.motion)) set.motion = d.motion
  if (typeof d.role === 'string' && d.role.trim()) set.role = d.role.trim().slice(0, 32)
  if (Array.isArray(d.size)) {
    if (typeof d.size[0] === 'number' && d.size[0] > 0) set.length = d.size[0]
    if (typeof d.size[1] === 'number' && d.size[1] > 0) set.width = d.size[1]
  }
  const out: Record<string, unknown> = { op: 'spawn', kind: d.kind }
  if (Array.isArray(d.xz)) out.xz = d.xz.slice(0, 2)
  if (typeof d.yaw === 'number') out.yaw = d.yaw
  if (typeof d.count === 'number') out.count = Math.max(1, Math.round(d.count))
  if (d.arrange && (ARRANGEMENTS as readonly string[]).includes(d.arrange)) out.arrange = d.arrange
  if (typeof d.radius === 'number' && d.radius > 0) out.radius = d.radius
  if (Object.keys(set).length) out.set = set
  return out
}

// ---------- strict per-op schemas ----------

const kindName = z.string().trim().min(1).max(48).transform(normalizeKind)

const SpawnOp = z.object({
  op: z.literal('spawn'),
  kind: kindName,
  count: num(1, MAX_COUNT, true).optional(),
  arrange: z.enum(ARRANGEMENTS).optional(),
  at: PlacementSchema.optional(),
  radius: num(POS, 200).optional(),
  vary: num(0, 1).optional(),
  facing: z.enum(FACINGS).optional(),
  set: PropsSchema.optional(),
  // Director-only room placement (see DirectorOpSchema). Overrides `at`; skips de-overlap.
  xz: z.array(num(-1500, 1500)).length(2).optional(),
  yaw: num(-720, 720).optional()
})

const DefineOp = z.object({
  op: z.literal('define'),
  kind: kindName,
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
  parts: z.array(PartSchema).min(1).max(MAX_PARTS),
  /** Director only: this place's signature prop, worth one forge refine. Never changes the kernel's result. */
  hero: z.boolean().optional()
}).transform(d => ({
  ...d,
  tags: (d.tags ?? []).map(t => t.toLowerCase()),
  parts: d.parts.map((p): Part => ({
    ...p,
    size: toVec3(p.size, 1).map(n => Math.max(0.01, Math.abs(n))) as Vec3,
    at: toVec3(p.at, 0),
    rot: p.rot ? toVec3(p.rot, 0) : undefined
  }))
}))

const ModifyOp = z.object({
  op: z.literal('modify'),
  target: SelectorSchema,
  set: RelativePropsSchema.refine(s => Object.keys(s).length > 0, 'set is empty'),
  relative: z.boolean().optional()
})

const MoveOp = z.object({ op: z.literal('move'), target: SelectorSchema, at: PlacementSchema })
const RemoveOp = z.object({ op: z.literal('remove'), target: SelectorSchema })
const UndoOp = z.object({ op: z.literal('undo') })
/** "Start over": back to the starting world (no entities, golden hour, clear sky, normal size). Never logged. */
const ResetOp = z.object({ op: z.literal('reset') })

const AtmosphereOp = z.object({
  op: z.literal('atmosphere'),
  time: z.enum(TIMES).optional(),
  fog: num(0, 1).optional(),
  ambient: z.enum(AMBIENTS).optional(),
  weather: z.enum(WEATHERS).optional(),
  event: z.enum(SKY_EVENTS).optional(),
  // "Make me tiny" / "make everything ten times bigger": the player's size (eye height, stride). 1 = normal.
  playerScale: num(0.02, 10).optional(),
  // Gauntlet loop 1. gravity false: loose things float up and turn (true brings them down). fly: the player
  // flies (Space rises, look + W carries you). sky / horizon: custom sky colours (hex) over the time preset.
  // moons: how many moons hang in the sky (0–3). intensity 0..1: how hard the weather is (1 = a blizzard's white-out).
  gravity: z.boolean().optional(),
  fly: z.boolean().optional(),
  sky: color.optional(),
  horizon: color.optional(),
  moons: num(0, 3, true).optional(),
  intensity: num(0, 1).optional()
}).refine(a => Object.keys(a).some(k => k !== 'op'), 'atmosphere needs at least one field')

const TeleportOp = z.object({ op: z.literal('teleport'), world: z.string().trim().min(1).max(80), brief: z.string().max(400).optional() })
/** "Take me to the top of the tower": the player glides to the target (on_top = stands on its highest point; front = before it). */
const GotoOp = z.object({ op: z.literal('goto'), target: SelectorSchema, side: z.enum(['on_top', 'front']).optional() })
const SayOp = z.object({ op: z.literal('say'), text: z.string().trim().min(1).max(280) })

const STRICT = {
  spawn: SpawnOp,
  define: DefineOp,
  modify: ModifyOp,
  move: MoveOp,
  remove: RemoveOp,
  undo: UndoOp,
  reset: ResetOp,
  atmosphere: AtmosphereOp,
  teleport: TeleportOp,
  goto: GotoOp,
  say: SayOp
} as const

export type SpawnOp = z.infer<typeof SpawnOp>
export type DefineOp = z.infer<typeof DefineOp>
export type ModifyOp = z.infer<typeof ModifyOp>
export type MoveOp = z.infer<typeof MoveOp>
export type RemoveOp = z.infer<typeof RemoveOp>
export type UndoOp = z.infer<typeof UndoOp>
export type ResetOp = z.infer<typeof ResetOp>
export type AtmosphereOp = z.infer<typeof AtmosphereOp>
export type TeleportOp = z.infer<typeof TeleportOp>
export type GotoOp = z.infer<typeof GotoOp>
export type SayOp = z.infer<typeof SayOp>
/** A strictly validated op. The engine only ever sees these. */
export type Op = SpawnOp | DefineOp | ModifyOp | MoveOp | RemoveOp | UndoOp | ResetOp | AtmosphereOp | TeleportOp | GotoOp | SayOp

export interface DroppedOp {
  index: number
  raw: unknown
  reason: string
}

/**
 * Strict per-op parse. Accepts `{ ops: [...] }` (also with `ops` as a JSON string), a bare array, or a single op object; never throws.
 * Invalid ops come back in `dropped` (with a console warning) and the valid siblings still apply.
 */
export function parseOps(raw: unknown): { ops: Op[], dropped: DroppedOp[] } {
  // Models sometimes stringify the array inside the envelope ({ "ops": "[{...}]" }) on long answers.
  if (raw && typeof raw === 'object' && typeof (raw as { ops?: unknown }).ops === 'string') {
    const inner = leadingJsonArray((raw as { ops: string }).ops)
    if (inner) raw = { ops: inner }
  }
  let list: unknown[]
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === 'object' && Array.isArray((raw as { ops?: unknown }).ops)) list = (raw as { ops: unknown[] }).ops
  else if (raw && typeof raw === 'object' && 'op' in raw) list = [raw]
  else return { ops: [], dropped: [{ index: -1, raw, reason: 'expected { ops: [...] } or an array of ops' }] }

  const ops: Op[] = []
  const dropped: DroppedOp[] = []
  list.forEach((item, index) => {
    const name = item && typeof item === 'object' ? (item as { op?: unknown }).op : undefined
    const schema = typeof name === 'string' ? STRICT[name as OpName] : undefined
    if (!schema) {
      dropped.push({ index, raw: item, reason: `unknown op ${JSON.stringify(name)}` })
      return
    }
    const res = schema.safeParse(item)
    if (res.success) {
      ops.push(stripUndefined(res.data) as Op)
    } else {
      const reason = res.error.issues.map(i => `${i.path.join('.') || name}: ${i.message}`).join('; ')
      dropped.push({ index, raw: item, reason })
    }
  })
  for (const d of dropped) console.warn(`[conjure] dropped op #${d.index}: ${d.reason}`)
  return { ops, dropped }
}

/**
 * Parse the first balanced JSON array in a string. Stringified envelopes sometimes carry a stray
 * closing brace after the array (`"[{...}]}"`), so a plain JSON.parse isn't enough.
 */
function leadingJsonArray(text: string): unknown[] | null {
  const body = balancedJson(text, text.indexOf('['))
  if (!body) return null
  try {
    const v = JSON.parse(body)
    return Array.isArray(v) ? v : null
  } catch {
    return null
  }
}

const ACT_ALIASES: Record<string, Act> = {
  waving: 'wave', greet: 'wave', hello: 'wave', bowing: 'bow', curtsy: 'bow', clap: 'cheer', clapping: 'cheer', cheering: 'cheer', celebrate: 'cheer',
  dancing: 'dance', party: 'dance', sitting: 'sit', sit_down: 'sit', following: 'follow', follow_me: 'follow', come: 'follow',
  stop: 'none', idle: 'none', stand: 'none', normal: 'none'
}

/** An act word → one of ACTS ("dancing" → dance, "stop" → none). Unknown words become 'none' rather than failing the op. */
export function toAct(word: string): Act {
  const w = word.toLowerCase().replace(/[\s-]+/g, '_')
  if ((ACTS as readonly string[]).includes(w)) return w as Act
  return ACT_ALIASES[w] ?? 'none'
}

/** 'Grandfather Clock' → 'grandfather_clock'. Kinds are ids, so they get one spelling. */
export function normalizeKind(kind: string): string {
  return kind.trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '')
}

// zod keeps explicit undefined keys from transforms; dropping them keeps the op log JSON tidy.
function stripUndefined<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripUndefined) as T
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, stripUndefined(x)])) as T
  }
  return v
}
