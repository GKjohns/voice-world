/**
 * Learned kinds: build a THREE.Group from `Part[]` (plain data from a `define` op, no code to sandbox).
 * Each primitive is unit-sized and scaled to `size`, so `size` is always the part's bounding box.
 */
import * as THREE from 'three'
import type { Part, Shape } from '#shared/world/ops'
import { glowMat, group, mat, mesh } from './kit/helpers'
import { materialLook } from './look'

// Unit geometries are shared across every learned instance; meshes scale them.
const GEOMETRY: Record<Shape, () => THREE.BufferGeometry> = {
  box: () => new THREE.BoxGeometry(1, 1, 1),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 20),
  cone: () => new THREE.ConeGeometry(0.5, 1, 20),
  sphere: () => new THREE.SphereGeometry(0.5, 20, 14),
  torus: () => new THREE.TorusGeometry(0.375, 0.125, 12, 28),
  capsule: () => new THREE.CapsuleGeometry(0.5, 1, 6, 16).scale(1, 0.5, 1)
}
const cache = new Map<Shape, THREE.BufferGeometry>()

function geometry(shape: Shape): THREE.BufferGeometry {
  let g = cache.get(shape)
  if (!g) {
    g = GEOMETRY[shape]()
    g.userData.shared = true
    cache.set(shape, g)
  }
  return g
}

export function buildFromParts(parts: Part[]): THREE.Group {
  const g = group()
  // With no explicit primary slot, the biggest part takes it so "make it red" still does something.
  const hasPrimary = parts.some(p => p.slot === 'primary')
  const biggest = parts.reduce((bi, p, i) => volume(p) > volume(parts[bi]!) ? i : bi, 0)
  parts.forEach((p, i) => {
    const slot = p.slot ?? (!hasPrimary && i === biggest ? 'primary' : null)
    const material = slot === 'glow' ? glowMat(p.color, 1.4) : mat(p.color)
    if (slot !== 'glow') Object.assign(material, materialLook(p.material))
    const m = mesh(geometry(p.shape), material, slot, p.at[0], p.at[1], p.at[2])
    m.scale.set(p.size[0], p.size[1], p.size[2])
    if (p.rot) m.rotation.set(p.rot[0], p.rot[1], p.rot[2])
    // Explicit-colour parts remember theirs, so a later trim/primary recolour only touches slotted parts.
    m.userData.baseColor = p.color
    g.add(m)
  })
  return g
}

function volume(p: Part): number {
  return p.size[0] * p.size[1] * p.size[2]
}
