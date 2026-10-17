/**
 * Pure webcam-control math: no DOM, no three, no MediaPipe. Unit-tested in tests/tracking.test.ts.
 *
 * - `headAngles(matrix)`: yaw/pitch (degrees) from MediaPipe's 4×4 facial transformation matrix.
 * - `headLookStep(...)`: dead zone → direct offset → rate control, so holding your head turned spins you.
 * - `detectPointing(landmarks)`: is the index finger out (others curled), and where on screen does it point?
 */

export const DEG = Math.PI / 180

/** Sign flips for the head → camera mapping, in one place so a real-face test can fix them in one line. */
export const HEAD_SIGN = { yaw: 1, pitch: 1 }

export interface HeadAngles {
  /** Degrees. Positive = the person turned their head to THEIR left (the camera should turn left too). */
  yaw: number
  /** Degrees. Positive = the person tilted their head up. */
  pitch: number
}

/**
 * MediaPipe's facial transformation matrix maps the canonical face into camera space (x right in the
 * unmirrored image, y up, z towards the camera); `data` is column-major (`new THREE.Matrix4().fromArray`).
 * The face's forward axis is R·(0,0,1) = the rotation's third column: turning to your left swings it
 * towards image-right (+x), tilting up swings it towards +y.
 */
export function headAngles(data: ArrayLike<number>): HeadAngles {
  const fx = data[8]! // R[0][2]
  const fy = data[9]! // R[1][2]
  const fz = data[10]! // R[2][2]
  const yaw = Math.atan2(fx, fz) / DEG
  const pitch = Math.asin(Math.max(-1, Math.min(1, fy))) / DEG
  return { yaw: yaw * HEAD_SIGN.yaw, pitch: pitch * HEAD_SIGN.pitch }
}

/** Wrap an angle in degrees to (-180, 180]. */
export function wrapDeg(a: number): number {
  let x = ((a + 180) % 360 + 360) % 360 - 180
  if (x === -180) x = 180
  return x
}

export interface LookTuning {
  /** Degrees of head movement ignored around the calibrated centre. */
  deadZone: number
  /** Past this many degrees, the excess drives a turn rate instead of an offset. */
  rateStart: number
  /** Camera degrees per head degree inside the offset band. */
  offsetGain: number
  /** Camera degrees per second, per head degree past `rateStart`. */
  rateGain: number
  /** Ceiling on the turn rate (degrees per second). */
  maxRate: number
}

export const YAW_TUNING: LookTuning = { deadZone: 4, rateStart: 15, offsetGain: 2, rateGain: 7, maxRate: 120 }
/** Pitch is offset-only (the camera's pitch is clamped anyway): no rate band. */
export const PITCH_TUNING: LookTuning = { deadZone: 4, rateStart: 90, offsetGain: 1.6, rateGain: 0, maxRate: 0 }

export interface LookStep {
  /** Camera offset (degrees) the head is asking for right now, relative to where calibration left it. */
  offset: number
  /** Continuous turn rate (degrees per second) while the head is held past `rateStart`. */
  rate: number
}

/** Head angle (relative to centre, degrees) → offset + rate. Symmetric, continuous at both band edges. */
export function headLookStep(angle: number, t: LookTuning): LookStep {
  const mag = Math.abs(angle)
  const sign = Math.sign(angle)
  if (mag <= t.deadZone) return { offset: 0, rate: 0 }
  const inBand = Math.min(mag, t.rateStart) - t.deadZone
  const offset = sign * inBand * t.offsetGain
  const past = mag - t.rateStart
  const rate = past > 0 ? sign * Math.min(t.maxRate, past * t.rateGain) : 0
  return { offset, rate }
}

/** Matches the camera clamp in renderer.turn() (radians). */
export const PITCH_MIN = -1.25
export const PITCH_MAX = 0.7

/**
 * One frame of head → camera. Offsets go in as DELTAS against what head look already applied, so the
 * mouse can keep turning the camera underneath; the rate term spins it while the head is held past 15°.
 * `cam` is radians (renderer.yaw/pitch); `applied` and `rel` are degrees.
 */
export function applyHeadLook(
  cam: { yaw: number, pitch: number },
  applied: { yaw: number, pitch: number },
  rel: { yaw: number, pitch: number },
  dt: number
): { cam: { yaw: number, pitch: number }, applied: { yaw: number, pitch: number } } {
  const ys = headLookStep(rel.yaw, YAW_TUNING)
  const ps = headLookStep(rel.pitch, PITCH_TUNING)
  const yaw = cam.yaw + (ys.offset - applied.yaw) * DEG + ys.rate * DEG * dt
  const pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, cam.pitch + (ps.offset - applied.pitch) * DEG))
  // Only count what the pitch clamp let through, so coming back from a clamped look doesn't overshoot.
  return { cam: { yaw, pitch }, applied: { yaw: ys.offset, pitch: applied.pitch + (pitch - cam.pitch) / DEG } }
}

/** Frame-rate-independent exponential smoothing: `tau` seconds to close ~63% of the gap. */
export function smooth(prev: number, next: number, dt: number, tau: number): number {
  if (tau <= 0) return next
  const a = 1 - Math.exp(-dt / tau)
  return prev + (next - prev) * a
}

// ---------- pointing ----------

export interface Pt { x: number, y: number, z?: number }

export interface Pointing {
  pointing: boolean
  /** Screen point in NDC (x right, y up, -1..1) the finger points at, mirrored for the selfie view. */
  ndc: [number, number] | null
  /** Why it isn't pointing, for the status label and tests. */
  reason?: 'no-hand' | 'index-curled' | 'others-open'
}

export interface PointTuning {
  /** Index tip must be this many palm-sizes from the palm centre. */
  indexOut: number
  /** Middle/ring/pinky tips must be within this many palm-sizes of the palm centre. */
  curled: number
  /** How far past the fingertip (in wrist→tip lengths) the pointed spot sits. */
  reach: number
  /** NDC gain around the frame centre, so a small hand movement covers the screen. */
  gain: number
}

export const POINT_TUNING: PointTuning = { indexOut: 1.1, curled: 0.9, reach: 0.6, gain: 1.6 }

const WRIST = 0
const INDEX_PIP = 6
const INDEX_TIP = 8
const MIDDLE_MCP = 9
const PALM = [0, 5, 9, 13, 17]
const OTHER_TIPS = [12, 16, 20]

/**
 * Hand Landmarker's 21 normalized landmarks (x right / y down in the UNMIRRORED frame, 0..1) → pointing.
 * `aspect` = video width / height, so distances are measured in square pixels, not stretched units.
 */
export function detectPointing(lm: readonly Pt[] | null | undefined, aspect = 4 / 3, t: PointTuning = POINT_TUNING): Pointing {
  if (!lm || lm.length < 21) return { pointing: false, ndc: null, reason: 'no-hand' }
  const P = (i: number) => ({ x: lm[i]!.x * aspect, y: lm[i]!.y })
  const d = (a: { x: number, y: number }, b: { x: number, y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
  const palm = PALM.map(P).reduce((s, p) => ({ x: s.x + p.x / PALM.length, y: s.y + p.y / PALM.length }), { x: 0, y: 0 })
  const size = d(P(WRIST), P(MIDDLE_MCP)) || 1e-6
  const wrist = P(WRIST)
  const tip = P(INDEX_TIP)
  const indexOut = d(tip, palm) / size > t.indexOut && d(tip, wrist) > d(P(INDEX_PIP), wrist)
  if (!indexOut) return { pointing: false, ndc: null, reason: 'index-curled' }
  const othersCurled = OTHER_TIPS.every(i => d(P(i), palm) / size < t.curled)
  if (!othersCurled) return { pointing: false, ndc: null, reason: 'others-open' }
  return { pointing: true, ndc: pointNdc(lm[WRIST]!, lm[INDEX_TIP]!, aspect, t) }
}

/**
 * Wrist→tip in screen space, mirrored for the selfie view, extended past the fingertip and mapped to NDC.
 * The spot moves with both where your hand is and which way the finger leans.
 */
export function pointNdc(wrist: Pt, tip: Pt, aspect = 4 / 3, t: PointTuning = POINT_TUNING): [number, number] {
  // Mirror x so moving your hand right (in the room) moves the spot right on screen.
  const mx = (p: Pt) => 1 - p.x
  const dx = (mx(tip) - mx(wrist)) * aspect
  const dy = tip.y - wrist.y
  const len = Math.hypot(dx, dy) || 1e-6
  const reach = len * t.reach
  const px = mx(tip) + (dx / len) * reach / aspect
  const py = tip.y + (dy / len) * reach
  const clamp = (v: number) => Math.max(-0.95, Math.min(0.95, v))
  return [clamp((px * 2 - 1) * t.gain), clamp((1 - py * 2) * t.gain)]
}
