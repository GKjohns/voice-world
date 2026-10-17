// Indoor furniture: table and chair. Fronts face +z like every other kind.
import * as THREE from 'three'
import { group, mat, mesh } from './helpers'
import type { Build } from './helpers'

export const table: Build = () => {
  const g = group(mesh(new THREE.BoxGeometry(1.6, 0.07, 0.95), mat('#8a5a38', { roughness: 0.6 }), 'primary', 0, 0.75, 0))
  for (const x of [-0.7, 0.7]) {
    for (const z of [-0.38, 0.38]) g.add(mesh(new THREE.BoxGeometry(0.07, 0.72, 0.07), mat('#3a2618'), 'trim', x, 0.36, z))
  }
  return g
}

export const chair: Build = () => {
  const g = group(
    mesh(new THREE.BoxGeometry(0.48, 0.06, 0.46), mat('#7c5236'), 'primary', 0, 0.46, 0),
    mesh(new THREE.BoxGeometry(0.48, 0.5, 0.05), mat('#7c5236'), 'primary', 0, 0.72, -0.21)
  )
  for (const x of [-0.2, 0.2]) {
    for (const z of [-0.19, 0.19]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.46, 0.05), mat('#7c5236'), 'primary', x, 0.23, z))
  }
  return g
}
