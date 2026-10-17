/**
 * Sprint 5 webcam math: head yaw/pitch from MediaPipe's facial transformation matrix, the dead zone /
 * offset / rate mapping, and index-finger pointing from Hand Landmarker's 21 landmarks.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEG, PITCH_MAX, PITCH_TUNING, YAW_TUNING, applyHeadLook, detectPointing, headAngles, headLookStep, pointNdc, smooth, wrapDeg
} from '../app/world/tracking/math.ts'
import type { Pt } from '../app/world/tracking/math.ts'

/** Column-major 4×4 of R = Ry(yaw)·Rx(pitchX), like MediaPipe's `Matrix.data` (plus a translation). */
function matrix(yawDeg: number, pitchXDeg: number): number[] {
  const y = yawDeg * DEG
  const x = pitchXDeg * DEG
  const cy = Math.cos(y)
  const sy = Math.sin(y)
  const cx = Math.cos(x)
  const sx = Math.sin(x)
  // Ry·Rx, row-major
  const R = [
    [cy, sy * sx, sy * cx],
    [0, cx, -sx],
    [-sy, cy * sx, cy * cx]
  ]
  const m = new Array(16).fill(0)
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[c * 4 + r] = R[r]![c]!
  m[12] = 1.5
  m[13] = -2
  m[14] = -40
  m[15] = 1
  return m
}

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`)

test('headAngles: identity is straight ahead', () => {
  const a = headAngles(matrix(0, 0))
  close(a.yaw, 0)
  close(a.pitch, 0)
})

test('headAngles: pure yaw and pure pitch come back out', () => {
  close(headAngles(matrix(25, 0)).yaw, 25)
  close(headAngles(matrix(-60, 0)).yaw, -60)
  // Nose up = rotation about x by a negative angle (forward axis (0,-sin,cos)) → positive pitch.
  close(headAngles(matrix(0, -20)).pitch, 20)
  close(headAngles(matrix(0, 15)).pitch, -15)
})

test('headAngles: combined yaw + pitch decouple', () => {
  const a = headAngles(matrix(30, -10))
  // With Ry·Rx the forward axis is (sy·cx, -sx, cy·cx): yaw = atan2(sy, cy), pitch = asin(-sx).
  close(a.yaw, 30)
  close(a.pitch, 10)
})

test('wrapDeg keeps angles in (-180, 180]', () => {
  close(wrapDeg(190), -170)
  close(wrapDeg(-190), 170)
  close(wrapDeg(540), 180)
  close(wrapDeg(-180), 180)
  close(wrapDeg(12), 12)
})

test('headLookStep: ±4° dead zone does nothing', () => {
  for (const a of [0, 1, -3.9, 4, -4]) assert.deepEqual(headLookStep(a, YAW_TUNING), { offset: 0, rate: 0 })
})

test('headLookStep: direct offset inside 15°, symmetric and continuous at the dead zone', () => {
  const s = headLookStep(10, YAW_TUNING)
  close(s.offset, (10 - 4) * YAW_TUNING.offsetGain)
  assert.equal(s.rate, 0)
  close(headLookStep(-10, YAW_TUNING).offset, -s.offset)
  assert.ok(headLookStep(4.01, YAW_TUNING).offset < 0.05)
})

test('headLookStep: past 15° the offset holds and a turn rate kicks in (so you can spin a full 360)', () => {
  const at15 = headLookStep(15, YAW_TUNING)
  const at25 = headLookStep(25, YAW_TUNING)
  close(at25.offset, at15.offset)
  assert.equal(at15.rate, 0)
  close(at25.rate, 10 * YAW_TUNING.rateGain)
  assert.ok(headLookStep(-25, YAW_TUNING).rate < 0)
  assert.equal(headLookStep(90, YAW_TUNING).rate, YAW_TUNING.maxRate)
  // Holding 25° for long enough turns the camera all the way round.
  let turned = 0
  for (let t = 0; t < 10; t += 1 / 30) turned += headLookStep(25, YAW_TUNING).rate / 30
  assert.ok(turned > 360, `turned only ${turned}°`)
})

test('headLookStep: pitch is offset-only', () => {
  const s = headLookStep(30, PITCH_TUNING)
  assert.equal(s.rate, 0)
  close(s.offset, 26 * PITCH_TUNING.offsetGain)
})

test('smooth: converges and is frame-rate independent', () => {
  let a = 0
  for (let i = 0; i < 60; i++) a = smooth(a, 10, 1 / 60, 0.12)
  let b = 0
  for (let i = 0; i < 30; i++) b = smooth(b, 10, 1 / 30, 0.12)
  close(a, b, 1e-9)
  assert.ok(a > 9.9)
  assert.equal(smooth(3, 7, 0.016, 0), 7)
})

// ---------- pointing ----------

/**
 * A synthetic right hand in normalized image coords (y down). The palm sits around (0.5, 0.6); each
 * finger is a 4-joint chain from its MCP along `dir`, `out` = extended, otherwise folded back to the palm.
 */
function hand(opts: { index: boolean, others: boolean, dir?: [number, number], at?: [number, number] }): Pt[] {
  const [ox, oy] = opts.at ?? [0.5, 0.65]
  const [dx, dy] = opts.dir ?? [0, -1]
  const lm: Pt[] = new Array(21)
  lm[0] = { x: ox, y: oy + 0.1 } // wrist below the palm
  lm[1] = { x: ox - 0.06, y: oy + 0.06 }
  lm[2] = { x: ox - 0.08, y: oy + 0.03 }
  lm[3] = { x: ox - 0.07, y: oy + 0.0 }
  lm[4] = { x: ox - 0.04, y: oy + 0.0 } // thumb tucked
  const mcps: [number, number][] = [[ox - 0.03, oy - 0.02], [ox, oy - 0.03], [ox + 0.03, oy - 0.02], [ox + 0.055, oy]]
  mcps.forEach(([mx, my], f) => {
    const base = 5 + f * 4
    const out = f === 0 ? opts.index : opts.others
    lm[base] = { x: mx, y: my }
    for (let j = 1; j <= 3; j++) {
      if (out) lm[base + j] = { x: mx + dx * 0.05 * j, y: my + dy * 0.05 * j }
      else lm[base + j] = { x: mx + (j === 1 ? 0 : 0.005), y: my + 0.02 * j - (j === 3 ? 0.03 : 0) } // folded into the palm
    }
  })
  return lm
}

test('detectPointing: index out, others curled → pointing', () => {
  const p = detectPointing(hand({ index: true, others: false }), 1)
  assert.equal(p.pointing, true)
  assert.ok(p.ndc)
})

test('detectPointing: fist, open hand and no hand are not pointing', () => {
  assert.deepEqual(detectPointing(hand({ index: false, others: false }), 1), { pointing: false, ndc: null, reason: 'index-curled' })
  assert.deepEqual(detectPointing(hand({ index: true, others: true }), 1), { pointing: false, ndc: null, reason: 'others-open' })
  assert.equal(detectPointing(null).reason, 'no-hand')
  assert.equal(detectPointing([{ x: 0, y: 0 }]).reason, 'no-hand')
})

test('pointNdc: finger straight up in the middle of the frame points above centre', () => {
  const [x, y] = pointNdc({ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.45 }, 1)
  close(x, 0)
  assert.ok(y > 0)
})

test('pointNdc: mirrored — leaning the finger towards image-left points right on screen', () => {
  // Image-left is the person's right in a selfie view, so it must land on the screen's right.
  const [x] = pointNdc({ x: 0.5, y: 0.7 }, { x: 0.4, y: 0.5 }, 1)
  assert.ok(x > 0, `x=${x}`)
  const [x2] = pointNdc({ x: 0.5, y: 0.7 }, { x: 0.6, y: 0.5 }, 1)
  assert.ok(x2 < 0, `x2=${x2}`)
})

test('pointNdc: pointing down lands below centre and is clamped on screen', () => {
  const [, y] = pointNdc({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.75 }, 1)
  assert.ok(y < 0)
  const [cx, cy] = pointNdc({ x: 0.1, y: 0.1 }, { x: 0.0, y: 0.0 }, 1)
  assert.ok(Math.abs(cx) <= 0.95 && Math.abs(cy) <= 0.95)
})

test('detectPointing: a leaning finger moves the spot sideways', () => {
  const left = detectPointing(hand({ index: true, others: false, dir: [0.6, -0.8] }), 1)
  const right = detectPointing(hand({ index: true, others: false, dir: [-0.6, -0.8] }), 1)
  assert.ok(left.ndc && right.ndc)
  // Image-right lean = the person's left = screen left (mirrored).
  assert.ok(left.ndc[0] < right.ndc[0])
})

test('MEDIAPIPE_VERSION matches the installed @mediapipe/tasks-vision (CDN WASM is pinned to it)', () => {
  const installed = JSON.parse(readFileSync(new URL('../node_modules/@mediapipe/tasks-vision/package.json', import.meta.url), 'utf8')).version
  const src = readFileSync(new URL('../app/composables/useHeadTracking.ts', import.meta.url), 'utf8')
  const pinned = /MEDIAPIPE_VERSION = '([^']+)'/.exec(src)?.[1]
  assert.equal(pinned, installed)
})

test('applyHeadLook: offsets apply as deltas, so the mouse keeps working underneath', () => {
  let cam = { yaw: 0, pitch: 0 }
  let applied = { yaw: 0, pitch: 0 }
  // Turn the head 10° left: camera turns (10-4)·2 = 12° left.
  ;({ cam, applied } = applyHeadLook(cam, applied, { yaw: 10, pitch: 0 }, 1 / 30))
  close(cam.yaw, 12 * DEG)
  // The mouse turns the camera 30° right while the head holds still: head look doesn't fight it.
  cam.yaw -= 30 * DEG
  ;({ cam, applied } = applyHeadLook(cam, applied, { yaw: 10, pitch: 0 }, 1 / 30))
  close(cam.yaw, -18 * DEG)
  // Head back to centre: only head look's own 12° comes off.
  cam = applyHeadLook(cam, applied, { yaw: 0, pitch: 0 }, 1 / 30).cam
  close(cam.yaw, -30 * DEG)
})

test('applyHeadLook: holding the head past 15° spins the camera a full turn', () => {
  let cam = { yaw: 0, pitch: 0 }
  let applied = { yaw: 0, pitch: 0 }
  for (let i = 0; i < 30 * 12; i++) ({ cam, applied } = applyHeadLook(cam, applied, { yaw: 25, pitch: 0 }, 1 / 30))
  assert.ok(cam.yaw / DEG > 360, `only ${cam.yaw / DEG}°`)
})

test('applyHeadLook: pitch clamps and returns without overshoot', () => {
  let cam = { yaw: 0, pitch: 0.6 }
  let applied = { yaw: 0, pitch: 0 }
  ;({ cam, applied } = applyHeadLook(cam, applied, { yaw: 0, pitch: 30 }, 1 / 30))
  close(cam.pitch, PITCH_MAX)
  ;({ cam, applied } = applyHeadLook(cam, applied, { yaw: 0, pitch: 0 }, 1 / 30))
  close(cam.pitch, 0.6)
  assert.equal(applied.pitch, 0)
})
