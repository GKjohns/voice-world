/**
 * People (NPC): the pure parts. Role words → the person kind with names and tags; acts as cues; persona
 * and reply parsing (JSON in text, lenient); routine slots, places and stand points; the routing rule
 * between the genie and a person; ground and steering; the state machine's priorities.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyBatch, createWorld } from '../shared/world/state.ts'
import { parseOps } from '../shared/world/ops.ts'
import { select } from '../shared/world/select.ts'
import { buildContext } from '../shared/world/context.ts'
import type { OpContext, WorldState } from '../shared/world/types.ts'
import { fallbackPersona, parsePersona, addTurn, emptyMemory, MAX_TURNS, KEEP_TURNS, addEvent } from '../shared/npc/persona.ts'
import { parseReply, spokenSoFar, speakableCut, cleanSpoken } from '../shared/npc/reply.ts'
import { currentSlot, pickBlock, resolvePlace, standPoint, slotsFor, SLOT_SECONDS } from '../shared/npc/routine.ts'
import { routeUtterance, isEcho, isWorldCommand } from '../shared/npc/routing.ts'
import type { RouteContext } from '../shared/npc/routing.ts'
import { deckAt, inWater, canStand, steer } from '../shared/npc/ground.ts'
import { chooseMode, shouldGreet, viewAngle } from '../shared/npc/behavior.ts'
import { personWord, rolePreset } from '../shared/npc/people.ts'
import { npcScene, wishEvent } from '../shared/npc/scene.ts'
import { honestSay } from '../shared/world/honesty.ts'

function ctx(over: Partial<OpContext> = {}): OpContext {
  return { gaze: { point: [0, 0, -10] }, player: { pos: [0, 1.6, 0], yaw: 0 }, seed: 42, ...over }
}
function run(state: WorldState, ops: unknown, c = ctx(), label?: string) {
  return applyBatch(state, { ops }, c, label, 0)
}

// ---------- the kernel ----------

test('people: "a fisherman" spawns the person kind with a role, a name and tags for both', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'fisherman', at: { anchor: 'gaze' } }]).state
  const p = s.entities[0]!
  assert.equal(p.kind, 'person')
  assert.equal(p.props.role, 'fisherman')
  assert.ok(p.props.name && p.props.name.length > 1)
  assert.ok(p.tags.includes('fisherman') && p.tags.includes('person') && p.tags.includes(p.props.name!.toLowerCase()))
  // "the fisherman" and the name both select them.
  assert.equal(select(s, { kind: 'fisherman' }, ctx()).length, 1)
  assert.equal(select(s, { kind: p.props.name!.toLowerCase() }, ctx()).length, 1)
})

test('people: a crowd gets unique names, a given name goes to the first, and replay names them the same', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'person', count: 12, arrange: 'scatter', radius: 8, at: { anchor: 'gaze' }, set: { role: 'villager', name: 'Edith' } }]).state
  const names = s.entities.map(e => e.props.name!)
  assert.equal(new Set(names.map(n => n.toLowerCase())).size, 12)
  assert.equal(names[0], 'Edith')
  const again = run(createWorld(), [{ op: 'spawn', kind: 'person', count: 12, arrange: 'scatter', radius: 8, at: { anchor: 'gaze' }, set: { role: 'villager', name: 'Edith' } }]).state
  assert.deepEqual(again.entities.map(e => e.props.name), names)
})

test('people: an act is a cue (actId), so "wave again" replays even though act was already wave', () => {
  let s = run(createWorld(), [{ op: 'spawn', kind: 'person', count: 3, at: { anchor: 'gaze' } }]).state
  s = run(s, [{ op: 'modify', target: { tag: 'person' }, set: { act: 'wave' } }], ctx({ seed: 7 })).state
  assert.ok(s.entities.every(e => e.props.act === 'wave' && e.props.actId === 7))
  const res = run(s, [{ op: 'modify', target: { tag: 'person' }, set: { act: 'wave' } }], ctx({ seed: 8 }))
  assert.equal(res.effects.modified.length, 3)
  assert.ok(res.state.entities.every(e => e.props.actId === 8))
})

test('people: lenient acts and roles ("dancing", "baker") never drop the op', () => {
  const { ops, dropped } = parseOps([{ op: 'modify', target: { tag: 'person' }, set: { act: 'dancing' } }, { op: 'spawn', kind: 'person', set: { role: 'Baker' } }])
  assert.equal(dropped.length, 0)
  assert.equal((ops[0] as { set: { act: string } }).set.act, 'dance')
  assert.equal((ops[1] as { set: { role: string } }).set.role, 'baker')
  assert.equal(rolePreset('baker'), 'shopkeeper')
  assert.equal(rolePreset('pirate captain'), 'villager')
  assert.deepEqual(personWord('Old Woman'), { role: 'elder' })
  assert.equal(personWord('lamp'), undefined)
})

test('people: "make the fisherman wave" with nobody here conjures a waving fisherman', () => {
  const res = run(createWorld(), [{ op: 'modify', target: { kind: 'fisherman' }, set: { act: 'wave' } }])
  const p = res.state.entities[0]!
  assert.equal(p.kind, 'person')
  assert.equal(p.props.role, 'fisherman')
  assert.equal(p.props.act, 'wave')
})

test('people: the intent context lists people by name; dance claims are honest with the dance act', () => {
  const s = run(createWorld(), [{ op: 'spawn', kind: 'person', count: 2, at: { anchor: 'gaze' }, set: { role: 'guard' } }]).state
  const block = buildContext(s, ctx())
  assert.match(block, /people \(select one by name/)
  assert.match(block, /\(guard\)/)
  const ops = [{ op: 'modify' as const, target: { tag: 'person' }, set: { act: 'dance' as const } }]
  assert.equal(honestSay('They dance!', ops, s, true), 'They dance!')
})

// ---------- persona ----------

test('persona: a good answer parses; the world\'s name wins; bad routine blocks fall back', () => {
  const seed = { id: 'person#3', role: 'fisherman', name: 'Tomas' }
  const good = parsePersona('Sure! ```json\n{"name":"Bob","age":61,"occupation":"fisherman","voice":"m","personality":"dry","speech":"slow","backstory":"x","secret":"y","routine":[{"when":"dawn","doing":"fishing","place":"the dock","activity":"fish"},{"when":"midday","doing":"eating","place":"12 pine","activity":"sit"},{"when":"night","doing":"sleeping","place":"home","activity":"sleep"},],}\n```', seed)
  assert.equal(good.generated, true)
  assert.equal(good.name, 'Tomas')
  assert.equal(good.age, 61)
  assert.deepEqual(good.routine.map(b => b.place), ['dock', 'pine', 'home'])
  const bad = parsePersona('{"age": "old", "routine": [{"when": "teatime"}]}', seed)
  assert.equal(bad.age, fallbackPersona(seed).age)
  assert.equal(bad.routine.length, fallbackPersona(seed).routine.length)
  assert.equal(parsePersona('no json here', seed).generated, false)
})

test('persona: the stand-in is seeded (same person every reload) and honours the genie\'s hint', () => {
  const a = fallbackPersona({ id: 'person#9', role: 'wizard', name: 'Ivo', persona: 'is jealous of the genie' })
  const b = fallbackPersona({ id: 'person#9', role: 'wizard', name: 'Ivo', persona: 'is jealous of the genie' })
  assert.deepEqual(a, b)
  assert.match(a.backstory, /jealous of the genie/)
  assert.ok(a.routine.length >= 5)
})

test('memory: turns roll into the summary queue past MAX_TURNS; repeated events collapse', () => {
  let m = emptyMemory()
  let folded = 0
  for (let i = 0; i < MAX_TURNS + 1; i++) {
    const r = addTurn(m, { who: i % 2 ? 'npc' : 'player', text: `line ${i}`, at: i })
    m = r.memory
    folded += r.toSummarize.length
  }
  assert.equal(m.turns.length, KEEP_TURNS)
  assert.equal(folded, MAX_TURNS + 1 - KEEP_TURNS)
  m = addEvent(addEvent(m, 'a storm', 1), 'a storm', 2)
  assert.equal(m.events.length, 1)
})

// ---------- replies ----------

test('reply: spoken line first, then the >> actions; stage directions never reach the voice', () => {
  const r = parseReply('*squints* Aye, you\'re back. Come, I\'ll show you.\n>> {"do":[{"act":"walk_to","target":"Dock"},{"act":"follow"},{"act":"give","item":"fish","count":2},{"act":"fly"}],"remember":"likes storms"}')
  assert.equal(r.say, 'Aye, you\'re back. Come, I\'ll show you.')
  assert.deepEqual(r.actions, [{ act: 'walk_to', target: 'dock' }, { act: 'follow' }, { act: 'give', item: 'fish', count: 2 }])
  assert.equal(r.remember, 'likes storms')
  // A malformed tail costs the actions, never the line.
  assert.deepEqual(parseReply('Hello there.\n>> {"do": [ {"act":'), { say: 'Hello there.', actions: [] })
  assert.equal(parseReply('Just words.').say, 'Just words.')
  assert.equal(cleanSpoken('Tomas: "Well now."'), 'Well now.')
})

test('reply: while streaming, the >> line and a lone trailing > are held back; the voice cuts at sentence ends', () => {
  assert.equal(spokenSoFar('Well now. You came back.\n>'), 'Well now. You came back.\n'.replace(/\s+/g, ' ').trimStart())
  assert.equal(spokenSoFar('Well now.\n>> {"do":[]}').trim(), 'Well now.')
  assert.equal(speakableCut('Aye.'), -1) // too short to bother the voice
  assert.equal(speakableCut('Well now, you came back. Did the'), 'Well now, you came back. '.length)
  assert.equal(speakableCut('no end yet'), -1)
})

// ---------- routine ----------

test('routine: the world\'s time walks through its slots on the shared clock; missing slots borrow the last block', () => {
  assert.deepEqual(slotsFor('day'), ['morning', 'midday', 'afternoon'])
  assert.equal(currentSlot('day', 0), 'morning')
  assert.equal(currentSlot('day', SLOT_SECONDS * 1.5), 'midday')
  assert.equal(currentSlot('night', 999), 'night')
  const routine = [{ when: 'dawn', doing: 'a', place: 'dock', activity: 'fish' }, { when: 'evening', doing: 'b', place: 'campfire', activity: 'sit' }] as const
  assert.equal(pickBlock([...routine], 'midday')?.doing, 'a')
  assert.equal(pickBlock([...routine], 'night')?.doing, 'b')
})

test('routine: places resolve by kind, count-prefixed words, tags and names; never to themselves', () => {
  const s = run(run(createWorld(), [{ op: 'spawn', kind: 'reeds', count: 3, at: { anchor: 'gaze' } }]).state, [{ op: 'spawn', kind: 'person', count: 2, at: { anchor: 'player', dir: 'left', dist: 8 } }]).state
  const [a, b] = s.entities.filter(e => e.kind === 'person')
  assert.equal(resolvePlace('3_reeds', s.entities, [0, 0], a!.id)?.kind, 'reeds')
  assert.equal(resolvePlace('plant', s.entities, [0, 0], a!.id)?.kind, 'reeds')
  assert.equal(resolvePlace(b!.props.name!, s.entities, [0, 0], a!.id)?.id, b!.id)
  assert.equal(resolvePlace(a!.props.name!, s.entities, [0, 0], a!.id), undefined)
  assert.equal(resolvePlace('wander', s.entities, [0, 0], a!.id), undefined)
})

test('routine: on a dock they stand near the far end facing out; elsewhere just outside the footprint, facing it', () => {
  const dock = { id: 'dock#1', kind: 'dock', tags: ['dock'], pos: [0, 0, 0] as [number, number, number], rotY: 0, props: { length: 10 } }
  const sp = standPoint(dock, 0, [0, 5], 0.5)
  assert.ok(sp.z < -7 && sp.z > -10 && Math.abs(sp.x) < 0.1, `${sp.x},${sp.z}`)
  assert.ok(Math.abs(Math.abs(sp.yaw) - Math.PI) < 1e-6) // facing -z, out over the water
  const house = { id: 'house#2', kind: 'house', tags: ['building'], pos: [10, 0, 0] as [number, number, number], rotY: 0, props: {} }
  const hp = standPoint(house, 3.2, [0, 0], 0.5)
  assert.ok(Math.hypot(hp.x - 10, hp.z) > 3.5 && hp.x < 10)
})

// ---------- routing ----------

const people = (over: Partial<RouteContext> = {}): RouteContext => ({
  people: [
    { id: 'person#1', name: 'Mara', dist: 4, gazed: true },
    { id: 'person#2', name: 'Tomas', dist: 20, gazed: false }
  ],
  ...over
})

test('routing: the genie by name, a person by name, world commands to the genie even mid-conversation', () => {
  assert.deepEqual(routeUtterance('Genie, make it night', people()), { to: 'genie', text: 'make it night', why: 'addressed the genie' })
  assert.equal(routeUtterance('Tomas, what are you doing over there?', people()).to, 'npc')
  assert.equal((routeUtterance('hey Tomas', people()) as { id: string }).id, 'person#2')
  assert.equal(routeUtterance('make it night', people({ talkingTo: 'person#1' })).to, 'genie')
  assert.equal(routeUtterance('give her a dog', people({ talkingTo: 'person#1' })).to, 'genie')
  assert.equal(routeUtterance('a thunderstorm', people({ talkingTo: 'person#1' })).to, 'genie')
  assert.equal(routeUtterance('Mara, make it night', people()).to, 'genie')
})

test('routing: conversation goes to whoever you face, talk to, or stand beside; hails find the nearest', () => {
  assert.equal((routeUtterance('what is your name?', people()) as { id: string }).id, 'person#1')
  assert.equal(routeUtterance('follow me', people()).to, 'npc')
  assert.equal(routeUtterance('tell me about the lake', people()).to, 'npc')
  const away = people({ people: [{ id: 'person#1', name: 'Mara', dist: 12, gazed: false }] })
  assert.equal(routeUtterance('what is your name?', away).to, 'genie')
  assert.equal(routeUtterance('hello there!', away).to, 'npc')
  assert.equal(routeUtterance('hello there!', { people: [] }).to, 'genie')
  assert.equal(routeUtterance('where are we?', people({ people: [{ id: 'p', name: 'Ada', dist: 2.5, gazed: false }] })).to, 'npc')
  assert.equal(routeUtterance('put a tree over there', people()).to, 'genie')
  assert.ok(isWorldCommand('could you make the lake into lava'))
  assert.ok(!isWorldCommand('can you show me the way'))
})

test('routing: the mic hearing a person\'s own line back is an echo', () => {
  assert.ok(isEcho('you are back did that storm rattle you', 'Ha! You\'re back. Did that storm rattle you too?'))
  assert.ok(!isEcho('what storm are you talking about', 'Ha! You\'re back. Did that storm rattle you too?'))
})

// ---------- ground, behaviour, scene ----------

test('ground: docks are decks over the lake; the lake itself is not for walking', () => {
  const ents = [
    { id: 'water#1', kind: 'water', tags: ['water'], pos: [0, 0, -30] as [number, number, number], rotY: 0, props: { length: 40, width: 40 } },
    { id: 'dock#2', kind: 'dock', tags: ['dock'], pos: [0, 0, -8] as [number, number, number], rotY: 0, props: { length: 12 } },
    { id: 'house#3', kind: 'house', tags: ['building'], pos: [10, 0, 0] as [number, number, number], rotY: 0, props: {} }
  ]
  assert.ok(inWater(ents, 0, -18))
  assert.equal(deckAt(ents, 0, -18), 0.55)
  assert.ok(canStand(ents, [], 0, -18))
  assert.ok(!canStand(ents, [], 6, -18))
  assert.ok(!canStand(ents, [[10, 0, 3]], 10, 1))
  // Walking east into the house, they swerve.
  const a = steer(ents, [[10, 0, 3]], 6, 0, Math.PI / 2, 1)
  assert.ok(a !== null && Math.abs(a - Math.PI / 2) > 0.3)
})

test('behaviour: fleeing beats talking beats acts beats reacting beats noticing beats routine', () => {
  const base = { fleeing: false, talking: false, playerDist: 20, playerLooking: false, lasting: false, reacting: false }
  assert.equal(chooseMode(base), 'routine')
  assert.equal(chooseMode({ ...base, playerDist: 3, playerLooking: true }), 'notice')
  assert.equal(chooseMode({ ...base, playerDist: 3, playerLooking: true, reacting: true }), 'react')
  assert.equal(chooseMode({ ...base, reacting: true, lasting: true }), 'act')
  assert.equal(chooseMode({ ...base, lasting: true, talking: true, playerDist: 5 }), 'talk')
  assert.equal(chooseMode({ ...base, talking: true, playerDist: 12 }), 'routine') // you walked away
  assert.equal(chooseMode({ ...base, talking: true, fleeing: true, playerDist: 2 }), 'flee')
  assert.equal(chooseMode({ ...base, talking: true, playerDist: 2, lasting: true, commanded: true }), 'act') // the genie said dance
  assert.ok(shouldGreet(1, 200, 100))
  assert.ok(!shouldGreet(0.3, 200, 100))
  assert.ok(!shouldGreet(1, 30, 100))
  assert.ok(viewAngle([0, 1.6, 0], 0, 0, [0, 1.6, -5]) < 0.01)
  assert.ok(viewAngle([0, 1.6, 0], 0, 0, [5, 1.6, 0]) > 1.5)
})

test('scene: a person\'s view lists what\'s near, the sky, other people and the stranger; wishes become memories', () => {
  const s = run(run(createWorld(), [{ op: 'spawn', kind: 'dock', at: { anchor: 'gaze' } }, { op: 'spawn', kind: 'dragon', at: { anchor: 'gaze' }, set: { altitude: 20 } }]).state, [{ op: 'spawn', kind: 'person', count: 2, at: { anchor: 'gaze' } }]).state
  const me = s.entities.find(e => e.kind === 'person')!
  const text = npcScene(s, { self: { id: me.id, pos: me.pos }, player: [0, 1.6, 0], slot: 'evening' })
  assert.match(text, /near you: .*dock/)
  assert.match(text, /in the sky: dragon/)
  assert.match(text, /other people: /)
  assert.match(text, /the stranger: \d+ m away/)
  assert.equal(wishEvent('a dragon', { dragon: 1 }, 0, 0, []), 'the stranger said "a dragon" and a dragon appeared out of nowhere')
  assert.equal(wishEvent('nothing', {}, 0, 0, []), null)
})

test('routing: someone following you stays in the conversation a little way behind', () => {
  const ctx: RouteContext = { people: [{ id: 'p1', name: 'Sabine', dist: 11, gazed: false, following: true }], talkingTo: 'p1' }
  assert.equal(routeUtterance('thanks, you can go back to fishing now', ctx).to, 'npc')
  assert.equal(routeUtterance('where are we going?', { people: ctx.people }).to, 'npc')
  assert.equal(routeUtterance('where are we going?', { people: [{ ...ctx.people[0]!, following: false }] }).to, 'genie')
})

test('routine: the lake\'s stand point is on its shore nearest them, never in the water', () => {
  const water = { id: 'water#1', kind: 'water', tags: ['water'], pos: [0, 0, -34] as [number, number, number], rotY: 0, props: { length: 44, width: 36 } }
  for (const from of [[0, -17.5], [-1, -20], [30, -34], [5, 0]] as [number, number][]) {
    const sp = standPoint(water, 0, from, 0.9)
    assert.ok(!inWater([water], sp.x, sp.z), `${from} → ${sp.x.toFixed(1)},${sp.z.toFixed(1)}`)
    assert.ok((sp.x / 22) ** 2 + ((sp.z + 34) / 18) ** 2 < 1.4, `${from} → too far: ${sp.x.toFixed(1)},${sp.z.toFixed(1)}`)
  }
})
