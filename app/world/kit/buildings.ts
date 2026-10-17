// Buildings: house and tower. Both rebuild when `floors` changes; height/scale are handled by the renderer.
import * as THREE from 'three'
import { glowMat, group, mat, mesh } from './helpers'
import type { Build } from './helpers'

export const house: Build = ({ floors = 1 }) => {
  const h = 2.8 * floors
  const g = group(
    mesh(new THREE.BoxGeometry(4.4, h, 4.4), mat('#d9c8a9'), 'primary', 0, h / 2, 0),
    mesh(new THREE.BoxGeometry(0.9, 1.8, 0.1), mat('#4a3326'), null, 0, 0.9, 2.22),
    mesh(new THREE.BoxGeometry(4.6, 0.18, 4.6), mat('#7a3b2e'), 'trim', 0, h + 0.09, 0),
    mesh(new THREE.BoxGeometry(0.5, 1.2, 0.5), mat('#7a3b2e'), 'trim', 1.2, h + 1.4, -0.8)
  )
  const roof = mesh(new THREE.ConeGeometry(3.6, 2, 4), mat('#7a3b2e', { flatShading: true }), 'trim', 0, h + 1.18, 0)
  roof.rotation.y = Math.PI / 4
  g.add(roof)
  for (let f = 0; f < floors; f++) {
    for (const x of [-1.3, 1.3]) {
      if (f === 0 && Math.abs(x) < 0.5) continue
      g.add(mesh(new THREE.BoxGeometry(0.8, 0.8, 0.08), glowMat('#ffd98a', 0.9), 'glow', x, 1.6 + f * 2.8, 2.22))
    }
    if (f > 0) g.add(mesh(new THREE.BoxGeometry(0.8, 0.8, 0.08), glowMat('#ffd98a', 0.9), 'glow', 0, 1.6 + f * 2.8, 2.22))
    for (const z of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(0.08, 0.8, 0.8), glowMat('#ffd98a', 0.9), 'glow', 2.22, 1.6 + f * 2.8, z))
  }
  return g
}

export const tower: Build = ({ floors = 8 }) => {
  const fh = 3
  const h = fh * floors
  const g = group(mesh(new THREE.BoxGeometry(4.8, h, 4.8), mat('#8fa3bf'), 'primary', 0, h / 2, 0))
  for (let f = 0; f < floors; f++) {
    // Window bands: dim glass by day, lit offices at night (the glow slot).
    g.add(mesh(new THREE.BoxGeometry(4.9, 1.5, 4.9), glowMat('#cfe3f5', 0.18), 'glow', 0, f * fh + 1.7, 0))
    g.add(mesh(new THREE.BoxGeometry(5.1, 0.22, 5.1), mat('#33404f'), 'trim', 0, f * fh + 0.11, 0))
  }
  g.add(mesh(new THREE.BoxGeometry(5.2, 0.4, 5.2), mat('#33404f'), 'trim', 0, h + 0.2, 0))
  g.add(mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), mat('#33404f'), 'trim', 0.9, h + 1, -0.6))
  return g
}
