/**
 * Fresh mode: the URL switch, the filler / showpiece split, the engine never conjuring a kit showpiece,
 * and the intent prompt carrying the Fresh rules only when asked (the cached digest never changes).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FRESH_FILLER, FRESH_SHOWPIECES, freshRenamer, isFreshShowpiece, nextKindName, parseFreshParam } from '../shared/world/fresh.ts'
import { KIT } from '../shared/world/kinds.ts'
import { applyBatch, createWorld, exportWorld, importWorld } from '../shared/world/state.ts'
import type { OpContext } from '../shared/world/types.ts'
import { DIGEST, intentPrompt } from '../server/utils/intent.ts'
import { directorPrompt } from '../server/utils/director.ts'

const ctx = (fresh?: boolean): OpContext => ({ gaze: { point: [0, 0, -14] }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 7, ...(fresh ? { fresh } : {}) })

test('fresh: ?fresh= parsing', () => {
  for (const v of ['1', 'true', 'on', 'yes', '', 'TRUE']) assert.equal(parseFreshParam(v), true, v)
  for (const v of ['0', 'false', 'off', 'no']) assert.equal(parseFreshParam(v), false, v)
  assert.equal(parseFreshParam(null), undefined)
  assert.equal(parseFreshParam('maybe'), undefined)
})

test('fresh: creatures and props are showpieces; terrain, structure, nature filler and people are not', () => {
  for (const k of ['whale', 'dragon', 'horse', 'bird', 'house', 'lamp', 'lantern', 'car', 'boat', 'campfire']) assert.ok(isFreshShowpiece(k), k)
  for (const k of ['hill', 'mountain_range', 'floor', 'wall', 'water', 'pine', 'oak', 'rock', 'person', 'fireflies']) assert.ok(!isFreshShowpiece(k), k)
  assert.ok(!isFreshShowpiece('sky_whale'), 'a learned kind is not a kit showpiece')
  for (const k of FRESH_FILLER) assert.ok(KIT[k], `filler ${k} is a real kit kind`)
  assert.equal(FRESH_SHOWPIECES.length + FRESH_FILLER.size, Object.keys(KIT).filter(k => k !== 'blob').length)
})

test('fresh: the engine never conjures a kit showpiece, but still does with Fresh off', () => {
  const ops = [{ op: 'modify', target: { kind: 'whale' }, set: { motion: 'orbit', around: 'player' } }]
  const normal = applyBatch(createWorld(), { ops }, ctx(), 'make the whale circle me', 0)
  assert.equal(normal.state.entities.filter(e => e.kind === 'whale').length, 1)
  const fresh = applyBatch(createWorld(), { ops }, ctx(true), 'make the whale circle me', 0)
  assert.equal(fresh.state.entities.filter(e => e.kind === 'whale').length, 0)
  // Filler still conjures in Fresh mode (a hill under a castle is scenery).
  const hill = applyBatch(createWorld(), { ops: [{ op: 'modify', target: { kind: 'hill' }, set: { color: '#4f8a3c' } }] }, ctx(true), 'make the hill green', 0)
  assert.equal(hill.state.entities.filter(e => e.kind === 'hill').length, 1)
})

test('fresh: the flag rides on the batch, so a reload replays the same world', () => {
  const ops = [{ op: 'modify', target: { kind: 'whale' }, set: { glow: 2 } }, { op: 'spawn', kind: 'pine' }]
  const res = applyBatch(createWorld(), { ops }, ctx(true), 'glow', 0)
  const back = importWorld(JSON.parse(JSON.stringify(exportWorld(res.state))))
  assert.deepEqual(back.entities.map(e => e.kind), res.state.entities.map(e => e.kind))
  assert.ok(!back.entities.some(e => e.kind === 'whale'))
})

test('fresh: only the per-call prompt changes; the cached digest is untouched', () => {
  const plain = intentPrompt('a whale swimming through the sky', undefined, ctx())
  const fresh = intentPrompt('a whale swimming through the sky', undefined, ctx(true))
  assert.ok(!plain.includes('FRESH MODE'))
  assert.ok(fresh.startsWith('## FRESH MODE'))
  assert.ok(fresh.includes('sky_whale'))
  assert.ok(!DIGEST.includes('FRESH MODE'))
  assert.ok(directorPrompt({ world: 'a lake', fresh: true }).startsWith('## FRESH MODE'))
  assert.ok(!directorPrompt({ world: 'a lake' }).includes('FRESH MODE'))
})

test('fresh: a repeated wish that re-defines a learned kind is renamed; a plain reuse passes unchanged', () => {
  const parts = [{ shape: 'box', size: [1, 1, 1], at: [0, 0.5, 0], color: '#ffffff', kind: 'sky_whale' }]
  const r = freshRenamer<{ op: string, kind?: string, target?: { kind?: string }, parts?: unknown[] }>(['sky_whale'])
  assert.deepEqual(r.push({ op: 'spawn', kind: 'sky_whale' }), [])
  assert.deepEqual(r.push({ op: 'modify', target: { kind: 'sky_whale' } }), [])
  const out = r.push({ op: 'define', kind: 'sky_whale', parts })
  assert.deepEqual(out.map(o => o.kind ?? o.target?.kind), ['sky_whale_2', 'sky_whale_2', 'sky_whale_2'])
  assert.equal(out[2]!.parts, parts, 'parts are left alone')
  assert.deepEqual(r.push({ op: 'say' }), [{ op: 'say' }])
  // "five more of those": held until the answer ends, then let go as it was.
  const again = freshRenamer<{ op: string, kind?: string }>(['sky_whale', 'sky_whale_2'])
  assert.deepEqual(again.push({ op: 'spawn', kind: 'sky_whale_2' }), [])
  assert.deepEqual(again.push({ op: 'say' }), [])
  assert.deepEqual(again.end().map(o => o.kind ?? o.op), ['sky_whale_2', 'say'])
  // A new name never holds.
  const fresh = freshRenamer<{ op: string, kind?: string }>(['sky_whale'])
  assert.deepEqual(fresh.push({ op: 'spawn', kind: 'sky_whale_3' }), [{ op: 'spawn', kind: 'sky_whale_3' }])
  assert.equal(nextKindName('sky_whale_2', new Set(['sky_whale', 'sky_whale_2'])), 'sky_whale_3')
})
