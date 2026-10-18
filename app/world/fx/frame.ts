/**
 * Camera framing: given the things a wish just made or changed (as footprint circles with a height), find a
 * view (yaw, pitch, position, eye lift) that shows all of them, foot to top, inside the frame. Tries the
 * current spot first (turn and tilt only), then backs away a few metres at most, never through a wall. If it
 * still doesn't fit, it stays put and tilts up: awe from below beats being yanked out of the room.
 * (The renderer's god view handles global scale-ups.)
 */
import * as THREE from 'three'

export interface FrameBox {
  x: number
  z: number
  /** footprint radius (m) */
  r: number
  /** top (m above ground) */
  h: number
}

export interface View {
  yaw: number
  pitch: number
  x: number
  z: number
  /** metres added to eye height */
  lift: number
}

const MARGIN = 0.92
/** The furthest a framing move may carry you (m). Everything bigger is seen from where you stand. */
export const MAX_BACK = 7
/**
 * Outdoors (no ceiling over you) a framing move may back you this far (Gauntlet loop 1): a cabin made three
 * times bigger or a castle with tall towers is seen whole, not cropped. Walls still stop the dolly.
 */
export const OUTDOOR_BACK = 30
/** How far short of a wall a step back stops (m). */
const WALL_GAP = 0.8

export interface FrameOpts {
  /** Cap on the step back (default MAX_BACK). */
  maxBack?: number
  /** Free distance from (x, z) along the unit direction (dx, dz), up to `max`: the renderer raycasts walls. */
  free?: (x: number, z: number, dx: number, dz: number, max: number) => number
}

/** The step-back distances worth trying: 0 first, then up to the cap, stopping WALL_GAP short of a wall. */
export function backLadder(maxBack: number, free = Infinity): number[] {
  const lim = Math.max(0, Math.min(maxBack, free - WALL_GAP))
  const out = [0]
  for (const b of [1.5, 3, 4.5, 6, 7, 8, 11, 15, 20, 25, 30]) if (b <= lim + 1e-6) out.push(b)
  if (lim > 0.5 && out[out.length - 1]! < lim - 0.25) out.push(lim)
  return out
}
const PITCH_MIN = -1.2
const PITCH_MAX = 0.68
const scratch = new THREE.PerspectiveCamera()
const v = new THREE.Vector3()

function samples(boxes: FrameBox[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  // Keep the cost bounded on a 200-thing teleport: sample the biggest boxes.
  const list = boxes.length > 60 ? [...boxes].sort((a, b) => b.h * b.r - a.h * a.r).slice(0, 60) : boxes
  for (const b of list) {
    const k = b.r > 3 ? 8 : 4
    for (let i = 0; i < k; i++) {
      const a = (i / k) * Math.PI * 2
      const x = b.x + Math.cos(a) * b.r * 0.85
      const z = b.z + Math.sin(a) * b.r * 0.85
      out.push(new THREE.Vector3(x, 0.05, z), new THREE.Vector3(x, b.h, z))
    }
    out.push(new THREE.Vector3(b.x, b.h, b.z))
  }
  return out
}

function place(cam: THREE.PerspectiveCamera, view: View, eye: number): void {
  scratch.fov = cam.fov
  scratch.aspect = cam.aspect
  scratch.near = cam.near
  scratch.far = cam.far
  scratch.updateProjectionMatrix()
  scratch.position.set(view.x, eye + view.lift, view.z)
  scratch.rotation.set(view.pitch, view.yaw, 0, 'YXZ')
  scratch.updateMatrixWorld(true)
}

/** The worst |NDC| over the sample points (Infinity if any is behind or right at the lens). */
function worst(pts: THREE.Vector3[]): number {
  let w = 0
  for (const p of pts) {
    v.copy(p).applyMatrix4(scratch.matrixWorldInverse)
    if (v.z > -0.8) return Infinity
    v.applyMatrix4(scratch.projectionMatrix)
    // Vertical is stricter (Gauntlet loop 1): captions and the HUD sit over the bottom of the frame.
    w = Math.max(w, Math.abs(v.x), Math.abs(v.y) * 1.12)
  }
  return w
}

/** How well a view frames the boxes: ≤ MARGIN means everything is comfortably in shot. */
export function frameScore(cam: THREE.PerspectiveCamera, view: View, boxes: FrameBox[], eye: number): number {
  place(cam, view, eye)
  return worst(samples(boxes))
}

/** Aim from (x, z, lift) at the middle of the angular spread of the points. */
function aim(pts: THREE.Vector3[], x: number, z: number, y: number, centerYaw: number): { yaw: number, pitch: number } {
  let yMin = Infinity
  let yMax = -Infinity
  let eMin = Infinity
  let eMax = -Infinity
  for (const p of pts) {
    const dx = p.x - x
    const dz = p.z - z
    const yaw = Math.atan2(-dx, -dz)
    const rel = wrap(yaw - centerYaw)
    yMin = Math.min(yMin, rel)
    yMax = Math.max(yMax, rel)
    const el = Math.atan2(p.y - y, Math.max(0.3, Math.hypot(dx, dz)))
    eMin = Math.min(eMin, el)
    eMax = Math.max(eMax, el)
  }
  return { yaw: centerYaw + (yMin + yMax) / 2, pitch: Math.max(PITCH_MIN, Math.min(PITCH_MAX, (eMin + eMax) / 2)) }
}

/**
 * A view that frames `boxes`, or null when the current one already does: turn and tilt first, then back
 * away a step at a time (the closest spot that fits wins).
 */
export function solveFrame(cam: THREE.PerspectiveCamera, cur: View, boxes: FrameBox[], eye: number, opts: FrameOpts = {}): View | null {
  if (!boxes.length) return null
  const pts = samples(boxes)
  place(cam, cur, eye)
  if (worst(pts) <= MARGIN) return null

  let x0 = Infinity
  let x1 = -Infinity
  let z0 = Infinity
  let z1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x - b.r)
    x1 = Math.max(x1, b.x + b.r)
    z0 = Math.min(z0, b.z - b.r)
    z1 = Math.max(z1, b.z + b.r)
  }
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const away = Math.hypot(cur.x - cx, cur.z - cz)
  // Back away from the centre of the things; standing on top of it, back away from where you face.
  const dir: [number, number] = away > 0.5 ? [(cur.x - cx) / away, (cur.z - cz) / away] : [Math.sin(cur.yaw), Math.cos(cur.yaw)]
  const maxBack = opts.maxBack ?? MAX_BACK
  const backs = backLadder(maxBack, opts.free ? opts.free(cur.x, cur.z, dir[0], dir[1], maxBack + WALL_GAP) : Infinity)

  let stay: View | null = null
  for (const back of backs) {
    const x = cur.x + dir[0] * back
    const z = cur.z + dir[1] * back
    const lift = cur.lift
    const y = eye + lift
    const centerYaw = Math.hypot(cx - x, cz - z) > 0.5 ? Math.atan2(-(cx - x), -(cz - z)) : cur.yaw
    const { yaw, pitch } = aim(pts, x, z, y, centerYaw)
    const view: View = { yaw: cur.yaw + wrap(yaw - cur.yaw), pitch, x, z, lift }
    place(cam, view, eye)
    const score = worst(pts)
    if (score <= MARGIN) return view
    stay ??= view
  }
  // Too big to frame from here: don't move, just turn and tilt toward it and let it be too big.
  return stay
}

function wrap(a: number): number {
  let x = a
  while (x > Math.PI) x -= Math.PI * 2
  while (x < -Math.PI) x += Math.PI * 2
  return x
}

/** The awe tilt's pitch range (rad): high enough to frame a 10–35° band, never straight up. */
export const SKY_PITCH: [number, number] = [0.24, 0.62]

/**
 * Loop 3, "look up": something arrived in the sky (lanterns, a whale, an orbiting dragon). From where you
 * stand, tilt up to the middle of it and turn a little toward the part in front of you. Position never
 * changes. Points are world positions; `eye` is the camera position. Returns null when nothing is above you
 * or you're already looking that high.
 */
export function skyTilt(eye: [number, number, number], yaw: number, pitch: number, points: [number, number, number][]): { yaw: number, pitch: number } | null {
  const seen = points.map((p) => {
    const dx = p[0] - eye[0]
    const dz = p[2] - eye[2]
    return { rel: wrap(Math.atan2(-dx, -dz) - yaw), el: Math.atan2(p[1] - eye[1], Math.hypot(dx, dz)) }
  }).filter(s => s.el > 0.05)
  if (!seen.length) return null
  const front = seen.filter(s => Math.abs(s.rel) < Math.PI / 2)
  const use = front.length ? front : seen
  // Turn toward the middle of what's in front (circular mean), but only partway: you stay facing your world.
  const turn = Math.atan2(use.reduce((a, s) => a + Math.sin(s.rel), 0), use.reduce((a, s) => a + Math.cos(s.rel), 0))
  const maxTurn = front.length ? 0.6 : 1.0
  const dYaw = Math.max(-maxTurn, Math.min(maxTurn, turn))
  const els = use.map(s => s.el).sort((a, b) => a - b)
  const mid = els[Math.floor(els.length / 2)]!
  const to = Math.max(SKY_PITCH[0], Math.min(SKY_PITCH[1], mid))
  if (to <= pitch + 0.04 && Math.abs(dYaw) < 0.05) return null
  return { yaw: yaw + dYaw, pitch: Math.max(pitch, to) }
}
