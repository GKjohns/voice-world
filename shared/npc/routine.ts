/**
 * A day in the life: the world's time of day → a routine slot → the block they're in → the place they go
 * and the spot they stand at. The world's clock is coarse (dawn, day, golden, dusk, night), so a "day"
 * walks through morning, midday and afternoon on a slow shared clock, and people move about even when
 * nobody touches the sky. Pure and three-free.
 */
import type { TimeOfDay, Vec3 } from '../world/ops.ts'
import { DAY_SLOTS } from './persona.ts'
import type { DaySlot, RoutineBlock } from './persona.ts'

/** Seconds a slot lasts when the world's time spans several (a "day" is morning → midday → afternoon). */
export const SLOT_SECONDS = 50

/**
 * Calm mode: a routine stays local. People stay roughly where the genie put them: a place further than this
 * from there is out of their day (they do the thing where they are), they potter only a few steps, and they
 * linger a long while between.
 */
export const ROUTINE_RANGE = 6
export const POTTER_RADIUS = 2.5
export const LINGER_S: [number, number] = [18, 40]

export function slotsFor(time: TimeOfDay): DaySlot[] {
  switch (time) {
    case 'dawn': return ['dawn', 'morning']
    case 'day': return ['morning', 'midday', 'afternoon']
    case 'golden': return ['afternoon', 'evening']
    case 'dusk': return ['evening']
    case 'night': return ['night']
    case 'interior': return ['midday', 'afternoon']
  }
}

/** The slot now: the world's time, walked through on the shared clock (`tSec` = seconds since the page opened). */
export function currentSlot(time: TimeOfDay, tSec: number): DaySlot {
  const list = slotsFor(time)
  return list[Math.floor(Math.max(0, tSec) / SLOT_SECONDS) % list.length]!
}

/** The block for a slot: the one written for it, else the latest one before it in the day (wrapping round). */
export function pickBlock(routine: RoutineBlock[], slot: DaySlot): RoutineBlock | undefined {
  if (!routine.length) return undefined
  const exact = routine.find(b => b.when === slot)
  if (exact) return exact
  const at = DAY_SLOTS.indexOf(slot)
  for (let k = 1; k <= DAY_SLOTS.length; k++) {
    const want = DAY_SLOTS[(at - k + DAY_SLOTS.length) % DAY_SLOTS.length]
    const b = routine.find(r => r.when === want)
    if (b) return b
  }
  return routine[0]
}

/** Just what placing a routine needs from an entity (structural, so the client can pass live entities). */
export interface PlaceEntity {
  id: string
  kind: string
  tags: string[]
  pos: Vec3
  rotY: number
  props: { name?: string, length?: number, width?: number }
}

/** A target as the model writes it → a place word: "Maeve the villager" → "maeve", "the old dock" → "old dock". */
export function cleanTarget(target: string): string {
  return target.toLowerCase().trim().replace(/[.!?]+$/, '').replace(/^(?:the|a|an)\s+/, '').replace(/\s+the\s+[\w ]{2,24}$/, '')
}

/** What a place word finds: the nearest entity (to `home`) of that kind, then tag, then a person by name, within `range` m. */
export function resolvePlace(place: string, entities: PlaceEntity[], home: [number, number], selfId: string, range = 90): PlaceEntity | undefined {
  // "the dock", "3 reeds", "12_pine": the scene lists counts, and models copy them.
  const w = place.toLowerCase().trim().replace(/^(the|a|an|some|\d+)[\s_]+/, '').replace(/[\s-]+/g, '_')
  if (!w || w === 'home' || w === 'wander') return undefined
  const forms = [w, w.replace(/es$/, ''), w.replace(/s$/, '')]
  const near = (list: PlaceEntity[]) => list
    .map(e => ({ e, d: Math.hypot(e.pos[0] - home[0], e.pos[2] - home[1]) }))
    .filter(x => x.d <= range && x.e.id !== selfId)
    .sort((a, b) => a.d - b.d)[0]?.e
  const others = entities.filter(e => e.id !== selfId)
  for (const f of forms) {
    const byName = near(others.filter(e => e.kind === 'person' && e.props.name?.toLowerCase().replace(/\s+/g, '_') === f))
    if (byName) return byName
    const byKind = near(others.filter(e => e.kind === f))
    if (byKind) return byKind
  }
  // "person" as a place means "someone to chat with": only other people, never yourself.
  for (const f of forms) {
    const byTag = near(others.filter(e => e.tags.includes(f) && !(e.kind === 'person' && f !== 'person' && f !== 'people')))
    if (byTag) return byTag
  }
  // "pool" → pool_table, "bar" / "counter" → bar_counter: a word of a compound kind.
  for (const f of forms) {
    const byPart = near(others.filter(e => e.kind !== 'person' && e.kind.split('_').includes(f)))
    if (byPart) return byPart
  }
  return undefined
}

/** Where to stand for a place and which way to face (yaw: 0 faces +z, three.js convention). */
export interface StandPoint { x: number, z: number, yaw: number }

/**
 * Where a person stands to use a place, approached from `from`. A dock: near its far end, facing out over
 * the water (the dock runs out its back, -z). Water: on the shore side nearest them, facing it. Anything
 * else: just outside its footprint on their side, facing it. `jitter` (0..1, seeded per person) spreads a
 * crowd round the same thing.
 */
export function standPoint(target: PlaceEntity, footprint: number, from: [number, number], jitter = 0.5): StandPoint {
  const [tx, , tz] = target.pos
  if (target.kind === 'dock' || target.kind === 'pier') {
    const len = target.props.length ?? 10
    const s = Math.sin(target.rotY)
    const c = Math.cos(target.rotY)
    const along = len * (0.72 + 0.18 * jitter)
    const side = (jitter - 0.5) * 1.2
    // Out the back: local (side, -along) → world.
    const x = tx + side * c - along * s
    const z = tz - side * s - along * c
    return { x, z, yaw: Math.atan2(-s, -c) }
  }
  let dx = from[0] - tx
  let dz = from[1] - tz
  let d = Math.hypot(dx, dz)
  if (d < 1e-3) {
    dx = 0
    dz = 1
    d = 1
  }
  if (target.kind === 'water') {
    // The shore of the oval nearest them (no spread: a swerve round a lake is a long way), a step back from the edge.
    const c = Math.cos(target.rotY)
    const s = Math.sin(target.rotY)
    const lx = (dx * c - dz * s) / d
    const lz = (dx * s + dz * c) / d
    const a = (target.props.length ?? 60) / 2
    const b = (target.props.width ?? 60) / 2
    const k = 1 / Math.sqrt((lx / a) ** 2 + (lz / b) ** 2) + 1.5
    const x = tx + (dx / d) * k
    const z = tz + (dz / d) * k
    return { x, z, yaw: Math.atan2(tx - x, tz - z) }
  }
  const spread = (jitter - 0.5) * 1.6 // up to ±0.8 rad round the thing
  const a = Math.atan2(dx / d, dz / d) + spread
  const r = Math.max(0.9, footprint + 0.7)
  const x = tx + Math.sin(a) * r
  const z = tz + Math.cos(a) * r
  return { x, z, yaw: Math.atan2(tx - x, tz - z) }
}
