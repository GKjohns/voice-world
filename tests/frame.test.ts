/**
 * Loop 2 camera restraint: framing turns and tilts first, steps back at most MAX_BACK metres, and never
 * through a wall; anything too big is seen from where you stand.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { MAX_BACK, SKY_PITCH, backLadder, skyTilt, solveFrame } from '../app/world/fx/frame.ts'
import { skyDome } from '../shared/world/layout.ts'
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

test('loop 3: sky arrivals tilt you up (never move you), and 50 lanterns fill the view', () => {
  let seed = 7
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const { pts, ys } = skyDome([0, 1.6, 0], [0, -1], 50, rand)
  const lanterns = pts.map((p, i) => [p[0], ys[i]! + 0.6, p[2]] as [number, number, number])
  const t = skyTilt([0, EYE, 0], 0, -0.12, lanterns)!
  assert.ok(t.pitch >= SKY_PITCH[0] && t.pitch <= SKY_PITCH[1], `pitch ${t.pitch}`)
  assert.ok(Math.abs(t.yaw) < 0.3, `barely turns: ${t.yaw}`)
  const c = new THREE.PerspectiveCamera(65, 16 / 9, 0.1, 3200)
  c.position.set(0, EYE, 0)
  c.rotation.set(t.pitch, t.yaw, 0, 'YXZ')
  c.updateMatrixWorld()
  c.updateProjectionMatrix()
  const inView = lanterns.filter((p) => {
    const v = new THREE.Vector3(...p).project(c)
    return v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1
  }).length
  assert.ok(inView >= 30, `${inView}/50 lanterns in frame`)
  // Nothing above you: no tilt. Already looking up there: no tilt.
  assert.equal(skyTilt([0, EYE, 0], 0, 0, [[0, 0.5, -10]]), null)
  assert.equal(skyTilt([0, EYE, 0], 0, 0.5, [[0, 12, -20]]), null)
})

test('final: inside a room (maxBack 0) framing turns and tilts but never steps out through a wall', () => {
  // A pool hall's furniture spread around and behind you: free-standing it would back you out 6 m.
  const room: FrameBox[] = [{ x: -5, z: -6, r: 1.4, h: 1 }, { x: 5, z: -6, r: 1.4, h: 1 }, { x: 0, z: 4, r: 2, h: 2.5 }, { x: -6, z: 2, r: 1, h: 2.2 }]
  const free = solveFrame(cam(), here, room, EYE)
  const inside = solveFrame(cam(), here, room, EYE, { maxBack: 0 })
  assert.ok(inside)
  assert.equal(travel(inside), 0)
  assert.ok(travel(free) >= 0)
})
