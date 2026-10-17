/**
 * Director smoke bench: stream a few places through the real model and the real kernel.
 *   node --env-file=.env bench/director.ts                 # the three Sprint 4 places
 *   node --env-file=.env bench/director.ts "a ramen shop"  # one place (brief optional after a |)
 * Prints time-to-first-op, time-to-done, op count, dropped ops and cost per place.
 */
import { applyBatch, createWorld, extendLastBatch } from '../shared/world/state.ts'
import { directorToOp } from '../shared/world/ops.ts'
import type { OpContext } from '../shared/world/types.ts'
import { directScene } from '../server/utils/director.ts'

const PLACES: [string, string][] = [
  ['pool hall', 'A dim, warm pool hall: wooden floor, green-felt tables under hanging shaded lamps, cue racks, a jukebox and a neon sign.'],
  ['tranquil lake', 'A wooden dock on a still lake at golden hour, low fog, pines along the shore, fireflies.'],
  ['neon city street', 'A rain-slick city street at night lined with shopfronts and towers, glowing neon signs, street lamps and parked cars.']
]

const arg = process.argv.slice(2).find(a => !a.startsWith('--'))
const places = arg ? [arg.split('|').map(s => s.trim()) as [string, string]] : PLACES
const verbose = process.argv.includes('--ops')
const ctx: OpContext = { gaze: { point: [0, 0, -10] }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 1 }

let total = 0
for (const [world, brief] of places) {
  let s = applyBatch(createWorld(), { ops: [{ op: 'teleport', world, brief }] }, ctx, `take me to ${world}`, 0).state
  let first = 0
  let dropped = 0
  const kinds = new Map<string, number>()
  for await (const ev of directScene({ world, brief, timeoutMs: 150_000 })) {
    if (ev.t === 'op') {
      if (!first) first = ev.ms
      const res = extendLastBatch(s, [directorToOp(ev.op)])
      s = res.state
      dropped += res.dropped.length
      for (const d of res.dropped) console.log(`   dropped: ${d.reason} ${JSON.stringify(d.raw)}`)
      if (verbose) console.log(`  ${String(ev.ms).padStart(6)}ms ${JSON.stringify(ev.op)}`)
    } else if (ev.t === 'done') {
      for (const e of s.entities) kinds.set(e.kind, (kinds.get(e.kind) ?? 0) + 1)
      total += ev.costUsd
      console.log(`${world}: first op ${first} ms · done ${ev.ms} ms · ${ev.count} ops (${dropped} dropped) · ${s.entities.length} entities · out ${ev.usage.output} tok · cache read ${ev.usage.cacheRead} · $${ev.costUsd.toFixed(4)} · ${ev.finishReason}`)
      console.log(`   ${s.atmosphere.time} fog ${s.atmosphere.fog} ${s.atmosphere.ambient ?? ''} · ${[...kinds].map(([k, n]) => `${k}×${n}`).join(' ')}`)
    } else {
      console.log(`${world}: ERROR after ${ev.ms} ms: ${ev.error}`)
    }
  }
}
console.log(`total $${total.toFixed(4)}`)
