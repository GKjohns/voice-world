// Street furniture: road, lamp, bench, fence. Roads run along local z so 'along' can follow them.
import * as THREE from 'three'
import { glowMat, group, mat, mesh } from './helpers'
import type { Build } from './helpers'

export const road: Build = () => {
  const g = group(mesh(new THREE.BoxGeometry(5, 0.06, 40), mat('#3b3d42', { roughness: 1 }), 'primary', 0, 0.03, 0))
  g.children[0]!.castShadow = false
  for (const x of [-2.75, 2.75]) g.add(mesh(new THREE.BoxGeometry(0.5, 0.12, 40), mat('#8b8d92'), null, x, 0.06, 0))
  for (let z = -18; z <= 18; z += 4) {
    const dash = mesh(new THREE.BoxGeometry(0.18, 0.07, 1.6), mat('#e8d27a'), 'trim', 0, 0.04, z)
    dash.castShadow = false
    g.add(dash)
  }
  return g
}

export const lamp: Build = () => {
  const g = group(
    mesh(new THREE.CylinderGeometry(0.07, 0.11, 4, 8), mat('#2a2d33', { metalness: 0.6, roughness: 0.4 }), 'primary', 0, 2, 0),
    mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.2, 8), mat('#2a2d33', { metalness: 0.6, roughness: 0.4 }), 'primary', 0, 0.1, 0),
    mesh(new THREE.ConeGeometry(0.34, 0.3, 8), mat('#2a2d33', { metalness: 0.6, roughness: 0.4 }), 'primary', 0, 4.35, 0),
    mesh(new THREE.SphereGeometry(0.24, 16, 12), glowMat('#ffd27a', 2.2), 'glow', 0, 4.05, 0)
  )
  // The renderer budgets real lights; the bulb's emissive carries the look when this one is switched off.
  const light = new THREE.PointLight(0xffd27a, 16, 13, 1.6)
  light.position.y = 3.9
  light.userData.baseIntensity = 16
  g.add(light)
  return g
}

export const bench: Build = () => {
  const g = group()
  for (const z of [-0.12, 0.12]) g.add(mesh(new THREE.BoxGeometry(2, 0.07, 0.2), mat('#8a5a38'), 'primary', 0, 0.5, z))
  for (const y of [0.72, 0.92]) g.add(mesh(new THREE.BoxGeometry(2, 0.14, 0.05), mat('#8a5a38'), 'primary', 0, y, -0.24))
  for (const x of [-0.85, 0.85]) {
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.5, 0.45), mat('#2a2d33', { metalness: 0.5, roughness: 0.4 }), 'trim', x, 0.25, 0))
    g.add(mesh(new THREE.BoxGeometry(0.07, 0.55, 0.06), mat('#2a2d33', { metalness: 0.5, roughness: 0.4 }), 'trim', x, 0.78, -0.24))
  }
  return g
}

export const fence: Build = () => {
  const g = group()
  for (const z of [-1.5, -0.5, 0.5, 1.5]) g.add(mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), mat('#c9b79a'), 'primary', 0, 0.55, z))
  for (const y of [0.4, 0.85]) g.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 3.1), mat('#c9b79a'), 'primary', 0, y, 0))
  return g
}
