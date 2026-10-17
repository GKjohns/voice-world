/**
 * Terrain and scale (Loop 2): the horizon anchor, 360° "around me" placement and the terrain snap
 * ("a castle on that hill" stands on the hill's surface).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyBatch, createWorld } from '../shared/world/state.ts'
import { distXZ } from '../shared/world/select.ts'
import { groundHeight, surfaceHeight } from '../shared/world/terrain.ts'
import { KIT } from '../shared/world/kinds.ts'
import type { OpContext, WorldState } from '../shared/world/types.ts'

function ctx(over: Partial<OpContext> = {}): OpContext {
  return { gaze: { point: [0, 0, -10] }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 42, ...over }
}

function run(state: WorldState, ops: unknown, c = ctx()) {
  return applyBatch(state, { ops }, c, undefined, 0)
}

const angleOf = (p: number[]) => Math.atan2(p[0]!, -p[2]!) // 0 = straight ahead (-z), + = right

test('horizon: a mountain range lands 300–1200 m out, ahead of the player, without a camera-sized push', () => {
  const { state } = run(createWorld(), [{ op: 'spawn', kind: 'mountain_range', at: { anchor: 'horizon' } }])
  const e = state.entities[0]!
  const d = distXZ(e.pos, [0, 0, 0])
  assert.ok(d >= 300 && d <= 1200, `range at ${d} m`)
  assert.ok(Math.abs(angleOf(e.pos)) < 0.05, 'straight ahead')
  // It faces the player, so its bow curves around them.
  assert.ok(Math.abs(Math.atan2(-e.pos[0], -e.pos[2]) - e.rotY) < 0.3)
})

test('horizon: dir turns it, and a count spreads across the view; around rings the player', () => {
  const left = run(createWorld(), [{ op: 'spawn', kind: 'mountain', at: { anchor: 'horizon', dir: 'left' } }]).state.entities[0]!
  assert.ok(left.pos[0] < -250 && Math.abs(left.pos[2]) < 60, `left mountain at ${left.pos}`)

  const five = run(createWorld(), [{ op: 'spawn', kind: 'mountain', count: 5, at: { anchor: 'horizon' } }]).state.entities
  const angles = five.map(e => angleOf(e.pos))
  assert.ok(Math.max(...angles) - Math.min(...angles) > 0.5, 'spread across the view')
  assert.ok(angles.every(a => Math.abs(a) < Math.PI / 3 + 0.2), 'within ~120°')
  for (const e of five) assert.ok(distXZ(e.pos, [0, 0, 0]) >= 250)

  const ring = run(createWorld(), [{ op: 'spawn', kind: 'mountain', count: 8, at: { anchor: 'horizon', dir: 'around' } }]).state.entities
  const quadrants = new Set(ring.map(e => Math.floor(((angleOf(e.pos) + Math.PI) / (Math.PI / 2))) % 4))
  assert.equal(quadrants.size, 4, 'peaks on all four sides')
})

test('horizon: an explicit dist wins, and a huge single thing gets pushed far enough to see whole', () => {
  const e = run(createWorld(), [{ op: 'spawn', kind: 'volcano', at: { anchor: 'horizon', dist: 900 } }]).state.entities[0]!
  assert.ok(Math.abs(distXZ(e.pos, [0, 0, 0]) - 900) < 1)
  // "Raise a volcano over there" (gaze 10 m ahead) still can't swallow the viewer.
  const g = run(createWorld(), [{ op: 'spawn', kind: 'volcano', at: { anchor: 'gaze' } }]).state.entities[0]!
  assert.ok(distXZ(g.pos, [0, 0, 0]) > KIT.volcano!.footprint + 20)
})

test('around me: a city surrounds the player on all four sides, nearest first', () => {
  const { state } = run(createWorld(), [{ op: 'spawn', kind: 'house', count: 16, at: { anchor: 'player', dir: 'around' } }])
  const es = state.entities
  assert.equal(es.length, 16)
  const quadrants = new Set(es.map(e => Math.floor(((angleOf(e.pos) + Math.PI) / (Math.PI / 2))) % 4))
  assert.equal(quadrants.size, 4)
  for (const e of es) assert.ok(distXZ(e.pos, [0, 0, 0]) > 4, 'nothing on top of the player')
  const ds = es.map(e => distXZ(e.pos, [0, 0, 0]))
  assert.ok(ds[0]! <= ds[ds.length - 1]!, 'the build radiates outward')
})

test('terrain snap: things spawned over a hill stand on its surface; on_top crowns the summit', () => {
  const s1 = run(createWorld(), [{ op: 'spawn', kind: 'hill', at: { anchor: 'player', dist: 60 } }]).state
  const hill = s1.entities[0]!
  const summit = groundHeight(s1, hill.pos[0], hill.pos[2])
  assert.ok(summit > 12 && summit < 20, `summit ${summit}`)

  const s2 = run(s1, [{ op: 'spawn', kind: 'house', at: { anchor: 'target', of: { kind: 'hill' }, side: 'on_top' } }]).state
  const castle = s2.entities.find(e => e.kind === 'house')!
  assert.ok(distXZ(castle.pos, hill.pos) < 1, 'on the summit')
  assert.ok(Math.abs(castle.pos[1] - summit) < 0.5, `castle y ${castle.pos[1]} vs summit ${summit}`)

  // Gazing at a point on the slope: the trees land on the slope (not buried, not floating), and the hill
  // is never an obstacle that pushes them off it.
  const slope: [number, number, number] = [hill.pos[0], 0, hill.pos[2] + 18]
  const s3 = run(s1, [{ op: 'spawn', kind: 'pine', count: 5, arrange: 'cluster', at: { anchor: 'gaze' } }], ctx({ gaze: { point: slope } })).state
  for (const e of s3.entities.filter(e => e.kind === 'pine')) {
    const g = groundHeight(s1, e.pos[0], e.pos[2])
    assert.ok(g > 0.5, 'on the hill')
    // Settled into the slope: never floating above it, never sunk more than a little below its centre.
    assert.ok(e.pos[1] <= g + 1e-2 && e.pos[1] > g - 1.5, `on its surface (${e.pos[1]} vs ${g})`)
  }
})

test('terrain snap: off terrain stays at y 0; height functions are zero outside their footprint', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'hill', at: { anchor: 'player', dist: 60 } }, { op: 'spawn', kind: 'rock', at: { anchor: 'player', dir: 'behind', dist: 8 } }]).state
  assert.equal(s.entities.find(e => e.kind === 'rock')!.pos[1], 0)
  for (const surf of ['hill', 'mountain', 'volcano', 'mesa', 'island'] as const) {
    assert.equal(surfaceHeight(surf, 5000, 0, 100, 100), 0)
    assert.ok(surfaceHeight(surf, 0, 0, 100, 100) > 30, `${surf} has height at its centre`)
  }
  // A scaled, raised hill raises what stands on it.
  const big = run(createWorld(), [{ op: 'spawn', kind: 'hill', at: { anchor: 'player', dist: 80 }, set: { scale: 2, height: 1.5 } }]).state
  const h = big.entities[0]!
  assert.ok(groundHeight(big, h.pos[0], h.pos[2]) > 40)
})

test('integration: "a castle on that hill" with no hill raises the hill first, then builds on it', () => {
  const { state } = run(createWorld(), [{ op: 'spawn', kind: 'tower', at: { anchor: 'target', of: { kind: 'hill' }, side: 'on_top' } }])
  const hill = state.entities.find(e => e.kind === 'hill')
  const tower = state.entities.find(e => e.kind === 'tower')
  assert.ok(hill && tower, 'both spawned')
  assert.ok(tower.pos[1] > 8, `tower stands on the hill (y ${tower.pos[1]})`)
})

test('integration: lanterns in a room stay under its ceiling and fill the room', () => {
  const room = run(createWorld(), [
    { op: 'spawn', kind: 'floor', xz: [0, -4], set: { length: 12, width: 10 } },
    { op: 'spawn', kind: 'ceiling', xz: [0, -4], set: { length: 12, width: 10 } }
  ], ctx({ player: { pos: [0, 1.6, -4], yaw: 0 } })).state
  const lid = room.entities.find(e => e.kind === 'ceiling')!
  const { state } = run(room, [{ op: 'spawn', kind: 'lantern', count: 30, arrange: 'scatter', at: { anchor: 'gaze', dist: 18 }, set: { altitude: 'sky', motion: 'drift' } }], ctx({ player: { pos: [0, 1.6, -4], yaw: 0 }, gaze: { point: [0, 0, -9] } }))
  const ls = state.entities.filter(e => e.kind === 'lantern')
  assert.equal(ls.length, 30)
  for (const l of ls) {
    assert.ok(l.pos[1] + 1.15 < 4, `lantern top ${l.pos[1] + 1.15} under the 4 m ceiling`)
    assert.ok(Math.abs(l.pos[0] - lid.pos[0]) <= 6 && Math.abs(l.pos[2] - lid.pos[2]) <= 5, `lantern at ${l.pos} inside the room`)
  }
  // "Higher" on a lantern indoors is still capped.
  const up = run(state, [{ op: 'modify', target: { kind: 'lantern' }, set: { altitude: 40 } }]).state
  assert.ok(up.entities.filter(e => e.kind === 'lantern').every(l => l.pos[1] + 1.15 < 4))
})
