/**
 * The model's view of the world for one sentence: a compact text block (player, gaze snapshot, last
 * batch, the world by kind) plus the trimmed scene the client posts to /api/intent. Three-free, so the
 * server, the bench and the tests share it. The model never sees an id list, only kinds, tags and counts.
 */
import { KIT, placeholderKind } from './kinds.ts'
import type { KindDescriptor } from './kinds.ts'
import { forward, right } from './layout.ts'
import type { Props, TimeOfDay, Vec3 } from './ops.ts'
import { DEFAULT_WITHIN, distXZ, entityHeight, gazeEntity, lastBatch } from './select.ts'
import { summarizeKinds } from './state.ts'
import type { Atmosphere, Entity, OpContext, WorldState } from './types.ts'

// ---------- the trimmed scene (what the client sends) ----------

export interface SceneEntity {
  id: string
  kind: string
  tags: string[]
  pos: Vec3
  props: Props
  group: string
}

export interface Scene {
  entities: SceneEntity[]
  /** Learned kinds only (kit kinds are known to the server); parts stripped, the model only needs names and tags. */
  learned: KindDescriptor[]
  atmosphere: { time: TimeOfDay, fog?: number, weather?: Atmosphere['weather'], playerScale?: number, gravity?: false, fly?: true, sky?: string, moons?: number, intensity?: number }
  place: string
  lastGroup: string | null
  lastLabel?: string
}

export function trimScene(state: WorldState): Scene {
  const last = state.log[state.log.length - 1]
  return {
    entities: state.entities.map(e => ({ id: e.id, kind: e.kind, tags: e.tags, pos: e.pos, props: e.props, group: e.group })),
    learned: Object.values(state.kinds).filter(k => k.learned).map(({ parts: _parts, ...k }) => k),
    atmosphere: state.atmosphere,
    place: state.place,
    lastGroup: state.lastGroup,
    lastLabel: last && last.id === state.lastGroup ? last.label : undefined
  }
}

/** Rebuild a WorldState-shaped value from a posted scene. Lenient: a hand-made or partial scene still works. */
export function sceneToState(scene: Partial<Scene> | undefined): WorldState & { lastLabel?: string } {
  const kinds: Record<string, KindDescriptor> = { ...KIT }
  for (const k of scene?.learned ?? []) {
    if (k && typeof k.kind === 'string' && !KIT[k.kind]) kinds[k.kind] = { ...k, learned: true }
  }
  const entities: Entity[] = (scene?.entities ?? [])
    .filter(e => e && typeof e.kind === 'string' && Array.isArray(e.pos))
    .map(e => ({ id: String(e.id), kind: e.kind, tags: Array.isArray(e.tags) ? e.tags : [], pos: e.pos, rotY: 0, props: e.props ?? {}, group: String(e.group ?? '') }))
  return {
    entities,
    kinds,
    atmosphere: scene?.atmosphere ?? { time: 'golden' },
    place: scene?.place ?? 'void',
    log: [],
    nextId: entities.length + 1,
    nextGroup: 1,
    lastGroup: scene?.lastGroup ?? null,
    lastLabel: scene?.lastLabel
  }
}

// ---------- words for directions ----------

const COMPASS = ['N', 'NW', 'W', 'SW', 'S', 'SE', 'E', 'NE'] // yaw 0 = north, positive turns left

export function compass(yaw: number): string {
  const i = Math.round(yaw / (Math.PI / 4))
  return COMPASS[((i % 8) + 8) % 8]!
}

/** "ahead", "ahead-left", "left", "behind-right"… relative to where the player faces. */
export function relativeDir(ctx: OpContext, p: Vec3): string {
  const dx = p[0] - ctx.player.pos[0]
  const dz = p[2] - ctx.player.pos[2]
  if (Math.hypot(dx, dz) < 0.5) return 'here'
  const f = forward(ctx.player.yaw)
  const r = right(ctx.player.yaw)
  const ahead = dx * f[0] + dz * f[1]
  const side = dx * r[0] + dz * r[1]
  const a = Math.atan2(side, ahead) // 0 ahead, +π/2 right
  const words = ['ahead', 'ahead-right', 'right', 'behind-right', 'behind', 'behind-left', 'left', 'ahead-left']
  const i = Math.round(a / (Math.PI / 4))
  return words[((i % 8) + 8) % 8]!
}

function propText(props: Props): string {
  const bits = Object.entries(props).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${typeof v === 'number' ? Math.round(v * 100) / 100 : v}`)
  return bits.join('; ')
}

function countBy(entities: Entity[]): string {
  const m = new Map<string, number>()
  for (const e of entities) m.set(e.kind, (m.get(e.kind) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ×${n}`).join(', ')
}

// ---------- the block ----------

/**
 * The per-sentence context. Example:
 *   player: at (0,0), facing N
 *   gaze (at speech start): ground, 8.2 m ahead-left
 *   last batch: pine ×9 (g3, "make a bunch of trees")
 *   world (by kind): pine ×9 [tree, plant] · house ×2 [building, home] · grandfather_clock ×1 [clock] (learned)
 */
export function buildContext(state: WorldState & { lastLabel?: string }, ctx: OpContext): string {
  const lines: string[] = []
  const pp = ctx.player.pos
  lines.push(`player: at (${Math.round(pp[0])},${Math.round(pp[2])}), facing ${compass(ctx.player.yaw)}`)

  const hit = gazeEntity(state, ctx)
  const gp = ctx.gaze.point
  const gd = ctx.gaze.dist ?? distXZ(gp, pp)
  if (hit) {
    const d = distXZ(hit.pos, pp)
    const props = propText(hit.props)
    const batch = state.entities.filter(e => e.group === hit.group)
    const batchNote = batch.length > 1 ? `, one of ${countBy(batch)} in batch ${hit.group}` : ''
    lines.push(`gaze (at speech start): object ${hit.id} (${hit.kind} [${hit.tags.filter(t => t !== hit.kind).join(', ')}]${props ? `; ${props}` : ''}; ${round1(entityHeight(state, hit))} m tall), ${round1(d)} m ${relativeDir(ctx, hit.pos)}${batchNote}`)
  } else {
    lines.push(`gaze (at speech start): ground, ${round1(gd)} m ${relativeDir(ctx, gp)}`)
  }
  const near = state.entities.filter(e => distXZ(e.pos, gp) <= DEFAULT_WITHIN)
  if (near.length) lines.push(`near gaze (≤${DEFAULT_WITHIN} m): ${countBy(near)}`)

  const last = lastBatch(state)
  if (last.length) {
    const said = state.lastLabel ?? state.log.find(b => b.id === state.lastGroup)?.label
    const label = said ? `, "${said.slice(0, 80)}"` : ''
    lines.push(`last batch: ${countBy(last)} (${state.lastGroup}${label})`)
  } else {
    lines.push('last batch: none')
  }

  const kinds = summarizeKinds(state)
  if (kinds.length) {
    const parts = kinds.map((k) => {
      const tags = k.tags.filter(t => t !== 'placeholder')
      const suffix = k.learned ? ' (learned)' : k.placeholder ? ' (placeholder, not defined yet)' : ''
      return `${k.kind} ×${k.count}${tags.length ? ` [${tags.join(', ')}]` : ''}${suffix}`
    })
    lines.push(`world (by kind, ${state.entities.length} total): ${parts.join(' · ')}`)
  } else {
    lines.push('world: empty')
  }

  const people = state.entities.filter(e => e.kind === 'person').sort((a, b) => distXZ(a.pos, pp) - distXZ(b.pos, pp))
  if (people.length) {
    const shown = people.slice(0, 10).map(e => `${e.props.name ?? e.id} (${e.props.role ?? 'villager'}${e.props.act && e.props.act !== 'none' ? `, ${e.props.act}` : ''}) ${round1(distXZ(e.pos, pp))} m ${relativeDir(ctx, e.pos)}`)
    lines.push(`people (select one by name: { kind: "<name lowercase>" }; all of them: { tag: "person" }): ${shown.join(' · ')}${people.length > 10 ? ` · and ${people.length - 10} more` : ''}`)
  }

  const learned = Object.values(state.kinds).filter(k => k.learned)
  if (learned.length) lines.push(`learned kinds (reuse by name, no define needed): ${learned.map(k => `${k.kind} [${k.tags.filter(t => t !== k.kind).join(', ')}]`).join(' · ')}`)
  const placeholders = [...new Set(state.entities.filter(e => !state.kinds[e.kind]).map(e => e.kind))]
  if (placeholders.length) lines.push(`placeholders waiting for a define: ${placeholders.map(k => placeholderKind(k).label).join(', ')}`)

  const at = state.atmosphere
  lines.push(`atmosphere: ${at.time}${at.fog !== undefined ? `, fog ${at.fog}` : ''}${at.weather ? ` · weather: ${at.weather}` : ''}${at.playerScale ? ` · player scale ${at.playerScale}` : ''}${at.gravity === false ? ' · gravity off' : ''}${at.fly ? ' · player flying' : ''}${at.sky ? ` · sky ${at.sky}` : ''}${at.moons !== undefined ? ` · moons ${at.moons}` : ''} · place: ${state.place}`)
  return lines.join('\n')
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}
