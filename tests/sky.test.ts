/**
 * Loop 2, the sky: altitude layout, motion paths and their determinism across replay, weather and sky
 * events in the kernel, the player's size, and the honesty filter on the genie's lines.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { directorToOp, parseOps } from '../shared/world/ops.ts'
import { applyBatch, createWorld, exportWorld, importWorld } from '../shared/world/state.ts'
import { SKY_BAND } from '../shared/world/layout.ts'
import { honestSay } from '../shared/world/honesty.ts'
import { blendedPose, motionPose } from '../app/world/fx/motion.ts'
import type { OpContext, WorldState } from '../shared/world/types.ts'

function ctx(over: Partial<OpContext> = {}): OpContext {
  return { gaze: { point: [0, 0, -10], dist: 10 }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 42, ...over }
}
const run = (s: WorldState, ops: unknown[], c = ctx(), label?: string) => applyBatch(s, { ops }, c, label, 0)

const LANTERNS = [{ op: 'spawn', kind: 'lantern', count: 40, arrange: 'scatter', at: { anchor: 'player', dist: 0 }, radius: 45, set: { altitude: 'sky', motion: 'drift', glow: 2 } }, { op: 'say', text: 'A thousand wishes, rising.' }]

test('fill the sky with lanterns: 40 lanterns 15–45 m up, spread wide, drifting', () => {
  const r = run(createWorld(), LANTERNS)
  const l = r.state.entities.filter(e => e.kind === 'lantern')
  assert.equal(l.length, 40)
  for (const e of l) {
    assert.ok(e.pos[1] >= SKY_BAND[0] && e.pos[1] <= SKY_BAND[1], `y ${e.pos[1]}`)
    assert.equal(e.props.motion, 'drift')
  }
  const ys = l.map(e => e.pos[1])
  assert.ok(Math.max(...ys) - Math.min(...ys) > 15, 'heights are spread, not one flat sheet')
  const far = l.filter(e => Math.hypot(e.pos[0], e.pos[2]) > 20).length
  assert.ok(far > 15, `${far} lanterns beyond 20 m`)
  assert.ok(r.effects.facts!.some(f => /40 lantern: in the sky 1\d–4\d m up, drift/.test(f)), JSON.stringify(r.effects.facts))
  assert.deepEqual(r.effects.say, ['A thousand wishes, rising.'])
})

test('a numeric altitude floats one thing exactly there; a flock jitters around it', () => {
  const one = run(createWorld(), [{ op: 'spawn', kind: 'bird', set: { altitude: 20 } }]).state.entities[0]!
  assert.equal(one.pos[1], 20)
  const flock = run(createWorld(), [{ op: 'spawn', kind: 'bird', count: 8, arrange: 'scatter', set: { altitude: 20, motion: 'orbit' } }]).state.entities
  assert.ok(flock.every(e => e.pos[1] >= 14 && e.pos[1] <= 26))
  assert.ok(flock.every(e => e.path), 'orbiting birds have a resolved path')
})

test('airborne spawns are not pushed out of the way by ground things below them', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'house', at: { anchor: 'gaze' } }]).state
  const house = s.entities[0]!
  const r = run(s, [{ op: 'spawn', kind: 'lantern', at: { anchor: 'target', of: { kind: 'house' }, side: 'front', dist: 0 }, set: { altitude: 12 } }])
  const l = r.state.entities.find(e => e.kind === 'lantern')!
  assert.ok(Math.hypot(l.pos[0] - house.pos[0], l.pos[2] - house.pos[2]) < 0.5, 'hangs right over the house')
  assert.equal(l.pos[1], 12)
})

test('modify altitude lifts things; relative altitude multiplies; altitude 0 lands them', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'lantern', count: 3, arrange: 'line', set: { altitude: 10 } }]).state
  s = run(s, [{ op: 'modify', target: { kind: 'lantern' }, set: { altitude: 2 }, relative: true }]).state
  assert.ok(s.entities.every(e => e.pos[1] >= 14), s.entities.map(e => e.pos[1]).join(','))
  s = run(s, [{ op: 'modify', target: { kind: 'lantern' }, set: { altitude: 0 } }]).state
  assert.ok(s.entities.every(e => e.pos[1] === 0 && e.props.altitude === undefined))
})

test('make the dragon fly around me: orbit around the player at its own distance', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'house', at: { anchor: 'gaze' } }]).state
  const r = run(s, [{ op: 'modify', target: { kind: 'house' }, set: { motion: 'orbit', around: 'player', altitude: 18 } }])
  const d = r.state.entities[0]!
  assert.deepEqual(d.path!.c, [0, 0])
  assert.ok(Math.abs(d.path!.r - Math.hypot(d.pos[0], d.pos[2])) < 0.01)
  assert.equal(d.pos[1], 18)
  assert.ok(r.effects.facts!.some(f => /orbit around the player/.test(f)))
  // Still again: motion none drops the path.
  const still = run(r.state, [{ op: 'modify', target: { kind: 'house' }, set: { motion: 'none' } }]).state.entities[0]!
  assert.equal(still.props.motion, undefined)
  assert.equal(still.path, undefined)
})

test('a galloping herd shares one loop, and every horse starts on it', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'rock', count: 6, arrange: 'cluster', radius: 5, set: { motion: 'gallop' } }]).state
  const cs = new Set(s.entities.map(e => e.path!.c.join(',')))
  assert.equal(cs.size, 1, 'one shared centre')
  for (const e of s.entities) {
    const p = motionPose(e, 0, 1)!
    assert.ok(Math.hypot(p.x - e.pos[0], p.z - e.pos[2]) < 0.05, `starts where it stands (${p.x},${p.z} vs ${e.pos})`)
  }
})

test('motion is deterministic, and replay (undo/save/load) moves things the same way', () => {
  const r = run(createWorld(), LANTERNS)
  const again = importWorld(JSON.parse(JSON.stringify(exportWorld(r.state))))
  assert.deepEqual(again.entities, r.state.entities)
  for (const t of [0, 0.5, 3, 17.25]) {
    for (let i = 0; i < 5; i++) assert.deepEqual(motionPose(again.entities[i]!, t), motionPose(r.state.entities[i]!, t))
  }
  // Different lanterns drift differently (seeded per id), and they really move.
  const a = motionPose(r.state.entities[0]!, 10)!
  const b = motionPose(r.state.entities[1]!, 10)!
  assert.notDeepEqual([a.x - r.state.entities[0]!.pos[0], a.y], [b.x - r.state.entities[1]!.pos[0], b.y])
  const a2 = motionPose(r.state.entities[0]!, 20)!
  assert.ok(Math.hypot(a2.x - a.x, a2.z - a.z, a2.y - a.y) > 0.2)
  // Undo removes them; the log replays without them.
  const u = run(r.state, [{ op: 'undo' }])
  assert.equal(u.state.entities.length, 0)
})

test('blendedPose starts at rest and an orbit keeps its radius', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'bird', at: { anchor: 'gaze' }, set: { altitude: 15, motion: 'orbit', around: 'player' } }]).state
  const e = s.entities[0]!
  const p0 = blendedPose(e, 0)!
  assert.ok(Math.abs(p0.x - e.pos[0]) < 1e-9 && Math.abs(p0.y - e.pos[1]) < 1e-9)
  for (const t of [2, 5, 9]) {
    const p = motionPose(e, t)!
    assert.ok(Math.abs(Math.hypot(p.x - e.path!.c[0], p.z - e.path!.c[1]) - e.path!.r) < 0.01)
  }
})

test('weather persists and replays; events are one-shots that leave no state', () => {
  let r = run(createWorld(), [{ op: 'atmosphere', weather: 'storm', time: 'night' }, { op: 'say', text: 'The heavens split.' }])
  assert.equal(r.state.atmosphere.weather, 'storm')
  assert.ok(r.batch)
  assert.equal(importWorld(exportWorld(r.state)).atmosphere.weather, 'storm')
  r = run(r.state, [{ op: 'atmosphere', event: 'lightning' }], ctx({ gaze: { point: [3, 0, -20], dist: 20 } }))
  assert.deepEqual(r.effects.events, [{ kind: 'lightning', at: [3, 0, -20] }])
  r = run(r.state, [{ op: 'atmosphere', weather: 'clear' }])
  assert.equal(r.state.atmosphere.weather, undefined)
  const fog = run(createWorld(), [{ op: 'atmosphere', weather: 'fog' }]).state.atmosphere
  assert.equal(fog.fog, 0.75)
  const sunrise = run(createWorld(), [{ op: 'atmosphere', event: 'sunrise' }]).state.atmosphere
  assert.equal(sunrise.time, 'day')
})

test('make me tiny: playerScale lives in the atmosphere, undo restores you, teleport resets it', () => {
  const s0 = createWorld()
  const r = run(s0, [{ op: 'atmosphere', playerScale: 0.1 }])
  assert.equal(r.state.atmosphere.playerScale, 0.1)
  assert.ok(r.effects.atmosphere)
  assert.ok(r.effects.facts!.some(f => /10× larger/.test(f)))
  assert.equal(run(r.state, [{ op: 'undo' }]).state.atmosphere.playerScale, undefined)
  assert.equal(run(r.state, [{ op: 'atmosphere', playerScale: 1 }]).state.atmosphere.playerScale, undefined)
  assert.equal(run(r.state, [{ op: 'teleport', world: 'pool hall' }]).state.atmosphere.playerScale, undefined)
  assert.equal(parseOps([{ op: 'atmosphere', playerScale: 0 }]).ops.length, 0)
})

test('honesty: the genie never claims motion, weather or a move that did not happen', () => {
  // Static street lamps with a drifting claim.
  const lamps = run(createWorld(), [{ op: 'atmosphere', time: 'night' }, { op: 'spawn', kind: 'lamp', count: 12, arrange: 'scatter' }, { op: 'say', text: 'Night falls, lanterns drift.' }])
  assert.deepEqual(lamps.effects.say, ['Night falls.'])
  // "Moved." with no move op; the honest half stays.
  const s = run(createWorld(), [{ op: 'spawn', kind: 'house' }]).state
  const fib = run(s, [{ op: 'say', text: 'Moved. It cannot fly… yet.' }])
  assert.deepEqual(fib.effects.say, ['It cannot fly… yet.'])
  // Weather claimed without weather.
  assert.deepEqual(run(s, [{ op: 'atmosphere', fog: 0.6 }, { op: 'say', text: 'Thunder rolls.' }]).effects.say, ['It is done.'])
  // True claims pass untouched.
  assert.deepEqual(run(createWorld(), LANTERNS).effects.say, ['A thousand wishes, rising.'])
  const storm = run(s, [{ op: 'atmosphere', weather: 'storm' }, { op: 'say', text: 'Thunder rolls, rain falls.' }])
  assert.deepEqual(storm.effects.say, ['Thunder rolls, rain falls.'])
  const flying = run(s, [{ op: 'modify', target: { kind: 'house' }, set: { motion: 'orbit', around: 'player' } }, { op: 'say', text: 'Behold, it flies!' }])
  assert.deepEqual(flying.effects.say, ['Behold, it flies!'])
  // Nothing changed and the line claims flight: an honest fallback.
  assert.equal(honestSay('It soars!', [], createWorld(), false), 'That is beyond me… for now.')
})

test('the Director can pass altitude, motion and weather through its flat ops', () => {
  const sp = parseOps([directorToOp({ op: 'spawn', kind: 'bird', xz: [0, -20], count: 6, altitude: 22, motion: 'orbit' })]).ops[0]!
  assert.equal(sp.op, 'spawn')
  if (sp.op === 'spawn') assert.deepEqual([sp.set?.altitude, sp.set?.motion], [22, 'orbit'])
  const at = parseOps([directorToOp({ op: 'atmosphere', time: 'night', weather: 'misty' })])
  assert.equal(at.ops.length, 1, 'a bad weather word never drops the atmosphere op')
  const rain = parseOps([directorToOp({ op: 'atmosphere', time: 'dusk', weather: 'rain' })]).ops[0]!
  assert.equal(rain.op === 'atmosphere' && rain.weather, 'rain')
})
