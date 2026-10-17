/**
 * Teleport mode (Sprint 4): room-frame placement (`xz` / `yaw`), the Director op conversion, and the
 * teleport batch (Director ops stream into it, undo removes the whole place, replay rebuilds it).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DirectorOpSchema, directorToOp, parseOps } from '../shared/world/ops.ts'
import { roomToWorld } from '../shared/world/layout.ts'
import { applyBatch, createWorld, exportWorld, extendLastBatch, importWorld } from '../shared/world/state.ts'
import { KIT } from '../shared/world/kinds.ts'
import { DIRECTOR_DIGEST } from '../server/utils/director.ts'
import { DIGEST } from '../server/utils/intent.ts'
import type { OpContext, WorldState } from '../shared/world/types.ts'

function ctx(over: Partial<OpContext> = {}): OpContext {
  return { gaze: { point: [0, 0, -10] }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 9, ...over }
}

const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) < eps

// ---------- room frame ----------

test('roomToWorld: -z is ahead and +x is right, whichever way the player faces', () => {
  const ahead = roomToWorld([0, -10], { pos: [0, 1.6, 0], yaw: 0 })
  assert.ok(near(ahead[0], 0) && near(ahead[2], -10))
  // Turned left 90° (yaw +π/2 faces -x): "ahead" is now -x, "right" is -z.
  const p = { pos: [5, 1.6, 3] as [number, number, number], yaw: Math.PI / 2 }
  const a = roomToWorld([0, -10], p)
  assert.ok(near(a[0], -5) && near(a[2], 3), `ahead → ${a}`)
  const r = roomToWorld([4, 0], p)
  assert.ok(near(r[0], 5) && near(r[2], -1), `right → ${r}`)
})

test('xz spawns land exactly at their room coordinates, face the room frame, and skip de-overlap', () => {
  const c = ctx({ player: { pos: [2, 1.6, -1], yaw: Math.PI / 2 } })
  const res = applyBatch(createWorld(), { ops: [
    { op: 'spawn', kind: 'pool_table', xz: [0, -6] },
    // A lamp hung over the same table: room placements must not be pushed apart.
    { op: 'spawn', kind: 'hanging_lamp', xz: [0, -6] },
    { op: 'spawn', kind: 'jukebox', xz: [3, -9], yaw: 90 }
  ] }, c, 'room', 0)
  const [table, lamp, juke] = res.state.entities
  const want = roomToWorld([0, -6], c.player)
  assert.ok(near(table!.pos[0], want[0]) && near(table!.pos[2], want[2]), `table at ${table!.pos}`)
  assert.deepEqual(lamp!.pos, table!.pos)
  // yaw 0 → front faces the room's +z (back toward the start), i.e. rotY = the player's yaw.
  assert.ok(near(table!.rotY, Math.PI / 2))
  assert.ok(near(juke!.rotY, Math.PI / 2 + Math.PI / 2), `jukebox rotY ${juke!.rotY}`)
})

test('xz + count + arrange lays the group out around the room point', () => {
  const res = applyBatch(createWorld(), { ops: [{ op: 'spawn', kind: 'stool', xz: [0, -8], count: 5, arrange: 'line' }] }, ctx(), 'stools', 0)
  const xs = res.state.entities.map(e => e.pos[0]).sort((a, b) => a - b)
  assert.equal(res.state.entities.length, 5)
  assert.ok(res.state.entities.every(e => Math.abs(e.pos[2] + 8) < 0.5), 'all on the z = -8 line')
  assert.ok(Math.abs((xs[0]! + xs[4]!) / 2) < 0.5, 'centred on x = 0')
})

test('xz is rejected when it is not a pair, without losing the batch', () => {
  const { ops, dropped } = parseOps([{ op: 'spawn', kind: 'rug', xz: [1, 2, 3] }, { op: 'spawn', kind: 'rug', xz: [1, 2] }])
  assert.equal(ops.length, 1)
  assert.equal(dropped.length, 1)
})

// ---------- Director ops ----------

test('directorToOp moves flat props into set and keeps atmosphere/say as they are', () => {
  assert.deepEqual(directorToOp({ op: 'spawn', kind: 'floor', xz: [0, -7], size: [18, 20], color: '#4a2f1c', time: '', fog: 0 }),
    { op: 'spawn', kind: 'floor', xz: [0, -7], set: { color: '#4a2f1c', length: 18, width: 20 } })
  assert.deepEqual(directorToOp({ op: 'spawn', kind: 'neon_sign', xz: [3, -16.8], text: 'POOL HALL', count: 1.4 }),
    { op: 'spawn', kind: 'neon_sign', xz: [3, -16.8], count: 1, set: { text: 'POOL HALL' } })
  assert.deepEqual(directorToOp({ op: 'atmosphere', time: 'interior', fog: 1.4, ambient: 'room' }), { op: 'atmosphere', time: 'interior', fog: 1, ambient: 'room' })
  assert.deepEqual(directorToOp({ op: 'say', text: 'Rack em up.' }), { op: 'say', text: 'Rack em up.' })
  const { ops } = parseOps([directorToOp({ op: 'atmosphere', time: 'golden', ambient: 'water' })])
  assert.equal(ops.length, 1)
})

// Since Loop 1 the Director writes JSON in plain text (no grammar), so the budget is a guard on flatness, not a
// compile limit. Loop 2 added altitude, motion and weather (16).
test('the Director schema stays flat (≤ 16 optional fields) and the intent digest never mentions xz', () => {
  const optional = Object.values(DirectorOpSchema.shape).filter(f => f.safeParse(undefined).success).length
  assert.ok(optional <= 16, `${optional} optional fields`)
  assert.ok(!/\bxz\b/.test(DIGEST), 'intent digest mentions xz')
  assert.ok(/\bxz\b/.test(DIRECTOR_DIGEST))
})

test('every kit kind has a builder-side note or a known description, and the new sets exist', () => {
  for (const k of ['floor', 'wall', 'ceiling', 'rug', 'pool_table', 'hanging_lamp', 'bar_counter', 'stool', 'jukebox', 'neon_sign', 'sofa', 'bookshelf', 'fireplace', 'window', 'water', 'shore', 'dock', 'boat', 'campfire', 'tent', 'fireflies', 'dust_motes', 'embers']) {
    assert.ok(KIT[k], `missing kind ${k}`)
  }
  assert.ok(KIT.hanging_lamp!.tags.includes('light') && KIT.hanging_lamp!.tags.includes('lamp'))
})

// ---------- the teleport batch ----------

function pool(): { state: WorldState, c: OpContext } {
  const c = ctx({ player: { pos: [4, 1.6, 4], yaw: 0.4 } })
  let s = applyBatch(createWorld(), { ops: [{ op: 'spawn', kind: 'pine', count: 5, arrange: 'cluster' }] }, ctx(), 'trees', 0).state
  s = applyBatch(s, { ops: [{ op: 'teleport', world: 'pool hall', brief: 'dim and warm' }, { op: 'say', text: 'Racking them up.' }] }, c, 'take me to a pool hall', 1).state
  return { state: s, c }
}

test('teleport clears the stage; Director ops stream into the same batch with its context', () => {
  const { state: s0, c } = pool()
  assert.equal(s0.entities.length, 0)
  assert.equal(s0.place, 'pool hall')
  const batches = s0.log.length
  let s = s0
  const stream = [
    { op: 'atmosphere', time: 'interior', fog: 0.2, ambient: 'room' },
    { op: 'spawn', kind: 'floor', xz: [0, -7], size: [18, 20] },
    { op: 'spawn', kind: 'pool_table', xz: [0, -8] },
    { op: 'spawn', kind: 'hanging_lamp', xz: [0, -8] },
    { op: 'spawn', kind: 'stool', xz: [-5, -15], count: 4, arrange: 'line' },
    { op: 'spawn', kind: 'nonsense' as string, xz: ['a'] as unknown as number[] }, // dropped, not fatal
    { op: 'say', text: 'Rack em up.' }
  ]
  let said = ''
  let dropped = 0
  for (const raw of stream) {
    const res = extendLastBatch(s, [directorToOp(raw)])
    s = res.state
    said += res.effects.say.join(' ')
    dropped += res.dropped.length
  }
  assert.equal(s.log.length, batches, 'still one batch for the whole place')
  assert.equal(s.entities.length, 1 + 1 + 1 + 4)
  assert.equal(s.atmosphere.time, 'interior')
  assert.equal(s.atmosphere.ambient, 'room')
  assert.equal(said, 'Rack em up.')
  assert.equal(dropped, 1)
  const batch = s.log[s.log.length - 1]!
  assert.equal(batch.ops[0]!.op, 'teleport')
  assert.ok(!batch.ops.some(o => o.op === 'say'), 'say is never logged')
  assert.ok(s.entities.every(e => e.group === batch.id), 'every entity belongs to the teleport batch')
  const table = s.entities.find(e => e.kind === 'pool_table')!
  const want = roomToWorld([0, -8], c.player)
  assert.ok(near(table.pos[0], want[0]) && near(table.pos[2], want[2]))
})

test('one undo removes the whole Director-built place and brings the old world back', () => {
  let { state: s } = pool()
  s = extendLastBatch(s, [{ op: 'spawn', kind: 'floor', xz: [0, -7] }, { op: 'spawn', kind: 'pool_table', xz: [0, -8] }]).state
  const res = applyBatch(s, { ops: [{ op: 'undo' }] }, ctx(), 'undo', 2)
  assert.deepEqual(res.state.entities.map(e => e.kind), ['pine', 'pine', 'pine', 'pine', 'pine'])
  assert.equal(res.state.place, 'void')
})

test('save → load replays the built scene from the log (no model), ids and positions identical', () => {
  let { state: s } = pool()
  s = extendLastBatch(s, [
    { op: 'atmosphere', time: 'golden', fog: 0.4, ambient: 'water' },
    { op: 'spawn', kind: 'water', xz: [0, -30], set: { length: 50, width: 40 } },
    { op: 'spawn', kind: 'pine', xz: [-14, -12], count: 9, arrange: 'cluster', radius: 7 }
  ]).state
  // Edits after the build land in their own batch and replay too.
  s = applyBatch(s, { ops: [{ op: 'modify', target: { tag: 'tree' }, set: { color: '#c0453a' } }] }, ctx(), 'trees red', 3).state
  const loaded = importWorld(JSON.parse(JSON.stringify(exportWorld(s))))
  assert.deepEqual(loaded.entities, s.entities)
  assert.deepEqual(loaded.atmosphere, s.atmosphere)
  assert.equal(loaded.place, 'pool hall')
})
