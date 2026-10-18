/**
 * World kernel: parsing, selectors, layout and applyOp, including the plan's worked examples
 * ("a bunch of trees", "all the trees red", "those houses twice as tall", a learned grandfather clock).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseOps } from '../shared/world/ops.ts'
import type { Op } from '../shared/world/ops.ts'
import { applyBatch, applyOp, createWorld, exportWorld, importWorld, summarizeKinds } from '../shared/world/state.ts'
import { distXZ, entityRadius, select } from '../shared/world/select.ts'
import { layout, rng } from '../shared/world/layout.ts'
import { KIT } from '../shared/world/kinds.ts'
import type { OpContext, WorldState } from '../shared/world/types.ts'

function ctx(over: Partial<OpContext> = {}): OpContext {
  return { gaze: { point: [0, 0, -10] }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 42, ...over }
}

function run(state: WorldState, ops: unknown, c = ctx(), label?: string) {
  return applyBatch(state, { ops }, c, label, 0)
}

function assertNoOverlaps(state: WorldState) {
  const es = state.entities
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      const a = es[i]!
      const b = es[j]!
      const need = entityRadius(state, a) + entityRadius(state, b)
      if (need === 0) continue
      assert.ok(distXZ(a.pos, b.pos) >= need - 0.01, `${a.id} overlaps ${b.id}: ${distXZ(a.pos, b.pos).toFixed(2)} < ${need.toFixed(2)}`)
    }
  }
}

const CLOCK = {
  op: 'define', kind: 'grandfather_clock', tags: ['clock', 'furniture'], parts: [
    { shape: 'box', size: [0.6, 2.0, 0.4], at: [0, 1.0, 0], color: '#5a3a22', slot: 'primary', material: 'wood' },
    { shape: 'cylinder', size: [0.4, 0.04, 0.4], at: [0, 1.6, 0.21], rot: [1.571, 0, 0], color: '#f2ead8', slot: 'trim' },
    { shape: 'box', size: [0.08, 0.6, 0.02], at: [0, 0.9, 0.21], color: '#c9a34a', slot: 'glow' }
  ]
}

// ---------- parseOps ----------

test('parseOps drops invalid ops and keeps valid siblings', () => {
  const { ops, dropped } = parseOps({ ops: [
    { op: 'spawn', kind: 'pine', count: 3 },
    { op: 'spawn' }, // no kind
    { op: 'teleport' }, // no world
    { op: 'explode', kind: 'house' }, // unknown op
    { op: 'modify', target: { tag: 'tree' }, set: {} }, // empty set
    { op: 'say', text: 'Planting.' }
  ] })
  assert.deepEqual(ops.map(o => o.op), ['spawn', 'say'])
  assert.deepEqual(dropped.map(d => d.index), [1, 2, 3, 4])
})

test('parseOps accepts a bare array or a single op, and never throws on junk', () => {
  assert.equal(parseOps([{ op: 'undo' }]).ops.length, 1)
  assert.equal(parseOps({ op: 'say', text: 'hi' }).ops.length, 1)
  const junk = parseOps('not json at all')
  assert.equal(junk.ops.length, 0)
  assert.equal(junk.dropped.length, 1)
})

test('parseOps normalizes kinds and pads part vectors', () => {
  const { ops } = parseOps([{ op: 'define', kind: 'Grandfather Clock', parts: [{ shape: 'sphere', size: [0.5], at: [0, 1, 0], color: '#fff' }] }])
  const d = ops[0] as Extract<Op, { op: 'define' }>
  assert.equal(d.kind, 'grandfather_clock')
  assert.deepEqual(d.parts[0]!.size, [0.5, 0.5, 0.5])
})

test('an invalid op is dropped while valid siblings apply', () => {
  const res = run(createWorld(), [{ op: 'spawn', kind: 'house' }, { op: 'spawn', count: 3 }, { op: 'spawn', kind: 'bench' }])
  assert.equal(res.dropped.length, 1)
  assert.deepEqual(res.state.entities.map(e => e.kind).sort(), ['bench', 'house'])
})

// ---------- layout ----------

test('a 9-tree cluster creates 9 entities with no overlaps, centred on the gaze point', () => {
  const res = run(createWorld(), [{ op: 'spawn', kind: 'pine', count: 9, arrange: 'cluster', at: { anchor: 'gaze' }, radius: 6, vary: 0.35 }])
  const s = res.state
  assert.equal(s.entities.length, 9)
  assert.equal(new Set(s.entities.map(e => e.group)).size, 1)
  assertNoOverlaps(s)
  const cx = s.entities.reduce((a, e) => a + e.pos[0], 0) / 9
  const cz = s.entities.reduce((a, e) => a + e.pos[2], 0) / 9
  assert.ok(Math.hypot(cx, cz + 10) < 4, 'cluster centroid near the gaze point')
  // vary jitters scale, so a group never looks copy-pasted
  assert.ok(new Set(s.entities.map(e => e.props.scale ?? 1)).size > 3)
  assert.deepEqual(res.effects.spawned, s.entities.map(e => e.id))
})

test('new spawns are pushed out of existing footprints', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'house', count: 3 }]).state
  s = run(s, [{ op: 'spawn', kind: 'pine', count: 12, radius: 4 }]).state
  s = run(s, [{ op: 'spawn', kind: 'house' }]).state
  assert.equal(s.entities.length, 16)
  assertNoOverlaps(s)
})

test('line, ring and grid lay out the right counts without overlap', () => {
  for (const arrange of ['line', 'ring', 'grid', 'scatter'] as const) {
    const s = run(createWorld(), [{ op: 'spawn', kind: 'lamp', count: 7, arrange }]).state
    assert.equal(s.entities.length, 7, arrange)
    assertNoOverlaps(s)
  }
})

test('a ring faces its centre and a line runs across the view', () => {
  const ring = run(createWorld(), [{ op: 'spawn', kind: 'chair', count: 6, arrange: 'ring', radius: 3, vary: 0 }]).state
  for (const e of ring.entities) {
    // front (+z local) points at the ring's centre (the gaze point)
    const fx = Math.sin(e.rotY)
    const fz = Math.cos(e.rotY)
    const tx = 0 - e.pos[0]
    const tz = -10 - e.pos[2]
    assert.ok((fx * tx + fz * tz) / Math.hypot(tx, tz) > 0.99)
  }
  const line = run(createWorld(), [{ op: 'spawn', kind: 'bench', count: 4, arrange: 'line', vary: 0 }]).state
  const zs = line.entities.map(e => e.pos[2])
  assert.ok(Math.max(...zs) - Math.min(...zs) < 0.01, 'player looks down -z, so a row runs along x')
})

test('along follows the road on both sides', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'road', at: { anchor: 'player', dist: 12 } }]).state
  s = run(s, [{ op: 'spawn', kind: 'lamp', count: 8, arrange: 'along', at: { anchor: 'target', of: { kind: 'road' } } }]).state
  const road = s.entities.find(e => e.kind === 'road')!
  const lamps = s.entities.filter(e => e.kind === 'lamp')
  assert.equal(lamps.length, 8)
  const left = lamps.filter(e => e.pos[0] < road.pos[0])
  assert.equal(left.length, 4)
  for (const l of lamps) assert.ok(Math.abs(Math.abs(l.pos[0] - road.pos[0]) - (2.5 + 0.5 + 0.6)) < 0.5)
})

test('layout is deterministic for a seed', () => {
  const a = layout(createWorld(), { desc: KIT.pine!, count: 5 }, ctx(), rng(7)).placed
  const b = layout(createWorld(), { desc: KIT.pine!, count: 5 }, ctx(), rng(7)).placed
  assert.deepEqual(a, b)
})

test('placement beside a target uses the player\'s left and right', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'table', at: { anchor: 'player', dist: 8 } }]).state
  s = run(s, [{ op: 'spawn', kind: 'chair', at: { anchor: 'target', of: { kind: 'table' }, side: 'right', gap: 0.2 } }]).state
  const table = s.entities.find(e => e.kind === 'table')!
  const chair = s.entities.find(e => e.kind === 'chair')!
  assert.ok(chair.pos[0] > table.pos[0] + 1, 'right of the table from where the player stands')
})

// ---------- selectors ----------

function grove(): WorldState {
  let s = createWorld()
  s = run(s, [{ op: 'spawn', kind: 'pine', count: 4, at: { anchor: 'player', dir: 'left', dist: 12 } }]).state
  s = run(s, [{ op: 'spawn', kind: 'oak', count: 3, at: { anchor: 'player', dir: 'right', dist: 12 } }]).state
  s = run(s, [{ op: 'spawn', kind: 'house', count: 2, at: { anchor: 'gaze' } }]).state
  return s
}

test('selectors: tag, kind, plurals, near/within, sort and limit', () => {
  const s = grove()
  const c = ctx()
  assert.equal(select(s, { tag: 'tree' }, c).length, 7)
  assert.equal(select(s, { tag: 'trees' }, c).length, 7)
  assert.equal(select(s, { kind: 'pine' }, c).length, 4)
  assert.equal(select(s, { kind: 'houses' }, c).length, 2)
  assert.equal(select(s, { kind: 'tree' }, c).length, 7, 'kind falls back to tag')
  assert.equal(select(s, { tag: 'building', near: 'gaze', within: 8 }, c).length, 2)
  assert.equal(select(s, { tag: 'tree', near: 'gaze', within: 3 }, c).length, 0)
  assert.equal(select(s, { tag: 'tree', sort: 'distance', near: 'player', limit: 2 }, c).length, 2)
  const tallest = select(s, { sort: 'height', limit: 1 }, c)[0]!
  assert.ok(['house', 'oak'].includes(tallest.kind))
  assert.deepEqual(select(s, { ref: 'last' }, c).map(e => e.kind), ['house', 'house'])
})

test('ref:gaze picks the entity the ray hit, else falls back to the last batch', () => {
  const s = grove()
  const pine = s.entities.find(e => e.kind === 'pine')!
  assert.deepEqual(select(s, { ref: 'gaze' }, ctx({ gaze: { point: pine.pos, entity: pine.id } })).map(e => e.id), [pine.id])
  assert.deepEqual(select(s, { ref: 'gaze' }, ctx({ gaze: { point: [50, 0, 50] } })).map(e => e.kind), ['house', 'house'])
})

// ---------- applyOp ----------

test('modify {tag:"tree"} recolours pine and oak but not houses', () => {
  const res = run(grove(), [{ op: 'modify', target: { tag: 'tree' }, set: { color: '#c0453a' } }])
  for (const e of res.state.entities) {
    if (e.kind === 'house') assert.equal(e.props.color, undefined)
    else assert.equal(e.props.color, '#c0453a')
  }
  assert.equal(res.effects.modified.length, 7)
  assert.equal(res.effects.spawned.length, 0)
})

test('relative height doubles ("those houses twice as tall"), and again', () => {
  let s = grove()
  s = run(s, [{ op: 'modify', target: { tag: 'house', near: 'gaze', within: 15 }, set: { height: 2 }, relative: true }]).state
  for (const e of s.entities.filter(e => e.kind === 'house')) assert.equal(e.props.height, 2)
  s = run(s, [{ op: 'modify', target: { tag: 'house' }, set: { height: 2 }, relative: true }]).state
  for (const e of s.entities.filter(e => e.kind === 'house')) assert.equal(e.props.height, 4)
  // relative floors start from the kind default (tower = 8)
  s = run(s, [{ op: 'spawn', kind: 'tower', at: { anchor: 'player', dir: 'behind', dist: 20 } }]).state
  s = run(s, [{ op: 'modify', target: { kind: 'tower' }, set: { floors: 1.5 }, relative: true }]).state
  assert.equal(s.entities.find(e => e.kind === 'tower')!.props.floors, 12)
})

test('undo removes the whole batch, and undoes a modify', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'house' }]).state
  s = run(s, [{ op: 'spawn', kind: 'pine', count: 9, arrange: 'cluster' }]).state
  assert.equal(s.entities.length, 10)
  const undo = run(s, [{ op: 'undo' }])
  assert.equal(undo.state.entities.length, 1)
  assert.equal(undo.effects.removed.length, 9)
  assert.equal(undo.state.log.length, 1, 'the undo itself is not logged')

  const red = run(undo.state, [{ op: 'modify', target: { kind: 'house' }, set: { color: 'red' } }]).state
  const back = run(red, [{ op: 'undo' }])
  assert.equal(back.state.entities[0]!.props.color, undefined)
  assert.deepEqual(back.effects.modified, [back.state.entities[0]!.id])
  assert.equal(run(createWorld(), [{ op: 'undo' }]).effects.notes[0], 'nothing to undo')
})

test('a define then spawn of the learned kind works, and "five more of those" reuses it', () => {
  let s = createWorld()
  const res = run(s, [CLOCK, { op: 'spawn', kind: 'grandfather_clock', at: { anchor: 'gaze' } }])
  s = res.state
  assert.ok(s.kinds.grandfather_clock?.learned)
  assert.deepEqual(res.effects.redefined, ['grandfather_clock'])
  const clock = s.entities.find(e => e.kind === 'grandfather_clock')!
  assert.ok(clock.tags.includes('clock'))
  assert.ok(Math.abs(s.kinds.grandfather_clock!.baseHeight - 2) < 1e-9)

  s = run(s, [{ op: 'spawn', kind: 'grandfather_clock', count: 5, arrange: 'line', at: { anchor: 'player', dir: 'right', dist: 6 } }]).state
  assert.equal(s.entities.filter(e => e.kind === 'grandfather_clock').length, 6)
  assert.equal(select(s, { tag: 'clock' }, ctx()).length, 6)
  assertNoOverlaps(s)
  assert.equal(summarizeKinds(s)[0]!.kind, 'grandfather_clock')
  assert.equal(summarizeKinds(s)[0]!.learned, true)
})

test('an unknown kind spawns a placeholder that a later define upgrades', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'pinball_machine' }]).state
  assert.equal(s.entities[0]!.kind, 'pinball_machine')
  assert.ok(s.entities[0]!.tags.includes('placeholder'))
  const res = run(s, [{ op: 'define', kind: 'pinball_machine', tags: ['music'], parts: [{ shape: 'box', size: [1, 1.7, 0.6], at: [0, 0.85, 0], color: '#6d2a14' }] }])
  s = res.state
  assert.deepEqual(res.effects.redefined, ['pinball_machine'])
  assert.ok(s.entities[0]!.tags.includes('music'))
  assert.equal(s.kinds.house?.learned, undefined, 'kit kinds stay kit kinds')
  const kitDefine = run(s, [{ op: 'define', kind: 'house', parts: [{ shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0], color: '#fff' }] }])
  assert.equal(kitDefine.state.kinds.house, s.kinds.house)
})

test('remove, move, atmosphere and say', () => {
  let s = grove()
  const res = run(s, [{ op: 'remove', target: { kind: 'oak' } }, { op: 'say', text: 'Gone.' }])
  s = res.state
  assert.equal(select(s, { kind: 'oak' }, ctx()).length, 0)
  assert.deepEqual(res.effects.say, ['Gone.'])

  s = run(s, [{ op: 'move', target: { kind: 'house' }, at: { anchor: 'player', dir: 'behind', dist: 15 } }]).state
  for (const h of s.entities.filter(e => e.kind === 'house')) assert.ok(h.pos[2] > 8)
  assertNoOverlaps(s)

  const atm = run(s, [{ op: 'atmosphere', time: 'night', fog: 0.7 }])
  assert.deepEqual(atm.state.atmosphere, { time: 'night', fog: 0.7 })
  assert.equal(atm.effects.atmosphere, true)
})

test('a modify that matches nothing is a note, not a log entry', () => {
  const s = createWorld()
  const res = run(s, [{ op: 'modify', target: { tag: 'tree' }, set: { color: 'red' } }])
  assert.equal(res.state.log.length, 0)
  assert.match(res.effects.notes[0]!, /nothing matches/)
})

test('applyOp alone is pure and reports effects', () => {
  const s = createWorld()
  const { state, effects } = applyOp(s, { op: 'spawn', kind: 'rock', count: 3 }, ctx())
  assert.equal(s.entities.length, 0, 'input state untouched')
  assert.equal(state.entities.length, 3)
  assert.equal(effects.spawned.length, 3)
})

test('export → import replays to the same world', () => {
  let s = grove()
  s = run(s, [CLOCK, { op: 'spawn', kind: 'grandfather_clock', count: 2 }]).state
  s = run(s, [{ op: 'modify', target: { tag: 'tree' }, set: { color: '#c0453a' } }]).state
  s = run(s, [{ op: 'atmosphere', time: 'golden' }]).state
  const json = JSON.parse(JSON.stringify(exportWorld(s)))
  const loaded = importWorld(json)
  assert.deepEqual(loaded.entities, s.entities)
  assert.deepEqual(loaded.atmosphere, s.atmosphere)
  assert.ok(loaded.kinds.grandfather_clock?.learned)
  assert.throws(() => importWorld({ nope: true }))
})

// ---------- size-aware placement (loop 1: always frame the wish) ----------

test('fitDistance: short things need no distance, tall things need enough to see foot to top', async () => {
  const { fitDistance, VIEW_VFOV } = await import('../shared/world/layout.ts')
  assert.equal(fitDistance(1), 0)
  const d = fitDistance(72)
  const span = Math.atan((72 - 1.6) / d) + Math.atan(1.6 / d)
  assert.ok(Math.abs(span - VIEW_VFOV * 0.86) < 1e-3)
  assert.ok(fitDistance(72) > fitDistance(24) && fitDistance(24) > fitDistance(5))
})

test('a giant tower "right there" lands far enough away that its top is in view', async () => {
  const { fitDistance } = await import('../shared/world/layout.ts')
  const c = ctx({ gaze: { point: [0, 0, -3] } })
  const s = run(createWorld(), [{ op: 'spawn', kind: 'tower', set: { scale: 3 } }], c).state
  const t = s.entities[0]!
  const d = distXZ(t.pos, c.player.pos)
  const near = d - entityRadius(s, t)
  assert.ok(near >= fitDistance(72) - 0.01, `near edge ${near.toFixed(1)} m is too close for a 72 m tower`)
  assert.ok(t.pos[2] < 0, 'still in the direction you looked')
})

test('scale makes footprints bigger: a cluster of giant pines does not overlap', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'pine', count: 6, set: { scale: 4 } }]).state
  assertNoOverlaps(s)
  for (const e of s.entities) assert.ok(distXZ(e.pos, [0, 1.6, 0]) > entityRadius(s, e), 'no giant pine swallows the viewer')
})

test('a normal-size spawn at a far gaze point is not pushed', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'house' }], ctx({ gaze: { point: [0, 0, -30] } })).state
  assert.ok(Math.abs(s.entities[0]!.pos[2] + 30) < 0.5)
})

test('oversized numbers clamp to their bound instead of dropping the op (a Director floor of length 240)', () => {
  const { ops, dropped } = parseOps([
    { op: 'spawn', kind: 'floor', set: { length: 240, width: 260, scale: 50 }, radius: 999, count: 500 },
    { op: 'spawn', kind: 'storefront', xz: [2000, -3], yaw: 900 },
    { op: 'modify', target: { ref: 'gaze' }, set: { height: 30 }, relative: true }
  ])
  assert.equal(dropped.length, 0)
  const floor = ops[0] as Extract<Op, { op: 'spawn' }>
  assert.equal(floor.set?.length, 200)
  assert.equal(floor.set?.width, 200)
  assert.equal(floor.set?.scale, 20)
  assert.equal(floor.radius, 200)
  assert.equal(floor.count, 80)
  const shop = ops[1] as Extract<Op, { op: 'spawn' }>
  assert.deepEqual(shop.xz, [1500, -3])
  assert.equal(shop.yaw, 720)
  assert.equal((ops[2] as Extract<Op, { op: 'modify' }>).set.height, 20)
  // Non-numbers still fail.
  assert.equal(parseOps([{ op: 'spawn', kind: 'floor', set: { length: 'huge' } }]).ops.length, 0)
})
