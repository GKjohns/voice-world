/**
 * The forge (progressive high-quality generation), pure half: the forged part vocabulary and its strict
 * cleaning, mirror expansion, bounds, the floating-island check, fitting a forged object to its draft, the
 * parts hash, tier choice, the library key and the spend decision. No three.js, no Node: the client, the
 * server and the tests all use it.
 *
 * A forged object is plain `Part[]` data, exactly like a Haiku `define`, just richer (tubes, lathes,
 * extrudes) and bigger (up to HQ_MAX_PARTS). The model writes a program on the server; only the parts it
 * produces ever reach the client or the world state.
 */
import { FORGE_SHAPES, MATERIALS, SHAPES, SLOTS } from './ops.ts'
import type { Material, Part, Slot, Vec3 } from './ops.ts'

export const HQ_MAX_PARTS = 240
const MAX_POINTS = 12
const MAX_PROFILE = 24
const MAX_OUTLINE = 24
const MAX_COORD = 200

export type Quality = 'draft' | 'good' | 'hero'
export type Tier = 'good' | 'hero'
export const QUALITY_RANK: Record<Quality, number> = { draft: 0, good: 1, hero: 2 }

const ALL_SHAPES = new Set<string>([...SHAPES, ...FORGE_SHAPES])
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const clampC = (n: number) => Math.max(-MAX_COORD, Math.min(MAX_COORD, n))
const r4 = (n: number) => Math.round(n * 1e4) / 1e4

function vec3(v: unknown): Vec3 | null {
  if (!Array.isArray(v) || v.length < 3 || !v.slice(0, 3).every(isNum)) return null
  return [clampC(v[0]), clampC(v[1]), clampC(v[2])]
}
function vec2(v: unknown): [number, number] | null {
  if (!Array.isArray(v) || v.length < 2 || !isNum(v[0]) || !isNum(v[1])) return null
  return [clampC(v[0]), clampC(v[1])]
}
const COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,20})$/i

/**
 * One raw part from a forge program → a clean Part, or null if it would not render. Strict: finite numbers
 * only, coordinates clamped, point lists capped. `glow: true` means slot glow (the program's shorthand).
 */
export function cleanPart(raw: unknown): (Part & { mirror?: boolean }) | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const shape = typeof r.shape === 'string' ? r.shape : ''
  if (!ALL_SHAPES.has(shape)) return null
  const color = typeof r.color === 'string' && COLOR.test(r.color.trim()) ? r.color.trim() : '#9a9a9a'
  const at = vec3(r.at) ?? [0, 0, 0]
  const rot = vec3(r.rot) ?? undefined
  const slot: Slot | undefined = typeof r.slot === 'string' && (SLOTS as readonly string[]).includes(r.slot) ? r.slot as Slot : r.glow === true ? 'glow' : undefined
  const material: Material | undefined = typeof r.material === 'string' && (MATERIALS as readonly string[]).includes(r.material) ? r.material as Material : undefined
  const base = { color, at, ...(rot && rot.some(n => n !== 0) ? { rot } : {}), ...(slot ? { slot } : {}), ...(material ? { material } : {}), ...(r.mirror === true ? { mirror: true } : {}) }
  if (shape === 'tube') {
    const points = Array.isArray(r.points) ? r.points.map(vec3).filter((p): p is Vec3 => !!p).slice(0, MAX_POINTS) : []
    if (points.length < 2) return null
    const rr = Array.isArray(r.radii) ? r.radii.filter(isNum) : isNum(r.radii) ? [r.radii] : isNum(r.radius) ? [r.radius] : [0.2]
    const radii = (rr.length ? rr : [0.2]).slice(0, MAX_POINTS).map(n => Math.max(0.005, Math.min(50, Math.abs(n))))
    const p: Part = { shape: 'tube', size: [0, 0, 0], ...base, points, radii }
    p.size = localSize(p)
    return p
  }
  if (shape === 'lathe') {
    const profile = Array.isArray(r.profile) ? r.profile.map(vec2).filter((q): q is [number, number] => !!q).slice(0, MAX_PROFILE).map(([x, y]) => [Math.abs(x), y] as [number, number]) : []
    if (profile.length < 2) return null
    const p: Part = { shape: 'lathe', size: [0, 0, 0], ...base, profile }
    p.size = localSize(p)
    return p
  }
  if (shape === 'extrude') {
    const outline = Array.isArray(r.outline) ? r.outline.map(vec2).filter((q): q is [number, number] => !!q).slice(0, MAX_OUTLINE) : []
    if (outline.length < 3) return null
    const depth = isNum(r.depth) ? Math.max(0.01, Math.min(50, Math.abs(r.depth))) : 0.1
    const p: Part = { shape: 'extrude', size: [0, 0, 0], ...base, outline, depth }
    p.size = localSize(p)
    return p
  }
  const size = vec3(r.size)
  if (!size) return null
  return { shape: shape as Part['shape'], size: size.map(n => Math.max(0.01, Math.abs(n))) as Vec3, ...base }
}

/**
 * `mirror: true` → the part plus its exact x → −x copy, as two plain parts. A reflection across x turns an
 * Euler (a, b, c) into (a, −b, −c) for every shape here (each is symmetric in its own local x, and an
 * extrude's outline is negated in local x), so the client never needs negative scales or flipped winding.
 */
export function expandMirror(p: Part & { mirror?: boolean }): Part[] {
  const { mirror, ...part } = p
  if (!mirror) return [part]
  const m: Part = { ...part, at: [-part.at[0], part.at[1], part.at[2]] }
  if (part.rot) m.rot = [part.rot[0], -part.rot[1], -part.rot[2]]
  if (part.points) m.points = part.points.map(q => [-q[0], q[1], q[2]] as Vec3)
  if (part.outline) m.outline = part.outline.map(q => [-q[0], q[1]] as [number, number])
  // A part sitting on the mirror plane would just duplicate itself.
  if (Math.abs(part.at[0]) < 1e-3 && !part.points && !part.outline && !part.rot) return [part]
  return [part, m]
}

/** Raw program output → clean, mirror-expanded parts, capped. */
export function programParts(raw: unknown[], cap = HQ_MAX_PARTS): Part[] {
  const out: Part[] = []
  for (const r of raw) {
    const p = cleanPart(r)
    if (!p) continue
    for (const q of expandMirror(p)) {
      if (out.length >= cap) return out
      out.push(q)
    }
  }
  return out
}

// ---------- bounds ----------

export interface Box { min: Vec3, max: Vec3 }

function localBox(p: Part): Box {
  if (p.shape === 'tube' && p.points?.length) {
    const r = Math.max(...(p.radii ?? [0.2]), 0.01)
    return { min: [0, 1, 2].map(i => Math.min(...p.points!.map(q => q[i]!)) - r) as Vec3, max: [0, 1, 2].map(i => Math.max(...p.points!.map(q => q[i]!)) + r) as Vec3 }
  }
  if (p.shape === 'lathe' && p.profile?.length) {
    const R = Math.max(...p.profile.map(q => q[0]))
    const ys = p.profile.map(q => q[1])
    return { min: [-R, Math.min(...ys), -R], max: [R, Math.max(...ys), R] }
  }
  if (p.shape === 'extrude' && p.outline?.length) {
    const d = (p.depth ?? 0.1) / 2
    return { min: [Math.min(...p.outline.map(q => q[0])), Math.min(...p.outline.map(q => q[1])), -d], max: [Math.max(...p.outline.map(q => q[0])), Math.max(...p.outline.map(q => q[1])), d] }
  }
  const h = p.size.map(n => Math.abs(n) / 2) as Vec3
  return { min: [-h[0], -h[1], -h[2]], max: h }
}

function localSize(p: Part): Vec3 {
  const b = localBox(p)
  return [0, 1, 2].map(i => r4(b.max[i]! - b.min[i]!)) as Vec3
}

/** three.js Euler 'XYZ' (v' = Rx · Ry · Rz · v). */
export function rotateXYZ(v: Vec3, r?: Vec3): Vec3 {
  if (!r) return v
  const [a, b, c] = r
  let [x, y, z] = v
  ;[x, y] = [x * Math.cos(c) - y * Math.sin(c), x * Math.sin(c) + y * Math.cos(c)]
  ;[x, z] = [x * Math.cos(b) + z * Math.sin(b), -x * Math.sin(b) + z * Math.cos(b)]
  ;[y, z] = [y * Math.cos(a) - z * Math.sin(a), y * Math.sin(a) + z * Math.cos(a)]
  return [x, y, z]
}

/** World-space (object-space) axis-aligned bounds of one part. */
export function partBounds(p: Part): Box {
  const { min, max } = localBox(p)
  const min3: Vec3 = [Infinity, Infinity, Infinity]
  const max3: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        const q = rotateXYZ([x, y, z], p.rot)
        for (let i = 0; i < 3; i++) {
          const v = q[i]! + p.at[i]!
          if (v < min3[i]!) min3[i] = v
          if (v > max3[i]!) max3[i] = v
        }
      }
    }
  }
  return { min: min3, max: max3 }
}

/**
 * Gen loop 6: points on the object's real silhouette, in object space, for camera framing. The one box
 * round the whole object overshoots anything that isn't box-shaped (a tapered pagoda, a telescope on a
 * splayed tripod), so the camera stopped short and thin things landed small. Per part: a box gives its 8
 * corners, a round shape (sphere, cylinder, cone, capsule, torus) points on its rims, a tube its path
 * points pushed out by their radius. The `max` biggest parts (by box volume) are used.
 */
export function silhouettePoints(parts: Part[], max = 64): Vec3[] {
  const list = parts.length > max
    ? [...parts].sort((a, b) => vol(b) - vol(a)).slice(0, max)
    : parts
  const out: Vec3[] = []
  const put = (p: Part, v: Vec3) => {
    const q = rotateXYZ(v, p.rot)
    out.push([q[0] + p.at[0], q[1] + p.at[1], q[2] + p.at[2]])
  }
  for (const p of list) {
    if (p.shape === 'tube' && p.points?.length) {
      p.points.forEach((q, i) => {
        const r = Math.abs(p.radii?.[i] ?? p.radii?.[p.radii.length - 1] ?? 0.2)
        for (const d of [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]] as Vec3[]) put(p, [q[0] + d[0], q[1] + d[1], q[2] + d[2]])
      })
      continue
    }
    const b = localBox(p)
    const round = p.shape === 'sphere' || p.shape === 'cylinder' || p.shape === 'cone' || p.shape === 'capsule' || p.shape === 'torus'
    if (!round) {
      for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) put(p, [x, y, z])
      continue
    }
    const c: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]
    const h: Vec3 = [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2]
    // Rims round the local y axis (a torus lies in x–y, so round z): at the ends and, for a sphere, the middle.
    const ys = p.shape === 'sphere' ? [-0.7, 0, 0.7] : p.shape === 'cone' ? [-1] : [-1, 1]
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2
      for (const t of ys) {
        const w = p.shape === 'sphere' ? Math.sqrt(1 - t * t) : 1
        put(p, p.shape === 'torus'
          ? [c[0] + Math.cos(a) * h[0], c[1] + Math.sin(a) * h[1], c[2] + t * h[2]]
          : [c[0] + Math.cos(a) * h[0] * w, c[1] + t * h[1], c[2] + Math.sin(a) * h[2] * w])
      }
    }
    if (p.shape === 'sphere' || p.shape === 'cone') put(p, [c[0], b.max[1], c[2]])
    if (p.shape === 'sphere') put(p, [c[0], b.min[1], c[2]])
  }
  return out
}

function vol(p: Part): number {
  const b = partBounds(p)
  return (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2])
}

export function boundsOf(parts: Part[]): Box | null {
  if (!parts.length) return null
  const min: Vec3 = [Infinity, Infinity, Infinity]
  const max: Vec3 = [-Infinity, -Infinity, -Infinity]
  for (const p of parts) {
    const b = partBounds(p)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, b.min[i]!)
      max[i] = Math.max(max[i]!, b.max[i]!)
    }
  }
  return { min, max }
}

/**
 * The structural check (conjure-progressive's floating-island test, on part bounds): union-find over
 * part boxes grown by `margin`; every island other than the biggest that doesn't reach the object's
 * lowest level floats. Returns the floating part count, the island count and short notes for the refiner.
 */
export function islands(parts: Part[], margin = 0.03): { floating: number, groups: number, notes: string[] } {
  const boxes = parts.map(partBounds)
  const n = boxes.length
  if (!n) return { floating: 0, groups: 0, notes: [] }
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const touch = (a: Box, b: Box) => [0, 1, 2].every(i => a.min[i]! - margin <= b.max[i]! + margin && b.min[i]! - margin <= a.max[i]! + margin)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (touch(boxes[i]!, boxes[j]!)) parent[find(i)] = find(j)
  const groups = new Map<number, number[]>()
  boxes.forEach((_, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), i])
  })
  const list = [...groups.values()].sort((a, b) => b.length - a.length)
  const floor = Math.min(...boxes.map(b => b.min[1])) + 0.05
  let floating = 0
  const notes: string[] = []
  for (const isl of list.slice(1)) {
    if (isl.some(i => boxes[i]!.min[1] <= floor)) continue
    floating += isl.length
    if (notes.length < 6) {
      const c = [0, 1, 2].map(k => +(isl.reduce((s, i) => s + (boxes[i]!.min[k]! + boxes[i]!.max[k]!) / 2, 0) / isl.length).toFixed(2))
      notes.push(`${isl.length} part(s) (${isl.map(i => parts[i]!.shape).join(', ')}) centred near [${c.join(', ')}] float unattached`)
    }
  }
  return { floating, groups: list.length, notes }
}

/**
 * Gen loop 5: snap small floating islands onto the main structure instead of rejecting the build. Each
 * floating island (not the biggest, not touching the object's lowest level) whose parts are under
 * `maxFrac` of the total box volume moves by the shortest per-axis translation that closes the gap to the
 * nearest attached part; if that move is longer than `maxMove` × the object's largest dimension, the island
 * is dropped. A big floating island is left alone (`core` false: the structure itself is broken).
 */
export function snapFloating(parts: Part[], maxFrac = 0.2, maxMove = 0.35): { parts: Part[], snapped: number, dropped: number, core: boolean } {
  const res = { parts, snapped: 0, dropped: 0, core: true }
  if (parts.length < 3 || !islands(parts).floating) return res
  const margin = 0.03
  const boxes = parts.map(partBounds)
  const n = boxes.length
  const parent = boxes.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)))
  const touch = (a: Box, b: Box) => [0, 1, 2].every(i => a.min[i]! - margin <= b.max[i]! + margin && b.min[i]! - margin <= a.max[i]! + margin)
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (touch(boxes[i]!, boxes[j]!)) parent[find(i)] = find(j)
  const groups = new Map<number, number[]>()
  for (let i = 0; i < n; i++) groups.set(find(i), [...(groups.get(find(i)) ?? []), i])
  const list = [...groups.values()].sort((a, b) => b.length - a.length)
  const floor = Math.min(...boxes.map(b => b.min[1])) + 0.05
  const vol = (b: Box) => Math.max(1e-6, (b.max[0] - b.min[0]) * (b.max[1] - b.min[1]) * (b.max[2] - b.min[2]))
  const total = boxes.reduce((s, b) => s + vol(b), 0)
  const all = boundsOf(parts)!
  const span = Math.max(...[0, 1, 2].map(k => all.max[k]! - all.min[k]!))
  const attached = new Set<number>()
  const floating: number[][] = []
  for (const [gi, isl] of list.entries()) {
    if (gi === 0 || isl.some(i => boxes[i]!.min[1] <= floor)) isl.forEach(i => attached.add(i))
    else floating.push(isl)
  }
  const out = parts.slice() as (Part | null)[]
  // Nearest islands first, so a chain (tooth → jaw rim) can attach through an already snapped one.
  for (const isl of floating) {
    const frac = isl.reduce((s, i) => s + vol(boxes[i]!), 0) / total
    if (frac > maxFrac) {
      res.core = false
      continue
    }
    let best: Vec3 | null = null
    let bestLen = Infinity
    for (const i of isl) {
      const a = boxes[i]!
      for (const j of attached) {
        const b = boxes[j]!
        const t = [0, 1, 2].map(k => a.min[k]! > b.max[k]! ? b.max[k]! - a.min[k]! : b.min[k]! > a.max[k]! ? b.min[k]! - a.max[k]! : 0) as Vec3
        const len = Math.hypot(...t)
        if (len < bestLen) {
          bestLen = len
          best = t
        }
      }
    }
    if (!best || bestLen > maxMove * span) {
      isl.forEach(i => (out[i] = null))
      res.dropped += isl.length
      continue
    }
    for (const i of isl) {
      out[i] = transformPart(parts[i]!, 1, best)
      const b = boxes[i]!
      boxes[i] = { min: [b.min[0] + best[0], b.min[1] + best[1], b.min[2] + best[2]], max: [b.max[0] + best[0], b.max[1] + best[1], b.max[2] + best[2]] } as Box
      attached.add(i)
    }
    res.snapped += isl.length
  }
  res.parts = out.filter((p): p is Part => !!p)
  return res
}

// ---------- fitting to the draft ----------

/** Uniform scale + translation of a part about the origin: at' = at·k + d; every length · k. */
export function transformPart(p: Part, k: number, d: Vec3): Part {
  const q: Part = { ...p, at: [r4(p.at[0] * k + d[0]), r4(p.at[1] * k + d[1]), r4(p.at[2] * k + d[2])], size: p.size.map(n => r4(n * k)) as Vec3 }
  if (p.points) q.points = p.points.map(v => v.map(n => r4(n * k)) as Vec3)
  if (p.radii) q.radii = p.radii.map(n => r4(n * k))
  if (p.profile) q.profile = p.profile.map(([a, b]) => [r4(a * k), r4(b * k)])
  if (p.outline) q.outline = p.outline.map(([a, b]) => [r4(a * k), r4(b * k)])
  if (p.depth !== undefined) q.depth = r4(p.depth * k)
  return q
}

/**
 * Fit a forged object to the draft the player already saw (placement and collision were solved for the
 * draft's footprint): rescale uniformly only if it is off by more than 0.8–1.25×, centre it over the
 * draft's centre and rest it at the draft's lowest point (0 for grounded things, higher for a hovering ship).
 */
export function fitToDraft(parts: Part[], draft: Part[]): { parts: Part[], k: number } {
  const b = boundsOf(parts)
  const d = boundsOf(draft)
  if (!b || !d) return { parts, k: 1 }
  const size = (x: Box) => [0, 1, 2].map(i => Math.max(0.05, x.max[i]! - x.min[i]!))
  const sb = size(b)
  const sd = size(d)
  const ratio = Math.sqrt((sd[1]! / sb[1]!) * (Math.max(sd[0]!, sd[2]!) / Math.max(sb[0]!, sb[2]!)))
  const k = ratio < 0.8 || ratio > 1.25 ? Math.max(0.05, Math.min(20, ratio)) : 1
  const cx = (b.min[0] + b.max[0]) / 2
  const cz = (b.min[2] + b.max[2]) / 2
  const tx = (d.min[0] + d.max[0]) / 2
  const tz = (d.min[2] + d.max[2]) / 2
  const groundY = Math.max(0, d.min[1])
  const off: Vec3 = [tx - cx * k, groundY - b.min[1] * k, tz - cz * k]
  return { parts: parts.map(p => transformPart(p, k, off)), k: r4(k) }
}

// ---------- identity, tiers, library, spend ----------

/** A stable short hash of a part list (the draft's identity: an upgrade's `basis`). */
export function hashParts(parts: Part[]): string {
  let h = 2166136261
  const s = JSON.stringify(parts)
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** Words that ask for the hero tier. */
export const HERO_WORDS = /\b(detailed|intricate(ly)?|masterpiece|ornate|elaborate|exquisite|majestic|realistic|beautiful(ly)?|stunning|highly detailed|lavish)\b/i
/** A follow-up that asks for a better version of something that already stands there. */
export const UPGRADE_WORDS = /\b(make|do|build)\b.{0,24}\b(it|that|this|them|those|these|the \w+)\b.{0,12}\b(better|nicer|more (detailed|intricate|realistic|beautiful|ornate|elaborate)|prettier|fancier|higher quality|perfect)\b|\b(more detail|add (more )?detail|perfect it|refine it|polish it)\b/i

export interface TierInput {
  /** The sentence that made (or asked to improve) the kind. */
  text: string
  kit: boolean
  person?: boolean
  /** Instances of the kind standing in the world. */
  count: number
  /** The kind's current quality, if it was already forged. */
  quality?: Quality
}

/**
 * Which forge tier (if any) a kind earns. Kit kinds and people never forge; crowds (count > 3) never
 * forge; detail words or an explicit "make it better" ask for hero; every other eligible define gets good.
 * Already at (or above) the tier → null (no repeat spend).
 */
export function chooseTier(i: TierInput): Tier | null {
  if (i.kit || i.person || i.count < 1 || i.count > 3) return null
  const tier: Tier = HERO_WORDS.test(i.text) || UPGRADE_WORDS.test(i.text) ? 'hero' : 'good'
  if (i.quality && QUALITY_RANK[i.quality] >= QUALITY_RANK[tier]) return null
  return tier
}

const FILLER = new Set(['a', 'an', 'the', 'some', 'put', 'place', 'make', 'build', 'create', 'conjure', 'give', 'me', 'us', 'please', 'over', 'there', 'here', 'right', 'now', 'i', 'want', 'would', 'like', 'can', 'you', 'of', 'in', 'front', 'next', 'to', 'by', 'it'])
/** Normalised words for a library key: lowercase, no punctuation, no articles or filler. */
export function libKey(text: string): string {
  const words = String(text ?? '').toLowerCase().replace(/[_-]+/g, ' ').replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w && !FILLER.has(w))
  return words.join('_').slice(0, 80) || 'thing'
}

export interface SpendInput {
  total: number
  session: number
  estimate: number
  cap: number
  sessionCap: number
}

/** May a forge call that might cost `estimate` start? */
export function spendDecision(s: SpendInput): { ok: true } | { ok: false, why: string } {
  if (s.total + s.estimate > s.cap) return { ok: false, why: `forge cap: $${s.total.toFixed(2)} of $${s.cap.toFixed(2)} spent` }
  if (s.session + s.estimate > s.sessionCap) return { ok: false, why: `session cap: $${s.session.toFixed(2)} of $${s.sessionCap.toFixed(2)} spent` }
  return { ok: true }
}

/** Is this error the gateway (or our ledger) saying the money ran out? */
export function isBudgetError(message: string): boolean {
  return /budget|spend|limit.*(exceed|reach)|insufficient.*(funds|credit|balance)|credit balance|cap:/i.test(message)
}

// ---------- the draft as a program (what the refiner rewrites) ----------

const n2 = (n: number) => String(Math.round(n * 1000) / 1000)
const arr = (v: number[]) => `[${v.map(n2).join(',')}]`

/** A Haiku draft's parts as lines of the forge program API, so the refiner edits code in its own language. */
export function partsToProgram(parts: Part[]): string {
  return parts.map((p) => {
    const o: string[] = []
    if (p.rot) o.push(`rot:${arr(p.rot)}`)
    if (p.slot) o.push(`slot:'${p.slot}'`)
    if (p.material) o.push(`material:'${p.material}'`)
    const opts = o.length ? `,{${o.join(',')}}` : ''
    const c = `'${p.color}'`
    if (p.shape === 'tube') return `tube([${p.points!.map(arr).join(',')}],${arr(p.radii ?? [0.2])},${c}${opts})`
    if (p.shape === 'lathe') return `lathe([${p.profile!.map(arr).join(',')}],${arr(p.at)},${c}${opts})`
    if (p.shape === 'extrude') return `extrude([${p.outline!.map(arr).join(',')}],${n2(p.depth ?? 0.1)},${arr(p.at)},${c}${opts})`
    return `${p.shape}(${arr(p.size)},${arr(p.at)},${c}${opts})`
  }).join('\n')
}

/** Validate stored forged parts (a library file, a saved world): clean every part again, never trust disk. */
export function cleanParts(raw: unknown): Part[] {
  return Array.isArray(raw) ? programParts(raw) : []
}

// ---------- Gen loop 2: one target size, decided at the spawn ----------

/** The largest side of a part list's bounding box (m), or 0. */
export function maxDim(parts: Part[]): number {
  const b = boundsOf(parts)
  return b ? Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) : 0
}

/**
 * The uniform scale that holds a (streaming) object to its target size S. While parts still stream it only
 * ever shrinks (the head and tail that arrive later never make it jump bigger); once complete it also
 * grows something that came out well under size (< 0.6 S).
 */
export function sizeK(parts: Part[], S: number | undefined, complete: boolean): number {
  const m = maxDim(parts)
  if (!S || m <= 0) return 1
  if (m > S) return r4(S / m)
  return complete && m < S * 0.6 ? r4(S / m) : 1
}
