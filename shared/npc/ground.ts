/**
 * Where people can put their feet, analytically (no rays, so a crowd stays cheap): the deck of a dock or
 * pier, a floor or rug, and the water they must not walk into. Footprints of solid things (houses, trees,
 * rocks) are obstacles to steer round. Pure and three-free.
 */
import type { Vec3 } from '../world/ops.ts'

export interface GroundEntity {
  id: string
  kind: string
  tags: string[]
  pos: Vec3
  rotY: number
  props: { length?: number, width?: number, scale?: number }
}

/** World (x, z) → the entity's local frame (its front is +z). */
function local(e: GroundEntity, x: number, z: number): [number, number] {
  const dx = x - e.pos[0]
  const dz = z - e.pos[2]
  const c = Math.cos(e.rotY)
  const s = Math.sin(e.rotY)
  // Inverse of three's rotation.y: local = R(-yaw) · world.
  return [dx * c - dz * s, dx * s + dz * c]
}

const DOCK_TOP = 0.55

/** The deck height under (x, z) if they're on something walkable, else null. */
export function deckAt(entities: GroundEntity[], x: number, z: number): number | null {
  let best: number | null = null
  for (const e of entities) {
    if (e.kind === 'dock' || e.kind === 'pier') {
      const [lx, lz] = local(e, x, z)
      const L = e.props.length ?? 10
      // The deck is 2.4 m wide; keep a person's body on the planks, not half over the edge.
      if (Math.abs(lx) <= 0.95 && lz <= 0.2 && lz >= -L) best = Math.max(best ?? -Infinity, e.pos[1] + DOCK_TOP)
    } else if (e.kind === 'floor' || e.kind === 'rug') {
      const [lx, lz] = local(e, x, z)
      const L = (e.props.length ?? (e.kind === 'floor' ? 16 : 3)) / 2
      const W = (e.props.width ?? (e.kind === 'floor' ? 16 : 2)) / 2
      if (Math.abs(lx) <= L && Math.abs(lz) <= W) best = Math.max(best ?? -Infinity, e.pos[1] + (e.kind === 'floor' ? 0.1 : 0.02))
    }
  }
  return best
}

/** Inside a lake (an oval length × width) or a river ribbon, and not on a deck. */
export function inWater(entities: GroundEntity[], x: number, z: number): boolean {
  for (const e of entities) {
    if (e.kind === 'water') {
      const [lx, lz] = local(e, x, z)
      const a = (e.props.length ?? 60) / 2
      const b = (e.props.width ?? 60) / 2
      if ((lx / a) ** 2 + (lz / b) ** 2 < 0.92) return true
    } else if (e.kind === 'river') {
      const [lx, lz] = local(e, x, z)
      const L = (e.props.length ?? 240) / 2
      const W = (e.props.width ?? 14) / 2
      if (Math.abs(lz) <= L && Math.abs(lx) <= W * 0.9) return true
    }
  }
  return false
}

/** Things too solid to walk through: a circle (x, z, r) per entity with a real footprint. */
export function obstacles(entities: GroundEntity[], footprint: (kind: string) => number, near: [number, number], range = 14): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const e of entities) {
    if (e.kind === 'person' || e.tags.includes('terrain') || e.tags.includes('particles') || e.pos[1] > 2) continue
    const r = footprint(e.kind) * (e.props.scale ?? 1)
    if (r < 0.3) continue
    if (Math.abs(e.pos[0] - near[0]) > range + r || Math.abs(e.pos[2] - near[1]) > range + r) continue
    out.push([e.pos[0], e.pos[2], r * 0.85 + 0.25])
  }
  return out
}

/** Can a person stand at (x, z)? Not in the water (unless on a deck), not inside a solid thing. */
export function canStand(entities: GroundEntity[], solid: [number, number, number][], x: number, z: number): boolean {
  if (inWater(entities, x, z) && deckAt(entities, x, z) === null) return false
  for (const [ox, oz, r] of solid) if ((x - ox) ** 2 + (z - oz) ** 2 < r * r) return false
  return true
}

/**
 * One steering step: the heading closest to `want` (radians, atan2(dx, dz)) that keeps them standable,
 * trying wider and wider swerves. Null when boxed in.
 */
export function steer(entities: GroundEntity[], solid: [number, number, number][], x: number, z: number, want: number, stepLen: number): number | null {
  const look = Math.max(0.6, stepLen * 3)
  for (const off of [0, 0.35, -0.35, 0.7, -0.7, 1.1, -1.1, 1.6, -1.6, 2.2, -2.2]) {
    const a = want + off
    if (canStand(entities, solid, x + Math.sin(a) * look, z + Math.cos(a) * look)) return a
  }
  return null
}
