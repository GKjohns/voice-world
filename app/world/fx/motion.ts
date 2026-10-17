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

/** Where `e` is at `t` seconds into its motion. Null when it has no motion. */
export function motionPose(e: MotionEntity, t: number, height = 1): Pose | null {
  const m = e.props.motion
  if (!m || m === 'none') return null
  const k = e.props.speed ?? 1
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
      // Wind-blown: a wide, slow wander downwind and back, rising and falling, turning gently. Never leaves its patch.
      const A = (e.props.range ?? 5) * jit
      const w = 0.06 * k * jit
      const dx = A * (Math.sin(t * w + ph) + 0.45 * Math.sin(t * w * 2.3 + ph * 1.7))
      const dz = A * 0.7 * (Math.cos(t * w * 0.8 + ph * 1.3) + 0.4 * Math.sin(t * w * 1.9 + ph))
      const lift = y0 < 0.3 ? 1.5 : 0
      return { ...base, x: x0 + dx, z: z0 + dz, y: y0 + lift + 1.4 * Math.sin(t * 0.21 * k + ph) + 0.3 * Math.sin(t * 0.9 * k + ph * 2), yaw: e.rotY + t * 0.08 * k * (seedOf(e.id, 3) > 0.5 ? 1 : -1), roll: 0.06 * Math.sin(t * 0.7 * k + ph), pitch: 0.05 * Math.sin(t * 0.55 * k + ph * 1.3) }
    }
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
export function blendedPose(e: MotionEntity, t: number, height = 1): Pose | null {
  const p = motionPose(e, t, height)
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
