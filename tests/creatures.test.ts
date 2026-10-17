/**
 * Loop 3, creatures: the per-frame drive and the joint rig are pure and seeded, so a replayed world moves
 * every wing, leg and tail exactly the same way; and they respond to the motion the way the eye expects.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { driveOf, rig, strokeWave } from '../app/world/fx/motion.ts'
import type { MotionEntity } from '../app/world/fx/motion.ts'

const dragon: MotionEntity = { id: 'e7', pos: [0, 18, -14], rotY: 0, props: { motion: 'orbit', altitude: 18 }, path: { c: [0, 0], r: 14 } }
const horse: MotionEntity = { id: 'e9', pos: [3, 0, -10], rotY: 1, props: { motion: 'gallop' }, path: { c: [3, -20], r: 10 } }
const style = { pace: 1.05, creature: true }

test('creature animation is deterministic: same entity and clock, same joints', () => {
  for (const t of [0.3, 2.7, 11.25, 63.9]) {
    const a = rig('dragon', driveOf(dragon, t, 4, style, [0, 1.6, 0], 0))
    const b = rig('dragon', driveOf({ ...dragon, props: { ...dragon.props } }, t, 4, style, [0, 1.6, 0], 0))
    assert.deepEqual(a, b)
    assert.deepEqual(rig('horse', driveOf(horse, t, 2.2)), rig('horse', driveOf(horse, t, 2.2)))
  }
  // A different creature (id) moves out of phase.
  const other = rig('dragon', driveOf({ ...dragon, id: 'e8' }, 5, 4, style, [0, 1.6, 0], 0))
  assert.notDeepEqual(other.flap, rig('dragon', driveOf(dragon, 5, 4, style, [0, 1.6, 0], 0)).flap)
})

test('the wing beat has a power stroke: the downstroke is quicker than the recovery', () => {
  // From the top (+1) to the bottom (-1) in 42% of the cycle, back up in 58%.
  assert.ok(Math.abs(strokeWave(0) - 1) < 1e-9)
  assert.ok(Math.abs(strokeWave(0.42) + 1) < 1e-9)
  assert.ok(Math.abs(strokeWave(1) - 1) < 1e-9)
  // Continuous across the turnaround.
  assert.ok(Math.abs(strokeWave(0.4199) - strokeWave(0.4201)) < 1e-3)
})

test('a flying dragon spreads and beats its wings; a standing one folds them and stands on its legs', () => {
  const flying = driveOf(dragon, 6, 4, style, undefined, 0)
  assert.ok(flying.air > 10 && flying.speed > 4, `air ${flying.air} speed ${flying.speed}`)
  const flaps = Array.from({ length: 40 }, (_, i) => rig('dragon', driveOf(dragon, 6 + i * 0.05, 4, style, undefined, 0)).flap)
  assert.ok(Math.max(...flaps) - Math.min(...flaps) > 0.3, 'the wings move')
  assert.ok(rig('dragon', flying).fold < 0.01)
  const still: MotionEntity = { id: 'e7', pos: [0, 0, -14], rotY: 0, props: {} }
  const r = rig('dragon', driveOf(still, 4, 4, style, undefined, 0))
  assert.ok(r.fold > 0.99, 'folded on the ground')
  assert.equal(r.legs.length, 4)
})

test('flyers bank into the turn and the tail trails to the inside', () => {
  const d = driveOf(dragon, 8, 4, style, undefined, 0)
  assert.ok(Math.abs(d.turn) > 0.2, `turn ${d.turn}`)
  const r = rig('dragon', d)
  const tip = r.tail[r.tail.length - 1]!
  // Turning left (+turn) swings the tail tip toward +x (negative yaw), on average across the swish.
  const avg = Array.from({ length: 60 }, (_, i) => rig('dragon', driveOf(dragon, 8 + i * 0.1, 4, style, undefined, 0)).tail.reduce((s, x) => s + x.yaw, 0)).reduce((a, b) => a + b) / 60
  assert.ok(Math.sign(avg) === -Math.sign(d.turn), `avg yaw ${avg} turn ${d.turn}`)
  assert.ok(Number.isFinite(tip.yaw))
})

test('galloping legs cycle with the stride; the whale undulates more toward its fluke', () => {
  const hips = Array.from({ length: 30 }, (_, i) => rig('horse', driveOf(horse, 3 + i * 0.03, 2.2)).legs[0]!.hip)
  assert.ok(Math.max(...hips) - Math.min(...hips) > 0.8, 'front leg swings through a full stride')
  const whale: MotionEntity = { id: 'w1', pos: [0, 30, -20], rotY: 0, props: { motion: 'orbit' }, path: { c: [0, 0], r: 20 } }
  const amp = (j: number) => Math.max(...Array.from({ length: 80 }, (_, i) => Math.abs(rig('whale', driveOf(whale, i * 0.1, 6, { pace: 0.36, creature: true })).spine[j]!)))
  assert.ok(amp(4) > amp(0) * 4, `fluke ${amp(4)} vs chest ${amp(0)}`)
})

test('the head turns toward the player only now and then, and never from behind', () => {
  const still: MotionEntity = { id: 'h1', pos: [0, 0, -10], rotY: Math.PI, props: {} } // facing -z, away from the player at the origin
  const looks = Array.from({ length: 400 }, (_, i) => driveOf(still, i * 0.1, 2.2, undefined, [0, 1.6, 0], 0).lookW)
  assert.ok(looks.every(w => w === 0), 'player directly behind: never looks')
  const facing: MotionEntity = { ...still, rotY: 0 }
  const w = Array.from({ length: 400 }, (_, i) => driveOf(facing, i * 0.1, 2.2, undefined, [0, 1.6, 0], 0).lookW)
  const share = w.filter(x => x > 0.5).length / w.length
  assert.ok(share > 0.1 && share < 0.6, `looks ${Math.round(share * 100)}% of the time`)
})
