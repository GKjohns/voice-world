/**
 * The world kernel: a plain WorldState and a pure `applyOp`. The op log is the world; replaying it
 * rebuilds the same entities (positions are seeded from the stored context), which is how undo,
 * save and load all work. No three.js here, so tests and the server context builder can use it.
 */
import { KIT, isKitKind, learnedKind } from './kinds.ts'
import type { KindDescriptor } from './kinds.ts'
import { deOverlap, hashSeed, layout, resolveAnchor, rng } from './layout.ts'
import type { Placed } from './layout.ts'
import { parseOps } from './ops.ts'
import type { DroppedOp, Op, Props } from './ops.ts'
import { entityRadius, kindOf, select } from './select.ts'
import type { Batch, Effects, Entity, OpContext, WorldState } from './types.ts'

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
  return { spawned: [], modified: [], removed: [], redefined: [], atmosphere: false, say: [], notes: [] }
}

interface StepResult {
  state: WorldState
  say?: string
  notes: string[]
  teleport?: Effects['teleport']
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
  return { state: res.state, effects }
}

function step(state: WorldState, op: Op, ctx: OpContext): StepResult {
  const group = `g${state.nextGroup}`
  const rand = rng(hashSeed(ctx.seed, group, state.nextId, op.op))

  switch (op.op) {
    case 'spawn': {
      const notes: string[] = []
      const desc = kindOf(state, op.kind)
      if (!state.kinds[op.kind]) notes.push(`unknown kind "${op.kind}": holding its spot with a placeholder until it's defined`)
      const out = layout(state, { desc, count: op.count ?? 1, arrange: op.arrange, at: op.at, radius: op.radius, vary: op.vary, facing: op.facing, xz: op.xz, yaw: op.yaw, props: op.set }, ctx, rand)
      notes.push(...out.notes)
      let nextId = state.nextId
      const spawned: Entity[] = out.placed.map((p) => {
        const props: Props = { ...op.set }
        const scale = round3(p.scale * (op.set?.scale ?? 1))
        if (scale !== 1) props.scale = scale
        else delete props.scale
        const e: Entity = { id: `${op.kind}#${nextId++}`, kind: op.kind, tags: [...desc.tags], pos: p.pos, rotY: round3(p.rotY), props, group }
        if (p.hue) e.hue = p.hue
        return e
      })
      return { state: { ...state, entities: [...state.entities, ...spawned], nextId, lastGroup: group }, notes }
    }

    case 'define': {
      if (isKitKind(op.kind)) return { state, notes: [`"${op.kind}" is a kit kind; define ignored`] }
      const desc = learnedKind(op.kind, op.tags, op.parts)
      // Placeholders already standing in for this kind pick up its tags (and the renderer morphs them).
      const entities = state.entities.map(e => e.kind === op.kind ? { ...e, tags: [...desc.tags] } : e)
      return { state: { ...state, kinds: { ...state.kinds, [op.kind]: desc }, entities }, notes: [] }
    }

    case 'modify': {
      const targets = select(state, op.target, ctx)
      if (!targets.length) return { state, notes: [`modify: nothing matches ${JSON.stringify(op.target)}`] }
      const ids = new Set(targets.map(t => t.id))
      const entities = state.entities.map(e => ids.has(e.id) ? { ...e, props: mergeProps(e.props, op.set, op.relative ?? false, kindOf(state, e.kind)) } : e)
      return { state: { ...state, entities }, notes: [] }
    }

    case 'move': {
      const targets = select(state, op.target, ctx)
      if (!targets.length) return { state, notes: [`move: nothing matches ${JSON.stringify(op.target)}`] }
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
      return { state: replayLog(state.log.slice(0, -1)), notes: [`undid ${undone.id}${undone.label ? ` (“${undone.label}”)` : ''}`] }
    }

    case 'atmosphere':
      return { state: { ...state, atmosphere: stripAtmos({ time: op.time ?? state.atmosphere.time, fog: op.fog ?? state.atmosphere.fog, ambient: op.ambient ?? state.atmosphere.ambient }) }, notes: [] }

    case 'teleport':
      // Clears the stage (and the old place's sound); the Director streams the new place into this same
      // batch afterwards (extendLastBatch), so the log replays the built scene without calling a model.
      return { state: { ...state, entities: [], place: op.world, lastGroup: null, atmosphere: stripAtmos({ ...state.atmosphere, ambient: undefined }) }, notes: [], teleport: { world: op.world, brief: op.brief } }

    case 'say':
      return { state, say: op.text, notes: [] }
  }
}

function stripAtmos(a: WorldState['atmosphere']): WorldState['atmosphere'] {
  const out: WorldState['atmosphere'] = { time: a.time }
  if (a.fog !== undefined) out.fog = a.fog
  if (a.ambient !== undefined && a.ambient !== 'none') out.ambient = a.ambient
  return out
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
  return commitOps(state, ops, dropped, ctx, label, at)
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
  const effects: Effects = { ...diffStates(state, s), say: extras.say, notes: extras.notes, teleport: extras.teleport }
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
  const keep = ops.filter(o => o.op !== 'undo' && o.op !== 'teleport' && o.op !== 'say')
  for (const o of ops) if (o.op === 'say') extras.say.push(o.text)
  // Step with the batch's own group number (nextGroup was bumped when it was committed).
  let s: WorldState = { ...state, nextGroup: state.nextGroup - 1 }
  for (const op of keep) {
    const res = step(s, op, b.ctx)
    s = res.state
    extras.notes.push(...res.notes)
  }
  const batch: Batch = { ...b, ops: [...b.ops, ...keep], dropped: [...b.dropped, ...dropped] }
  s = { ...s, nextGroup: state.nextGroup, log: [...state.log.slice(0, -1), batch] }
  return { state: s, effects: { ...diffStates(state, s), say: extras.say, notes: extras.notes }, ops: keep, dropped, batch }
}

/** Rebuild a world from its op log. Ops in a log are already strict, so they're applied as-is. */
export function replayLog(log: Batch[]): WorldState {
  let s = createWorld()
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
  fx.atmosphere = a.atmosphere.time !== b.atmosphere.time || a.atmosphere.fog !== b.atmosphere.fog || a.atmosphere.ambient !== b.atmosphere.ambient
  return fx
}

function entityKey(e: Entity): string {
  return JSON.stringify([e.pos, e.rotY, e.props, e.tags, e.hue])
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
}

export function exportWorld(state: WorldState): SavedWorld {
  return { version: WORLD_VERSION, log: state.log }
}

/** Load a saved world by replaying its log. Every batch's ops are re-validated, since files can be hand-edited. */
export function importWorld(saved: unknown): WorldState {
  const log = (saved as Partial<SavedWorld> | null)?.log
  if (!Array.isArray(log)) throw new Error('not a Conjure world: expected { version, log: [...] }')
  const clean: Batch[] = log.flatMap((b: Batch) => {
    const { ops } = parseOps(b?.ops ?? [])
    if (!ops.length || !b.ctx) return []
    return [{ ...b, ops, dropped: b.dropped ?? [] }]
  })
  return replayLog(clean)
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}
