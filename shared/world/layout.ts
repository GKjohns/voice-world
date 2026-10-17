/**
 * The placement resolver: anchor + count + arrangement → ground positions, with jitter, footprint
 * de-overlap and facing. The model says "nine pines, clustered, over there"; this does all the coordinate math.
 */
import type { KindDescriptor } from './kinds.ts'
import type { Arrangement, Facing, Placement, Vec3 } from './ops.ts'
import { distXZ, entityHeight, entityRadius, kindOf, select } from './select.ts'
import type { Entity, OpContext, WorldState } from './types.ts'

export interface Placed {
  pos: Vec3
  rotY: number
  scale: number
  hue: number
}

export interface LayoutSpec {
  desc: KindDescriptor
  count: number
  arrange?: Arrangement
  at?: Placement
  radius?: number
  vary?: number
  facing?: Facing
  /** Director room placement: [x, z] in the room frame (see roomToWorld). Overrides `at`, skips de-overlap. */
  xz?: number[]
  /** Degrees in the room frame; 0 = front faces +z (back toward the player's teleport spot). */
  yaw?: number
}

export interface Anchor {
  center: Vec3
  target?: Entity
  ringRadius?: number // set by side:'around'
  onTop?: boolean
  note?: string
}

const PLAYER_RADIUS = 1.5 // nothing lands on top of the viewer
const PLAYER_CLEAR = 2.5 // gaze-anchored groups keep their near edge this far from the viewer
const TAU = Math.PI * 2

/** mulberry32: tiny, fast and good enough for jitter. Seeded so replaying a log rebuilds the same world. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export function forward(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)]
}

export function right(yaw: number): [number, number] {
  return [Math.cos(yaw), -Math.sin(yaw)]
}

/**
 * The Director's room frame → world. Origin = the player's feet when the teleport was asked for, -z = the
 * way they faced, +x = their right. It's a rotation by the player's yaw, so `yaw: 0` objects face back
 * toward the origin and a recipe reads the same whichever way the player happened to be looking.
 */
export function roomToWorld(xz: number[], player: OpContext['player']): Vec3 {
  const x = xz[0] ?? 0
  const z = xz[1] ?? 0
  const c = Math.cos(player.yaw)
  const s = Math.sin(player.yaw)
  return [player.pos[0] + x * c + z * s, 0, player.pos[2] - x * s + z * c]
}

/** rotY that turns an object's front (+z local) toward a point. */
export function faceToward(from: Vec3, to: Vec3): number {
  return Math.atan2(to[0] - from[0], to[2] - from[2])
}

export function resolveAnchor(state: WorldState, at: Placement | undefined, ctx: OpContext, selfRadius: number): Anchor {
  const place = at ?? { anchor: 'gaze' as const }
  const { player } = ctx
  if (place.anchor === 'player') {
    const d = place.dist ?? 6 + selfRadius
    const f = forward(player.yaw)
    const r = right(player.yaw)
    const dir: [number, number] = place.dir === 'behind'
      ? [-f[0], -f[1]]
      : place.dir === 'left' ? [-r[0], -r[1]] : place.dir === 'right' ? r : f
    return { center: [player.pos[0] + dir[0] * d, 0, player.pos[2] + dir[1] * d] }
  }

  if (place.anchor === 'target') {
    const pool = place.of ? select(state, place.of, ctx) : []
    // Of several matches ("next to the bar" with two bars), take the one nearest where you're looking.
    const target = [...pool].sort((a, b) => distXZ(a.pos, ctx.gaze.point) - distXZ(b.pos, ctx.gaze.point))[0]
    if (target) return besideTarget(state, target, place, ctx, selfRadius)
    const fallback = gazeAnchor(ctx)
    return { ...fallback, note: `no target matches ${JSON.stringify(place.of ?? {})}; placed at gaze` }
  }

  return gazeAnchor(ctx)
}

function gazeAnchor(ctx: OpContext): Anchor {
  // Looking at an object means "next to it". The hit point sits on its near face, so de-overlap
  // pushes the new thing out toward the viewer rather than behind the object.
  const g = ctx.gaze.point
  return { center: [g[0], 0, g[2]] }
}

function besideTarget(state: WorldState, target: Entity, place: Placement, ctx: OpContext, selfRadius: number): Anchor {
  const tr = entityRadius(state, target)
  const gap = place.gap ?? 0.5
  const off = tr + selfRadius + gap
  if (place.side === 'on_top') return { center: [target.pos[0], entityHeight(state, target), target.pos[2]], target, onTop: true }
  if (place.side === 'around') return { center: [target.pos[0], 0, target.pos[2]], target, ringRadius: off }
  // Sides read from where the player stands: "to the right of the bar" is your right, not the bar's.
  const toPlayer = norm2(ctx.player.pos[0] - target.pos[0], ctx.player.pos[2] - target.pos[2])
  const r = right(ctx.player.yaw)
  const dir: [number, number] = place.side === 'left'
    ? [-r[0], -r[1]]
    : place.side === 'right' ? r : place.side === 'behind' ? [-toPlayer[0], -toPlayer[1]] : toPlayer
  const d = place.dist ?? off
  return { center: [target.pos[0] + dir[0] * d, 0, target.pos[2] + dir[1] * d], target }
}

/** Lay out `count` instances. Positions are de-overlapped against the world and each other. */
export function layout(state: WorldState, spec: LayoutSpec, ctx: OpContext, rand: () => number): { placed: Placed[], notes: string[] } {
  const { desc } = spec
  const n = Math.max(1, Math.round(spec.count))
  const r = desc.footprint
  const notes: string[] = []
  const room = spec.xz && spec.xz.length >= 2
  const anchor: Anchor = room ? { center: roomToWorld(spec.xz!, ctx.player) } : resolveAnchor(state, spec.at, ctx, r)
  if (anchor.note) notes.push(anchor.note)
  const vary = spec.vary ?? (n > 1 ? (desc.randomYaw ? 0.3 : 0.15) : 0)
  let arrange: Arrangement | 'single' = spec.arrange ?? (anchor.ringRadius ? 'ring' : 'cluster')
  if (n === 1 && arrange !== 'along') arrange = 'single'

  const gap = spec.at?.gap ?? (r > 0 ? 0.6 * r + 0.3 : 1)
  const spacing = Math.max(1, 2 * r + gap)
  const yaw = ctx.player.yaw
  const rv = right(yaw)
  const fv = forward(yaw)
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  const R = arrange === 'cluster'
    ? spec.radius ?? Math.max(2 * r, r * Math.sqrt(n) * 1.6)
    : arrange === 'scatter'
      ? spec.radius ?? Math.max(8, Math.max(r, 1) * Math.sqrt(n) * 3.5)
      : arrange === 'ring' ? spec.radius ?? anchor.ringRadius ?? Math.max(spacing * n / TAU, 2 * r + 1) : 0

  // "Over there" must never swallow the viewer. Big things need more room before they stop looming
  // (a house wants ~10 m, a pine ~5 m). Clusters keep their centre on the gaze and fill the far side of
  // the disc instead; rings, grids and long things shift back until their near edge is clear.
  const gazeAnchored = !room && (spec.at?.anchor ?? 'gaze') === 'gaze'
  const clear = r + PLAYER_CLEAR + 1.5 * r
  const extent = arrange === 'single'
    ? (desc.length ? desc.length / 2 : 0)
    : arrange === 'grid' ? Math.hypot(cols, rows) * spacing / 2 : arrange === 'ring' ? R : 0
  const c: Vec3 = [...anchor.center]
  if (gazeAnchored && r + extent > 0) {
    const d = distXZ(c, ctx.player.pos)
    const need = extent + clear
    if (d < need) {
      const dir = d > 1e-3 ? norm2(c[0] - ctx.player.pos[0], c[2] - ctx.player.pos[2]) : forward(yaw)
      c[0] = ctx.player.pos[0] + dir[0] * need
      c[2] = ctx.player.pos[2] + dir[1] * need
    }
  }
  let pts: Vec3[] = []
  let faceAxis: { origin: Vec3, dir: [number, number] } | undefined

  if (arrange === 'single') {
    pts = [[c[0], c[1], c[2]]]
  } else if (arrange === 'cluster' || arrange === 'scatter') {
    const minSep = arrange === 'cluster' ? 2 * r * 1.05 : 2 * r * 1.6
    pts = poissonDisc(c, R, n, minSep, rand, gazeAnchored ? { pos: ctx.player.pos, r: clear } : undefined)
  } else if (arrange === 'line') {
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * spacing
      pts.push([c[0] + rv[0] * t, 0, c[2] + rv[1] * t])
    }
    faceAxis = { origin: c, dir: rv }
  } else if (arrange === 'ring') {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU
      pts.push([c[0] + Math.cos(a) * R, 0, c[2] + Math.sin(a) * R])
    }
  } else if (arrange === 'grid') {
    for (let i = 0; i < n; i++) {
      const u = (i % cols - (cols - 1) / 2) * spacing
      const v = (Math.floor(i / cols) - (rows - 1) / 2) * spacing
      pts.push([c[0] + rv[0] * u + fv[0] * v, 0, c[2] + rv[1] * u + fv[1] * v])
    }
  } else {
    const along = alongPoints(state, { ...anchor, center: c }, ctx, n, r, spacing)
    if (along.note) notes.push(along.note)
    pts = along.pts
    faceAxis = along.axis
  }
  if (anchor.onTop) pts = pts.map(p => [p[0], c[1], p[2]])

  // Room placements face the room frame's +z unless told otherwise (an explicit yaw always wins).
  const roomYaw = room ? yaw + ((spec.yaw ?? 0) * Math.PI) / 180 : undefined
  const facing: Facing | 'uniform' = room && spec.yaw !== undefined
    ? 'uniform'
    : spec.facing ?? (desc.randomYaw ? 'random' : arrange === 'ring' ? 'center' : arrange === 'along' ? 'along' : room || arrange === 'line' || arrange === 'grid' ? 'uniform' : 'player')
  const uniformYaw = roomYaw ?? faceToward(c, ctx.player.pos)

  const placed: Placed[] = pts.map((p) => {
    const regular = arrange !== 'cluster' && arrange !== 'scatter' && arrange !== 'single'
    const jitter = regular ? vary * Math.max(r, 0.5) * 0.5 : 0
    const pos: Vec3 = [p[0] + (rand() * 2 - 1) * jitter, p[1], p[2] + (rand() * 2 - 1) * jitter]
    const scale = Math.max(0.4, 1 + (rand() * 2 - 1) * vary * 0.6)
    const hue = (rand() * 2 - 1) * vary * 0.08
    let rotY: number
    if (facing === 'random') rotY = rand() * TAU
    else if (facing === 'center') rotY = faceAxis ? faceAxisYaw(pos, faceAxis) : faceToward(pos, c)
    else if (facing === 'along') rotY = faceAxis ? faceAxisYaw(pos, faceAxis) : Math.atan2(rv[0], rv[1])
    else if (facing === 'uniform') rotY = uniformYaw
    else rotY = faceToward(pos, ctx.player.pos)
    if (facing !== 'random' && !(room && spec.yaw !== undefined)) rotY += (rand() * 2 - 1) * vary * 0.3
    return { pos, rotY, scale: round(scale, 3), hue: round(hue, 4) }
  })

  // The Director lays rooms out by hand (a lamp hangs over its table on purpose), so room placements never get pushed.
  if (!room && !anchor.onTop && r > 0) deOverlap(state, placed, r, ctx, new Set(), rand)
  for (const p of placed) p.pos = [round(p.pos[0], 3), round(p.pos[1], 3), round(p.pos[2], 3)]
  return { placed, notes }
}

/** Instances along a long thing (a road): both sides, evenly spaced, set back from its edge. */
function alongPoints(state: WorldState, anchor: Anchor, ctx: OpContext, n: number, r: number, spacing: number) {
  let target = anchor.target
  if (!target) {
    // "along the road" with no explicit target: the nearest long thing to where you're looking.
    target = state.entities
      .filter(e => kindOf(state, e.kind).length)
      .sort((a, b) => distXZ(a.pos, ctx.gaze.point) - distXZ(b.pos, ctx.gaze.point))[0]
  }
  if (!target) {
    const rv = right(ctx.player.yaw)
    const c = anchor.center
    const pts: Vec3[] = []
    for (let i = 0; i < n; i++) {
      const t = (i - (n - 1) / 2) * spacing
      pts.push([c[0] + rv[0] * t, 0, c[2] + rv[1] * t])
    }
    return { pts, axis: { origin: c, dir: rv }, note: 'nothing long to follow; laid out in a line' }
  }
  const desc = kindOf(state, target.kind)
  const s = target.props.scale ?? 1
  const length = (desc.length ?? Math.max(spacing * n / 2, 10)) * s
  const width = (desc.width ?? 2 * desc.footprint) * s
  const dir: [number, number] = [Math.sin(target.rotY), Math.cos(target.rotY)]
  const side: [number, number] = [dir[1], -dir[0]]
  const offset = width / 2 + r + 0.6
  const perSide = n === 1 ? 1 : Math.ceil(n / 2)
  const pts: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const k = n === 1 ? 0 : Math.floor(i / 2)
    const sign = n === 1 || i % 2 === 0 ? 1 : -1
    // Stagger the two sides by half a step so the rows read as planted, not mirrored.
    const t = -length / 2 + ((k + (sign > 0 ? 0.5 : 0.75)) * length) / perSide
    pts.push([target.pos[0] + dir[0] * t + side[0] * offset * sign, 0, target.pos[2] + dir[1] * t + side[1] * offset * sign])
  }
  return { pts, axis: { origin: target.pos, dir }, note: undefined }
}

/** Face the nearest point on an axis (lamps along a road look at the road). */
function faceAxisYaw(p: Vec3, axis: { origin: Vec3, dir: [number, number] }): number {
  const dx = p[0] - axis.origin[0]
  const dz = p[2] - axis.origin[2]
  const t = dx * axis.dir[0] + dz * axis.dir[1]
  const foot: Vec3 = [axis.origin[0] + axis.dir[0] * t, 0, axis.origin[2] + axis.dir[1] * t]
  if (distXZ(p, foot) < 1e-6) return Math.atan2(axis.dir[0], axis.dir[1])
  return faceToward(p, foot)
}

/** Rejection-sampled points in a disc with a minimum separation; best effort when the disc is too small. */
/**
 * Rejection-sampled points in a disc with a minimum separation and an optional keep-out circle (the
 * viewer). Best effort when the disc is too small; de-overlap cleans up after it.
 */
function poissonDisc(c: Vec3, R: number, n: number, minSep: number, rand: () => number, avoid?: { pos: Vec3, r: number }): Vec3[] {
  const pts: Vec3[] = []
  for (let i = 0; i < n; i++) {
    let best: Vec3 = [c[0], 0, c[2]]
    let bestScore = -Infinity
    for (let k = 0; k < 40; k++) {
      // The first instance tries the anchor itself so a cluster lands where you looked.
      const rr = i === 0 && k === 0 ? 0 : R * Math.sqrt(rand())
      const a = rand() * TAU
      const p: Vec3 = [c[0] + Math.cos(a) * rr, 0, c[2] + Math.sin(a) * rr]
      const sep = pts.reduce((m, q) => Math.min(m, distXZ(p, q)), Infinity)
      const keepOut = avoid ? distXZ(p, avoid.pos) - avoid.r : Infinity
      if (sep >= minSep && keepOut >= 0) {
        best = p
        break
      }
      const score = Math.min(sep - minSep, keepOut)
      if (score > bestScore) {
        best = p
        bestScore = score
      }
    }
    pts.push(best)
  }
  return pts
}

interface Obstacle { pos: Vec3, r: number }

/**
 * Push new instances out of existing footprints (and each other, and the player). Pairwise pushes first;
 * if that stalls in a crowd, a spiral search guarantees a free spot.
 */
export function deOverlap(state: WorldState, placed: Placed[], baseRadius: number, ctx: OpContext, ignore: Set<string>, rand: () => number): void {
  const obstacles: Obstacle[] = state.entities
    .filter(e => !ignore.has(e.id))
    .map(e => ({ pos: e.pos, r: entityRadius(state, e) }))
    .filter(o => o.r > 0)
  obstacles.push({ pos: ctx.player.pos, r: PLAYER_RADIUS })

  for (const p of placed) {
    const self = baseRadius * p.scale
    const clash = () => obstacles.find(o => distXZ(o.pos, p.pos) < o.r + self - 1e-6)
    for (let tries = 0; tries < 24; tries++) {
      const o = clash()
      if (!o) break
      const d = distXZ(o.pos, p.pos)
      const dir = d < 1e-6 ? angleDir(rand() * TAU) : [(p.pos[0] - o.pos[0]) / d, (p.pos[2] - o.pos[2]) / d]
      const push = o.r + self - d + 0.05
      p.pos = [p.pos[0] + dir[0]! * push, p.pos[1], p.pos[2] + dir[1]! * push]
    }
    if (clash()) {
      const origin = p.pos
      search: for (let ring = 1; ring < 200; ring++) {
        const rr = ring * Math.max(self, 0.3) * 0.6
        const start = rand() * TAU
        for (let k = 0; k < 16; k++) {
          const a = start + (k / 16) * TAU
          p.pos = [origin[0] + Math.cos(a) * rr, origin[1], origin[2] + Math.sin(a) * rr]
          if (!clash()) break search
        }
      }
    }
    obstacles.push({ pos: p.pos, r: self })
  }
}

function angleDir(a: number): [number, number] {
  return [Math.cos(a), Math.sin(a)]
}

function norm2(x: number, z: number): [number, number] {
  const d = Math.hypot(x, z)
  return d < 1e-6 ? [0, 1] : [x / d, z / d]
}

function round(v: number, places: number): number {
  const k = 10 ** places
  return Math.round(v * k) / k
}
