/**
 * What a person can see and feel right now, as a few lines for their prompt: the time and the weather,
 * the place, what's near them and what's further off (by kind, with distances), the other people and what
 * they're up to, and where the stranger is. Short on purpose (Haiku answers fast on small prompts).
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
  lines.push(`time: ${v.slot} (${at.time})${weather}${at.playerScale && at.playerScale !== 1 ? ` · the stranger is ${at.playerScale < 1 ? 'tiny' : 'a giant'} right now` : ''} · place: ${state.place === 'void' ? 'a quiet open land' : state.place}`)

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
  if (near.size) lines.push(`near you: ${[...near].map(([k, ds]) => `${ds.length > 1 ? `${ds.length} ${k}` : `a ${k}`} (${Math.min(...ds)} m)`).join(', ')}`)
  if (far.size) lines.push(`further off: ${[...far].map(([k, n]) => (n > 1 ? `${n} ${k}` : k)).join(', ')}`)
  if (sky.length) lines.push(`in the sky: ${sky.join(', ')}`)

  const others = state.entities.filter(e => e.kind === 'person' && e.id !== v.self.id)
    .map(e => ({ e, d: dist(where(e), v.self.pos) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 6)
  if (others.length) lines.push(`other people: ${others.map(({ e, d }) => `${e.props.name ?? 'someone'} the ${e.props.role ?? 'villager'} (${Math.round(d)} m${v.doing?.get(e.id) ? `, ${v.doing.get(e.id)}` : ''})`).join('; ')}`)

  const pd = dist(v.player, v.self.pos)
  lines.push(`the stranger: ${pd < 1.5 ? 'right in front of you' : `${Math.round(pd)} m away`}${at.playerScale && at.playerScale < 0.5 ? ', no bigger than a beetle' : ''}`)
  return lines.join('\n')
}

/** One line for the memory of a wish the person saw granted. */
export function wishEvent(label: string, spawned: Record<string, number>, changed: number, removed: number, atmos: string[]): string | null {
  const bits: string[] = []
  const kinds = Object.entries(spawned)
  if (kinds.length) bits.push(kinds.map(([k, n]) => `${n > 1 ? `${n} ${k.replace(/_/g, ' ')}s` : `a ${k.replace(/_/g, ' ')}`}`).join(' and ') + ' appeared out of nowhere')
  if (changed) bits.push(`${changed} thing${changed > 1 ? 's' : ''} changed before your eyes`)
  if (removed) bits.push(`${removed} thing${removed > 1 ? 's' : ''} vanished`)
  bits.push(...atmos)
  if (!bits.length) return null
  return `the stranger said "${label.slice(0, 70)}" and ${bits.join(', ')}`
}
