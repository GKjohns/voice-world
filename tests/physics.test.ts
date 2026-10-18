/**
 * Gauntlet loop 1 (track B): physics-lite ops (stack, drop, throw, tip, gravity), player powers (fly, goto),
 * the creative sky, honest lines about all of them, followers, and collision that never gets you stuck.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyBatch, createWorld, isLoose, looseThings, upgradeKind } from '../shared/world/state.ts'
import { directorToOp, parseOps } from '../shared/world/ops.ts'
import { honestSay } from '../shared/world/honesty.ts'
import { distXZ } from '../shared/world/select.ts'
import { supportAt } from '../shared/world/layout.ts'
import type { Op } from '../shared/world/ops.ts'
import type { OpContext, WorldState } from '../shared/world/types.ts'
import { flightPose, flightTimes, floatHeight, followStep, tipLift, tipPose, weightlessPose } from '../app/world/fx/motion.ts'
import { slideOut } from '../app/world/fx/collide.ts'

const CTX: OpContext = { gaze: { point: [0, 0, -10], dist: 10 }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 9 }
const CRATE = [{ shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0], color: '#8a5a38', slot: 'primary' }]

function run(state: WorldState, ops: unknown[], label = 'test') {
  return applyBatch(state, { ops }, CTX, label, 0)
}

test('stack: five crates stand in one column, each on the one below, slightly offset', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'crate', count: 5, arrange: 'stack', at: { anchor: 'gaze' } }, { op: 'define', kind: 'crate', tags: ['crate'], parts: CRATE }]).state
  const crates = s.entities.filter(e => e.kind === 'crate').sort((a, b) => a.pos[1] - b.pos[1])
  assert.equal(crates.length, 5)
  crates.forEach((c, i) => assert.ok(Math.abs(c.pos[1] - i) < 1e-6, `crate ${i} at y ${c.pos[1]}`))
  const spread = Math.max(...crates.map(c => distXZ(c.pos, crates[0]!.pos)))
  assert.ok(spread > 0 && spread < 0.3, `offset ${spread}`)
  // A forged upgrade that is taller re-settles the column onto the new tops.
  const up = upgradeKind(s, 'crate', [{ shape: 'box', size: [1, 1.5, 1], at: [0, 0.75, 0], color: '#8a5a38', slot: 'primary' }], { basis: s.kinds.crate!.basis!, quality: 'good' })!
  const ys = up.state.entities.filter(e => e.kind === 'crate').map(e => e.pos[1]).sort((a, b) => a - b)
  ys.forEach((y, i) => assert.ok(Math.abs(y - i * 1.5) < 1e-6, `upgraded crate ${i} at ${y}`))
})

test('stack on an existing thing starts on its top', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'table', at: { anchor: 'gaze' } }]).state
  s = run(s, [{ op: 'spawn', kind: 'crate', count: 2, arrange: 'stack', at: { anchor: 'target', of: { kind: 'table' }, side: 'on_top' } }, { op: 'define', kind: 'crate', tags: ['crate'], parts: CRATE }]).state
  const ys = s.entities.filter(e => e.kind === 'crate').map(e => e.pos[1]).sort()
  assert.ok(Math.abs(ys[0]! - 0.78) < 0.01 && Math.abs(ys[1]! - 1.78) < 0.01, `ys ${ys}`)
})

test('drop: it rests on the ground (or on what is under it) and remembers where its fall began', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'rock', at: { anchor: 'gaze' }, set: { drop: 'sky' } }]).state
  const rock = s.entities[0]!
  assert.equal(rock.pos[1], 0)
  assert.equal(rock.launch?.kind, 'drop')
  assert.equal(rock.launch!.from[1], 25)
  assert.equal(rock.props.drop, undefined)
  // Dropped onto a table: lands on its top.
  let t = run(createWorld(), [{ op: 'spawn', kind: 'table', at: { anchor: 'gaze' } }]).state
  const table = t.entities[0]!
  t = run(t, [{ op: 'spawn', kind: 'rock', at: { anchor: 'target', of: { kind: 'table' }, side: 'on_top' }, set: { drop: 10 } }]).state
  const r2 = t.entities.find(e => e.kind === 'rock')!
  assert.ok(Math.abs(r2.pos[1] - 0.78) < 0.01, `rock at ${r2.pos[1]}`)
  assert.ok(distXZ(r2.pos, table.pos) < 0.5)
  assert.ok(Math.abs(supportAt(t, table.pos[0], table.pos[2], 0.3, new Set([r2.id])) - 0.78) < 0.01)
})

test('drop on a thing already in the air falls from where it is', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'lantern', at: { anchor: 'gaze' }, set: { altitude: 8 } }]).state
  s = run(s, [{ op: 'modify', target: { kind: 'lantern' }, set: { drop: 12 } }]).state
  const l = s.entities[0]!
  assert.equal(l.pos[1], 0)
  assert.ok(Math.abs(l.launch!.from[1] - 8) < 0.01, `from ${l.launch!.from[1]}`)
})

test('throw: from the player toward the gaze, landing that far out', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'rock', set: { throw: 40 } }]).state
  const r = s.entities[0]!
  assert.ok(Math.abs(distXZ(r.pos, CTX.player.pos) - 40) < 0.01, `dist ${distXZ(r.pos, CTX.player.pos)}`)
  assert.ok(r.pos[2] < -39, 'lands ahead, toward the gaze')
  assert.equal(r.launch?.kind, 'throw')
  assert.ok(r.launch!.from[1] > 1 && distXZ(r.launch!.from, CTX.player.pos) < 1)
})

test('flight poses: a drop starts high, accelerates, bounces and settles; a throw arcs', () => {
  const e = { id: 'piano#1', pos: [0, 0, -5] as [number, number, number], rotY: 0, launch: { from: [0, 20, -5] as [number, number, number], kind: 'drop' as const } }
  const times = flightTimes(e)!
  assert.ok(Math.abs(times.land - Math.sqrt(40 / 9.8)) < 1e-6)
  assert.ok(times.bounce.length >= 1)
  const p0 = flightPose(e, 0)!
  const p1 = flightPose(e, times.land * 0.5)!
  assert.equal(p0.y, 20)
  assert.ok(p1.y > 14 && p1.y < 16, `quarter height lost at half time: ${p1.y}`)
  assert.equal(flightPose(e, times.settle + 0.01), null)
  const ball = { id: 'ball#1', pos: [0, 0, -40] as [number, number, number], rotY: 0, launch: { from: [0, 1.35, -0.6] as [number, number, number], kind: 'throw' as const } }
  const bt = flightTimes(ball)!
  const mid = flightPose(ball, bt.land / 2)!
  assert.ok(mid.y > 5, `arc apex ${mid.y}`)
  assert.ok(mid.z < -10 && mid.z > -30)
})

test('tip: absolute degrees even in a relative modify; the turned box never sinks', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'house', at: { anchor: 'gaze' } }]).state
  s = run(s, [{ op: 'modify', target: { kind: 'house' }, set: { tip: 180 }, relative: true }]).state
  assert.equal(s.entities[0]!.props.tip, 180)
  assert.ok(Math.abs(tipLift(Math.PI, 2, 5) - 5) < 1e-9)
  assert.ok(Math.abs(tipLift(Math.PI / 2, 2, 5) - 2) < 1e-9)
  assert.equal(tipLift(0, 2, 5), 0)
  const end = tipPose(0, 180, 5, 2, 5)
  assert.ok(Math.abs(end.roll - Math.PI) < 1e-9 && Math.abs(end.lift - 5) < 1e-9)
})

test('gravity off: loose things float, buildings and terrain stay; it toggles back; a teleport restores it', () => {
  const s = run(createWorld(), [
    { op: 'spawn', kind: 'rock', count: 4, arrange: 'cluster', at: { anchor: 'gaze' } },
    { op: 'spawn', kind: 'house', at: { anchor: 'player', dir: 'left', dist: 14 } },
    { op: 'spawn', kind: 'hill', at: { anchor: 'player', dist: 60 } }
  ]).state
  assert.equal(looseThings(s).length, 4)
  assert.ok(!isLoose(s, s.entities.find(e => e.kind === 'house')!))
  const off = run(s, [{ op: 'atmosphere', gravity: false }])
  assert.equal(off.state.atmosphere.gravity, false)
  assert.ok(off.effects.atmosphere)
  assert.ok(off.effects.facts!.some(f => /gravity off: 4/.test(f)))
  const on = run(off.state, [{ op: 'atmosphere', gravity: true }]).state
  assert.equal(on.atmosphere.gravity, undefined)
  const tp = run(off.state, [{ op: 'teleport', world: 'a beach' }]).state
  assert.equal(tp.atmosphere.gravity, undefined)
  // The float: rises and slows; when gravity returns it falls back to rest.
  assert.ok(floatHeight('rock#1', 8, 1) > floatHeight('rock#1', 2, 1))
  assert.ok(weightlessPose('rock#1', 1, 6)!.dy > 1)
  assert.equal(weightlessPose('rock#1', 1, 30, 20), null)
})

test('fly, goto and a creative sky are player and sky state, not entities', () => {
  let s = run(createWorld(), [{ op: 'atmosphere', fly: true }]).state
  assert.equal(s.atmosphere.fly, true)
  s = run(s, [{ op: 'atmosphere', sky: '#7b4fa6', horizon: '#c9a0dc', moons: 2 }]).state
  assert.deepEqual([s.atmosphere.sky, s.atmosphere.moons], ['#7b4fa6', 2])
  // A new time of day without a tint drops the custom sky but keeps the moons.
  s = run(s, [{ op: 'atmosphere', time: 'night' }]).state
  assert.equal(s.atmosphere.sky, undefined)
  assert.equal(s.atmosphere.moons, 2)
  s = run(s, [{ op: 'spawn', kind: 'tower', at: { anchor: 'gaze' } }]).state
  const res = run(s, [{ op: 'goto', target: { kind: 'tower' }, side: 'on_top' }, { op: 'say', text: 'Up you go.' }])
  const tower = s.entities.find(e => e.kind === 'tower')!
  assert.ok(res.effects.goto)
  assert.ok(Math.abs(res.effects.goto!.to[1] - 24) < 0.01)
  assert.ok(distXZ(res.effects.goto!.to, tower.pos) < 0.01)
  assert.equal(res.batch, undefined, 'a goto changes no world state, so it is never an undo step')
  assert.deepEqual(res.effects.say, ['Up you go.'])
})

test('honesty: no "stacked" over a row, no gravity or flip claims without the op', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'rock', count: 5, arrange: 'line', at: { anchor: 'gaze' } }]).state
  const row: Op[] = parseOps([{ op: 'spawn', kind: 'rock', count: 5, arrange: 'line' }]).ops
  assert.equal(honestSay('Five crates, stacked high.', row, s, true), 'Five crates.')
  const stack: Op[] = parseOps([{ op: 'spawn', kind: 'rock', count: 5, arrange: 'stack' }]).ops
  assert.equal(honestSay('Five crates, stacked high.', stack, s, true), 'Five crates, stacked high.')
  assert.equal(honestSay('Gravity, suspended. Float.', [], s, false), 'That is beyond me… for now.')
  const grav: Op[] = parseOps([{ op: 'atmosphere', gravity: false }]).ops
  assert.equal(honestSay('Gravity, suspended. Float.', grav, s, true), 'Gravity, suspended. Float.')
  const recolor: Op[] = parseOps([{ op: 'modify', target: { ref: 'all' }, set: { color: '#3a6fc0' } }]).ops
  assert.ok(!/head/.test(honestSay('Turned on its head.', recolor, s, true)))
  assert.ok(!/swirl/i.test(honestSay('Swirling skies, bold strokes.', recolor, s, true)))
  const tip: Op[] = parseOps([{ op: 'modify', target: { ref: 'gaze' }, set: { tip: 180 } }]).ops
  assert.equal(honestSay('Turned on its head.', tip, s, true), 'Turned on its head.')
  assert.ok(!/moons/.test(honestSay('Purple skies, two moons.', parseOps([{ op: 'atmosphere', sky: '#7b4fa6' }]).ops, s, true)))
})

test('followers trot to a spot ahead of the player and keep up with a run', () => {
  let f = { x: 0, z: 5, yaw: 0 }
  const player = { x: 0, z: 0, yaw: 0 }
  for (let i = 0; i < 120; i++) f = followStep(f, 'dog#1', player, 1 / 60, 0.5)
  assert.ok(f.z < -1, `ahead of the player (z ${f.z})`)
  // The player runs 14 m/s down -z for 3 s; the dog stays within a few metres.
  for (let i = 0; i < 180; i++) {
    player.z -= 14 / 60
    f = followStep(f, 'dog#1', player, 1 / 60, 0.5)
  }
  assert.ok(Math.hypot(f.x - player.x, f.z - player.z) < 8, `gap ${Math.hypot(f.x - player.x, f.z - player.z)}`)
})

test('collision: a step into a solid slides along it, a step out of one is always allowed', () => {
  const lighthouse = { x: 0, z: -5, r: 2 }
  // Walking straight at it stops at its skin.
  let px = 0
  let pz = 0
  for (let i = 0; i < 200; i++) {
    const [mx, mz] = slideOut(px, pz, 0, -0.1, [lighthouse])
    px += mx
    pz += mz
  }
  assert.ok(Math.hypot(px - lighthouse.x, pz - lighthouse.z) >= 2 - 1e-6, `got inside: ${pz}`)
  // Walking diagonally past it keeps the sideways part.
  const [sx] = slideOut(0, -2.95, 0.1, -0.1, [lighthouse])
  assert.ok(sx > 0.05)
  // Spawned on top of you: you can walk out, not deeper.
  const [ox, oz] = slideOut(0, -4.5, 0, 0.1, [lighthouse])
  assert.deepEqual([ox, oz], [0, 0.1])
  const [, iz] = slideOut(0, -4.5, 0, -0.1, [lighthouse])
  assert.ok(Math.abs(iz) < 1e-9)
})

test('the Director can define signature props (with a hero), and people get a role', () => {
  const def = directorToOp({ op: 'define', kind: 'Washing Machine', tags: ['machine'], hero: true, parts: CRATE }) as Record<string, unknown>
  const { ops, dropped } = parseOps([def])
  assert.equal(dropped.length, 0)
  assert.equal(ops[0]!.op, 'define')
  assert.equal((ops[0] as { kind: string }).kind, 'washing_machine')
  assert.equal((ops[0] as { hero?: boolean }).hero, true)
  const p = directorToOp({ op: 'spawn', kind: 'person', xz: [2, -6], role: 'guard', count: 3 }) as { set: { role: string } }
  assert.equal(p.set.role, 'guard')
  const atmo = directorToOp({ op: 'atmosphere', time: 'night', sky: '#0b3040', moons: 2 }) as Record<string, unknown>
  assert.deepEqual(parseOps([atmo]).ops[0], { op: 'atmosphere', time: 'night', sky: '#0b3040', moons: 2 })
})
