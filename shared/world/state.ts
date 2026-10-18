/**
 * The world kernel: a plain WorldState and a pure `applyOp`. The op log is the world; replaying it
 * rebuilds the same entities (positions are seeded from the stored context), which is how undo,
 * save and load all work. No three.js here, so tests and the server context builder can use it.
 */
import { KIT, isKitKind, learnedKind } from './kinds.ts'
import type { KindDescriptor } from './kinds.ts'
import { altitudeY, capAltitude, deOverlap, hashSeed, layout, resolveAnchor, rng } from './layout.ts'
import { honestSay } from './honesty.ts'
import type { Placed } from './layout.ts'
import { parseOps } from './ops.ts'
import type { DroppedOp, Op, Part, Placement, Props, Selector, SkyEvent, Vec3 } from './ops.ts'
import { entityHeight, entityRadius, kindOf, select } from './select.ts'
import type { Batch, Effects, Entity, KindUpgrade, OpContext, WorldState } from './types.ts'
import { QUALITY_RANK, cleanParts, hashParts } from './forge.ts'
import { genderOfWords, personName, personTags, personWord } from '../npc/people.ts'

export const WORLD_VERSION = 1

export function createWorld(): WorldState {
  return {
    entities: [],
    kinds: { ...KIT },
    atmosphere: { time: 'dusk' },
    place: 'void',
    log: [],
    nextId: 1,
    nextGroup: 1,
    lastGroup: null
  }
}

export function emptyEffects(): Effects {
  return { spawned: [], modified: [], removed: [], redefined: [], atmosphere: false, say: [], notes: [], events: [], facts: [] }
}

interface StepResult {
  state: WorldState
  say?: string
  notes: string[]
  teleport?: Effects['teleport']
  facts?: string[]
  event?: { kind: SkyEvent, at?: Vec3 }
}

/**
 * Apply one strict op. Pure: returns a new state plus the effects the renderer should animate.
 * Spawns join the in-progress batch (`g<nextGroup>`); `applyBatch` is what commits a batch to the log.
 */
export function applyOp(state: WorldState, op: Op, ctx: OpContext): { state: WorldState, effects: Effects } {
  const res = step(state, op, ctx)
  const effects = diffStates(state, res.state)
  if (res.say) effects.say.push(res.say)
  effects.notes.push(...res.notes)
  if (res.teleport) effects.teleport = res.teleport
  if (res.facts) effects.facts!.push(...res.facts)
  if (res.event) effects.events!.push(res.event)
  return { state: res.state, effects }
}

function step(state: WorldState, op0: Op, ctx: OpContext): StepResult {
  const op = asPerson(op0)
  const group = `g${state.nextGroup}`
  const rand = rng(hashSeed(ctx.seed, group, state.nextId, op.op))

  switch (op.op) {
    case 'spawn': {
      // "A castle on that hill" with no hill in the world: raise the hill at the gaze first, then build on it.
      const of = op.at?.anchor === 'target' && op.at.side === 'on_top' ? op.at.of : undefined
      const landform = of?.kind ?? of?.tag
      if (landform && landform !== op.kind && KIT[landform]?.surface && !select(state, of!, ctx).length) {
        const base = step(state, { op: 'spawn', kind: landform, at: { anchor: 'gaze' } } as Op, ctx)
        const top = step(base.state, op, ctx)
        return { ...top, notes: [`no ${landform} here: raised one first`, ...base.notes, ...top.notes], facts: [...(base.facts ?? []), ...(top.facts ?? [])] }
      }
      const notes: string[] = []
      const desc = kindOf(state, op.kind)
      if (!state.kinds[op.kind]) notes.push(`unknown kind "${op.kind}": holding its spot with a placeholder until it's defined`)
      const out = layout(state, { desc, count: op.count ?? 1, arrange: op.arrange, at: op.at, radius: op.radius, vary: op.vary, facing: op.facing, xz: op.xz, yaw: op.yaw, props: op.set }, ctx, rand)
      notes.push(...out.notes)
      let nextId = state.nextId
      const spawned: Entity[] = withPaths(out.placed.map((p) => {
        const props: Props = { ...op.set }
        const scale = round3(p.scale * (op.set?.scale ?? 1))
        if (scale !== 1) props.scale = scale
        else delete props.scale
        if (props.motion === 'none') delete props.motion
        const e: Entity = { id: `${op.kind}#${nextId++}`, kind: op.kind, tags: [...desc.tags], pos: p.pos, rotY: round3(p.rotY), props, group }
        if (p.hue) e.hue = p.hue
        return e
      }), ctx)
      if (op.kind === 'person') namePeople(state, spawned, op.set?.name, ctx.seed)
      return { state: { ...state, entities: [...state.entities, ...spawned], nextId, lastGroup: group }, notes, facts: skyFacts(spawned, op.set) }
    }

    case 'define': {
      if (isKitKind(op.kind)) return { state, notes: [`"${op.kind}" is a kit kind; define ignored`] }
      // A forged upgrade of exactly this draft (same parts hash) builds instead of the draft: undo, replay
      // and reload all keep the high-quality version, and a NEW define of the kind (different parts) drops it.
      const basis = hashParts(op.parts)
      const up = state.upgrades?.[op.kind]
      const desc = up && up.basis === basis
        ? { ...learnedKind(op.kind, op.tags, up.parts), basis, quality: up.quality }
        : { ...learnedKind(op.kind, op.tags, op.parts), basis, quality: 'draft' as const }
      // Placeholders already standing in for this kind pick up its tags (and the renderer morphs them).
      const entities = state.entities.map(e => e.kind === op.kind ? { ...e, tags: [...desc.tags] } : e)
      return { state: { ...state, kinds: { ...state.kinds, [op.kind]: desc }, entities }, notes: [] }
    }

    case 'modify': {
      const targets = select(state, op.target, ctx)
      if (!targets.length) {
        // A genie grants: "make the dragon fly around me" with no dragon conjures one, already flying.
        const spawn = conjure(state, op.target, conjureSet(op.set, op.relative ?? false))
        if (!spawn) return { state, notes: [`modify: nothing matches ${JSON.stringify(op.target)}`] }
        const res = step(state, spawn, ctx)
        return { ...res, notes: [`no ${spawn.kind} here: conjured ${spawn.count === 1 ? 'one' : spawn.count}`, ...res.notes] }
      }
      const ids = new Set(targets.map(t => t.id))
      const { altitude, ...rest } = op.set
      const rel = op.relative ?? false
      const changed0 = state.entities.filter(e => ids.has(e.id)).map((e) => {
        const props = Object.keys(rest).length ? mergeProps(e.props, rest, rel, kindOf(state, e.kind)) : { ...e.props }
        let pos = e.pos
        if (altitude !== undefined) {
          // "Higher" multiplies the height it floats at; a number or 'sky' sets it.
          const y0 = rel && typeof altitude === 'number' ? Math.min(150, e.pos[1] * altitude) : altitudeY(altitude, rand, targets.length)
          const y = capAltitude(state, e.pos[0], e.pos[2], y0, entityHeight(state, e), rand)
          pos = [e.pos[0], round3(y), e.pos[2]]
          props.altitude = altitude === 'sky' ? 'sky' : round3(y)
          if (y <= 0) delete props.altitude
        }
        if (props.motion === 'none') delete props.motion
        const next: Entity = { ...e, props, pos }
        if (!props.motion) delete next.path
        if (e.kind === 'person') {
          // Every act is a fresh cue ("wave again" replays even when act was already wave); a new name or role re-tags.
          if (op.set.act) props.actId = ctx.seed
          if (op.set.name || op.set.role) next.tags = personTags(kindOf(state, 'person').tags, props.role, props.name)
        }
        return next
      })
      // A new motion (or a new circle) resolves its path for the whole set at once, so a herd shares one loop.
      const changed = op.set.motion || op.set.around || op.set.range ? withPaths(changed0, ctx) : changed0
      const byId = new Map(changed.map(e => [e.id, e]))
      const entities = state.entities.map(e => byId.get(e.id) ?? e)
      return { state: { ...state, entities }, notes: [], facts: skyFacts(changed, op.set) }
    }

    case 'move': {
      const targets = select(state, op.target, ctx)
      if (!targets.length) {
        // "Move the boat over there" with no boat: conjure one where it was meant to go.
        const spawn = conjure(state, op.target, undefined, op.at)
        if (!spawn) return { state, notes: [`move: nothing matches ${JSON.stringify(op.target)}`] }
        const res = step(state, spawn, ctx)
        return { ...res, notes: [`no ${spawn.kind} here: conjured ${spawn.count === 1 ? 'one' : spawn.count}`, ...res.notes] }
      }
      const ids = new Set(targets.map(t => t.id))
      const maxR = Math.max(...targets.map(t => entityRadius(state, t)))
      const anchor = resolveAnchor({ ...state, entities: state.entities.filter(e => !ids.has(e.id)) }, op.at, ctx, maxR)
      const cx = targets.reduce((s, t) => s + t.pos[0], 0) / targets.length
      const cz = targets.reduce((s, t) => s + t.pos[2], 0) / targets.length
      // Keep the group's shape: translate it so its centroid lands on the anchor, then nudge out of others.
      const placed: Placed[] = targets.map(t => ({ pos: [t.pos[0] - cx + anchor.center[0], anchor.center[1], t.pos[2] - cz + anchor.center[2]], rotY: t.rotY, scale: 1, hue: 0 }))
      const moved = new Map<string, Placed>()
      targets.forEach((t, i) => {
        const p = placed[i]!
        if (!anchor.onTop) deOverlap(state, [p], entityRadius(state, t), ctx, ids, rand)
        moved.set(t.id, p)
      })
      const entities = state.entities.map((e) => {
        const p = moved.get(e.id)
        return p ? { ...e, pos: [round3(p.pos[0]), round3(p.pos[1]), round3(p.pos[2])] as Entity['pos'] } : e
      })
      return { state: { ...state, entities }, notes: anchor.note ? [anchor.note] : [] }
    }

    case 'remove': {
      const targets = select(state, op.target, ctx)
      if (!targets.length) return { state, notes: [`remove: nothing matches ${JSON.stringify(op.target)}`] }
      const ids = new Set(targets.map(t => t.id))
      return { state: { ...state, entities: state.entities.filter(e => !ids.has(e.id)) }, notes: [] }
    }

    case 'undo': {
      if (!state.log.length) return { state, notes: ['nothing to undo'] }
      const undone = state.log[state.log.length - 1]!
      return { state: replayLog(state.log.slice(0, -1), state.upgrades), notes: [`undid ${undone.id}${undone.label ? ` (“${undone.label}”)` : ''}`] }
    }

    case 'atmosphere': {
      const a = state.atmosphere
      const weather = op.weather === undefined ? a.weather : op.weather === 'clear' ? undefined : op.weather
      // Fog as weather thickens the air; "clear skies" thins whatever fog the weather brought.
      const fog = op.fog ?? (op.weather === 'fog' ? 0.75 : op.weather === 'clear' && a.weather === 'fog' ? 0 : a.fog)
      const playerScale = op.playerScale === undefined ? a.playerScale : op.playerScale
      const facts: string[] = []
      if (op.weather) facts.push(`weather → ${op.weather}`)
      if (op.event) facts.push(`sky event: ${op.event}`)
      if (op.playerScale !== undefined) facts.push(op.playerScale === 1 ? 'player back to normal size' : `player scale → ${op.playerScale} (the world looms ${round3(1 / op.playerScale)}× larger)`)
      // A sunrise sweep ends in day; lightning strikes where you look (when that's close enough to see).
      const time = op.event === 'sunrise' && !op.time ? 'day' : op.time ?? a.time
      const event = op.event ? { kind: op.event, ...(op.event === 'lightning' && (ctx.gaze.dist ?? 99) < 90 ? { at: ctx.gaze.point } : {}) } : undefined
      return { state: { ...state, atmosphere: stripAtmos({ time, fog, ambient: op.ambient ?? a.ambient, weather, playerScale }) }, notes: [], facts, event }
    }

    case 'teleport':
      // Clears the stage (and the old place's sound); the Director streams the new place into this same
      // batch afterwards (extendLastBatch), so the log replays the built scene without calling a model.
      // A new place starts dry and at your own size (the Director sets its own weather).
      return { state: { ...state, entities: [], place: op.world, lastGroup: null, atmosphere: stripAtmos({ ...state.atmosphere, ambient: undefined, weather: undefined, playerScale: undefined }) }, notes: [], teleport: { world: op.world, brief: op.brief } }

    case 'say':
      return { state, say: op.text, notes: [] }
  }
}

/**
 * A modify or move whose selector names a concrete kind that isn't in the world becomes a spawn of that
 * kind (the genie conjures what you asked about instead of refusing). Only a named kind the world knows
 * (kit or learned) qualifies; refs (it, those, everything) and loose tags never conjure.
 */
function conjure(state: WorldState, sel: Selector, set?: Props, at?: Placement): Extract<Op, { op: 'spawn' }> | undefined {
  if (sel.ref) return undefined
  const word = (sel.kind ?? sel.tag ?? '').toLowerCase().trim()
  if (!word) return undefined
  // "Make the fisherman wave" with nobody here: a fisherman walks into being, already waving.
  const pw = personWord(word)
  if (pw && !state.entities.some(e => e.kind === 'person' && (!pw.role || e.tags.includes(pw.role)))) {
    const many = /s$|crowd|people|folk|children|men$/.test(word)
    return { op: 'spawn', kind: 'person', count: many ? 4 : 1, ...(many ? { arrange: 'cluster' as const, radius: 5 } : {}), at: at ?? { anchor: 'gaze' }, facing: 'player', set: { ...set, ...(pw.role ? { role: pw.role } : {}) } } as Extract<Op, { op: 'spawn' }>
  }
  const kind = [word, word.replace(/ies$/, 'y'), word.replace(/es$/, ''), word.replace(/s$/, '')].find(w => state.kinds[w] && !state.kinds[w]!.tags.includes('placeholder'))
  if (!kind) return undefined
  // Only when the world truly has none: a "lamp" selector over hanging lamps, or "those houses" with the
  // gaze elsewhere, is a missed match, not a missing subject.
  const forms = new Set([word, kind, word.replace(/es$/, ''), word.replace(/s$/, '')])
  if (state.entities.some(e => forms.has(e.kind) || e.tags.some(t => forms.has(t)))) return undefined
  const desc = state.kinds[kind]!
  const many = kind !== word && !desc.sized
  const count = Math.min(sel.limit ?? (many ? 6 : 1), 12)
  const props: Props = { ...set }
  // Something told to fly or circle that would otherwise stand on the ground takes to the air.
  if ((props.motion === 'orbit' || props.motion === 'fly') && props.altitude === undefined && desc.baseHeight < 30) props.altitude = 18
  const colossal = desc.tags.includes('terrain') && desc.baseHeight >= 100
  return {
    op: 'spawn',
    kind,
    count,
    ...(count > 1 ? { arrange: 'cluster' as const, radius: 8, vary: 0.3 } : {}),
    at: at ?? (colossal ? { anchor: 'horizon' } : { anchor: 'gaze' }),
    facing: 'player',
    ...(Object.keys(props).length ? { set: props } : {})
  } as Extract<Op, { op: 'spawn' }>
}

/** "a fisherman", "some villagers", "a crowd" → the person kind with that role (and the name, if a person's word was a name). */
function asPerson(op: Op): Op {
  if (op.op !== 'spawn' || op.kind === 'person') return op
  const pw = personWord(op.kind)
  if (!pw) return op
  const set: Props = { ...op.set }
  if (pw.role && !set.role) set.role = pw.role
  const g = genderOfWords(op.kind)
  if (g && !set.gender) set.gender = g
  return { ...op, kind: 'person', set }
}

/** Names at birth (seeded, unique in the world); the role and name become tags; an act at birth is a cue. */
function namePeople(state: WorldState, spawned: Entity[], asked: string | undefined, seed: number): void {
  const taken = new Set(state.entities.filter(e => e.kind === 'person' && e.props.name).map(e => e.props.name!.toLowerCase()))
  spawned.forEach((e, i) => {
    const name = i === 0 && asked && !taken.has(asked.toLowerCase()) ? asked : personName(e.id, seed, taken, e.props.gender)
    taken.add(name.toLowerCase())
    e.props = { ...e.props, name }
    if (e.props.act) e.props.actId = seed
    e.tags = personTags(e.tags, e.props.role, name)
  })
}

/** A modify's props as a newborn's: absolute values carry over; relative ones only as a scale. */
function conjureSet(set: Props, relative: boolean): Props {
  if (!relative) return { ...set }
  const out: Props = {}
  for (const [k, v] of Object.entries(set) as [keyof Props, Props[keyof Props]][]) {
    if (typeof v !== 'number') (out as Record<string, unknown>)[k] = v
    else if (k === 'scale' || k === 'height') out.scale = Math.max(out.scale ?? 1, v)
  }
  return out
}

const TIME_WORDS = /\b(night|nighttime|midnight|dark|darkness|evening|dusk|twilight|sunset|golden|dawn|morning|sunrise|noon|midday|day|daytime|daylight|bright|afternoon|indoors)\b/i

/**
 * Weather keeps the time of day (Loop 3, #4): a weather wish that doesn't name a time never changes it
 * ("a thunderstorm" at night stays night). Aurora and meteors may still bring the night they need. Only
 * for the player's own sentences (a teleport's Director sets its own light with its weather).
 */
function keepTime(ops: Op[], label: string | undefined): Op[] {
  if (label === undefined || TIME_WORDS.test(label) || ops.some(o => o.op === 'teleport')) return ops
  return ops.map((o) => {
    if (o.op !== 'atmosphere' || !o.time || !o.weather || o.weather === 'aurora') return o
    const { time: _time, ...rest } = o
    return rest as Op
  })
}

function stripAtmos(a: WorldState['atmosphere']): WorldState['atmosphere'] {
  const out: WorldState['atmosphere'] = { time: a.time }
  if (a.fog !== undefined) out.fog = a.fog
  if (a.ambient !== undefined && a.ambient !== 'none') out.ambient = a.ambient
  if (a.weather !== undefined) out.weather = a.weather
  if (a.playerScale !== undefined && Math.abs(a.playerScale - 1) > 1e-3) out.playerScale = a.playerScale
  return out
}

const PATHED = new Set(['orbit', 'gallop', 'fly'])
const MIN_R: Record<string, number> = { orbit: 8, gallop: 10, fly: 12 }

/**
 * Resolve the circle each orbit / gallop / flight follows. Around the player or the gaze: that point, at the
 * thing's own distance (never tighter than a natural minimum). Around 'self': the loop sits just beyond the
 * group (away from the player), so every member starts ON it and the herd runs one shared circle in a band.
 */
function withPaths(list: Entity[], ctx: OpContext): Entity[] {
  const moving = list.filter(e => e.props.motion && PATHED.has(e.props.motion))
  if (!moving.length) return list
  const motion = moving[0]!.props.motion!
  const around = moving[0]!.props.around ?? 'self'
  const range = moving[0]!.props.range
  let c: [number, number]
  if (around === 'player') c = [ctx.player.pos[0], ctx.player.pos[2]]
  else if (around === 'gaze') c = [ctx.gaze.point[0], ctx.gaze.point[2]]
  else {
    const cx = moving.reduce((s, e) => s + e.pos[0], 0) / moving.length
    const cz = moving.reduce((s, e) => s + e.pos[2], 0) / moving.length
    const R = range ?? MIN_R[motion]! * 1.25
    const dx = cx - ctx.player.pos[0]
    const dz = cz - ctx.player.pos[2]
    const d = Math.hypot(dx, dz)
    const away: [number, number] = d > 0.5 ? [dx / d, dz / d] : [-Math.sin(ctx.player.yaw), -Math.cos(ctx.player.yaw)]
    c = [cx + away[0] * R, cz + away[1] * R]
  }
  const ids = new Set(moving.map(e => e.id))
  return list.map((e) => {
    if (!ids.has(e.id)) return e
    const own = Math.hypot(e.pos[0] - c[0], e.pos[2] - c[1])
    const r = around === 'self' ? Math.max(3, own) : Math.max(range ?? MIN_R[motion]!, own)
    return { ...e, path: { c: [round3(c[0]), round3(c[1])] as [number, number], r: round3(r) } }
  })
}

/** What the batch did to the sky and to motion, in words the genie can repeat ("40 lantern in the sky 15–45 m up, drifting"). */
function skyFacts(list: Entity[], set: Props | undefined): string[] | undefined {
  if (!set || !list.length) return undefined
  const bits: string[] = []
  if (set.altitude !== undefined) {
    const ys = list.map(e => e.pos[1])
    const lo = Math.round(Math.min(...ys))
    const hi = Math.round(Math.max(...ys))
    bits.push(lo > 0 || hi > 0 ? `in the sky ${lo === hi ? lo : `${lo}–${hi}`} m up` : 'back on the ground')
  }
  if (set.motion) bits.push(set.motion === 'none' ? 'now still' : `${set.motion}${set.around === 'player' ? ' around the player' : ''}`)
  if (set.glow !== undefined) bits.push(set.glow > 0 ? 'glowing' : 'not glowing')
  if (set.light !== undefined) bits.push(set.light > 0 ? 'casting light' : 'no longer casting light')
  if (!bits.length) return undefined
  const kinds = [...new Set(list.map(e => e.kind))].join('/')
  return [`${list.length} ${kinds}: ${bits.join(', ')}`]
}

function mergeProps(props: Props, set: Props, relative: boolean, desc: KindDescriptor): Props {
  const out: Props = { ...props }
  for (const [key, value] of Object.entries(set) as [keyof Props, Props[keyof Props]][]) {
    if (value === undefined) continue
    if (relative && typeof value === 'number') {
      const base = (props[key] ?? desc.defaults[key] ?? 1) as number
      ;(out as Record<string, unknown>)[key] = round3(base * value)
    } else {
      ;(out as Record<string, unknown>)[key] = value
    }
  }
  if (out.floors !== undefined) out.floors = Math.min(40, Math.max(1, Math.round(out.floors)))
  if (out.height !== undefined) out.height = Math.min(20, Math.max(0.05, out.height))
  if (out.scale !== undefined) out.scale = Math.min(20, Math.max(0.05, out.scale))
  return out
}

export interface BatchResult {
  state: WorldState
  effects: Effects
  ops: Op[]
  dropped: DroppedOp[]
  batch?: Batch
}

/**
 * One sentence = one batch. Parses strictly (dropping bad ops), applies undos first (an "undo that"
 * sentence means the previous batch), then the rest, and commits the batch to the log if it changed
 * the world. Effects are a diff of before/after, so they're right however the ops interact.
 */
export function applyBatch(state: WorldState, raw: unknown, ctx: OpContext, label?: string, at = Date.now()): BatchResult {
  const { ops, dropped } = parseOps(raw)
  return commitOps(state, genderFromLabel(keepTime(ops, label), label), dropped, ctx, label, at)
}

/**
 * "two guys playing pool", "an old woman on the bench": the sentence's gender goes onto its person spawns
 * (unless the op already says), so they're named, dressed and voiced to match. Stored in the logged ops,
 * so replay agrees. Only when the sentence says one gender.
 */
function genderFromLabel(ops: Op[], label: string | undefined): Op[] {
  const g = label ? genderOfWords(label) : undefined
  if (!g) return ops
  return ops.map((o) => {
    if (o.op !== 'spawn' || o.set?.gender || (o.kind !== 'person' && !personWord(o.kind))) return o
    return { ...o, set: { ...o.set, gender: g } }
  })
}

function commitOps(state: WorldState, ops: Op[], dropped: DroppedOp[], ctx: OpContext, label: string | undefined, at: number): BatchResult {
  const extras = emptyEffects()
  const run = (s: WorldState, list: Op[]) => {
    for (const op of list) {
      const res = step(s, op, ctx)
      s = res.state
      if (res.say) extras.say.push(res.say)
      extras.notes.push(...res.notes)
      if (res.teleport) extras.teleport = res.teleport
      if (res.facts) extras.facts!.push(...res.facts)
      if (res.event) extras.events!.push(res.event)
    }
    return s
  }
  const afterUndo = run(state, ops.filter(o => o.op === 'undo'))
  const worldOps = ops.filter(o => o.op !== 'undo' && o.op !== 'say')
  let s = run(afterUndo, ops.filter(o => o.op !== 'undo'))

  // Only batches that changed something are logged, so "undo" always undoes something you can see.
  const own = diffStates(afterUndo, s)
  const changed = own.spawned.length || own.modified.length || own.removed.length || own.redefined.length || own.atmosphere || extras.teleport
  let batch: Batch | undefined
  if (worldOps.length && changed) {
    batch = { id: `g${s.nextGroup}`, label, ops: worldOps, dropped, ctx, at }
    s = { ...s, log: [...s.log, batch], nextGroup: s.nextGroup + 1 }
  }
  // The genie only claims what this batch actually did.
  const say = extras.say.map(t => honestSay(t, worldOps, s, !!changed || !!extras.events!.length))
  const effects: Effects = { ...diffStates(state, s), say, notes: extras.notes, teleport: extras.teleport, events: extras.events, facts: extras.facts }
  return { state: s, effects, ops, dropped, batch }
}

/**
 * Stream more ops into the LAST batch (the Director filling a teleport). They run with that batch's
 * context and group, exactly as `replayLog` will run them, so the live build and a reload match. Undo,
 * teleport and say never join (say comes back in effects). No-op if the log is empty.
 */
export function extendLastBatch(state: WorldState, raw: unknown): BatchResult {
  const { ops, dropped } = parseOps(raw)
  const b = state.log[state.log.length - 1]
  if (!b) return { state, effects: { ...emptyEffects(), notes: ['nothing to extend'] }, ops: [], dropped }
  const extras = emptyEffects()
  const keep = b.ops.some(o => o.op === 'teleport') ? ops.filter(o => o.op !== 'undo' && o.op !== 'teleport' && o.op !== 'say') : keepTime(ops.filter(o => o.op !== 'undo' && o.op !== 'teleport' && o.op !== 'say'), b.label?.replace(/ \(cont\.\)$/, ''))
  // Step with the batch's own group number (nextGroup was bumped when it was committed).
  let s: WorldState = { ...state, nextGroup: state.nextGroup - 1 }
  for (const op of keep) {
    const res = step(s, op, b.ctx)
    s = res.state
    extras.notes.push(...res.notes)
    if (res.facts) extras.facts!.push(...res.facts)
    if (res.event) extras.events!.push(res.event)
  }
  const batch: Batch = { ...b, ops: [...b.ops, ...keep], dropped: [...b.dropped, ...dropped] }
  s = { ...s, nextGroup: state.nextGroup, log: [...state.log.slice(0, -1), batch] }
  // A say streamed in after the sentence's ops is checked against everything the batch did.
  for (const o of ops) if (o.op === 'say') extras.say.push(honestSay(o.text, batch.ops, s, true))
  return { state: s, effects: { ...diffStates(state, s), say: extras.say, notes: extras.notes, events: extras.events, facts: extras.facts }, ops: keep, dropped, batch }
}

/** Rebuild a world from its op log (and its forged upgrades). Ops in a log are already strict, so they're applied as-is. */
export function replayLog(log: Batch[], upgrades?: WorldState['upgrades']): WorldState {
  let s = createWorld()
  if (upgrades && Object.keys(upgrades).length) s = { ...s, upgrades }
  for (const b of log) {
    for (const op of b.ops) s = step(s, op, b.ctx).state
    s = { ...s, log: [...s.log, { ...b, id: `g${s.nextGroup}` }], nextGroup: s.nextGroup + 1 }
  }
  return s
}

/** What changed between two states, as renderer instructions. A reused id with a new kind or batch is a respawn. */
export function diffStates(a: WorldState, b: WorldState): Effects {
  const fx = emptyEffects()
  const before = new Map(a.entities.map(e => [e.id, e]))
  const after = new Set<string>()
  for (const e of b.entities) {
    after.add(e.id)
    const old = before.get(e.id)
    if (!old) fx.spawned.push(e.id)
    else if (old.kind !== e.kind || old.group !== e.group) {
      fx.removed.push(e.id)
      fx.spawned.push(e.id)
    } else if (old !== e && entityKey(old) !== entityKey(e)) fx.modified.push(e.id)
  }
  for (const e of a.entities) if (!after.has(e.id)) fx.removed.push(e.id)
  for (const [kind, desc] of Object.entries(b.kinds)) {
    const prev = a.kinds[kind]
    if (desc.learned && prev !== desc && JSON.stringify(prev?.parts) !== JSON.stringify(desc.parts)) fx.redefined.push(kind)
  }
  const aa = a.atmosphere
  const ba = b.atmosphere
  fx.atmosphere = aa.time !== ba.time || aa.fog !== ba.fog || aa.ambient !== ba.ambient || aa.weather !== ba.weather || aa.playerScale !== ba.playerScale
  return fx
}

function entityKey(e: Entity): string {
  return JSON.stringify([e.pos, e.rotY, e.props, e.tags, e.hue, e.path])
}

// ---------- summaries (the model's view of the world, and the HUD's) ----------

export interface KindSummary {
  kind: string
  count: number
  tags: string[]
  learned: boolean
  placeholder: boolean
}

/** The world by kind, most common first: `pine ×16 [tree]`. The model sees this, never the id list. */
export function summarizeKinds(state: WorldState): KindSummary[] {
  const counts = new Map<string, number>()
  for (const e of state.entities) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1)
  return [...counts.entries()]
    .map(([kind, count]) => {
      const desc = state.kinds[kind]
      return { kind, count, tags: (desc?.tags ?? ['placeholder']).filter(t => t !== kind), learned: !!desc?.learned, placeholder: !desc }
    })
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind))
}

// ---------- save / load ----------

export interface SavedWorld {
  version: number
  log: Batch[]
  upgrades?: Record<string, KindUpgrade>
}

export function exportWorld(state: WorldState): SavedWorld {
  // Only upgrades of kinds the world still knows are worth keeping (an undone define's upgrade is dead weight).
  const ups = Object.entries(state.upgrades ?? {}).filter(([k, u]) => state.kinds[k]?.basis === u.basis)
  return { version: WORLD_VERSION, log: state.log, ...(ups.length ? { upgrades: Object.fromEntries(ups) } : {}) }
}

/**
 * Swap a learned kind's parts for a forged version, outside the op log (so the sentence's undo still
 * removes the kind). Null when the kind is gone, isn't learned, or was redefined since the forge began
 * (its basis no longer matches), or when the upgrade would be a downgrade. Every instance then rebuilds
 * (effects.redefined), since they all share the kind.
 */
export function upgradeKind(state: WorldState, kind: string, parts: Part[], opts: { basis: string, quality: KindUpgrade['quality'] }): { state: WorldState, effects: Effects } | null {
  const desc = state.kinds[kind]
  if (!desc?.learned || desc.basis !== opts.basis || !parts.length) return null
  if (QUALITY_RANK[desc.quality ?? 'draft'] > QUALITY_RANK[opts.quality]) return null
  const next: KindDescriptor = { ...learnedKind(kind, desc.tags, parts), basis: opts.basis, quality: opts.quality }
  const s: WorldState = { ...state, kinds: { ...state.kinds, [kind]: next }, upgrades: { ...state.upgrades, [kind]: { basis: opts.basis, parts, quality: opts.quality } } }
  return { state: s, effects: diffStates(state, s) }
}

/** Load a saved world by replaying its log. Every batch's ops are re-validated, since files can be hand-edited. */
export function importWorld(saved: unknown): WorldState {
  const log = (saved as Partial<SavedWorld> | null)?.log
  if (!Array.isArray(log)) throw new Error('not a Conjure world: expected { version, log: [...] }')
  const ups: Record<string, KindUpgrade> = {}
  for (const [k, u] of Object.entries((saved as Partial<SavedWorld>).upgrades ?? {})) {
    const parts = cleanParts(u?.parts)
    if (parts.length && typeof u?.basis === 'string' && (u.quality === 'good' || u.quality === 'hero')) ups[k] = { basis: u.basis, parts, quality: u.quality }
  }
  const clean: Batch[] = log.flatMap((b: Batch) => {
    const { ops } = parseOps(b?.ops ?? [])
    if (!ops.length || !b.ctx) return []
    return [{ ...b, ops, dropped: b.dropped ?? [] }]
  })
  return replayLog(clean, ups)
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
