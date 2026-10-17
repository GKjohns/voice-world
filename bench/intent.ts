/**
 * Intent bench: ~30 utterances × small scenes, through the real model and the real kernel.
 *   npm run bench:intent                      # haiku and sonnet
 *   npm run bench:intent -- haiku --only tree # one model, cases whose name contains "tree"
 *   npm run bench:intent -- haiku --repeat 2  # run each case twice (flakiness)
 * Scenes are built with applyBatch from canned ops; each case applies the model's ops to its scene with
 * applyBatch and checks the resulting state (or the ops). Prints pass rate, first-op and done latency
 * (the intent call streams; rows show first/done ms), cost and which provider served it.
 */
import { applyBatch, createWorld } from '../shared/world/state.ts'
import { trimScene } from '../shared/world/context.ts'
import { distXZ } from '../shared/world/select.ts'
import type { Op } from '../shared/world/ops.ts'
import type { Entity, OpContext, WorldState } from '../shared/world/types.ts'
import { interpret } from '../server/utils/intent.ts'

// ---------- scenes ----------

const CTX: OpContext = { gaze: { point: [0, 0, -10], dist: 10 }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 7 }

function build(...batches: [string, unknown[]][]): WorldState {
  let s = createWorld()
  let i = 0
  for (const [label, ops] of batches) s = applyBatch(s, { ops }, { ...CTX, seed: 100 + i++ }, label, 0).state
  return s
}

const CLOCK = [
  { shape: 'box', size: [0.6, 2, 0.4], at: [0, 1, 0], color: '#5a3a22', slot: 'primary', material: 'wood' },
  { shape: 'cylinder', size: [0.4, 0.04, 0.4], at: [0, 1.6, 0.21], rot: [1.571, 0, 0], color: '#f2ead8' }
]

const BLOCKY = [
  { shape: 'box', size: [1.2, 1.4, 2.6], at: [0, 1.4, 0], color: '#4f8a3c', slot: 'primary' },
  { shape: 'box', size: [0.5, 0.6, 0.8], at: [0, 2.2, 1.4], color: '#4f8a3c', slot: 'primary' },
  { shape: 'box', size: [0.3, 0.8, 0.3], at: [0.4, 0.4, 0.9], color: '#3a2618', slot: 'trim' }
]

const SCENES = {
  empty: () => createWorld(),
  grove: () => build(
    ['make a bunch of trees', [{ op: 'spawn', kind: 'pine', count: 9, arrange: 'cluster', at: { anchor: 'gaze' }, radius: 6 }]],
    ['some oaks to the right', [{ op: 'spawn', kind: 'oak', count: 4, arrange: 'cluster', at: { anchor: 'player', dir: 'right', dist: 14 } }]],
    ['a house on the left', [{ op: 'spawn', kind: 'house', at: { anchor: 'player', dir: 'left', dist: 12 } }]],
    ['a few rocks', [{ op: 'spawn', kind: 'rock', count: 5, arrange: 'cluster', at: { anchor: 'player', dir: 'behind', dist: 8 } }]]
  ),
  village: () => build(
    ['some pines', [{ op: 'spawn', kind: 'pine', count: 6, arrange: 'cluster', at: { anchor: 'player', dir: 'right', dist: 16 } }]],
    ['a few houses over there', [{ op: 'spawn', kind: 'house', count: 3, arrange: 'cluster', at: { anchor: 'gaze' } }]]
  ),
  road: () => build(['a road', [{ op: 'spawn', kind: 'road', at: { anchor: 'gaze' }, facing: 'player' }]]),
  lit: () => build(
    ['a road', [{ op: 'spawn', kind: 'road', at: { anchor: 'gaze' }, facing: 'player' }]],
    ['lamps along it', [{ op: 'spawn', kind: 'lamp', count: 6, arrange: 'along', at: { anchor: 'target', of: { kind: 'road' } } }]]
  ),
  oneHouse: () => build(['put a little house over there', [{ op: 'spawn', kind: 'house', at: { anchor: 'gaze' } }]]),
  clock: () => build(
    ['some trees', [{ op: 'spawn', kind: 'pine', count: 7, arrange: 'cluster', at: { anchor: 'player', dir: 'left', dist: 14 } }]],
    ['a grandfather clock here', [{ op: 'define', kind: 'grandfather_clock', tags: ['clock', 'furniture'], parts: CLOCK }, { op: 'spawn', kind: 'grandfather_clock', at: { anchor: 'gaze' } }]]
  ),
  placeholder: () => build(['a pinball machine', [{ op: 'spawn', kind: 'pinball_machine', at: { anchor: 'gaze' } }]]),
  hill: () => build(['a hill', [{ op: 'spawn', kind: 'hill', at: { anchor: 'player', dist: 55 } }]]),
  cliff: () => build(['a cliff', [{ op: 'spawn', kind: 'cliff', at: { anchor: 'player', dist: 90 } }]]),
  city: () => build(['shops', [{ op: 'spawn', kind: 'storefront', count: 6, arrange: 'line', at: { anchor: 'gaze' } }]]),
  // Loop 2 (sky): a night grove, and learned creatures and a castle to make fly, gallop and glow.
  night: () => build(
    ['make a bunch of trees', [{ op: 'spawn', kind: 'pine', count: 9, arrange: 'cluster', at: { anchor: 'gaze' }, radius: 6 }]],
    ['make it night', [{ op: 'atmosphere', time: 'night' }]]
  ),
  dragon: () => build(['a dragon', [{ op: 'define', kind: 'dragon', tags: ['dragon', 'animal', 'creature'], parts: BLOCKY }, { op: 'spawn', kind: 'dragon', at: { anchor: 'gaze' } }]]),
  horses: () => build(
    ['some trees', [{ op: 'spawn', kind: 'pine', count: 6, arrange: 'cluster', at: { anchor: 'player', dir: 'left', dist: 18 } }]],
    ['a herd of horses', [{ op: 'define', kind: 'horse', tags: ['horse', 'animal'], parts: BLOCKY }, { op: 'spawn', kind: 'horse', count: 6, arrange: 'cluster', at: { anchor: 'gaze' } }]]
  ),
  castle: () => build(
    ['some trees', [{ op: 'spawn', kind: 'pine', count: 6, arrange: 'cluster', at: { anchor: 'player', dir: 'right', dist: 18 } }]],
    ['a castle', [{ op: 'define', kind: 'castle', tags: ['castle', 'building', 'structure'], parts: BLOCKY }, { op: 'spawn', kind: 'castle', at: { anchor: 'gaze' } }]],
    ['make it night', [{ op: 'atmosphere', time: 'night' }]]
  )
} satisfies Record<string, () => WorldState>

/** Look straight at an entity (the gaze ray hit it at speech start). */
function lookAt(state: WorldState, pick: (e: Entity) => boolean): OpContext {
  const e = state.entities.find(pick)
  if (!e) throw new Error('lookAt: no such entity')
  return { ...CTX, gaze: { point: e.pos, entity: e.id, dist: distXZ(e.pos, CTX.player.pos) } }
}

// ---------- colour checks ----------

const NAMED: Record<string, string> = { red: '#ff0000', crimson: '#dc143c', blue: '#0000ff', navy: '#000080', white: '#ffffff', black: '#000000' }

function hsl(color: string | undefined): [number, number, number] | null {
  if (!color) return null
  const hex = (NAMED[color.toLowerCase()] ?? color).replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return null
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  if (d === 0) return [0, 0, l]
  const s = d / (1 - Math.abs(2 * l - 1))
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  h = (h * 60 + 360) % 360
  return [h, s, l]
}
const reddish = (c?: string) => {
  const v = hsl(c)
  return !!v && (v[0] >= 340 || v[0] <= 20) && v[1] > 0.3
}
const bluish = (c?: string) => {
  const v = hsl(c)
  return !!v && v[0] >= 190 && v[0] <= 255 && v[1] > 0.25
}
const whitish = (c?: string) => {
  const v = hsl(c)
  return !!v && v[2] > 0.8
}

// ---------- cases ----------

interface Outcome { before: WorldState, after: WorldState, ops: Op[], ctx: OpContext, notes: string[], say: string[] }
interface Case {
  name: string
  text: string
  scene: keyof typeof SCENES
  ctx?: (s: WorldState) => OpContext
  check: (o: Outcome) => true | string
}

const isTree = (e: Entity) => e.tags.includes('tree')
const added = (o: Outcome) => o.after.entities.filter(e => !o.before.entities.some(b => b.id === e.id))
const learnedAdded = (o: Outcome) => Object.values(o.after.kinds).filter(k => k.learned && !o.before.kinds[k.kind])
const has = (o: Outcome, name: string) => o.ops.some(op => op.op === name)
const expect = (ok: boolean, why: string): true | string => ok ? true : why
const kinds = (es: Entity[]) => [...new Set(es.map(e => e.kind))].join(',') || 'none'

function newThing(o: Outcome, word: RegExp): true | string {
  const k = learnedAdded(o).find(d => word.test(d.kind))
  if (!k) return `no learned kind matching ${word} (learned: ${learnedAdded(o).map(d => d.kind).join(',') || 'none'}; spawned ${kinds(added(o))})`
  if (!(k.parts && k.parts.length >= 3)) return `${k.kind} has only ${k.parts?.length ?? 0} parts`
  const n = o.after.entities.filter(e => e.kind === k.kind).length
  return expect(n >= 1, `${k.kind} defined but never spawned`)
}

const CASES: Case[] = [
  // counts
  { name: 'count: a bunch of trees', text: 'make a bunch of trees', scene: 'empty', check: o => expect(added(o).filter(isTree).length >= 6 && added(o).filter(isTree).length <= 14, `${added(o).filter(isTree).length} new trees`) },
  { name: 'count: a few rocks', text: 'a few rocks over there', scene: 'empty', check: o => expect(added(o).filter(e => e.kind === 'rock').length >= 2 && added(o).filter(e => e.kind === 'rock').length <= 5, `${added(o).filter(e => e.kind === 'rock').length} rocks`) },
  { name: 'count: lamps along the road', text: 'a row of lamps along the road', scene: 'road', check: o => expect(added(o).filter(e => e.kind === 'lamp').length >= 5 && o.ops.some(op => op.op === 'spawn' && op.arrange === 'along'), `lamps ${added(o).filter(e => e.kind === 'lamp').length}, ops ${JSON.stringify(o.ops.map(x => x.op === 'spawn' ? x.arrange : x.op))}`) },
  { name: 'count: a forest', text: 'plant a forest', scene: 'empty', check: o => expect(added(o).filter(isTree).length >= 40, `${added(o).filter(isTree).length} trees`) },
  { name: 'count: a grove of oaks', text: 'grow a little grove of oak trees', scene: 'empty', check: o => expect(added(o).filter(e => e.kind === 'oak').length >= 5, `${added(o).filter(e => e.kind === 'oak').length} oaks`) },
  { name: 'count: ring of rocks around me', text: 'put a ring of rocks around me', scene: 'empty', check: (o) => {
    const rocks = added(o).filter(e => e.kind === 'rock')
    const ds = rocks.map(e => distXZ(e.pos, o.ctx.player.pos))
    return expect(rocks.length >= 6 && Math.max(...ds) - Math.min(...ds) < 3 && Math.min(...ds) > 2, `${rocks.length} rocks, dist ${ds.map(d => d.toFixed(1)).join(' ')}`)
  } },
  { name: 'count: couple of benches to my right', text: 'a couple of benches to my right', scene: 'empty', check: (o) => {
    const b = added(o).filter(e => e.kind === 'bench')
    return expect(b.length === 2 && b.every(e => e.pos[0] > 2), `${b.length} benches at x ${b.map(e => e.pos[0].toFixed(1)).join(' ')}`)
  } },
  { name: 'count: few white houses', text: 'a few houses over there, painted white', scene: 'empty', check: (o) => {
    const h = added(o).filter(e => e.kind === 'house')
    return expect(h.length >= 2 && h.length <= 5 && h.every(e => whitish(e.props.color)), `${h.length} houses, colors ${h.map(e => e.props.color).join(' ')}`)
  } },
  { name: 'place: tower behind me', text: 'put a tower behind me', scene: 'empty', check: (o) => {
    const t = added(o).filter(e => e.kind === 'tower')
    return expect(t.length === 1 && t[0]!.pos[2] > 3, `towers ${t.length} at ${t.map(e => e.pos.join(',')).join(' ')}`)
  } },
  { name: 'place: bench next to the house', text: 'put a bench next to the house', scene: 'grove', check: (o) => {
    const b = added(o).filter(e => e.kind === 'bench')
    const house = o.after.entities.find(e => e.kind === 'house')!
    return expect(b.length === 1 && distXZ(b[0]!.pos, house.pos) < 7, `benches ${b.length}, dist ${b.map(e => distXZ(e.pos, house.pos).toFixed(1)).join(' ')}`)
  } },

  // sets
  { name: 'set: all the trees red', text: 'make all the trees red', scene: 'grove', check: (o) => {
    const trees = o.after.entities.filter(isTree)
    const house = o.after.entities.find(e => e.kind === 'house')!
    return expect(trees.length === 13 && trees.every(e => reddish(e.props.color)) && !reddish(house.props.color) && added(o).length === 0, `trees ${trees.filter(e => reddish(e.props.color)).length}/${trees.length} red, house ${house.props.color ?? 'default'}`)
  } },
  { name: 'set: paint the houses blue', text: 'paint the houses blue', scene: 'village', check: (o) => {
    const h = o.after.entities.filter(e => e.kind === 'house')
    const pines = o.after.entities.filter(e => e.kind === 'pine')
    return expect(h.length === 3 && h.every(e => bluish(e.props.color)) && pines.every(e => !bluish(e.props.color)), `houses ${h.map(e => e.props.color).join(' ')}`)
  } },
  { name: 'set: remove the rocks', text: 'remove the rocks', scene: 'grove', check: o => expect(o.after.entities.filter(e => e.kind === 'rock').length === 0 && o.after.entities.filter(isTree).length === 13, `rocks ${o.after.entities.filter(e => e.kind === 'rock').length}, trees ${o.after.entities.filter(isTree).length}`) },
  { name: 'set: trees twice as big', text: 'make the trees twice as big', scene: 'grove', check: (o) => {
    const trees = o.after.entities.filter(isTree)
    const before = new Map(o.before.entities.map(e => [e.id, (e.props.scale ?? 1) * (e.props.height ?? 1)]))
    const grew = trees.filter(e => (e.props.scale ?? 1) * (e.props.height ?? 1) >= 1.8 * before.get(e.id)!)
    return expect(grew.length === trees.length, `${grew.length}/${trees.length} doubled`)
  } },
  { name: 'set: lamps brighter', text: 'make the lamps glow brighter', scene: 'lit', check: (o) => {
    const l = o.after.entities.filter(e => e.kind === 'lamp')
    return expect(l.length === 6 && l.every(e => (e.props.glow ?? 1) > 1), `glow ${l.map(e => e.props.glow ?? 'default').join(' ')}`)
  } },
  { name: 'set: clear everything', text: 'clear everything', scene: 'grove', check: o => expect(o.after.entities.length === 0, `${o.after.entities.length} left`) },

  // unknown kinds
  { name: 'define: grandfather clock', text: 'put a grandfather clock here', scene: 'empty', check: o => newThing(o, /clock/) },
  { name: 'define: snowman', text: 'a snowman', scene: 'empty', check: o => newThing(o, /snow/) },
  { name: 'define: hot air balloon', text: 'a hot air balloon', scene: 'empty', check: o => newThing(o, /balloon/) },
  { name: 'define: fountain', text: 'build a fountain over there', scene: 'empty', check: o => newThing(o, /fountain/) },
  { name: 'define: mailbox next to house', text: 'put a red mailbox next to the house', scene: 'grove', check: (o) => {
    const r = newThing(o, /mail|post/)
    if (r !== true) return r
    const k = learnedAdded(o).find(d => /mail|post/.test(d.kind))!
    const m = o.after.entities.find(e => e.kind === k.kind)!
    const house = o.after.entities.find(e => e.kind === 'house')!
    return expect(distXZ(m.pos, house.pos) < 7, `mailbox ${distXZ(m.pos, house.pos).toFixed(1)} m from the house`)
  } },
  { name: 'define: real pinball (placeholder)', text: 'make that pinball machine look like a real one', scene: 'placeholder', check: o => expect(!!o.after.kinds.pinball_machine?.learned && o.after.entities.some(e => e.kind === 'pinball_machine'), `kinds ${Object.keys(o.after.kinds).filter(k => o.after.kinds[k]!.learned).join(',') || 'no learned'}`) },
  { name: 'reuse: five more (gaze on a pine)', text: 'make five more of those', scene: 'clock', ctx: s => lookAt(s, e => e.kind === 'pine'), check: o => expect(added(o).filter(e => e.kind === 'grandfather_clock').length === 5 && !has(o, 'define'), `+${added(o).filter(e => e.kind === 'grandfather_clock').length} clocks, spawned ${kinds(added(o))}`) },
  { name: 'reuse: five more of those', text: 'make five more of those', scene: 'clock', check: o => expect(added(o).filter(e => e.kind === 'grandfather_clock').length === 5 && !has(o, 'define'), `+${added(o).filter(e => e.kind === 'grandfather_clock').length} clocks, define ${has(o, 'define')}, spawned ${kinds(added(o))}`) },

  // references
  { name: 'ref: make it taller', text: 'make it taller', scene: 'oneHouse', check: (o) => {
    const h = o.after.entities.find(e => e.kind === 'house')!
    return expect((h.props.height ?? 1) * (h.props.scale ?? 1) > 1.2 || (h.props.floors ?? 1) > 1, `house props ${JSON.stringify(h.props)}`)
  } },
  { name: 'ref: those twice as tall', text: 'make those twice as tall', scene: 'village', check: (o) => {
    const h = o.after.entities.filter(e => e.kind === 'house')
    const p = o.after.entities.filter(e => e.kind === 'pine')
    return expect(h.every(e => (e.props.height ?? 1) * (e.props.scale ?? 1) >= 1.8) && p.every(e => (e.props.height ?? 1) < 1.5), `house heights ${h.map(e => e.props.height ?? 1).join(' ')}, pine ${p.map(e => e.props.height ?? 1).join(' ')}`)
  } },
  { name: 'ref: undo that', text: 'undo that', scene: 'grove', check: o => expect(o.after.entities.filter(e => e.kind === 'rock').length === 0 && o.after.entities.filter(isTree).length === 13, `rocks ${o.after.entities.filter(e => e.kind === 'rock').length}`) },
  { name: 'ref: get rid of that (gaze)', text: 'get rid of that', scene: 'grove', ctx: s => lookAt(s, e => e.kind === 'oak'), check: (o) => {
    const target = o.ctx.gaze.entity!
    return expect(!o.after.entities.some(e => e.id === target) && o.after.entities.length === o.before.entities.length - 1, `removed ${o.before.entities.length - o.after.entities.length}`)
  } },
  { name: 'ref: make that blue (gaze)', text: 'make that blue', scene: 'village', ctx: s => lookAt(s, e => e.kind === 'house'), check: (o) => {
    const target = o.ctx.gaze.entity!
    const blue = o.after.entities.filter(e => bluish(e.props.color)).map(e => e.id)
    return expect(blue.length === 1 && blue[0] === target, `blue ${blue.join(',') || 'none'} (gaze ${target})`)
  } },
  { name: 'ref: another floor (gaze)', text: 'add another floor to that', scene: 'village', ctx: s => lookAt(s, e => e.kind === 'house'), check: (o) => {
    const t = o.after.entities.find(e => e.id === o.ctx.gaze.entity)!
    const others = o.after.entities.filter(e => e.kind === 'house' && e.id !== t.id)
    return expect(t.props.floors === 2 && others.every(e => (e.props.floors ?? 1) === 1), `floors ${t.props.floors}, others ${others.map(e => e.props.floors ?? 1).join(' ')}`)
  } },

  // atmosphere and teleport
  { name: 'atmo: make it night', text: 'make it night', scene: 'grove', check: o => expect(o.after.atmosphere.time === 'night', `time ${o.after.atmosphere.time}`) },
  { name: 'atmo: foggy', text: 'make it foggy', scene: 'grove', check: o => expect((o.after.atmosphere.fog ?? 0) >= 0.4, `fog ${o.after.atmosphere.fog}`) },
  { name: 'teleport: pool hall', text: 'take me to a pool hall', scene: 'grove', check: o => expect(o.ops.some(op => op.op === 'teleport' && /pool/i.test(op.world)) && !has(o, 'spawn'), `ops ${o.ops.map(x => x.op).join(',')}`) },
  { name: 'teleport: tranquil', text: 'take me somewhere peaceful where I can unwind', scene: 'empty', check: o => expect(has(o, 'teleport') && !has(o, 'spawn'), `ops ${o.ops.map(x => x.op).join(',')}`) },
  // Sprint 4: the teleport carries a brief good enough for the Director to build from.
  { name: 'teleport: I want to relax', text: 'I want to relax', scene: 'grove', check: o => teleportTo(o, /./, 30) },
  { name: 'teleport: a scene, not an object', text: 'a neon city street at night', scene: 'empty', check: o => teleportTo(o, /street|city|neon/i, 30, /night/i) },
  { name: 'teleport: go to a cabin', text: 'go to a cozy cabin in the woods', scene: 'village', check: o => teleportTo(o, /cabin/i, 30) },

  // the sky, motion, weather, glow and the player's size (Loop 2)
  { name: 'sky: fill the sky with lanterns', text: 'fill the sky with floating lanterns', scene: 'night', check: (o) => {
    const l = added(o).filter(e => e.kind === 'lantern')
    const high = l.filter(e => e.pos[1] >= 10).length
    return expect(l.length >= 20 && high === l.length && l.every(e => e.props.motion === 'drift' || e.props.motion === 'hover'), `${l.length} lanterns, ${high} high, motion ${[...new Set(l.map(e => e.props.motion))].join(',')}, spawned ${kinds(added(o))}`)
  } },
  { name: 'sky: night and lanterns (voice)', text: 'now make it night, and fill the sky with lanterns', scene: 'grove', check: (o) => {
    const l = added(o).filter(e => e.kind === 'lantern')
    return expect(o.after.atmosphere.time === 'night' && l.length >= 20 && l.every(e => e.pos[1] >= 10) && !added(o).some(e => e.kind === 'lamp'), `time ${o.after.atmosphere.time}, ${l.length} lanterns, spawned ${kinds(added(o))}`)
  } },
  { name: 'sky: birds circling', text: 'a flock of birds circling overhead', scene: 'empty', check: (o) => {
    const b = added(o).filter(e => e.kind === 'bird')
    return expect(b.length >= 4 && b.every(e => e.pos[1] >= 8 && (e.props.motion === 'orbit' || e.props.motion === 'fly')), `${b.length} birds, y ${b.map(e => e.pos[1]).join(' ')}, motion ${b[0]?.props.motion}`)
  } },
  { name: 'motion: dragon flies around me', text: 'make the dragon fly around me', scene: 'dragon', check: (o) => {
    const d = o.after.entities.find(e => e.kind === 'dragon')!
    return expect((d.props.motion === 'orbit' || d.props.motion === 'fly') && d.pos[1] >= 5 && d.props.around === 'player' && added(o).length === 0, `motion ${d.props.motion}, y ${d.pos[1]}, around ${d.props.around}, added ${added(o).length}`)
  } },
  { name: 'motion: horses gallop', text: 'make the horses gallop around the field', scene: 'horses', check: (o) => {
    const h = o.after.entities.filter(e => e.kind === 'horse')
    return expect(h.length === 6 && h.every(e => e.props.motion === 'gallop' && e.pos[1] < 1 && !!e.path), `motions ${[...new Set(h.map(e => e.props.motion))].join(',')}, y ${h[0]?.pos[1]}`)
  } },
  { name: 'motion: no dragon to fly (honest)', text: 'make the dragon fly in circles', scene: 'grove', check: (o) => {
    const line = o.say.join(' ')
    const claim = line.split(/[.!?…,;]/).filter(c => !/\b(cannot|can't|not|no|alas|yet|shall)\b/i.test(c)).join(' ')
    return expect(!o.after.entities.some(e => e.props.motion) && !/\b(soar|circl|fl(y|ies|ying))/i.test(claim), `say "${line}", moving ${o.after.entities.filter(e => e.props.motion).length}`)
  } },
  { name: 'weather: let it snow', text: 'let it snow', scene: 'grove', check: o => expect(o.after.atmosphere.weather === 'snow', `weather ${o.after.atmosphere.weather}`) },
  { name: 'weather: thunderstorm', text: 'summon a thunderstorm', scene: 'grove', check: o => expect(o.after.atmosphere.weather === 'storm', `weather ${o.after.atmosphere.weather}`) },
  { name: 'weather: make it rain', text: 'make it rain', scene: 'village', check: o => expect(o.after.atmosphere.weather === 'rain' || o.after.atmosphere.weather === 'storm', `weather ${o.after.atmosphere.weather}`) },
  { name: 'weather: northern lights', text: 'show me the northern lights', scene: 'grove', check: o => expect(o.after.atmosphere.weather === 'aurora' && o.after.atmosphere.time === 'night' && !has(o, 'teleport'), `weather ${o.after.atmosphere.weather}, time ${o.after.atmosphere.time}`) },
  { name: 'weather: shooting stars', text: 'a meteor shower', scene: 'night', check: o => expect(o.ops.some(op => op.op === 'atmosphere' && op.event === 'meteors'), `ops ${opsBrief(o.ops)}`) },
  { name: 'glow: the castle glows', text: 'make the castle glow', scene: 'castle', check: (o) => {
    const c = o.after.entities.find(e => e.kind === 'castle')!
    return expect((c.props.glow ?? 0) >= 1.5, `castle props ${JSON.stringify(c.props)}`)
  } },
  { name: 'glow: trees glow gold', text: 'make the trees glow gold', scene: 'night', check: (o) => {
    const t = o.after.entities.filter(isTree)
    return expect(t.every(e => (e.props.glow ?? 0) >= 1.5), `glow ${[...new Set(t.map(e => e.props.glow ?? 'none'))].join(',')}`)
  } },
  { name: 'player: make me tiny', text: 'make me tiny', scene: 'grove', check: o => expect((o.after.atmosphere.playerScale ?? 1) <= 0.25 && o.after.entities.every(e => !e.props.scale || e.props.scale < 2), `playerScale ${o.after.atmosphere.playerScale}`) },
  { name: 'player: everything ten times bigger', text: 'make everything ten times bigger', scene: 'grove', check: (o) => {
    const scaled = o.after.entities.filter(e => (e.props.scale ?? 1) >= 3).length
    return expect((o.after.atmosphere.playerScale ?? 1) <= 0.2 && scaled === 0, `playerScale ${o.after.atmosphere.playerScale}, ${scaled} scaled up`)
  } },
  // terrain and scale (Loop 2)
  { name: 'terrain: range on the horizon', text: 'put a mountain range on the horizon', scene: 'city', check: (o) => {
    const m = added(o).filter(e => e.tags.includes('mountain'))
    return expect(m.length >= 1 && m.every(e => distXZ(e.pos, CTX.player.pos) >= 250), `mountains ${m.map(e => `${e.kind}@${Math.round(distXZ(e.pos, CTX.player.pos))}m`).join(',') || 'none'}`)
  } },
  { name: 'terrain: volcano over there', text: 'raise a volcano over there', scene: 'empty', check: o => expect(added(o).some(e => e.kind === 'volcano' && distXZ(e.pos, CTX.player.pos) >= 200), `spawned ${kinds(added(o))}`) },
  { name: 'terrain: castle on that hill', text: 'put a castle on that hill', scene: 'hill', ctx: s => lookAt(s, e => e.kind === 'hill'), check: (o) => {
    const c = added(o).find(e => /castle|fort/.test(e.kind))
    const hills = o.after.entities.filter(e => e.kind === 'hill').length
    return expect(!!c && c.pos[1] > 8 && hills === 1, `castle ${c ? `${c.kind} y=${c.pos[1]}` : 'none'}, hills ${hills}`)
  } },
  { name: 'terrain: castle on a hill that isn\'t there', text: 'put a castle on that hill', scene: 'grove', check: (o) => {
    const c = added(o).find(e => /castle|fort/.test(e.kind))
    const at = o.ops.find(op => op.op === 'spawn' && /castle|fort/.test(op.kind))
    return expect(added(o).some(e => e.kind === 'hill') && !!c && c.pos[1] > 8, `added ${kinds(added(o))}${c ? ` castle y=${c.pos[1]}` : ''} at ${JSON.stringify(at && 'at' in at ? at.at : null)}`)
  } },
  { name: 'terrain: waterfall off that cliff', text: 'a waterfall off that cliff', scene: 'cliff', ctx: s => lookAt(s, e => e.kind === 'cliff'), check: o => expect(added(o).some(e => e.kind === 'waterfall'), `added ${kinds(added(o))}`) },
  { name: 'terrain: forest around me', text: 'plant a forest all around me', scene: 'empty', check: (o) => {
    const t = added(o).filter(isTree)
    const behind = t.filter(e => e.pos[2] > 5).length
    return expect(t.length >= 30 && behind >= 8, `${t.length} trees, ${behind} behind`)
  } }
]

function teleportTo(o: Outcome, world: RegExp, minBrief: number, briefHas?: RegExp): true | string {
  const t = o.ops.find(op => op.op === 'teleport')
  if (!t || t.op !== 'teleport') return `no teleport (ops ${o.ops.map(x => x.op).join(',')})`
  if (has(o, 'spawn')) return 'spawned things instead of leaving the place to the Director'
  if (!world.test(t.world)) return `world "${t.world}"`
  const brief = t.brief ?? ''
  if (brief.length < minBrief) return `brief too thin: "${brief}"`
  return expect(!briefHas || briefHas.test(brief), `brief misses ${briefHas}: "${brief}"`)
}

// ---------- runner ----------

const argv = process.argv.slice(2)
const flag = (k: string) => {
  const i = argv.indexOf(k)
  return i >= 0 ? argv[i + 1] : undefined
}
const flagVals = new Set(['--only', '--repeat', '--conc'].flatMap(k => argv.includes(k) ? [flag(k)] : []))
const models = argv.filter(a => !a.startsWith('--') && !flagVals.has(a))
const only = flag('--only')
const repeat = Number(flag('--repeat') ?? 1)
const conc = Number(flag('--conc') ?? 4)
const cases = CASES.filter(c => !only || c.name.includes(only))

interface Row { model: string, name: string, pass: boolean, why: string, ms: number, first: number, provider?: string, cost: number, cacheRead: number, out: number, ops: Op[], dropped: number, error?: string }

async function runCase(model: string, c: Case): Promise<Row> {
  const before = SCENES[c.scene]()
  const ctx = c.ctx ? c.ctx(before) : CTX
  const res = await interpret({ text: c.text, scene: trimScene(before), ctx, model })
  const base = { model: res.model, name: c.name, ms: res.ms, first: res.firstOpMs ?? res.ms, provider: res.provider, cost: res.costUsd ?? 0, cacheRead: res.usage?.cacheRead ?? 0, out: res.usage?.output ?? 0, ops: res.ops, dropped: res.dropped.length, error: res.error }
  if (res.error) return { ...base, pass: false, why: `call failed: ${res.error}` }
  const applied = applyBatch(before, { ops: res.ops }, ctx, c.text, 0)
  let verdict: true | string
  try {
    verdict = c.check({ before, after: applied.state, ops: res.ops, ctx, notes: applied.effects.notes, say: applied.effects.say })
  } catch (err) {
    verdict = `check threw: ${(err as Error).message}`
  }
  if (verdict === true && res.dropped.length) return { ...base, pass: true, why: `: ${res.dropped.map(d => d.reason).join('; ')}` }
  const why = verdict === true ? '' : `${verdict}${applied.effects.notes.length ? ` · notes: ${applied.effects.notes.join('; ')}` : ''}${res.dropped.length ? ` · dropped: ${res.dropped.map(d => d.reason).join('; ')}` : ''}`
  return { ...base, pass: verdict === true, why }
}

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }))
  return out
}

function pct(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))] ?? 0
}

function opsBrief(ops: Op[]): string {
  return ops.filter(o => o.op !== 'say').map((o) => {
    if (o.op === 'spawn' && (o.set?.altitude !== undefined || o.set?.motion)) return `spawn ${o.kind}×${o.count ?? 1}${o.arrange ? ` ${o.arrange}` : ''} alt ${o.set?.altitude ?? 0} ${o.set?.motion ?? ''}`
    if (o.op === 'spawn') return `spawn ${o.kind}×${o.count ?? 1}${o.arrange ? ` ${o.arrange}` : ''}`
    if (o.op === 'define') return `define ${o.kind}(${o.parts.length})`
    if (o.op === 'modify') return `modify ${JSON.stringify(o.target)}→${JSON.stringify(o.set)}${o.relative ? 'rel' : ''}`
    if (o.op === 'remove') return `remove ${JSON.stringify(o.target)}`
    if (o.op === 'atmosphere') return `atmo ${o.time ?? ''}${o.fog !== undefined ? ` fog ${o.fog}` : ''}${o.weather ? ` ${o.weather}` : ''}${o.event ? ` !${o.event}` : ''}${o.playerScale !== undefined ? ` player×${o.playerScale}` : ''}`
    if (o.op === 'teleport') return `teleport "${o.world}"`
    return o.op
  }).join(' + ')
}

const started = Date.now()
console.log(`Conjure intent bench · ${new Date().toISOString().slice(0, 16)} · ${cases.length} cases × ${repeat} · models ${(models.length ? models : ['haiku', 'sonnet']).join(', ')}\n`)
const summary: string[] = []
for (const model of models.length ? models : ['haiku', 'sonnet']) {
  const jobs = Array.from({ length: repeat }, () => cases).flat()
  const rows = await pool(jobs, conc, c => runCase(model, c))
  for (const r of rows) {
    const say = r.ops.find(o => o.op === 'say')
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.model.padEnd(6)} ${String(r.first).padStart(5)}/${String(r.ms).padStart(5)}ms ${String(r.out).padStart(4)}tok  ${r.name.padEnd(36)} ${opsBrief(r.ops)}${say && say.op === 'say' ? `  “${say.text}”` : ''}`)
    if (!r.pass) console.log(`       ↳ ${r.why}`)
    else if (r.dropped) console.log(`       ↳ (passed with ${r.dropped} dropped op(s)${r.why})`)
  }
  const ms = rows.map(r => r.ms)
  const plain = rows.filter(r => !r.ops.some(o => o.op === 'define')).map(r => r.ms)
  const defs = rows.filter(r => r.ops.some(o => o.op === 'define')).map(r => r.ms)
  const first = rows.map(r => r.first)
  const firstPlain = rows.filter(r => !r.ops.some(o => o.op === 'define')).map(r => r.first)
  const firstDefs = rows.filter(r => r.ops.some(o => o.op === 'define')).map(r => r.first)
  const providers = [...new Set(rows.map(r => r.provider ?? '?'))].join('/')
  const passed = rows.filter(r => r.pass).length
  const cost = rows.reduce((s, r) => s + r.cost, 0)
  const cached = rows.filter(r => r.cacheRead > 0).length
  const line = `${model}: ${passed}/${rows.length} pass (${Math.round(100 * passed / rows.length)}%) · first op median ${pct(first, 0.5)} ms (plain ${pct(firstPlain, 0.5)}, define ${pct(firstDefs, 0.5)}) · done median ${pct(ms, 0.5)} ms, p90 ${pct(ms, 0.9)} ms · plain edits median ${pct(plain, 0.5)} ms (n=${plain.length}) · define median ${pct(defs, 0.5)} ms (n=${defs.length}) · cost $${cost.toFixed(4)} ($${(cost / rows.length).toFixed(5)}/call) · cache hits ${cached}/${rows.length} · provider ${providers}`
  summary.push(line)
  console.log(`\n${line}\n`)
}
console.log('Summary')
for (const s of summary) console.log(`  ${s}`)
console.log(`  wall ${((Date.now() - started) / 1000).toFixed(1)} s`)
