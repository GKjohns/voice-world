/**
 * The model's view: the context block, the trimmed scene round trip, direction words, and the
 * stringified-envelope salvage in parseOps.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildContext, compass, relativeDir, sceneToState, trimScene } from '../shared/world/context.ts'
import { parseOps } from '../shared/world/ops.ts'
import { applyBatch, createWorld } from '../shared/world/state.ts'
import type { OpContext } from '../shared/world/types.ts'

const ctx = (over: Partial<OpContext> = {}): OpContext => ({ gaze: { point: [-5, 0, -8] }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 1, ...over })

const PARTS = [{ shape: 'box', size: [0.6, 2, 0.4], at: [0, 1, 0], color: '#5a3a22' }]

function scene() {
  let s = createWorld()
  s = applyBatch(s, { ops: [{ op: 'spawn', kind: 'pine', count: 9, arrange: 'cluster', at: { anchor: 'gaze' } }] }, ctx(), 'make a bunch of trees', 0).state
  s = applyBatch(s, { ops: [{ op: 'define', kind: 'grandfather_clock', tags: ['clock', 'furniture'], parts: PARTS }, { op: 'spawn', kind: 'grandfather_clock', at: { anchor: 'player', dir: 'right', dist: 8 } }] }, ctx(), 'a clock to my right', 0).state
  s = applyBatch(s, { ops: [{ op: 'spawn', kind: 'pinball_machine', at: { anchor: 'player', dir: 'behind', dist: 6 } }] }, ctx(), 'a pinball_machine', 0).state
  return s
}

test('compass and relative directions follow yaw 0 = north, positive turns left', () => {
  assert.equal(compass(0), 'N')
  assert.equal(compass(Math.PI / 2), 'W')
  assert.equal(compass(-Math.PI / 2), 'E')
  assert.equal(compass(Math.PI), 'S')
  assert.equal(relativeDir(ctx(), [0, 0, -10]), 'ahead')
  assert.equal(relativeDir(ctx(), [-6, 0, -6]), 'ahead-left')
  assert.equal(relativeDir(ctx(), [8, 0, 0]), 'right')
  assert.equal(relativeDir(ctx(), [0, 0, 9]), 'behind')
  // Facing west, -x is ahead.
  assert.equal(relativeDir(ctx({ player: { pos: [0, 1.6, 0], yaw: Math.PI / 2 } }), [-10, 0, 0]), 'ahead')
})

test('the context block summarizes by kind, never by id list', () => {
  const block = buildContext(scene(), ctx())
  assert.match(block, /player: at \(0,0\), facing N/)
  assert.match(block, /last batch: pinball_machine ×1 \(g3, "a pinball_machine"\)/)
  assert.match(block, /pine ×9 \[tree, plant, nature, conifer\]/)
  assert.match(block, /grandfather_clock ×1 \[clock, furniture\] \(learned\)/)
  assert.match(block, /pinball_machine ×1 \(placeholder, not defined yet\)/)
  assert.match(block, /learned kinds \(reuse by name, no define needed\): grandfather_clock/)
  assert.match(block, /placeholders waiting for a define: pinball machine/)
  assert.doesNotMatch(block, /pine#2/)
})

test('gaze on an object names it with props and its batch', () => {
  const s = scene()
  const pine = s.entities.find(e => e.kind === 'pine')!
  const block = buildContext(s, ctx({ gaze: { point: pine.pos, entity: pine.id } }))
  assert.match(block, new RegExp(`gaze \\(at speech start\\): object ${pine.id.replace('#', '#')} \\(pine \\[tree`))
  assert.match(block, /one of pine ×9 in batch g1/)
  const ground = buildContext(s, ctx({ gaze: { point: [0, 0, -30] } }))
  assert.match(ground, /gaze \(at speech start\): ground, 30 m ahead/)
})

test('trimScene → sceneToState keeps what the model and selectors need', () => {
  const s = scene()
  const trimmed = trimScene(s)
  assert.equal(trimmed.learned.length, 1)
  assert.equal(trimmed.learned[0]!.parts, undefined)
  assert.equal(trimmed.lastLabel, 'a pinball_machine')
  const back = sceneToState(JSON.parse(JSON.stringify(trimmed)))
  assert.equal(back.entities.length, s.entities.length)
  assert.ok(back.kinds.grandfather_clock?.learned)
  assert.ok(back.kinds.pine)
  assert.equal(buildContext(back, ctx()), buildContext(s, ctx()))
  // A missing or junk scene still yields an empty world.
  assert.match(buildContext(sceneToState(undefined), ctx()), /world: empty/)
})

test('parseOps unwraps an ops array the model stringified', () => {
  const { ops, dropped } = parseOps({ ops: JSON.stringify([{ op: 'atmosphere', time: 'night' }, { op: 'say', text: 'Night.' }]) })
  assert.equal(ops.length, 2)
  assert.equal(dropped.length, 0)
  assert.equal(parseOps({ ops: '[not json' }).ops.length, 0)
  // The envelope's own closing brace sometimes lands inside the string.
  const stray = parseOps({ ops: '[{"op":"say","text":"a ] and a \\" in here"},{"op":"undo"}]}\n' })
  assert.equal(stray.ops.length, 2)
})
