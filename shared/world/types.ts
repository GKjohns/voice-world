/**
 * Plain world data. No three.js, no Vue: the engine, the tests and the server context builder all share it.
 */
import type { KindDescriptor } from './kinds.ts'
import type { Ambient, DroppedOp, Op, Props, TimeOfDay, Vec3 } from './ops.ts'

export interface Entity {
  id: string // 'pine#14'
  kind: string
  tags: string[]
  pos: Vec3
  rotY: number
  props: Props
  group: string // the batch that spawned it, so "those" and "undo that" act on the whole batch
  hue?: number // per-instance hue jitter from `vary`, so a cluster never looks copy-pasted
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
  notes: string[] // why an op did nothing ("no entities match {tag:'tree'}"), for the op log
}
