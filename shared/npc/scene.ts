/**
 * What a person can see and feel right now, as a few lines for their prompt: the time and the weather,
 * the place, what's near them and what's further off (by kind, with distances), the other people and what
 * they're up to, and where the visitor is. Short on purpose (Haiku answers fast on small prompts).
 * Distances are words, never metres (the model reads numbers aloud), and only what exists is listed.
 * Pure and three-free.
 */
import type { Entity, WorldState } from '../world/types.ts'
import type { Vec3 } from '../world/ops.ts'
import type { DaySlot } from './persona.ts'

export interface SceneView {
  self: { id: string, pos: Vec3 }
  /** Live positions (people walk; their entity pos is where they were spawned). */
  livePos?: Map<string, Vec3>
  player: Vec3
  slot: DaySlot
  /** What other people are doing now, by id ("fishing off the dock"). */
  doing?: Map<string, string>
  /** Names that must be in "other people" whatever the distance (their ties, who you asked about). */
  mustInclude?: string[]
}

/** A distance as a person would say it. */
export function howFar(d: number): string {
  if (d < 1.6) return 'right beside you'
  if (d < 4) return 'a few steps away'
  if (d < 9) return 'close by'
  if (d < 20) return 'a short walk off'
  if (d < 45) return 'a fair way off'
  return 'far off'
}

const NEAR = 15
const FAR = 120

const SKIP = new Set(['floor', 'ceiling', 'wall', 'fireflies', 'dust_motes', 'embers'])

function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

function label(e: Entity): string {
  return e.kind.replace(/_/g, ' ')
}

export function npcScene(state: Pick<WorldState, 'entities' | 'atmosphere' | 'place'>, v: SceneView): string {
  const at = state.atmosphere
  const where = (e: Entity) => v.livePos?.get(e.id) ?? e.pos
  const lines: string[] = []
  const weather = at.weather ? ` · weather: ${at.weather}` : ' · the sky is clear'
  lines.push(`time: ${v.slot} (${at.time})${weather}${at.playerScale && at.playerScale !== 1 ? ` · the visitor is ${at.playerScale < 1 ? 'tiny' : 'a giant'} right now` : ''} · place: ${state.place === 'void' ? 'a quiet open land' : state.place}`)

  const things = state.entities.filter(e => e.kind !== 'person' && !SKIP.has(e.kind))
  const near = new Map<string, number[]>()
  const far = new Map<string, number>()
  const sky: string[] = []
  for (const e of things) {
    const p = where(e)
    const d = dist(p, v.self.pos)
    if (p[1] > 8 && !e.tags.includes('terrain')) {
      if (!sky.includes(label(e))) sky.push(label(e))
      continue
    }
    if (d <= NEAR) near.set(label(e), [...(near.get(label(e)) ?? []), Math.round(d)])
    else if (d <= FAR || e.tags.includes('terrain')) far.set(label(e), (far.get(label(e)) ?? 0) + 1)
  }
  if (near.size) lines.push(`near you: ${[...near].map(([k, ds]) => `${ds.length > 1 ? `${ds.length} ${k}` : `a ${k}`} (${howFar(Math.min(...ds))})`).join(', ')}`)
  if (far.size) lines.push(`further off: ${[...far].map(([k, n]) => (n > 1 ? `${n} ${k}` : k)).join(', ')}`)
  if (sky.length) lines.push(`in the sky: ${sky.join(', ')}`)

  const must = new Set((v.mustInclude ?? []).map(n => n.toLowerCase()))
  const all = state.entities.filter(e => e.kind === 'person' && e.id !== v.self.id)
    .map(e => ({ e, d: dist(where(e), v.self.pos) }))
    .sort((a, b) => a.d - b.d)
  // The nearest 8, plus anyone they're tied to or were asked about, wherever they are.
  const others = all.filter((x, i) => i < 8 || must.has((x.e.props.name ?? '').toLowerCase())).slice(0, 12)
  if (others.length) lines.push(`other people: ${others.map(({ e, d }) => `${e.props.name ?? 'someone'} the ${e.props.role ?? 'villager'} (${howFar(d)}${v.doing?.get(e.id) ? `, ${v.doing.get(e.id)}` : ''})`).join('; ')}`)
  if (all.length > others.length) lines.push(`(and ${all.length - others.length} more people about)`)

  const pd = dist(v.player, v.self.pos)
  lines.push(`the visitor: ${pd < 1.5 ? 'right in front of you' : howFar(pd)}${at.playerScale && at.playerScale < 0.5 ? ', no bigger than a beetle' : ''}`)
  return lines.join('\n')
}

/** What a wish did to one thing that was already there, as a person would tell it. */
export interface WishChange {
  kind: string
  /** Its name, for a person ("Hilde"). */
  name?: string
  /** Short phrases: "turned orange", "began to glow", "grew huge", "started dancing". */
  what: string[]
}

function colourName(c: string): string {
  if (!c.startsWith('#')) return c.replace(/_/g, ' ')
  const n = parseInt(c.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max < 50) return 'black'
  if (min > 205) return 'white'
  if (max - min < 25) return 'grey'
  if (r === max && g < 0.3 * r) return 'red'
  if (r === max && g < 0.8 * r) return 'orange'
  if (r === max || (r > 0.85 * max && g > 0.85 * max)) return b < 0.6 * max ? 'yellow' : 'pink'
  if (g === max) return b > 0.8 * g ? 'teal' : 'green'
  return r > 0.6 * b ? 'purple' : 'blue'
}
/** Two versions of one entity → what changed, in words (empty when nothing a person would notice). */
export function describeChange(before: Pick<Entity, 'kind' | 'props' | 'pos'>, after: Pick<Entity, 'kind' | 'props' | 'pos'>): string[] {
  const a = before.props
  const b = after.props
  const out: string[] = []
  if (b.color && b.color !== a.color) out.push(`turned ${colourName(b.color)}`)
  if (b.material && b.material !== a.material) out.push(`turned to ${b.material.replace(/_/g, ' ')}`)
  if ((b.glow ?? 0) > (a.glow ?? 0) + 0.2) out.push('began to glow')
  else if ((b.glow ?? 0) + 0.2 < (a.glow ?? 0)) out.push('stopped glowing')
  const sa = (a.scale ?? 1) * (a.height ?? 1)
  const sb = (b.scale ?? 1) * (b.height ?? 1)
  if (sb > sa * 1.15) out.push(sb > sa * 2.5 ? 'grew huge' : 'grew bigger')
  else if (sb < sa / 1.15) out.push(sb < sa / 2.5 ? 'shrank to almost nothing' : 'shrank')
  if (b.motion && b.motion !== a.motion && b.motion !== 'none') out.push(b.motion === 'fly' ? 'took off flying' : b.motion === 'hover' ? 'rose and hung in the air' : `began to ${b.motion}`)
  if (b.text && b.text !== a.text) out.push(`now reads "${b.text}"`)
  if (b.act && (b.actId !== a.actId || b.act !== a.act)) out.push(b.act === 'none' ? 'stopped what they were doing' : b.act === 'follow' ? 'started following the visitor' : `started to ${b.act}`)
  if (Math.hypot(before.pos[0] - after.pos[0], before.pos[2] - after.pos[2]) > 1) out.push('moved')
  if ((b.light ?? 0) > (a.light ?? 0)) out.push('lit up')
  return out
}

/** One line for the memory of a wish the person saw granted: what was said, and concretely what happened. */
export function wishEvent(label: string, spawned: Record<string, number>, changed: number | WishChange[], removed: number | string[], atmos: string[], who = 'the visitor'): string | null {
  const bits: string[] = []
  const kinds = Object.entries(spawned)
  if (kinds.length) bits.push(kinds.map(([k, n]) => `${n > 1 ? `${n} ${k.replace(/_/g, ' ')}s` : `a ${k.replace(/_/g, ' ')}`}`).join(' and ') + ' appeared out of nowhere')
  if (typeof changed === 'number') {
    if (changed) bits.push(`${changed} thing${changed > 1 ? 's' : ''} changed before your eyes`)
  } else {
    // "the dock turned orange and began to glow"; a crowd of the same change reads as one line.
    const groups = new Map<string, string[]>()
    for (const c of changed) {
      if (!c.what.length) continue
      const key = c.what.join(' and ')
      groups.set(key, [...(groups.get(key) ?? []), c.name ?? c.kind.replace(/_/g, ' ')])
    }
    for (const [what, list] of [...groups].slice(0, 3)) {
      const uniq = [...new Set(list)]
      const subj = uniq.length === 1 ? (/^[A-Z]/.test(uniq[0]!) ? uniq[0]! : `the ${uniq[0]}`) : list.length > 4 ? `${list.length} ${list[0]}s` : uniq.map(u => (/^[A-Z]/.test(u) ? u : `the ${u}`)).join(' and ')
      bits.push(`${subj} ${what}`)
    }
  }
  if (typeof removed === 'number') {
    if (removed) bits.push(`${removed} thing${removed > 1 ? 's' : ''} vanished`)
  } else if (removed.length) {
    bits.push(`${[...new Set(removed)].slice(0, 3).map(k => `the ${k.replace(/_/g, ' ')}`).join(' and ')} vanished`)
  }
  bits.push(...atmos)
  if (!bits.length) return null
  return `${who} said "${label.slice(0, 70)}" and ${bits.join(', ')}`
}
