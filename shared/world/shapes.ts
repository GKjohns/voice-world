/**
 * Gen loop 8: two unit primitives that give generated objects real silhouettes, as plain vertex data (no
 * three.js, so the tests can check them). Both fill the unit box (−0.5…0.5 on every axis) and are scaled to
 * a part's `size` like every other primitive, so they cost nothing new: same materials, same programs.
 *
 * - roof: a hip roof whose profile is concave (steep near the ridge, flattening toward the eaves) and whose
 *   eave tips flick up; four sides with crisp hips. Pagodas, temples, gazebos, cottages, hats. Before it the
 *   models stacked flat discs ("a stack of plates").
 * - shell: a cupped, rounded plate (an elliptic rim, open side facing +z, `d` = how deep it cups). Frills,
 *   petals, leaves, ears, trap lobes, shields, awnings, bowls. Before it, frills were flat slabs.
 *
 * Each smooth region has its own vertices (normals are averaged within a region only), so hips, the eave
 * fascia and the shell's rim stay crisp while the curved faces shade smoothly. Every mesh is closed and
 * wound outward (front faces out; the renderer culls back faces).
 */

export interface MeshData {
  position: number[]
  index: number[]
}

/** Roof profile as [half-width, y] in unit-box units, in three smooth groups: soffit, fascia, top. */
const SOFFIT: [number, number][] = [[0, -0.4], [0.2, -0.47], [0.34, -0.5], [0.44, -0.47], [0.5, -0.4]]
const FASCIA: [number, number][] = [[0.5, -0.4], [0.5, -0.33]]
// Flat-ish just inside the flicked tip, then steepening toward the ridge: the outer ring (what shows
// between pagoda tiers) still has a real pitch.
const TOP: [number, number][] = [[0.5, -0.33], [0.46, -0.4], [0.4, -0.39], [0.32, -0.29], [0.24, -0.16], [0.16, 0], [0.08, 0.22], [0, 0.5]]
// The hip corners, going round +y counter-clockwise seen from above: (+x,+z) → (+x,−z) → (−x,−z) → (−x,+z).
const CORNERS: [number, number][] = [[1, 1], [1, -1], [-1, -1], [-1, 1]]

export function roofMesh(): MeshData {
  const position: number[] = []
  const index: number[] = []
  for (const prof of [SOFFIT, FASCIA, TOP]) {
    for (let k = 0; k < 4; k++) {
      const a = CORNERS[k]!
      const b = CORNERS[(k + 1) % 4]!
      const base = position.length / 3
      for (const [h, y] of prof) position.push(a[0] * h, y, a[1] * h, b[0] * h, y, b[1] * h)
      for (let i = 0; i < prof.length - 1; i++) {
        const a0 = base + i * 2
        const b0 = a0 + 1
        const a1 = a0 + 2
        const b1 = a0 + 3
        // Skip the triangle that collapses where a ring sits on the axis (ridge point, soffit centre).
        if (prof[i]![0] > 1e-6) index.push(a0, b0, a1)
        if (prof[i + 1]![0] > 1e-6) index.push(b0, b1, a1)
      }
    }
  }
  return { position, index }
}

const SHELL_RINGS = 6
const SHELL_SEGS = 20
const SHELL_THICK = 0.3 // share of the cup depth `d`

/** Back (convex) surface depth at rim fraction ρ; the front (open) surface sits SHELL_THICK in front of it. */
const shellZ = (rho: number) => -0.5 + (1 - SHELL_THICK) * rho * rho

export function shellMesh(): MeshData {
  const position: number[] = []
  const index: number[] = []
  // One polar grid per surface: a centre vertex, then rings 1..R of SHELL_SEGS each.
  const surface = (front: boolean) => {
    const base = position.length / 3
    position.push(0, 0, shellZ(0) + (front ? SHELL_THICK : 0))
    for (let i = 1; i <= SHELL_RINGS; i++) {
      const rho = i / SHELL_RINGS
      for (let j = 0; j < SHELL_SEGS; j++) {
        const a = (j / SHELL_SEGS) * Math.PI * 2
        position.push(0.5 * rho * Math.cos(a), 0.5 * rho * Math.sin(a), shellZ(rho) + (front ? SHELL_THICK : 0))
      }
    }
    const at = (i: number, j: number) => (i === 0 ? base : base + 1 + (i - 1) * SHELL_SEGS + (j % SHELL_SEGS))
    const tri = (a: number, b: number, c: number) => (front ? index.push(a, b, c) : index.push(a, c, b))
    for (let j = 0; j < SHELL_SEGS; j++) tri(at(0, 0), at(1, j), at(1, j + 1))
    for (let i = 1; i < SHELL_RINGS; i++) {
      for (let j = 0; j < SHELL_SEGS; j++) {
        tri(at(i, j), at(i + 1, j), at(i + 1, j + 1))
        tri(at(i, j), at(i + 1, j + 1), at(i, j + 1))
      }
    }
  }
  surface(true)
  surface(false)
  // The rim: its own band of vertices joining the two outer rings (a crisp lip).
  const base = position.length / 3
  for (let j = 0; j < SHELL_SEGS; j++) {
    const a = (j / SHELL_SEGS) * Math.PI * 2
    const x = 0.5 * Math.cos(a)
    const y = 0.5 * Math.sin(a)
    position.push(x, y, shellZ(1) + SHELL_THICK, x, y, shellZ(1))
  }
  for (let j = 0; j < SHELL_SEGS; j++) {
    const f0 = base + j * 2
    const b0 = f0 + 1
    const f1 = base + ((j + 1) % SHELL_SEGS) * 2
    const b1 = f1 + 1
    index.push(f0, b0, b1, f0, b1, f1)
  }
  return { position, index }
}

/** Points on a unit roof / shell's silhouette (for camera framing), in its unit box. */
export const ROOF_SILHOUETTE: [number, number, number][] = [
  ...CORNERS.map(([x, z]) => [x * 0.5, -0.44, z * 0.5] as [number, number, number]),
  [0, 0.5, 0]
]
export const SHELL_SILHOUETTE: [number, number, number][] = [
  ...Array.from({ length: 8 }, (_, k) => [0.5 * Math.cos(k * Math.PI / 4), 0.5 * Math.sin(k * Math.PI / 4), 0.5] as [number, number, number]),
  [0, 0, -0.5]
]
