/**
 * The forge (progressive high-quality generation): tier choice, spend decisions, the sandboxed program
 * runner and its limits, program → parts (mirror, cleaning, caps), fitting to the draft, the library key,
 * and upgradeKind outside the undo history.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HQ_MAX_PARTS, boundsOf, chooseTier, cleanPart, expandMirror, fitToDraft, hashParts, isBudgetError, islands, libKey, partBounds, partsToProgram, programParts, spendDecision } from '../shared/world/forge.ts'
import type { Part } from '../shared/world/ops.ts'
import { applyBatch, createWorld, exportWorld, importWorld, upgradeKind } from '../shared/world/state.ts'
import type { OpContext } from '../shared/world/types.ts'
import { programToParts, runProgram, streamRunner } from '../server/utils/forgeRun.ts'

const ctx: OpContext = { gaze: { point: [0, 0, -10] }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 3 }
const DRAFT: Part[] = [
  { shape: 'box', size: [2, 2, 2], at: [0, 1, 0], color: '#a33', slot: 'primary' },
  { shape: 'cone', size: [2.4, 1, 2.4], at: [0, 2.5, 0], color: '#333' }
]

test('tier: kit kinds, people and crowds never forge; detail words and "make it better" go hero; else good', () => {
  assert.equal(chooseTier({ text: 'a steampunk airship', kit: false, count: 1 }), 'good')
  assert.equal(chooseTier({ text: 'an intricate carousel', kit: false, count: 1 }), 'hero')
  assert.equal(chooseTier({ text: 'a masterpiece of a fountain', kit: false, count: 2 }), 'hero')
  assert.equal(chooseTier({ text: 'make it more detailed', kit: false, count: 1, quality: 'good' }), 'hero')
  assert.equal(chooseTier({ text: 'make it better', kit: false, count: 1, quality: 'draft' }), 'hero')
  assert.equal(chooseTier({ text: 'a dragon', kit: true, count: 1 }), null)
  assert.equal(chooseTier({ text: 'a wizard', kit: false, person: true, count: 1 }), null)
  assert.equal(chooseTier({ text: 'ten gnomes', kit: false, count: 10 }), null)
  assert.equal(chooseTier({ text: 'an airship', kit: false, count: 1, quality: 'good' }), null, 'already good: no repeat spend')
  assert.equal(chooseTier({ text: 'a detailed airship', kit: false, count: 1, quality: 'hero' }), null)
})

test('ledger: the $12 total and $1.50 session caps (with the estimate) refuse before a call; budget errors are recognised', () => {
  const caps = { cap: 12, sessionCap: 1.5 }
  assert.deepEqual(spendDecision({ total: 1, session: 0.2, estimate: 0.06, ...caps }), { ok: true })
  assert.equal(spendDecision({ total: 11.97, session: 0, estimate: 0.06, ...caps }).ok, false)
  assert.equal(spendDecision({ total: 3, session: 1.46, estimate: 0.06, ...caps }).ok, false)
  assert.ok(isBudgetError('Budget exceeded: current spend $30.18, limit $30.00'))
  assert.ok(isBudgetError('forge cap: $12.00 of $12.00 spent'))
  assert.ok(!isBudgetError('refine took over 50 s'))
})

test('sandbox: no host realm, no eval, timeouts (incl. microtasks), part cap; partial prefixes are skipped', () => {
  assert.match(runProgram(`box([1,1,1],[0,.5,0],'#fff'); this.constructor.constructor('return process')()`).error ?? '', /not allowed/)
  assert.match(runProgram(`box['const'+'ructor']('return 1')()`).error ?? '', /disallowed/, 'string code generation is off')
  assert.match(runProgram(`const f = (0, box)['con' + 'structor']; f('return 1')()`).error ?? '', /disallowed/)
  assert.ok(runProgram(`box([1,1,1],[0,.5,0],'#fff'); this.x()`).raw.length === 1, 'the global has no host prototype')
  assert.match(runProgram('eval("1")').error ?? '', /not allowed/)
  assert.ok(runProgram('for(;;){}').timedOut)
  assert.match(runProgram('Promise.resolve().then(() => { for(;;){} })').error ?? '', /not allowed/)
  assert.match(runProgram('(async () => { for(;;){} })()').error ?? '', /not allowed/)
  assert.equal(typeof (globalThis as Record<string, unknown>).__out, 'undefined')
  const many = runProgram(`for (let i = 0; i < 1000; i++) box([1,1,1],[i,.5,0],'#fff')`)
  assert.equal(many.raw.length, HQ_MAX_PARTS)
  assert.ok(many.ok, 'hitting the cap is a finished object')
  assert.ok(runProgram('for (let i = 0; i < 3; i++) {').syntax)
  // Math.random is seeded: re-running a prefix gives the same parts.
  const a = runProgram(`box([Math.random(),1,1],[0,0,0],'#fff')`).raw
  const b = runProgram(`box([Math.random(),1,1],[0,0,0],'#fff')`).raw
  assert.deepEqual(a, b)
})

test('stream runner: each closed line re-runs the prefix and emits only new parts', () => {
  const r = streamRunner()
  assert.equal(r.push('// name: hut\nbox([2,2,2],[0,1,0],\'#a33\',{slot:\'primary\'})\nfor (const x of [1,').length, 1)
  assert.equal(r.count(), 1)
  const more = r.push(' -1]) cylinder([.2,1,.2],[x,.5,1.2],\'#333\')\n')
  assert.equal(more.length, 2)
  assert.equal(r.end().length, 0)
  assert.equal(r.count(), 3)
})

test('program → parts: tube / lathe / extrude, mirror as plain parts (rot a,−b,−c), strict cleaning', () => {
  const { parts } = programToParts(`const C='#7a5'
tube([[0.3,0,0],[0.3,1,0],[0.5,2,0.4]],[0.2,0.15,0.1],C,{mirror:true,slot:'primary'})
lathe([[1,0],[0.6,2],[0,3]],[0,0,0],'#fff',{material:'stone'})
extrude([[0,0],[1,0],[0,1]],0.1,[1,1,0],'#00f',{mirror:true,rot:[0.2,0.5,0.1],glow:true})
box([NaN,1,1],[0,0,0],'#fff')
box([1,1,1],[0,0,0],'not a colour (with spaces)')`)
  assert.equal(parts.length, 6, 'NaN box dropped; mirrors doubled')
  assert.deepEqual(parts.map(p => p.shape), ['tube', 'tube', 'lathe', 'extrude', 'extrude', 'box'])
  assert.deepEqual(parts[1]!.points![0], [-0.3, 0, 0])
  assert.deepEqual(parts[4]!.at, [-1, 1, 0])
  assert.deepEqual(parts[4]!.rot, [0.2, -0.5, -0.1])
  assert.deepEqual(parts[4]!.outline![1], [-1, 0])
  assert.equal(parts[3]!.slot, 'glow')
  assert.equal(parts[5]!.color, '#9a9a9a')
  assert.equal(cleanPart({ shape: 'tube', points: [[0, 0, 0]] }), null, 'a tube needs two points')
  assert.equal(cleanPart({ shape: 'teapot', size: [1, 1, 1] }), null)
  assert.equal(programParts(Array.from({ length: 300 }, () => ({ shape: 'box', size: [1, 1, 1], at: [1, 0, 0], mirror: true }))).length, HQ_MAX_PARTS)
  // A mirrored part on the plane isn't duplicated.
  assert.equal(expandMirror({ shape: 'box', size: [1, 1, 1], at: [0, 0, 0], color: '#fff', mirror: true }).length, 1)
})

test('bounds honour rotation and the new shapes; islands find floating parts', () => {
  const lying = partBounds({ shape: 'cylinder', size: [0.4, 2, 0.4], at: [0, 1, 0], rot: [Math.PI / 2, 0, 0], color: '#fff' })
  assert.ok(Math.abs(lying.max[2] - 1) < 1e-6 && Math.abs(lying.max[1] - 1.2) < 1e-6)
  const lathe = partBounds({ shape: 'lathe', size: [0, 0, 0], at: [0, 0, 0], profile: [[1, 0], [0, 3]], color: '#fff' })
  assert.deepEqual([lathe.min[0], lathe.max[1]], [-1, 3])
  const floating: Part[] = [...DRAFT, { shape: 'sphere', size: [0.3, 0.3, 0.3], at: [5, 4, 0], color: '#fff' }]
  assert.equal(islands(DRAFT).floating, 0)
  assert.equal(islands(floating).floating, 1)
  assert.match(islands(floating).notes[0]!, /float unattached/)
})

test('fit to the draft: rescale only beyond 0.8–1.25×, centre over the draft, rest where it rests', () => {
  const big = DRAFT.map(p => ({ ...p, at: [p.at[0] * 3 + 4, p.at[1] * 3 + 1, p.at[2] * 3] as Part['at'], size: p.size.map(n => n * 3) as Part['size'] }))
  const fit = fitToDraft(big, DRAFT)
  const b = boundsOf(fit.parts)!
  const d = boundsOf(DRAFT)!
  assert.ok(Math.abs(fit.k - 1 / 3) < 0.02)
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(b.min[i]! - d.min[i]!) < 0.05 && Math.abs(b.max[i]! - d.max[i]!) < 0.05)
  const close = fitToDraft(DRAFT.map(p => ({ ...p, size: p.size.map(n => n * 1.1) as Part['size'] })), DRAFT)
  assert.equal(close.k, 1)
})

test('library key: normalised words, filler and articles gone; the draft as a program round-trips', () => {
  assert.equal(libKey('Put a Steampunk Airship over there!'), 'steampunk_airship')
  assert.equal(libKey('steampunk_airship'), 'steampunk_airship')
  assert.equal(libKey('an intricate carousel'), 'intricate_carousel')
  const back = programToParts(partsToProgram(DRAFT)).parts
  assert.deepEqual(back, DRAFT)
  assert.equal(hashParts(DRAFT), hashParts(DRAFT.map(p => ({ ...p }))))
})

test('upgradeKind: outside the undo history, survives later undos and reloads, refuses stale bases', () => {
  let s = applyBatch(createWorld(), { ops: [{ op: 'spawn', kind: 'hut', at: { anchor: 'gaze' } }, { op: 'define', kind: 'hut', tags: ['building'], parts: DRAFT }] }, ctx, 'a hut', 0).state
  s = applyBatch(s, { ops: [{ op: 'spawn', kind: 'pine', at: { anchor: 'gaze' } }] }, ctx, 'a pine', 0).state
  const basis = s.kinds.hut!.basis!
  const forged: Part[] = [...DRAFT, { shape: 'lathe', size: [0, 0, 0], at: [0, 3, 0], profile: [[0.3, 0], [0, 1]], color: '#ff0', slot: 'glow' }]
  const up = upgradeKind(s, 'hut', forged, { basis, quality: 'good' })!
  assert.ok(up)
  assert.deepEqual(up.effects.redefined, ['hut'])
  assert.equal(up.state.log.length, s.log.length, 'no new batch')
  assert.equal(up.state.kinds.hut!.parts!.length, 3)
  assert.equal(up.state.kinds.hut!.quality, 'good')
  assert.ok(up.state.kinds.hut!.baseHeight >= 4)
  // Undo the pine: the hut stays forged. Undo the hut: it is gone, and a stale upgrade is refused.
  const undo1 = applyBatch(up.state, { ops: [{ op: 'undo' }] }, ctx, 'undo', 0).state
  assert.equal(undo1.kinds.hut!.quality, 'good')
  const undo2 = applyBatch(undo1, { ops: [{ op: 'undo' }] }, ctx, 'undo', 0).state
  assert.equal(undo2.kinds.hut, undefined)
  assert.equal(upgradeKind(undo2, 'hut', forged, { basis, quality: 'good' }), null)
  assert.equal(upgradeKind(s, 'hut', forged, { basis: 'stale', quality: 'good' }), null)
  assert.equal(upgradeKind(up.state, 'hut', DRAFT, { basis, quality: 'good' })?.state.kinds.hut!.quality, 'good')
  const hero = upgradeKind(up.state, 'hut', forged, { basis, quality: 'hero' })!.state
  assert.equal(upgradeKind(hero, 'hut', forged, { basis, quality: 'good' }), null, 'never a downgrade')
  // Save and reload: the upgrade comes back (re-cleaned) and only for the kind's current basis.
  const back = importWorld(JSON.parse(JSON.stringify(exportWorld(up.state))))
  assert.equal(back.kinds.hut!.quality, 'good')
  assert.equal(back.kinds.hut!.parts!.length, 3)
  // A new define of the kind (different parts) drops the upgrade.
  const redefined = applyBatch(up.state, { ops: [{ op: 'define', kind: 'hut', tags: ['building'], parts: [DRAFT[0]!] }] }, ctx, 'a plainer hut', 0).state
  assert.equal(redefined.kinds.hut!.quality, 'draft')
})
