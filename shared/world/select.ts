/**
 * The selector engine: turns `{ tag: 'tree', near: 'gaze', within: 15 }` into a set of entities.
 * The model never lists ids; it says which ones, and this decides. Pure over plain world data.
 */
import { kindHeight, placeholderKind } from './kinds.ts'
import type { KindDescriptor } from './kinds.ts'
import { normalizeKind } from './ops.ts'
import type { Selector, Vec3 } from './ops.ts'
import type { Entity, OpContext, WorldState } from './types.ts'

export const DEFAULT_WITHIN = 15

export function kindOf(state: WorldState, kind: string): KindDescriptor {
  return state.kinds[kind] ?? placeholderKind(kind)
}

export function entityHeight(state: WorldState, e: Entity): number {
  return kindHeight(kindOf(state, e.kind), e.props)
}

export function entityRadius(state: WorldState, e: Entity): number {
  return kindOf(state, e.kind).footprint * (e.props.scale ?? 1)
}

export function distXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

/** What "that" means: the entity the gaze ray hit, else whatever stands at the gaze point. */
export function gazeEntity(state: WorldState, ctx: OpContext): Entity | undefined {
  if (ctx.gaze.entity) {
    const hit = state.entities.find(e => e.id === ctx.gaze.entity)
    if (hit) return hit
  }
  let best: Entity | undefined
  let bestD = Infinity
  for (const e of state.entities) {
    const r = entityRadius(state, e)
    if (r <= 0) continue
    const d = distXZ(e.pos, ctx.gaze.point)
    if (d < r + 0.5 && d < bestD) {
      best = e
      bestD = d
    }
  }
  return best
}

export function lastBatch(state: WorldState): Entity[] {
  return state.lastGroup ? state.entities.filter(e => e.group === state.lastGroup) : []
}

export function select(state: WorldState, sel: Selector, ctx: OpContext): Entity[] {
  let pool: Entity[]
  if (sel.ref === 'gaze') {
    // Looking at nothing in particular falls back to the last thing made: "make it red" right after a spawn.
    const hit = gazeEntity(state, ctx)
    pool = hit ? [hit] : lastBatch(state)
  } else if (sel.ref === 'last') {
    pool = lastBatch(state)
  } else {
    pool = state.entities
  }

  if (sel.kind) {
    const kind = normalizeKind(sel.kind)
    const byKind = matchWithPlural(pool, kind, (e, k) => e.kind === k)
    // Models sometimes say kind:'tree' when they mean the tag; honour the intent.
    pool = byKind.length ? byKind : matchWithPlural(pool, kind, hasTag)
  }
  if (sel.tag) pool = matchWithPlural(pool, sel.tag.trim().toLowerCase(), hasTag)

  const origin = sel.near === 'gaze' ? ctx.gaze.point : ctx.player.pos
  if (sel.near) {
    const within = sel.within ?? DEFAULT_WITHIN
    pool = pool.filter(e => distXZ(e.pos, origin) <= within + entityRadius(state, e))
  }

  if (sel.sort === 'distance') {
    pool = [...pool].sort((a, b) => distXZ(a.pos, origin) - distXZ(b.pos, origin))
  } else if (sel.sort === 'height') {
    pool = [...pool].sort((a, b) => entityHeight(state, b) - entityHeight(state, a))
  }
  if (sel.limit) pool = pool.slice(0, sel.limit)
  return pool
}

function hasTag(e: Entity, tag: string): boolean {
  return e.kind === tag || e.tags.includes(tag)
}

// "trees", "benches", "those houses": try the word as said, then its singular forms.
function matchWithPlural(pool: Entity[], word: string, test: (e: Entity, w: string) => boolean): Entity[] {
  for (const w of [word, word.replace(/es$/, ''), word.replace(/s$/, '')]) {
    const hit = pool.filter(e => test(e, w))
    if (hit.length) return hit
  }
  return []
}
