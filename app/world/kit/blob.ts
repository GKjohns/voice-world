// The placeholder for kinds nobody has defined: a slowly turning crystal with the requested name over it.
import * as THREE from 'three'
import { group, mat, mesh, textTexture } from './helpers'
import type { Build } from './helpers'

export const blob: Build = ({ text = '?' }) => {
  const crystal = mesh(new THREE.IcosahedronGeometry(0.9, 0), mat('#9b8cff', { flatShading: true, emissive: '#3a2f8f', emissiveIntensity: 0.4 }), 'primary', 0, 1.1, 0)
  crystal.userData.spin = true
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text), transparent: true, depthWrite: false }))
  label.scale.set(3.2, 0.8, 1)
  label.position.y = 2.6
  return group(crystal, label)
}
