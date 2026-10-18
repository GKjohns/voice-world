/**
 * Terrain surfaces: the pure height functions behind the colossal kinds (hill, mountain, range, volcano,
 * cliff, island, canyon). The three.js builders in app/world/kit/terrain.ts mesh exactly these functions,
 * and `groundHeight` samples them, so "a castle on that hill" stands on the surface you see.
 */
import type { KindDescriptor } from './kinds.ts'
import type { Props } from './ops.ts'
import type { Entity, WorldState } from './types.ts'

export type Surface = 'hill' | 'mountain' | 'range' | 'volcano' | 'mesa' | 'island' | 'canyon'

// ---------- noise (deterministic, tiny) ----------

function hash2(x: number, z: number, seed: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function valueNoise(x: number, z: number, seed: number): number {
  const xi = Math.floor(x)
  const zi = Math.floor(z)
  const fx = x - xi
  const fz = z - zi
  const sx = fx * fx * (3 - 2 * fx)
  const sz = fz * fz * (3 - 2 * fz)
  const a = hash2(xi, zi, seed)
  const b = hash2(xi + 1, zi, seed)
  const c = hash2(xi, zi + 1, seed)
  const d = hash2(xi + 1, zi + 1, seed)
  return (a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz) * 2 - 1
}

/** Fractal noise in -1..1. */
export function fbm(x: number, z: number, seed = 1, octaves = 3): number {
  let sum = 0
  let amp = 0.5
  let f = 1
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * f, z * f, seed + i * 17) * amp
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** One peak: a ridged cone, steeper near the top, with rough flanks. */
function peak(x: number, z: number, R: number, H: number, seed: number, stretch = 1.35): number {
  const t = Math.hypot(x / stretch, z) / R
  if (t >= 1) return 0
  const n = fbm(x / (R * 0.32), z / (R * 0.32), seed)
  const ridge = 1 - Math.abs(fbm(x / (R * 0.55), z / (R * 0.55), seed + 5))
  const base = Math.pow(1 - t, 1.25)
  return H * base * (0.86 + 0.16 * n + 0.12 * ridge * (1 - t))
}

/** The peaks of a mountain range: along local x, bowed toward +z (the player) so the ridge hugs the horizon. */
export function rangePeaks(length: number, H: number): { x: number, z: number, r: number, h: number }[] {
  const n = Math.max(5, Math.min(12, Math.round(length / 85)))
  const out: { x: number, z: number, r: number, h: number }[] = []
  const step = length / n
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n - 0.5
    const x = u * length + (hash2(i, 3, 91) - 0.5) * step * 0.5
    const centre = 1 - Math.abs(u) * 0.9 // the middle rises highest
    const h = H * (0.42 + 0.58 * centre) * (0.7 + 0.45 * hash2(i, 7, 91))
    out.push({ x, z: (x * x) / (2 * 650) - (hash2(i, 11, 91) - 0.3) * 40, r: step * (1.0 + 0.5 * hash2(i, 13, 91)), h })
  }
  return out
}

/**
 * Height (m) of a terrain surface at local (x, z), at scale 1. R = the descriptor footprint, H = its base
 * height. Returns 0 outside the shape.
 */
export function surfaceHeight(surface: Surface, x: number, z: number, R: number, H: number, props: Props = {}): number {
  switch (surface) {
    case 'hill':
    case 'island': {
      const t = Math.hypot(x, z) / R + 0.05 * fbm(x / 9, z / 9, surface === 'hill' ? 3 : 4)
      if (t >= 1) return 0
      const bell = 0.5 + 0.5 * Math.cos(Math.PI * t)
      return H * Math.pow(bell, surface === 'island' ? 0.8 : 1.1) * (1 + 0.04 * fbm(x / 6, z / 6, 9))
    }
    case 'mountain': {
      let h = peak(x, z, R, H, 21)
      h = Math.max(h, peak(x - R * 0.48, z + R * 0.08, R * 0.55, H * 0.62, 23, 1.1))
      h = Math.max(h, peak(x + R * 0.52, z - R * 0.1, R * 0.5, H * 0.5, 25, 1.1))
      return h
    }
    case 'range': {
      let h = 0
      for (const p of rangePeaks(props.length ?? 800, H)) h = Math.max(h, peak(x - p.x, z - p.z, p.r, p.h, 31 + Math.round(p.x), 1.15))
      return h
    }
    case 'volcano': {
      const d = Math.hypot(x, z)
      const t = d / R + 0.035 * fbm(x / 18, z / 18, 41)
      if (t >= 1) return 0
      const tc = 0.14
      const rim = Math.pow(1 - tc, 1.3)
      const cone = t > tc ? Math.pow(1 - t, 1.3) : rim - 0.16 * Math.pow(1 - t / tc, 1.6)
      return H * (cone / rim) * (1 + 0.05 * fbm(x / 22, z / 22, 43) * t)
    }
    case 'mesa': {
      // A long cliff: a superellipse plateau, stretched along x, with a sheer edge and a rough top.
      const u = x / (R * 1.7)
      const v = z / R
      const q = Math.pow(u ** 4 + v ** 4, 0.25) + 0.05 * fbm(x / 7, z / 7, 51)
      const edge = 1 - smooth(0.8, 0.9, q)
      return H * edge * (0.95 + 0.05 * fbm(x / 12, z / 12, 53))
    }
    case 'canyon': {
      // Two walls either side of a channel running along local z.
      const L = (props.length ?? 320) / 2
      const a = Math.abs(x) + 4 * fbm(x / 10, z / 10, 61)
      const g = 20
      const w = 80
      const walls = smooth(g, g + 8, a) * (1 - smooth(g + w - 25, g + w, a))
      const ends = 1 - smooth(L - 40, L, Math.abs(z))
      return H * walls * ends * (0.82 + 0.18 * fbm(x / 30, z / 30, 63))
    }
  }
}

/** World height of one terrain entity's surface at (x, z), or 0 if (x, z) is off it. */
export function entitySurfaceAt(desc: KindDescriptor, e: Entity, x: number, z: number): number {
  if (!desc.surface) return 0
  const s = e.props.scale ?? 1
  const dx = x - e.pos[0]
  const dz = z - e.pos[2]
  // Into the entity's local frame: undo its yaw, then its uniform scale.
  const c = Math.cos(e.rotY)
  const sn = Math.sin(e.rotY)
  const lx = (dx * c - dz * sn) / s
  const lz = (dx * sn + dz * c) / s
  const h = surfaceHeight(desc.surface, lx, lz, desc.footprint, desc.baseHeight, e.props)
  return h > 0 ? e.pos[1] + h * s * (e.props.height ?? 1) : 0
}

/** The ground under (x, z): the highest terrain surface there, else 0 (the flat world). */
export function groundHeight(state: Pick<WorldState, 'entities' | 'kinds'>, x: number, z: number, ignore?: string): number {
  let h = 0
  for (const e of state.entities) {
    if (e.id === ignore) continue
    const desc = state.kinds[e.kind]
    if (!desc?.surface) continue
    h = Math.max(h, entitySurfaceAt(desc, e, x, z))
  }
  return h
}

/**
 * Where something of footprint `r` settles on the ground at (x, z): the lowest of its centre and four
 * points around its edge, so a castle on a hilltop sinks into the crown instead of overhanging the slope.
 */
export function groundUnder(state: Pick<WorldState, 'entities' | 'kinds'>, x: number, z: number, r: number): number {
  const c = groundHeight(state, x, z)
  if (c <= 0 || r <= 0) return c
  let h = c
  const k = r * 0.6
  for (const [dx, dz] of [[k, 0], [-k, 0], [0, k], [0, -k]] as const) h = Math.min(h, groundHeight(state, x + dx, z + dz))
  return Math.round(h * 1000) / 1000
}
