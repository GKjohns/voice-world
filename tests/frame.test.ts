/**
 * Loop 2 camera restraint: framing turns and tilts first, steps back at most MAX_BACK metres, and never
 * through a wall; anything too big is seen from where you stand.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MAX_BACK, backLadder, solveFrame } from '../app/world/fx/frame.ts'
import type { FrameBox, View } from '../app/world/fx/frame.ts'

const EYE = 1.6
const cam = () => {
  const c = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 500)
  c.updateProjectionMatrix()
  return c
}
const here: View = { yaw: 0, pitch: 0, x: 0, z: 0, lift: 0 }
const travel = (v: View | null) => (v ? Math.hypot(v.x - here.x, v.z - here.z) : 0)

test('backLadder caps the dolly and stops short of a wall', () => {
  assert.ok(Math.max(...backLadder(MAX_BACK)) <= 8)
  assert.deepEqual(backLadder(MAX_BACK, 2.5), [0, 1.5])
  assert.deepEqual(backLadder(MAX_BACK, 0.5), [0])
})

test('a small thing to the side: turn, do not move', () => {
  const v = solveFrame(cam(), here, [{ x: 8, z: 0, r: 1, h: 2 }], EYE)
  assert.ok(v)
  assert.equal(travel(v), 0)
})

test('a mountain range 100 m off never pulls you more than MAX_BACK', () => {
  const range: FrameBox[] = [-60, -30, 0, 30, 60].map(x => ({ x, z: -120, r: 20, h: 50 }))
  assert.ok(travel(solveFrame(cam(), here, range, EYE)) <= MAX_BACK + 1e-6)
})

test('a colossus right in front: stay put and tilt up', () => {
  const v = solveFrame(cam(), here, [{ x: 0, z: -6, r: 4, h: 60 }], EYE)
  assert.ok(v)
  assert.equal(travel(v), 0)
  assert.ok(v.pitch > 0.3)
})

test('a wall 2 m behind you: the step back stops before it', () => {
  const v = solveFrame(cam(), here, [{ x: 0, z: -4, r: 2.5, h: 5 }], EYE, { free: () => 2 })
  assert.ok(travel(v) <= 1.2 + 1e-6)
})
