/** Loop 1: the incremental op scanner that lets the intent and the Director apply ops as they close. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opScanner, parseLooseJson } from '../server/utils/opStream.ts'

function feed(text: string, step = 3): unknown[][] {
  const s = opScanner()
  const out: unknown[][] = []
  for (let i = 0; i < text.length; i += step) out.push(s.push(text.slice(i, i + step)))
  return out
}

test('opScanner: yields each envelope op as soon as it closes', () => {
  const text = '{"ops":[{"op":"spawn","kind":"pine","at":{"anchor":"gaze"}},{"op":"say","text":"A } grove [rises]."}]}'
  const chunks = feed(text)
  const all = chunks.flat()
  assert.equal(all.length, 2)
  assert.deepEqual(all[0], { op: 'spawn', kind: 'pine', at: { anchor: 'gaze' } })
  assert.deepEqual(all[1], { op: 'say', text: 'A } grove [rises].' })
  // The first op arrives before the stream ends.
  const firstAt = chunks.findIndex(c => c.length)
  assert.ok(firstAt < chunks.length - 5)
})

test('opScanner: bare arrays with nested arrays, fences and escapes', () => {
  const text = '```json\n[{"op":"spawn","kind":"floor","xz":[0,-7],"size":[18,20]},{"op":"say","text":"He said \\"hi\\"]"}]\n```'
  const all = feed(text, 5).flat()
  assert.equal(all.length, 2)
  assert.deepEqual((all[0] as { xz: number[] }).xz, [0, -7])
  assert.equal((all[1] as { text: string }).text, 'He said "hi"]')
})

test('opScanner: a stringified envelope yields nothing; parseLooseJson recovers it', () => {
  const text = '{"ops":"[{\\"op\\":\\"undo\\"}]"}'
  const s = opScanner()
  assert.equal(s.push(text).length, 0)
  assert.deepEqual(parseLooseJson(s.text()), { ops: '[{"op":"undo"}]' })
})
