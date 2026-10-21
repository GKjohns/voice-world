/**
 * Gen loop 8: the roof and shell unit primitives. Each must fill the unit box exactly (so `size` is its
 * bounding box like every other primitive), be closed, and be wound outward (front faces out; the
 * renderer culls back faces, so a flipped face is a hole).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ROOF_SILHOUETTE, SHELL_SILHOUETTE, roofMesh, shellMesh } from '../shared/world/shapes.ts'
import type { MeshData } from '../shared/world/shapes.ts'
import { cleanPart, partBounds, silhouettePoints } from '../shared/world/forge.ts'
import { SHAPES } from '../shared/world/ops.ts'

const P = (m: MeshData, i: number) => m.position.slice(i * 3, i * 3 + 3) as [number, number, number]

function bounds(m: MeshData) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < m.position.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, m.position[i + k]!)
      max[k] = Math.max(max[k]!, m.position[i + k]!)
    }
  }
  return { min, max }
}

/** Every edge (welded by position) is used exactly twice, in opposite directions: closed and consistently wound. */
function closedAndConsistent(m: MeshData): { open: number, flipped: number } {
  const key = (i: number) => P(m, i).map(n => n.toFixed(5)).join(',')
  const edges = new Map<string, number>()
  for (let t = 0; t < m.index.length; t += 3) {
    const tri = [m.index[t]!, m.index[t + 1]!, m.index[t + 2]!].map(key)
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue // degenerate
    for (let e = 0; e < 3; e++) {
      const k = `${tri[e]}>${tri[(e + 1) % 3]}`
      edges.set(k, (edges.get(k) ?? 0) + 1)
    }
  }
  let open = 0
  let flipped = 0
  for (const [k, n] of edges) {
    const [a, b] = k.split('>')
    const back = edges.get(`${b}>${a}`) ?? 0
    if (n > 1) flipped++
    if (back === 0) open++
  }
  return { open, flipped }
}

function signedVolume(m: MeshData): number {
  let v = 0
  for (let t = 0; t < m.index.length; t += 3) {
    const [a, b, c] = [P(m, m.index[t]!), P(m, m.index[t + 1]!), P(m, m.index[t + 2]!)]
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return v
}

for (const [name, mesh] of [['roof', roofMesh()], ['shell', shellMesh()]] as const) {
  test(`${name}: fills the unit box, closed, wound outward`, () => {
    const b = bounds(mesh)
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(b.min[k]! + 0.5) < 1e-6, `${name} min[${k}] = ${b.min[k]}`)
      assert.ok(Math.abs(b.max[k]! - 0.5) < 1e-6, `${name} max[${k}] = ${b.max[k]}`)
    }
    const c = closedAndConsistent(mesh)
    assert.equal(c.open, 0, `${name} has open edges`)
    assert.equal(c.flipped, 0, `${name} has inconsistently wound faces`)
    assert.ok(signedVolume(mesh) > 0.05, `${name} faces point inward`)
    assert.ok(mesh.index.every(i => i >= 0 && i < mesh.position.length / 3))
  })
}

test('roof: concave profile with up-flicked eaves; shell cups toward +z', () => {
  const roof = roofMesh()
  // The roof surface over the half-width midpoint sits well below the straight eave-to-ridge line (concave).
  const ys = (h: number) => {
    let best = -Infinity
    for (let i = 0; i < roof.position.length; i += 3) {
      if (Math.abs(roof.position[i]! - h) < 1e-6 && Math.abs(roof.position[i + 2]! - h) < 1e-6) best = Math.max(best, roof.position[i + 1]!)
    }
    return best
  }
  const chord = -0.4 + (0.22 / 0.46) * 0.9
  assert.ok(ys(0.24) < chord - 0.1, `mid-slope y ${ys(0.24)}`)
  // But the outer ring still pitches (it is what shows between pagoda tiers).
  assert.ok(ys(0.32) - ys(0.4) > 0.08)
  // The eave tip is higher than the roof just inside it (the flick).
  assert.ok(ys(0.5) > ys(0.46) + 0.05)
  // Shell: the centre is at the back, the rim at the front.
  const shell = shellMesh()
  assert.deepEqual(P(shell, 0).map(n => +n.toFixed(3)), [0, 0, -0.2])
  const rim = bounds(shell).max[2]
  assert.ok(Math.abs(rim! - 0.5) < 1e-9)
})

test('roof and shell are define and forge primitives sized by their box', () => {
  assert.ok((SHAPES as readonly string[]).includes('roof'))
  assert.ok((SHAPES as readonly string[]).includes('shell'))
  const roof = cleanPart({ shape: 'roof', size: [4, 1, 3], at: [0, 3, 0], color: '#556677' })!
  assert.deepEqual(partBounds(roof), { min: [-2, 2.5, -1.5], max: [2, 3.5, 1.5] })
  const pts = silhouettePoints([roof])
  assert.equal(pts.length, ROOF_SILHOUETTE.length)
  // The ridge point is the top of the box; the eave corners sit at the box's corners, low down.
  assert.ok(pts.some(p => p[1] === 3.5 && p[0] === 0))
  assert.ok(pts.some(p => p[0] === 2 && p[2] === 1.5 && p[1] < 2.7))
  const shell = cleanPart({ shape: 'shell', size: [2, 1.6, 0.5], at: [0, 2, 0], color: '#cc8844' })!
  assert.equal(silhouettePoints([shell]).length, SHELL_SILHOUETTE.length)
})
