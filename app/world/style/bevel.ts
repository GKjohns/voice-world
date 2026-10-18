/**
 * A unit box with a "normal bevel" (art_direction.md §3.5): the corners stay sharp in geometry but the
 * normals along every edge bend toward the corner, so the toon bands round off the edges like a chunky toy
 * block. Positions are unchanged (any non-uniform part scale stays a perfect box: no squashed fillets), and
 * the normal matrix carries the bend through the scale. 3×3×3 segments with the inner rows pushed out to
 * ±0.44, so the rounded strip is ~6% of each face.
 */
import * as THREE from 'three'

const INNER = 0.44
const BEND = 0.85

export function bevelBox(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 1, 3, 3, 3)
  const pos = g.getAttribute('position') as THREE.BufferAttribute
  const nor = g.getAttribute('normal') as THREE.BufferAttribute
  const p = new THREE.Vector3()
  const n = new THREE.Vector3()
  const map = (v: number) => (Math.abs(Math.abs(v) - 1 / 6) < 1e-4 ? Math.sign(v) * INNER : v)
  for (let i = 0; i < pos.count; i++) {
    p.set(map(pos.getX(i)), map(pos.getY(i)), map(pos.getZ(i)))
    pos.setXYZ(i, p.x, p.y, p.z)
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i))
    // On an edge row (another axis at ±0.5), lean the normal toward that side.
    const bend = new THREE.Vector3()
    for (const ax of ['x', 'y', 'z'] as const) {
      if (Math.abs(n[ax]) > 0.5) continue
      if (Math.abs(Math.abs(p[ax]) - 0.5) < 1e-4) bend[ax] = Math.sign(p[ax]) * BEND
    }
    n.add(bend).normalize()
    nor.setXYZ(i, n.x, n.y, n.z)
  }
  pos.needsUpdate = true
  nor.needsUpdate = true
  g.computeBoundingBox()
  g.computeBoundingSphere()
  return g
}
