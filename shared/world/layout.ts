/**
 * The placement resolver: anchor + count + arrangement → ground positions, with jitter, footprint
 * de-overlap and facing. The model says "nine pines, clustered, over there"; this does all the coordinate math.
 */
import { isTerrain, kindHeight } from './kinds.ts'
import type { KindDescriptor } from './kinds.ts'
import type { Arrangement, Facing, Placement, Props, Vec3 } from './ops.ts'
import { distXZ, entityHeight, entityRadius, kindOf, select } from './select.ts'
import { groundHeight, groundUnder } from './terrain.ts'
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
  /** The spawn's `set` props: scale, floors and height make it bigger, so it needs more room and distance. */
  props?: Props
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
/** The renderer's vertical field of view; placement keeps a wish inside 86% of it (the camera tilts to fit). */
export const VIEW_VFOV = (65 * Math.PI) / 180
const FRAME_SPAN = VIEW_VFOV * 0.86

/**
 * How far back you must stand (from the thing's near edge) to see a `height`-metre thing from its foot
 * to its top within 86% of the view, tilting the camera as needed. 0 for things shorter than eye height.
 */
export function fitDistance(height: number, eye = 1.6): number {
  if (height <= eye + 0.5) return 0
  const span = (d: number) => Math.atan((height - eye) / d) + Math.atan(eye / d)
  let lo = 0.05
  let hi = 4000
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2
    if (span(mid) > FRAME_SPAN) lo = mid
    else hi = mid
  }
  return hi
}

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
  // A giant pine is a bigger pine: its footprint (spacing, clearance, de-overlap) and height scale with it.
  const r = desc.footprint * (spec.props?.scale ?? 1)
  const tall = kindHeight(desc, spec.props ?? {})
  const notes: string[] = []
  const room = spec.xz && spec.xz.length >= 2
  const terrain = isTerrain(desc)
  const horizon = !room && spec.at?.anchor === 'horizon'
  // "Around me": anchor player (or horizon) with dir around spreads the spawn 360° around the viewer.
  const around = !room && spec.at?.dir === 'around' && (spec.at.anchor === 'player' || horizon)
  const anchor: Anchor = room
    ? { center: roomToWorld(spec.xz!, ctx.player) }
    : horizon || around ? { center: [ctx.player.pos[0], 0, ctx.player.pos[2]] } : resolveAnchor(state, spec.at, ctx, r)
  if (anchor.note) notes.push(anchor.note)
  // Loop 2: things with an altitude live in the air. They never collide with the ground's things, never
  // need pushing back to fit foot-to-top, and a scattered flock spreads wide.
  const alt = spec.props?.altitude
  const airborne = alt !== undefined && alt !== 0 && !anchor.onTop
  const vary = spec.vary ?? (n > 1 ? (desc.randomYaw ? 0.3 : 0.15) : 0)
  let arrange: Arrangement | 'single' = spec.arrange ?? (anchor.ringRadius ? 'ring' : 'cluster')
  if (n === 1 && arrange !== 'along') arrange = 'single'
  const stack = arrange === 'stack'

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
      ? spec.radius ?? (airborne ? Math.max(30, Math.sqrt(n) * 6) : Math.max(8, Math.max(r, 1) * Math.sqrt(n) * 3.5))
      : arrange === 'ring' ? spec.radius ?? anchor.ringRadius ?? Math.max(spacing * n / TAU, 2 * r + 1) : 0

  // "Over there" must never swallow the viewer. Big things need more room before they stop looming
  // (a house wants ~10 m, a pine ~5 m). Clusters keep their centre on the gaze and fill the far side of
  // the disc instead; rings, grids and long things shift back until their near edge is clear.
  // Tall things also get pushed back until foot-to-top fits the view: "a giant tower right there" lands
  // far enough off that you see all of it, not a wall 3 m away with its top cut off.
  const anchorKind = spec.at?.anchor ?? 'gaze'
  const gazeAnchored = !room && !horizon && !around && (anchorKind === 'gaze' || (anchorKind === 'player' && spec.at?.dist === undefined))
  // Terrain is big by nature: it only needs its edge clear of you, not 1.5 footprints of breathing room.
  const clear = terrain ? r + PLAYER_CLEAR + 4 : r + PLAYER_CLEAR + 1.5 * r
  const extent = arrange === 'single'
    ? (desc.length ? desc.length / 2 : 0)
    : arrange === 'grid' ? Math.hypot(cols, rows) * spacing / 2 : arrange === 'ring' ? R : 0
  const c: Vec3 = [...anchor.center]
  // "Right in front of me" (anchor player, an explicit few metres): honour the distance, but never inside
  // you, and a big thing still steps back until all of it fits the view (a giant robot "in front of me").
  const nearPlayer = !room && !horizon && !around && anchorKind === 'player' && spec.at?.dist !== undefined && spec.at.dir !== 'around'
  if (nearPlayer && r + extent > 0 && !airborne) {
    const d = distXZ(c, ctx.player.pos)
    const eye = Math.max(0.3, (ctx.player.pos[1] || 1.6) - groundHeight(state, ctx.player.pos[0], ctx.player.pos[2]))
    const need = Math.max(extent + r + 1.2, tall > eye + 0.5 ? extent + r + fitDistance(tall, eye) : 0)
    if (d < need) {
      const dir = d > 1e-3 ? norm2(c[0] - ctx.player.pos[0], c[2] - ctx.player.pos[2]) : forward(yaw)
      c[0] = ctx.player.pos[0] + dir[0] * need
      c[2] = ctx.player.pos[2] + dir[1] * need
    }
  }
  if (gazeAnchored && r + extent > 0) {
    const d = distXZ(c, ctx.player.pos)
    const need = airborne ? extent + clear : Math.max(extent + clear, extent + r + fitDistance(tall, Math.max(0.3, (ctx.player.pos[1] || 1.6) - groundHeight(state, ctx.player.pos[0], ctx.player.pos[2]))))
    if (d < need) {
      const dir = d > 1e-3 ? norm2(c[0] - ctx.player.pos[0], c[2] - ctx.player.pos[2]) : forward(yaw)
      c[0] = ctx.player.pos[0] + dir[0] * need
      c[2] = ctx.player.pos[2] + dir[1] * need
    }
  }
  // Indoors (a ceiling over the anchor, or over you), the "sky" is the room: lanterns fill it under the lid.
  const lid = airborne && !horizon ? ceilingOver(state, c[0], c[2]) ?? ceilingOver(state, ctx.player.pos[0], ctx.player.pos[2]) : null
  // Loop 3: "fill the sky" outdoors is a dome of lights in front of you, in the band you can see.
  const dome = airborne && alt === 'sky' && n >= 6 && !lid && !room && !around && !anchor.onTop
    && (arrange === 'scatter' || arrange === 'cluster') && (anchorKind === 'player' || anchorKind === 'gaze')
  let domeY: number[] | null = null
  let pts: Vec3[] = []
  let faceAxis: { origin: Vec3, dir: [number, number] } | undefined

  if (horizon) {
    pts = horizonPoints(spec, ctx, n, r, tall, around, rand)
  } else if (around && arrange !== 'ring') {
    pts = annulusPoints(ctx.player.pos, n, r, spacing, spec, rand)
  } else if (dome) {
    const away = distXZ(c, ctx.player.pos)
    const sky = skyDome(ctx.player.pos, away > 3 ? norm2(c[0] - ctx.player.pos[0], c[2] - ctx.player.pos[2]) : forward(yaw), n, rand)
    pts = sky.pts
    domeY = sky.ys
  } else if (arrange === 'single' || stack) {
    pts = stack ? Array.from({ length: n }, () => [c[0], c[1], c[2]] as Vec3) : [[c[0], c[1], c[2]]]
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
  // On top of a hill or mountain means on its surface (the terrain snap below), not at one flat height.
  const onSurface = !!(anchor.onTop && anchor.target && kindOf(state, anchor.target.kind).surface)
  if (anchor.onTop) pts = pts.map(p => [p[0], onSurface ? 0 : c[1], p[2]])

  // Room placements face the room frame's +z unless told otherwise (an explicit yaw always wins).
  const roomYaw = room ? yaw + ((spec.yaw ?? 0) * Math.PI) / 180 : undefined
  const facing: Facing | 'uniform' = room && spec.yaw !== undefined
    ? 'uniform'
    : spec.facing ?? (desc.randomYaw ? 'random' : arrange === 'ring' ? 'center' : arrange === 'along' ? 'along' : room || arrange === 'line' || arrange === 'grid' ? 'uniform' : 'player')
  const uniformYaw = roomYaw ?? faceToward(c, ctx.player.pos)

  const placed: Placed[] = pts.map((p) => {
    const regular = arrange !== 'cluster' && arrange !== 'scatter' && arrange !== 'single' && !stack
    // A stack is slightly offset like a real one (a hand-stacked pile is never a perfect column).
    const jitter = stack ? Math.max(r, 0.3) * 0.08 : regular ? vary * Math.max(r, 0.5) * 0.5 : 0
    const pos: Vec3 = [p[0] + (rand() * 2 - 1) * jitter, p[1], p[2] + (rand() * 2 - 1) * jitter]
    const scale = stack ? 1 : Math.max(0.4, 1 + (rand() * 2 - 1) * vary * 0.6)
    const hue = (rand() * 2 - 1) * vary * 0.08
    let rotY: number
    if (facing === 'random') rotY = rand() * TAU
    else if (facing === 'center') rotY = faceAxis ? faceAxisYaw(pos, faceAxis) : faceToward(pos, c)
    else if (facing === 'along') rotY = faceAxis ? faceAxisYaw(pos, faceAxis) : Math.atan2(rv[0], rv[1])
    else if (facing === 'uniform') rotY = uniformYaw
    else rotY = faceToward(pos, ctx.player.pos)
    if (facing !== 'random' && !(room && spec.yaw !== undefined)) rotY += (rand() * 2 - 1) * vary * 0.3
    if (stack) rotY += (rand() * 2 - 1) * 0.18
    return { pos, rotY, scale: round(scale, 3), hue: round(hue, 4) }
  })

  // The Director lays rooms out by hand (a lamp hangs over its table on purpose), so room placements never get pushed.
  if (stack) {
    // One column: the base finds a free spot (or the top of whatever it is stacked on), the rest ride on it.
    const base = placed[0]!
    const b0: Vec3 = [...base.pos]
    if (!room && !anchor.onTop && !terrain && !airborne && r > 0) deOverlap(state, [base], r, ctx, new Set(), rand)
    const y0 = anchor.onTop && !onSurface ? c[1] : supportAt(state, base.pos[0], base.pos[2], r)
    const each = tall
    const sx = base.pos[0] - b0[0]
    const sz = base.pos[2] - b0[2]
    placed.forEach((p, i) => {
      p.pos = i ? [p.pos[0] + sx, y0 + i * each, p.pos[2] + sz] : [p.pos[0], y0, p.pos[2]]
    })
  } else if (!room && !anchor.onTop && !terrain && !airborne && r > 0) deOverlap(state, placed, r, ctx, new Set(), rand)
  if (airborne) {
    for (const [i, p] of placed.entries()) {
      if (lid && !underLid(lid, p.pos[0], p.pos[2])) p.pos = insideLid(lid, rand)
      // Loop 3: small things floating indoors are smaller (a room of wish lanterns, not a wall of them).
      if (lid && tall < 3) p.scale = round(p.scale * 0.45, 3)
      const y = domeY?.[i] ?? altitudeY(alt, rand, n)
      p.pos = [p.pos[0], p.pos[1] + capAltitude(state, p.pos[0], p.pos[2], y, tall * (lid ? p.scale : 1), rand), p.pos[2]]
    }
  }
  // Terrain snap: anything spawned over a hill, mountain or cliff stands on its surface.
  if (!terrain && !(anchor.onTop && !onSurface) && !stack) {
    for (const p of placed) p.pos = [p.pos[0], p.pos[1] + groundUnder(state, p.pos[0], p.pos[2], r * p.scale), p.pos[2]]
  }
  for (const p of placed) p.pos = [round(p.pos[0], 3), round(p.pos[1], 3), round(p.pos[2], 3)]
  return { placed, notes }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Gauntlet loop 1, physics-lite: the height something of radius `r` comes to rest at over (x, z). The
 * terrain, or the top of the highest solid thing under it (its bounding box: footprint circle × height),
 * so a dropped crate lands on the table and a stack rests on the crate below. Flat kinds (floors, rugs,
 * roads), terrain and things in the air are never a support; `ignore` skips the falling things themselves.
 */
export function supportAt(state: WorldState, x: number, z: number, r = 0.5, ignore: Set<string> = new Set(), accept?: (e: Entity) => boolean): number {
  let top = groundUnder(state, x, z, r)
  for (const e of state.entities) {
    if (ignore.has(e.id) || e.kind === 'person') continue
    const d = kindOf(state, e.kind)
    if (d.surface || isTerrain(d) || d.footprint <= 0 || d.tags.includes('particles')) continue
    if (e.props.motion && e.props.motion !== 'none') continue
    if (e.props.altitude !== undefined && e.props.altitude !== 0) continue
    const er = entityRadius(state, e)
    if (distXZ(e.pos, [x, 0, z]) > er * 0.9 + r * 0.4) continue
    if (accept && !accept(e)) continue
    top = Math.max(top, e.pos[1] + entityHeight(state, e))
  }
  return round(top, 3)
}

/** The sky band: 'sky' spreads a flock 15–45 m up (one thing floats at ~24 m); a number jitters ±20% (≤ 6 m) in a group. */
export const SKY_BAND: [number, number] = [15, 45]

/** Height above the ground for one instance of a spawn (or modify) with `altitude`. Seeded by `rand`. */
export function altitudeY(alt: number | 'sky' | undefined, rand: () => number, n: number): number {
  if (alt === undefined || alt === 0) return 0
  if (alt === 'sky') return round(n > 1 ? SKY_BAND[0] + rand() * (SKY_BAND[1] - SKY_BAND[0]) : 24, 2)
  if (n <= 1) return alt
  return round(Math.max(0.3, alt + (rand() * 2 - 1) * Math.min(alt * 0.2, 6)), 2)
}

/** An interior's lid: a ceiling (or roof) entity, the height of its underside and its half-extents. */
export interface Lid { e: Entity, y: number, hx: number, hz: number }

const DEG = Math.PI / 180
/** "Fill the sky" outdoors (Loop 3): most of the flock in a ±55° wedge ahead, 10–35° above the eye, 16–90 m out. */
export const SKY_DOME = { wedge: 55 * DEG, elev: [10 * DEG, 35 * DEG] as [number, number], dist: [16, 90] as [number, number] }

/**
 * A sky flock laid out for the eye: low-discrepancy azimuth and height (no clumps, no gaps), each lantern's
 * distance picked so its elevation lands in the visible band. One in seven goes anywhere around you, so
 * turning round still finds lights. Heights stay inside SKY_BAND. Returns ground points and heights.
 */
export function skyDome(origin: Vec3, dir: [number, number], n: number, rand: () => number): { pts: Vec3[], ys: number[] } {
  const eye = 1.6
  const { wedge, elev, dist } = SKY_DOME
  const r0 = rand()
  const r1 = rand()
  const pts: Vec3[] = []
  const ys: number[] = []
  for (let i = 0; i < n; i++) {
    const u = (r0 + i * 0.7548776662) % 1
    const w = (r1 + i * 0.5698402910) % 1
    const a = i % 7 === 6 ? (u * 2 - 1) * Math.PI : (u * 2 - 1) * wedge
    const y = SKY_BAND[0] + w * (SKY_BAND[1] - 1 - SKY_BAND[0])
    const lo = Math.max(elev[0], Math.atan2(y - eye, dist[1]))
    const hi = Math.min(elev[1], Math.atan2(y - eye, dist[0]))
    const d = (y - eye) / Math.tan(lo + rand() * Math.max(0, hi - lo))
    const ca = Math.cos(a)
    const sa = Math.sin(a)
    pts.push([origin[0] + (dir[0] * ca - dir[1] * sa) * d, 0, origin[2] + (dir[0] * sa + dir[1] * ca) * d])
    ys.push(round(y, 2))
  }
  return { pts, ys }
}

/** The lowest ceiling or roof over (x, z), else null. Interiors have a low "sky". */
export function ceilingOver(state: WorldState, x: number, z: number): Lid | null {
  let best: Lid | null = null
  for (const e of state.entities) {
    const d = kindOf(state, e.kind)
    if (!d.tags.includes('ceiling') && !d.tags.includes('roof')) continue
    const s = e.props.scale ?? 1
    const lid: Lid = {
      e,
      y: e.pos[1] + kindHeight(d, e.props) * 0.9, // the beams hang ~10% below the slab
      hx: ((e.props.length ?? d.defaults.length ?? 16) * s) / 2,
      hz: ((e.props.width ?? d.defaults.width ?? 16) * s) / 2
    }
    if (underLid(lid, x, z) && (!best || lid.y < best.y)) best = lid
  }
  return best
}

function lidLocal(lid: Lid, x: number, z: number): [number, number] {
  const c = Math.cos(lid.e.rotY)
  const sn = Math.sin(lid.e.rotY)
  const dx = x - lid.e.pos[0]
  const dz = z - lid.e.pos[2]
  return [dx * c - dz * sn, dx * sn + dz * c]
}

function underLid(lid: Lid, x: number, z: number): boolean {
  const [lx, lz] = lidLocal(lid, x, z)
  return Math.abs(lx) <= lid.hx && Math.abs(lz) <= lid.hz
}

/** A random spot inside the room under `lid`, 0.6 m in from its walls. */
function insideLid(lid: Lid, rand: () => number): Vec3 {
  const lx = (rand() * 2 - 1) * Math.max(0, lid.hx - 0.6)
  const lz = (rand() * 2 - 1) * Math.max(0, lid.hz - 0.6)
  const c = Math.cos(lid.e.rotY)
  const sn = Math.sin(lid.e.rotY)
  return [lid.e.pos[0] + lx * c + lz * sn, 0, lid.e.pos[2] - lx * sn + lz * c]
}

/**
 * Keep a floating thing of height `tall` under any ceiling over (x, z): an altitude that would poke through
 * is re-spread between head height and just under the lid, so "fill the room with lanterns" fills the room.
 */
export function capAltitude(state: WorldState, x: number, z: number, y: number, tall: number, rand: () => number): number {
  if (y <= 0) return y
  const lid = ceilingOver(state, x, z)
  if (!lid) return y
  const hi = Math.max(0.3, lid.y - tall - 0.25)
  if (y <= hi) return y
  const lo = Math.min(hi, 1.9)
  return round(lo + rand() * (hi - lo), 2)
}

/** The horizon distance for a thing this big: far enough to read whole, near enough to tower. */
export function horizonDistance(r: number, tall: number, dist?: number): number {
  return clamp(dist ?? Math.max(380, r + fitDistance(tall) * 1.15), 250, 1400)
}

/**
 * anchor horizon: 300–1200 m out in the facing direction (dir turns it), spread over 120° of view for a
 * count, or a full ring with dir around. Nearer and farther by ±15% so a ring of peaks doesn't look drawn
 * with a compass.
 */
function horizonPoints(spec: LayoutSpec, ctx: OpContext, n: number, r: number, tall: number, around: boolean, rand: () => number): Vec3[] {
  const D = horizonDistance(r, tall, spec.at?.dist)
  const turn = { ahead: 0, left: Math.PI / 2, right: -Math.PI / 2, behind: Math.PI, around: 0 }[spec.at?.dir ?? 'ahead']
  const base = ctx.player.yaw + turn
  const spread = around ? TAU : Math.min(TAU / 3, n > 1 ? (n * 2.2 * r) / D : 0)
  const start = around ? rand() * TAU : 0
  const pts: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const off = around ? start + (i / n) * TAU : n === 1 ? 0 : (i / (n - 1) - 0.5) * spread
    const jitter = n === 1 ? 0 : (rand() * 2 - 1) * (around ? TAU / n : spread / Math.max(1, n - 1)) * 0.2
    const d = D * (n === 1 ? 1 : 0.85 + 0.3 * rand())
    const f = forward(base + off + jitter)
    pts.push([ctx.player.pos[0] + f[0] * d, 0, ctx.player.pos[2] + f[1] * d])
  }
  return pts
}

/**
 * anchor player + dir around: fill an annulus around the viewer (a city, a forest, a crowd), nearest
 * first, so the build radiates outward from where you stand.
 */
function annulusPoints(center: Vec3, n: number, r: number, spacing: number, spec: LayoutSpec, rand: () => number): Vec3[] {
  const rin = Math.max(spec.at?.dist ?? 0, r + PLAYER_CLEAR + 2)
  const rout = spec.radius ? Math.max(rin + spacing, spec.radius) : Math.sqrt(rin * rin + (n * (spacing * 1.5) ** 2) / Math.PI)
  const minSep = 2 * r * 1.05
  const pts: Vec3[] = []
  for (let i = 0; i < n; i++) {
    let best: Vec3 = [center[0], 0, center[2]]
    let bestSep = -Infinity
    for (let k = 0; k < 40; k++) {
      const rr = Math.sqrt(rin * rin + (rout * rout - rin * rin) * rand())
      const a = rand() * TAU
      const p: Vec3 = [center[0] + Math.cos(a) * rr, 0, center[2] + Math.sin(a) * rr]
      const sep = pts.reduce((m, q) => Math.min(m, distXZ(p, q)), Infinity)
      if (sep >= minSep) {
        best = p
        break
      }
      if (sep > bestSep) {
        best = p
        bestSep = sep
      }
    }
    pts.push(best)
  }
  return pts.sort((a, b) => distXZ(a, center) - distXZ(b, center))
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
    .filter(e => !ignore.has(e.id) && !kindOf(state, e.kind).surface)
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
