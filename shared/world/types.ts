/**
 * Plain world data. No three.js, no Vue: the engine, the tests and the server context builder all share it.
 */
import type { KindDescriptor } from './kinds.ts'
import type { Quality } from './forge.ts'
import type { Part, Ambient, DroppedOp, Op, Props, SkyEvent, TimeOfDay, Vec3, Weather } from './ops.ts'

export interface Entity {
  id: string // 'pine#14'
  kind: string
  tags: string[]
  pos: Vec3
  rotY: number
  props: Props
  group: string // the batch that spawned it, so "those" and "undo that" act on the whole batch
  hue?: number // per-instance hue jitter from `vary`, so a cluster never looks copy-pasted
  /** The circle an orbit / gallop / flight follows ([x, z] centre, radius m), resolved by the kernel from `props.around`. */
  path?: { c: [number, number], r: number }
}

/** Where the player was looking when they started talking. Deictics resolve against this, not live gaze. */
export interface GazeSnapshot {
  point: Vec3
  entity?: string
  dist?: number
}

export interface Player {
  pos: Vec3
  yaw: number // radians; 0 looks down -z (north), positive turns left (three.js convention)
}

export interface OpContext {
  gaze: GazeSnapshot
  player: Player
  seed: number
}

export interface Atmosphere {
  time: TimeOfDay
  fog?: number
  ambient?: Ambient
  weather?: Exclude<Weather, 'clear'>
  /** The player's size: 0.1 = ant-sized among giants (eye height and stride scale with it). Absent = 1. */
  playerScale?: number
}

export interface Batch {
  id: string // group id, 'g7'
  label?: string // the sentence (or canned example) that produced it
  ops: Op[]
  dropped: DroppedOp[]
  ctx: OpContext
  at: number
}

export interface WorldState {
  entities: Entity[]
  /** Kit kinds plus kinds learned through `define` in this world. */
  kinds: Record<string, KindDescriptor>
  atmosphere: Atmosphere
  place: string // the current teleport destination ('void' until someone says "take me to…")
  log: Batch[]
  nextId: number
  nextGroup: number
  lastGroup: string | null
  /**
   * Forged (high-quality) versions of learned kinds, keyed by kind. Not ops: they live beside the log, so
   * undo and replay stay pure. A `define` whose own parts hash equals `basis` builds from `parts` instead.
   */
  upgrades?: Record<string, KindUpgrade>
}

export interface KindUpgrade {
  basis: string
  parts: Part[]
  quality: Quality
}

/** What the renderer should animate after an op. Ids are in creation order so batches can stagger. */
export interface Effects {
  spawned: string[]
  modified: string[]
  removed: string[]
  redefined: string[] // learned kinds whose parts changed: rebuild every instance
  atmosphere: boolean
  say: string[]
  teleport?: { world: string, brief?: string }
  /** The batch started over from the starting world ("start over"): the client also clears minds, view and saves. */
  reset?: boolean
  notes: string[] // why an op did nothing ("no entities match {tag:'tree'}"), for the op log
  /** One-shot sky events to play (lightning at a point, a meteor shower…). Never replayed on load. */
  events?: { kind: SkyEvent, at?: Vec3 }[]
  /** What actually happened, in words ("40 lantern in the sky 15–45 m up, drifting"), for honest replies. */
  facts?: string[]
}
