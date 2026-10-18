/**
 * Motion (Loop 2): hover, drift, orbit, fly, wander, gallop, spin and sway, computed per frame from an
 * entity's props. Positions in the world state never change; the renderer adds the pose on top, on the
 * item's `stretch` group, so arrival and move tweens on the holder keep working underneath it.
 *
 * Deterministic: a pose is a pure function of (entity, seconds since its motion began), with every phase
 * and rate seeded from the entity id. A replayed or reloaded world moves exactly the same way.
 * Pure math (no three.js), so tests import it directly.
 */
import type { Motion, Props, Vec3 } from '../../../shared/world/ops.ts'

export interface MotionEntity {
  id: string
  pos: Vec3
  rotY: number
  props: Props
  path?: { c: [number, number], r: number }
}

/** World-space pose: where the thing is and which way it faces, plus a bank (roll) and a nod (pitch). */
export interface Pose {
  x: number
  y: number
  z: number
  yaw: number
  roll: number
  pitch: number
}

/** 0..1 from the id: every phase and rate is seeded, so the same id always moves the same way. */
export function seedOf(id: string, salt = 0): number {
  let h = 2166136261 ^ salt
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619)
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

const TAU = Math.PI * 2

/** Natural cruising speeds in m/s at speed 1, by motion. Big flyers go a little faster. */
const CRUISE: Partial<Record<Motion, number>> = { orbit: 7, fly: 8, gallop: 8, wander: 1.1 }

/** Seconds a motion takes to blend in from standing still (so a modify never teleports the thing). */
export const BLEND_IN = 1.4

/**
 * How a kind moves (Loop 3, creatures): `pace` scales its natural speed (a sky-whale cruises at a third of
 * a gull's), and `creature` makes drift a slow swim that faces where it goes instead of a wind-blown wobble.
 */
export interface MotionStyle {
  pace?: number
  creature?: boolean
}

/** Where `e` is at `t` seconds into its motion. Null when it has no motion. */
export function motionPose(e: MotionEntity, t: number, height = 1, style?: MotionStyle): Pose | null {
  const m = e.props.motion
  if (!m || m === 'none') return null
  const k = (e.props.speed ?? 1) * (style?.pace ?? 1)
  const ph = seedOf(e.id) * TAU
  const jit = 0.85 + 0.3 * seedOf(e.id, 7)
  const [x0, y0, z0] = e.pos
  const base: Pose = { x: x0, y: y0, z: z0, yaw: e.rotY, roll: 0, pitch: 0 }

  switch (m) {
    case 'hover': {
      // Off the ground if it was standing on it; a slow breathing bob and a lazy turn.
      const lift = y0 < 0.3 ? 0.5 + 0.15 * height : 0
      const amp = 0.18 + 0.05 * Math.min(height, 6)
      return { ...base, y: y0 + lift + amp * Math.sin(t * 1.15 * k * jit + ph), yaw: e.rotY + 0.12 * Math.sin(t * 0.3 * k + ph), roll: 0.03 * Math.sin(t * 0.9 * k + ph) }
    }
    case 'drift': {
      // A creature swims its patch: a slow figure-of-eight, nose first (a whale doesn't slide sideways).
      if (style?.creature) {
        const R = e.props.range ?? 12
        return travel({ ...e, path: { c: [x0 - R, z0], r: R } }, 'fly', t, k * 0.45, ph, jit, height)
      }
      // Wind-blown: a wide, slow wander downwind and back, rising and falling, turning gently. Never leaves its patch.
      const A = (e.props.range ?? 5) * jit
      const w = 0.06 * k * jit
      const dx = A * (Math.sin(t * w + ph) + 0.45 * Math.sin(t * w * 2.3 + ph * 1.7))
      const dz = A * 0.7 * (Math.cos(t * w * 0.8 + ph * 1.3) + 0.4 * Math.sin(t * w * 1.9 + ph))
      const lift = y0 < 0.3 ? 1.5 : 0
      return { ...base, x: x0 + dx, z: z0 + dz, y: y0 + lift + 1.4 * Math.sin(t * 0.21 * k + ph) + 0.3 * Math.sin(t * 0.9 * k + ph * 2), yaw: e.rotY + t * 0.08 * k * (seedOf(e.id, 3) > 0.5 ? 1 : -1), roll: 0.06 * Math.sin(t * 0.7 * k + ph), pitch: 0.05 * Math.sin(t * 0.55 * k + ph * 1.3) }
    }
    case 'follow':
      // Trails the player: the renderer steps it every frame (followStep), since it needs where you are.
      return null
    case 'spin':
      return { ...base, yaw: e.rotY + t * 1.2 * k }
    case 'sway':
      // Rocks about its base (trees in wind, a buoy): pivot is the ground origin.
      return { ...base, roll: 0.07 * Math.sin(t * 1.3 * k * jit + ph) + 0.02 * Math.sin(t * 3.1 * k + ph), pitch: 0.04 * Math.sin(t * 0.9 * k * jit + ph * 2) }
    default:
      return travel(e, m, t, k, ph, jit, height)
  }
}

/** Motions that go somewhere: the pose follows a path, facing along it and banking into the turns. */
function travel(e: MotionEntity, m: Motion, t: number, k: number, ph: number, jit: number, height: number): Pose {
  const at = (s: number) => pathPoint(e, m, s, k, ph, jit, height)
  const p = at(t)
  const q = at(t + 0.08)
  const r = at(t + 0.16)
  const yaw = Math.atan2(q[0] - p[0], q[2] - p[2])
  const yaw2 = Math.atan2(r[0] - q[0], r[2] - q[2])
  const turn = wrap(yaw2 - yaw) / 0.08 // rad/s
  let roll = 0
  let pitch = 0
  let y = p[1]
  if (m === 'gallop') {
    // A stride: the body bounds and rocks at the gait's rhythm.
    const f = 7.5 * Math.min(1.6, k)
    y += Math.abs(Math.sin(t * f + ph)) * 0.12 * Math.max(1, height * 0.5)
    pitch = 0.07 * Math.sin(t * f * 2 + ph)
  } else if (m === 'wander') {
    y += Math.abs(Math.sin(t * 6 * k + ph)) * 0.03 * height
  } else {
    // Flyers bank into the turn and rise a little on the straights.
    roll = Math.max(-0.5, Math.min(0.5, -turn * 0.35))
    pitch = Math.max(-0.2, Math.min(0.2, (q[1] - p[1]) / 0.08 * -0.05))
  }
  return { x: p[0], y, z: p[2], yaw, roll, pitch }
}

function pathPoint(e: MotionEntity, m: Motion, t: number, k: number, ph: number, jit: number, height: number): Vec3 {
  const [x0, y0, z0] = e.pos
  if (m === 'wander') {
    // Grazing around its spot: two slow incommensurate sines, so it never quite repeats.
    const R = e.props.range ?? 4
    const w = ((CRUISE.wander! * k) / R) * 0.5 * jit
    return [x0 + R * (0.65 * Math.sin(t * w + ph) + 0.35 * Math.sin(t * w * 1.73 + ph * 2.1)), y0, z0 + R * (0.65 * Math.cos(t * w * 0.9 + ph * 1.4) + 0.35 * Math.sin(t * w * 1.37 + ph))]
  }
  const path = e.path ?? { c: [x0, z0 + 10] as [number, number], r: 10 }
  const [cx, cz] = path.c
  const R = Math.max(1, path.r)
  // Start where the thing stands on its circle, so a motion that begins mid-world doesn't jump.
  const a0 = Math.atan2(z0 - cz, x0 - cx)
  const v = (CRUISE[m] ?? 6) * k * (m === 'gallop' ? jit : 1) * (1 + Math.min(1, height / 20))
  const w = v / R
  if (m === 'fly') {
    // A wandering flight: a figure-of-eight over the region, rising and dipping as it goes.
    const s = a0 + t * w * 0.8
    const dx = R * Math.cos(s)
    const dz = R * 0.6 * Math.sin(2 * s)
    return [cx + dx, Math.max(2, y0 + 3 * Math.sin(s * 1.5 + ph)), cz + dz]
  }
  const s = a0 + t * w
  const bob = m === 'orbit' ? 0.8 * Math.sin(t * 0.7 + ph) : 0
  return [cx + R * Math.cos(s), y0 + bob, cz + R * Math.sin(s)]
}

function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

/**
 * The pose blended in from rest over BLEND_IN seconds. `t` is seconds since the motion began; pass
 * Infinity-free values. The result is still pure: the same (entity, t) always gives the same pose.
 */
export function blendedPose(e: MotionEntity, t: number, height = 1, style?: MotionStyle): Pose | null {
  const p = motionPose(e, t, height, style)
  if (!p) return null
  const b = ease(Math.min(1, Math.max(0, t / BLEND_IN)))
  if (b >= 1) return p
  const dy = wrap(p.yaw - e.rotY)
  return { x: e.pos[0] + (p.x - e.pos[0]) * b, y: e.pos[1] + (p.y - e.pos[1]) * b, z: e.pos[2] + (p.z - e.pos[2]) * b, yaw: e.rotY + dy * b, roll: p.roll * b, pitch: p.pitch * b }
}

/** What the renderer needs from an item: the groups and the entity. Structural, so this file stays three-free. */
export interface MotionTarget {
  entity: MotionEntity
  holder: { scale: { x: number }, rotation: { y: number } }
  stretch: { position: { set(x: number, y: number, z: number): unknown }, rotation: { set(x: number, y: number, z: number, order?: 'XYZ' | 'YXZ'): unknown } }
}

/**
 * Put a pose on an item's stretch group, in the holder's frame: the holder still sits at the entity's
 * position with its yaw and scale (and its tweens), so the offset is un-rotated and un-scaled here.
 */
export function applyPose(item: MotionTarget, pose: Pose | null): void {
  const { entity: e, holder, stretch } = item
  if (!pose) {
    stretch.position.set(0, 0, 0)
    stretch.rotation.set(0, 0, 0, 'XYZ')
    return
  }
  const s = Math.max(1e-3, holder.scale.x)
  const dx = pose.x - e.pos[0]
  const dy = pose.y - e.pos[1]
  const dz = pose.z - e.pos[2]
  const ry = holder.rotation.y
  const c = Math.cos(ry)
  const sn = Math.sin(ry)
  // Inverse of the holder's yaw: world offset → holder-local offset.
  stretch.position.set((dx * c - dz * sn) / s, dy / s, (dx * sn + dz * c) / s)
  stretch.rotation.set(pose.pitch, wrap(pose.yaw - ry), pose.roll, 'YXZ')
}

// ---------- Loop 3: creatures. What the body is doing, then what every joint does about it. ----------

/**
 * A creature's state of motion this frame, from the same pure pose (so it is deterministic too): how fast
 * it goes, how hard it turns and climbs, how high it is, where its stride is, and where the player is.
 */
export interface Drive {
  motion: Motion | 'none'
  /** Seconds on its clock: the motion clock while it moves, the wall clock while it stands. */
  t: number
  /** 0..1 from the id: every creature's phases differ. */
  seed: number
  speed: number // horizontal m/s
  turn: number // rad/s, + = turning left (toward +x)
  climb: number // m/s
  air: number // metres above the ground under it
  /** Stride in cycles (continuous); one cycle = every leg steps once. */
  stride: number
  /** 0..1 how much the gait shows (ramps with speed). */
  step: number
  /** Toward the player, in the body's frame, already weighted by `lookW`: [yaw, pitch]. */
  look: [number, number]
  lookW: number
  /** Arrival theatre the renderer sets: 0..1 into a dive, and 0..1 of a roar. */
  dive?: number
  roar?: number
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const smooth = (v: number) => {
  const x = clamp(v, 0, 1)
  return x * x * (3 - 2 * x)
}
const frac = (v: number) => v - Math.floor(v)
/** 0..1, on for the part of a slow seeded sine above `above`: "now and then". */
const window01 = (t: number, rate: number, phase: number, above: number) => smooth((Math.sin(t * rate + phase) - above) / (1 - above) * 1.6)

/** The drive of `e` at `t` (see Drive). `player` is the eye position; `ground` the terrain height under it. */
export function driveOf(e: MotionEntity, t: number, height = 1, style?: MotionStyle, player?: Vec3, ground = 0): Drive {
  const seed = seedOf(e.id)
  const ph = seed * TAU
  const m = e.props.motion ?? 'none'
  const k = (e.props.speed ?? 1) * (style?.pace ?? 1)
  const p = blendedPose(e, t, height, style)
  const here = p ?? { x: e.pos[0], y: e.pos[1], z: e.pos[2], yaw: e.rotY, roll: 0, pitch: 0 }
  let speed = 0
  let turn = 0
  let climb = 0
  if (p) {
    const dt = 0.05
    const q = blendedPose(e, t + dt, height, style)!
    speed = Math.hypot(q.x - p.x, q.z - p.z) / dt
    climb = (q.y - p.y) / dt
    turn = wrap(q.yaw - p.yaw) / dt
  }
  // The stride runs at the same rhythm as the body's bound in `travel`, so the feet and the bounce agree.
  let stride = 0
  let step = 0
  if (m === 'gallop') {
    stride = (t * 7.5 * Math.min(1.6, k) + ph) / Math.PI
    step = clamp(speed / 4, 0, 1)
  } else if (m === 'wander') {
    stride = (t * 6 * k + ph) / TAU
    step = clamp(speed / 0.5, 0, 1)
  } else if (speed > 0.2) {
    stride = t * 0.9 * k + seed
    step = clamp(speed / 2, 0, 1)
  }
  let look: [number, number] = [0, 0]
  let lookW = 0
  if (player) {
    const dx = player[0] - here.x
    const dz = player[2] - here.z
    const dist = Math.hypot(dx, dz)
    const yawTo = wrap(Math.atan2(dx, dz) - here.yaw)
    // Now and then (about a third of the time), if you're near and not behind it, it turns its head to you.
    lookW = window01(t, 0.19, ph * 3, 0.35) * clamp((110 - dist) / 40, 0, 1) * clamp((2.5 - Math.abs(yawTo)) / 0.7, 0, 1)
    look = [clamp(yawTo, -1.2, 1.2) * lookW, clamp(Math.atan2(player[1] - here.y - height * 0.85, Math.max(1, dist)), -0.7, 0.7) * lookW]
  }
  return { motion: m, t, seed, speed, turn, climb, air: here.y - ground, stride, step, look, lookW }
}

export type RigKind = 'dragon' | 'whale' | 'horse' | 'deer' | 'dog' | 'bird'

/** Joint angles (radians) for one frame. The builder maps them onto its named pivots. */
export interface Rig {
  /** Whole-body heave (m), pitch (+ = nose down) and roll on top of the motion pose. */
  bob: number
  pitch: number
  roll: number
  /** Shoulder flap (+ = up), outer-wing flex relative to it, sweep back (about y), 0..1 folded. */
  flap: number
  tip: number
  sweep: number
  fold: number
  /** Per spine joint pitch (the whale's undulation, + = segment tips down). */
  spine: number[]
  /** Per tail segment: yaw (+ swings the tip to -x) and pitch (+ lifts it). */
  tail: { yaw: number, pitch: number }[]
  /** FL, FR, HL, HR: hip (+ = foot back) and knee (+ = foot tucks back). */
  legs: { hip: number, knee: number }[]
  neck: { pitch: number, yaw: number } // + pitch = head goes down
  head: { pitch: number, yaw: number }
  jaw: number // 0 shut .. ~0.6 open
  fins: number // pectoral fin angle (+ = up)
  breath: number // 0..1 embers from the mouth
}

const TAIL_SEGS: Record<RigKind, number> = { dragon: 8, whale: 0, horse: 3, deer: 1, dog: 2, bird: 1 }

/** A wing beat with a power stroke: a quick downstroke (42% of the cycle), a slower recovery. -1..1. */
export function strokeWave(s: number): number {
  const u = frac(s)
  return u < 0.42 ? Math.cos(Math.PI * u / 0.42) : -Math.cos(Math.PI * (u - 0.42) / 0.58)
}

/** One leg's swing: stance drives the foot back along the ground, swing lifts it and brings it forward. */
function legAt(s: number, duty: number): { f: number, lift: number } {
  const u = frac(s)
  if (u < duty) return { f: 1 - 2 * (u / duty), lift: 0 }
  const v = (u - duty) / (1 - duty)
  return { f: -Math.cos(Math.PI * v), lift: Math.sin(Math.PI * v) }
}

const WALK = { offsets: [0.25, 0.75, 0, 0.5], duty: 0.62, hip: 0.3, knee: 0.55 }
const GALLOP = { offsets: [0.52, 0.64, 0, 0.12], duty: 0.38, hip: 0.72, knee: 1.1 }

/** Every joint of a `kind` for a drive. Pure and seeded: the same drive always poses the same way. */
export function rig(kind: RigKind, d: Drive): Rig {
  const ph = d.seed * TAU
  const t = d.t
  const dive = d.dive ?? 0
  const out: Rig = {
    bob: 0, pitch: 0, roll: 0, flap: 0, tip: 0, sweep: 0, fold: 0, spine: [], tail: [], legs: [],
    neck: { pitch: 0, yaw: 0 }, head: { pitch: 0, yaw: 0 }, jaw: 0, fins: 0, breath: 0
  }
  const flying = kind === 'whale' ? 1 : kind === 'bird' ? smooth((d.air - 0.3) / 0.6) : smooth((d.air - 1) / 2)

  if (kind === 'whale') {
    // A slow travelling wave from chest to fluke; it swims harder when it goes faster.
    const w = 1.15
    const effort = 1 + 0.7 * clamp(d.speed / 4, 0, 1)
    const amps = [0.018, 0.035, 0.065, 0.13, 0.2]
    out.spine = amps.map((a, i) => a * effort * Math.sin(t * w - i * 0.62 + ph))
    out.tail = amps.map((_, i) => ({ yaw: -d.turn * 0.06 * i, pitch: 0 }))
    out.bob = 0.35 * Math.sin(t * w + ph + 0.8)
    out.pitch = 0.025 * Math.sin(t * w + ph + 2.2)
    out.fins = 0.22 * Math.sin(t * w * 0.5 + ph) - clamp(d.turn, -0.4, 0.4) * 0.5
    out.head = { yaw: d.look[0] * 0.12, pitch: -d.look[1] * 0.1 }
    out.jaw = 0.05 * window01(t, 0.13, ph * 5, 0.6)
    return out
  }

  // ---- wings (dragon, bird) ----
  if (kind === 'dragon' || kind === 'bird') {
    const hz = kind === 'bird' ? 3.1 : 0.82
    const amp = kind === 'bird' ? 0.8 : 0.78
    let beat: number
    if (d.motion === 'fly' || d.motion === 'hover') beat = 0.88
    else if (d.motion === 'orbit' || d.motion === 'drift') beat = 0.25 + 0.75 * window01(t, 0.31, ph, 0.2) // soaring, with bouts of beats
    else beat = d.speed > 0.5 ? 0.8 : 0.6
    beat = clamp(beat + clamp(d.climb / 2.5, 0, 0.6), 0, 1) * (1 - dive)
    const s = t * hz + d.seed
    const wave = strokeWave(s)
    const lag = strokeWave(s - 0.09) // the hand trails the arm: a whip at the end of each stroke
    const glideFlap = 0.1 + 0.04 * Math.sin(t * 0.7 + ph)
    out.flap = glideFlap + (0.12 + amp * wave - glideFlap) * beat
    out.tip = -0.06 + (0.42 * amp * lag - 0.12 * Math.max(0, -wave)) * beat
    out.sweep = 0.06 + 0.14 * (1 - beat) + 0.08 * Math.max(0, -wave) * beat
    out.bob = -0.18 * wave * beat * (kind === 'bird' ? 0.15 : 1) * flying
    out.pitch = 0.04 * wave * beat * flying
    // In a dive the wings half-close and sweep back, the nose drops.
    out.flap += (0.3 - out.flap) * dive
    out.tip += (-0.25 - out.tip) * dive
    out.sweep += (0.75 - out.sweep) * dive
    out.pitch += 0.42 * dive
    // On the ground the wings fold along the back.
    out.fold = 1 - flying
    out.flap += (0.6 - out.flap) * out.fold
    out.tip += (-2.75 - out.tip) * out.fold
    out.sweep += (1.25 - out.sweep) * out.fold
  }

  // ---- tail ----
  const n = TAIL_SEGS[kind]
  for (let i = 0; i < n; i++) {
    const f = (i + 1) / n
    const swish = kind === 'dragon' ? (0.035 + 0.06 * f) * (0.7 + 0.3 * flying) : kind === 'bird' ? 0.05 : kind === 'dog' ? 0.45 : 0.06 + 0.05 * f
    const rate = kind === 'dragon' ? 1.25 : kind === 'bird' ? 2 : kind === 'dog' ? 9 + d.lookW * 5 : 1.7 + d.step * 2.5
    const yaw = swish * Math.sin(t * rate - i * 0.55 + ph) - clamp(d.turn, -1.2, 1.2) * (kind === 'dragon' ? 0.11 : 0.05)
    let pitch: number
    if (kind === 'dragon') {
      // In the air it streams level and ripples with the beats; standing, it droops to the ground and curls up at the tip.
      const air = 0.025 * Math.sin((t * 0.82 + d.seed) * TAU - i * 0.7)
      const ground = i === 0 ? -0.42 : i < 4 ? 0.06 : 0.03
      pitch = air * flying + ground * (1 - flying) + 0.06 * dive
    } else if (kind === 'horse') {
      pitch = (i === 0 ? -0.9 + 0.5 * d.step : 0.05) + 0.04 * Math.sin(t * 2.3 + ph + i)
    } else if (kind === 'dog') {
      pitch = i === 0 ? -1.0 : 0.25 // the tail up and curling
    } else if (kind === 'deer') {
      pitch = 0.25 + 0.5 * window01(t, 0.7, ph * 2, 0.7) // the flag flicks up
    } else {
      pitch = -0.05 * out.flap
    }
    out.tail.push({ yaw, pitch })
  }

  // ---- legs ----
  if (kind !== 'bird') {
    const gait = d.motion === 'gallop' ? GALLOP : WALK
    for (let i = 0; i < 4; i++) {
      const hind = i >= 2
      const { f, lift } = legAt(d.stride + gait.offsets[i]!, gait.duty)
      let hip = -gait.hip * f * d.step * (hind ? 0.9 : 1)
      let knee = gait.knee * lift * d.step * (hind ? 0.7 : 1)
      // Flying: forelegs tuck up, hind legs trail back.
      const tuckHip = hind ? 0.95 : -0.35
      const tuckKnee = hind ? 0.25 : 1.3
      hip += (tuckHip - hip) * flying
      knee += (tuckKnee - knee) * flying
      out.legs.push({ hip, knee })
    }
  }

  // ---- neck and head ----
  const gallop = d.motion === 'gallop' ? d.step : 0
  const nod = gallop * 0.09 * Math.sin(d.stride * TAU) + (1 - gallop) * 0.035 * d.step * Math.sin(d.stride * TAU * 2)
  if (kind === 'horse' || kind === 'deer' || kind === 'dog') {
    // Grazing now and then while it stands or ambles; never while it's looking at you.
    const graze = window01(t, 0.09, ph * 5, 0.1) * (1 - clamp(d.speed / 1.6, 0, 1)) * (1 - d.lookW)
    const alert = kind === 'deer' ? d.lookW * 0.25 : 0
    out.neck = { pitch: 0.18 * gallop + nod + 1.9 * graze - alert, yaw: d.look[0] * 0.45 + clamp(d.turn, -1, 1) * 0.12 }
    out.head = { pitch: -0.6 * graze - d.look[1] * 0.5 + 0.1 * gallop, yaw: d.look[0] * 0.4 }
    out.jaw = 0.12 * graze * Math.max(0, Math.sin(t * 5 + ph))
    out.roll = clamp(-d.turn * 0.12, -0.12, 0.12) * gallop
  } else if (kind === 'dragon') {
    // In flight the neck stretches out ahead, the head level; standing it rears up in an S.
    out.neck = { pitch: 0.55 * flying + nod - 0.15 * dive + 0.03 * Math.sin(t * 0.82 * TAU + 1), yaw: d.look[0] * 0.45 + clamp(d.turn, -1, 1) * 0.16 }
    out.head = { pitch: -d.look[1] * 0.6 + 0.05 * flying - 0.2 * dive, yaw: d.look[0] * 0.45 }
    // A roar now and then (and on arrival); every other roar in the air is a breath of embers.
    const r = window01(t, 0.21, ph * 7, 0.82)
    const roar = Math.max(r, d.roar ?? 0)
    out.jaw = 0.55 * roar
    out.head.pitch -= 0.25 * roar
    const breathes = Math.floor((t * 0.21 + ph * 7) / TAU) % 2 === 0
    out.breath = Math.max(breathes ? r * flying : 0, d.roar ?? 0)
  } else {
    out.head = { pitch: 0.1 * Math.sin(t * 1.3 + ph), yaw: 0.3 * Math.sin(t * 0.45 + ph * 2) }
  }
  return out
}

// ---------- Gauntlet loop 1: physics-lite (drops, throws, flips, no gravity) and followers ----------

export const GRAVITY = 9.8
/** How bouncy a landing is (each bounce keeps this share of the speed) and how many bounces play. */
const RESTITUTION = 0.32
const BOUNCES = 2

/** Where a flight began (the kernel's Entity.launch) and what made it. */
export interface Flight { from: Vec3, kind: 'drop' | 'throw' }

/** One flight's timing: when it first hits (s), and when the last bounce settles. */
export function flightTimes(e: { pos: Vec3, launch?: Flight }): { land: number, settle: number, bounce: number[] } | null {
  const l = e.launch
  if (!l) return null
  const v = landingSpeed(e.pos, l)
  const land = airTime(e.pos, l)
  const bounce: number[] = []
  let t = land
  let u = v * RESTITUTION
  for (let i = 0; i < BOUNCES && u > 0.6; i++) {
    t += (2 * u) / GRAVITY
    bounce.push(t)
    u *= RESTITUTION
  }
  return { land, settle: t, bounce }
}

function apexOf(to: Vec3, l: Flight): number {
  const d = Math.hypot(to[0] - l.from[0], to[2] - l.from[2])
  return Math.min(30, Math.max(1.5, d * 0.22)) + Math.max(0, to[1] - l.from[1])
}

function airTime(to: Vec3, l: Flight): number {
  if (l.kind === 'drop') return Math.sqrt((2 * Math.max(0, l.from[1] - to[1])) / GRAVITY)
  // A throw rises `apex` over the launch height and comes down to the landing height.
  const apex = apexOf(to, l)
  const up = Math.sqrt((2 * apex) / GRAVITY)
  const down = Math.sqrt((2 * Math.max(0.01, l.from[1] + apex - to[1])) / GRAVITY)
  return up + down
}

function landingSpeed(to: Vec3, l: Flight): number {
  const fall = l.kind === 'drop' ? l.from[1] - to[1] : l.from[1] + apexOf(to, l) - to[1]
  return Math.sqrt(2 * GRAVITY * Math.max(0, fall))
}

/**
 * The flight at `t` seconds: ballistic from `from` to the resting spot, then a couple of decaying bounces.
 * A throw lands 90% of the way and the bounces carry it the rest. Null once it has settled. Spins while airborne.
 */
export function flightPose(e: { id: string, pos: Vec3, rotY: number, launch?: Flight }, t: number): Pose | null {
  const l = e.launch
  const times = flightTimes(e)
  if (!l || !times || t >= times.settle || t < 0) return null
  const [x1, y1, z1] = e.pos
  const throwing = l.kind === 'throw'
  const k = throwing ? 0.9 : 1
  const lx = l.from[0] + (x1 - l.from[0]) * k
  const lz = l.from[2] + (z1 - l.from[2]) * k
  const spin = seedOf(e.id, 11) > 0.5 ? 1 : -1
  if (t < times.land) {
    const s = t / times.land
    let y: number
    if (throwing) {
      const apex = apexOf(e.pos, l)
      const vy = Math.sqrt(2 * GRAVITY * apex)
      y = l.from[1] + vy * t - 0.5 * GRAVITY * t * t
    } else {
      y = l.from[1] - 0.5 * GRAVITY * t * t
    }
    return { x: l.from[0] + (lx - l.from[0]) * s, y: Math.max(y1, y), z: l.from[2] + (lz - l.from[2]) * s, yaw: e.rotY + (throwing ? t * 2 * spin : 0), roll: throwing ? 0 : 0.12 * Math.sin(t * 5) * spin, pitch: throwing ? t * 7 * spin : 0.06 * Math.sin(t * 4) }
  }
  // Bounces: each a smaller parabola, sliding the last stretch to the resting spot.
  let t0 = times.land
  let u = landingSpeed(e.pos, l) * RESTITUTION
  for (let i = 0; i < times.bounce.length; i++) {
    const t1 = times.bounce[i]!
    if (t < t1) {
      const tau = t - t0
      const s0 = i / times.bounce.length
      const s1 = (i + 1) / times.bounce.length
      const s = s0 + (s1 - s0) * (tau / (t1 - t0))
      return { x: lx + (x1 - lx) * s, y: y1 + u * tau - 0.5 * GRAVITY * tau * tau, z: lz + (z1 - lz) * s, yaw: e.rotY, roll: 0, pitch: throwing ? (t1 - t) * 3 * spin : 0 }
    }
    t0 = t1
    u *= RESTITUTION
  }
  return null
}

/** How high (m) a tipped thing's base must lift so the turned box doesn't sink: half-width `w`, height `h`, roll `a`. */
export function tipLift(a: number, w: number, h: number): number {
  const c = Math.cos(a)
  const s = Math.sin(a)
  // The box's corners in its own x–y plane, rolled about the base pivot (rotation about local z).
  let min = Infinity
  for (const [x, y] of [[-w, 0], [w, 0], [-w, h], [w, h]] as const) min = Math.min(min, x * s + y * c)
  return Math.max(0, -min)
}

/** Seconds a flip or topple takes. */
export const TIP_SECONDS = 0.9

/**
 * The roll (rad) and lift for a tip, `t` seconds after it changed from `fromDeg` to `toDeg`: it turns over
 * on its edge (the lift keeps the lowest corner on the ground) with a little hop at the top of the turn.
 */
export function tipPose(fromDeg: number, toDeg: number, t: number, w: number, h: number): { roll: number, lift: number } {
  const k = Math.min(1, Math.max(0, t / TIP_SECONDS))
  const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2
  const a = ((fromDeg + (toDeg - fromDeg) * e) * Math.PI) / 180
  return { roll: a, lift: tipLift(a, w, h) + Math.sin(Math.PI * k) * 0.08 * h }
}

/** No gravity: how high a loose thing has floated `t` seconds after gravity went (it rises and slows). */
export function floatHeight(id: string, t: number, height: number): number {
  const top = (2.5 + 5.5 * seedOf(id, 21)) * Math.max(1, Math.sqrt(Math.max(0.3, height)))
  const delay = seedOf(id, 23) * 0.8
  const s = Math.max(0, t - delay)
  return top * (1 - Math.exp(-s / 4.5)) + 0.25 * Math.sin(s * 0.9 + seedOf(id) * 6) * Math.min(1, s)
}

/**
 * The weightless offset: `off` = seconds since gravity went; `on` = seconds since it came back (or
 * undefined while it's still off). Floating things rise and tumble slowly; when gravity returns they fall
 * back with a little bounce. Null when nothing to add.
 */
export function weightlessPose(id: string, height: number, off: number, on?: number): { dy: number, yaw: number, roll: number, pitch: number } | null {
  if (on === undefined) {
    const s = Math.max(0, off)
    const w = 0.15 + 0.25 * seedOf(id, 25)
    const dir = seedOf(id, 27) > 0.5 ? 1 : -1
    return { dy: floatHeight(id, s, height), yaw: s * w * dir, roll: 0.5 * Math.sin(s * w * 0.8 + seedOf(id) * 4) * Math.min(1, s / 3), pitch: 0.4 * Math.sin(s * w * 0.6 + seedOf(id, 29) * 4) * Math.min(1, s / 3) }
  }
  const h0 = floatHeight(id, Math.max(0, off - on), height)
  const tf = Math.sqrt((2 * h0) / GRAVITY)
  if (on < tf) return { dy: Math.max(0, h0 - 0.5 * GRAVITY * on * on), yaw: 0, roll: 0, pitch: 0 }
  const u = GRAVITY * tf * RESTITUTION
  const tb = (2 * u) / GRAVITY
  const tau = on - tf
  if (tau < tb) return { dy: Math.max(0, u * tau - 0.5 * GRAVITY * tau * tau), yaw: 0, roll: 0, pitch: 0 }
  return null
}

/** A follower's spot this frame (Gauntlet loop 1: "a dog that follows me around"). */
export interface FollowState { x: number, z: number, yaw: number }

/**
 * Trot toward a spot a few metres ahead of the player and off to one side (so it's in the lower part of the
 * view while you walk), fast enough to keep up with a run. Far behind (a teleport, a giant's stride): it
 * bounds over at once. Facing: where it goes, or you when it's settled.
 */
export function followStep(cur: FollowState, id: string, player: { x: number, z: number, yaw: number }, dt: number, size = 1): FollowState {
  const side = seedOf(id, 31) > 0.5 ? 1 : -1
  const ahead = 2.6 + size * 0.8
  const off = 1.3 + size * 0.5
  const gx = player.x - Math.sin(player.yaw) * ahead + Math.cos(player.yaw) * off * side
  const gz = player.z - Math.cos(player.yaw) * ahead - Math.sin(player.yaw) * off * side
  const dx = gx - cur.x
  const dz = gz - cur.z
  const d = Math.hypot(dx, dz)
  if (d > 60) return { x: gx, z: gz, yaw: Math.atan2(player.x - gx, player.z - gz) }
  if (d < 0.3) {
    const face = Math.atan2(player.x - cur.x, player.z - cur.z)
    return { ...cur, yaw: cur.yaw + wrap(face - cur.yaw) * Math.min(1, dt * 3) }
  }
  const v = Math.min(18, d * 2.6)
  const step = Math.min(d, v * dt)
  const heading = Math.atan2(dx, dz)
  return { x: cur.x + (dx / d) * step, z: cur.z + (dz / d) * step, yaw: cur.yaw + wrap(heading - cur.yaw) * Math.min(1, dt * 8) }
}
