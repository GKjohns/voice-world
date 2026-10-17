// Nature: pine, oak, rock, bush. Flat-shaded low-poly so they read as one style with the buildings.
import * as THREE from 'three'
import { group, mat, mesh } from './helpers'
import type { Build } from './helpers'

export const pine: Build = () => {
  const g = group(mesh(new THREE.CylinderGeometry(0.15, 0.22, 1.2, 7), mat('#5a3d28'), 'trim', 0, 0.6, 0))
  for (let i = 0; i < 3; i++) {
    g.add(mesh(new THREE.ConeGeometry(1.4 - i * 0.35, 1.8, 7), mat('#2f5d3c', { flatShading: true }), 'primary', 0, 1.6 + i * 1, 0))
  }
  return g
}

export const oak: Build = () => {
  const g = group(mesh(new THREE.CylinderGeometry(0.22, 0.32, 2.2, 7), mat('#5a3d28'), 'trim', 0, 1.1, 0))
  const blobs: [number, number, number, number][] = [[0, 3.2, 0, 1.5], [0.9, 2.8, 0.3, 1.0], [-0.8, 2.9, -0.4, 1.1], [0.1, 3.9, -0.2, 0.9]]
  for (const [x, y, z, r] of blobs) {
    g.add(mesh(new THREE.IcosahedronGeometry(r, 0), mat('#4f7a3a', { flatShading: true }), 'primary', x, y, z))
  }
  return g
}

export const rock: Build = () => {
  const m = mesh(new THREE.DodecahedronGeometry(0.8, 0), mat('#6e6a62', { flatShading: true, roughness: 1 }), 'primary', 0, 0.42, 0)
  m.scale.set(1.15, 0.62, 0.95)
  const pebble = mesh(new THREE.DodecahedronGeometry(0.32, 0), mat('#6e6a62', { flatShading: true, roughness: 1 }), 'primary', 0.75, 0.16, 0.35)
  return group(m, pebble)
}

export const bush: Build = () => {
  const g = group()
  const blobs: [number, number, number, number][] = [[0, 0.5, 0, 0.6], [0.45, 0.4, 0.15, 0.42], [-0.4, 0.38, -0.1, 0.45], [0.05, 0.75, -0.2, 0.38]]
  for (const [x, y, z, r] of blobs) g.add(mesh(new THREE.IcosahedronGeometry(r, 0), mat('#3e6b3a', { flatShading: true }), 'primary', x, y, z))
  return g
}
