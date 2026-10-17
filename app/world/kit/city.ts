// City set (Sprint 4): a two-storey storefront with its own neon sign (props.text) and a parked car.
import * as THREE from 'three'
import { glowMat, group, mat, mesh, neonTexture, seeded } from './helpers'
import type { Build } from './helpers'

const SIGN_COLORS = ['#ff4fa3', '#2bf0ff', '#ffb347', '#7dff7a', '#b388ff', '#ff5a5a']
const AWNINGS = ['#8b1e2b', '#1f4a6b', '#2f6b3a', '#6b4a1f', '#4a2a6b']

export const storefront: Build = ({ text = '' }) => {
  const rand = seeded(`shop:${text}`)
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!
  const g = group(
    mesh(new THREE.BoxGeometry(6, 7.2, 6), mat('#3a3e4a', { roughness: 0.85 }), 'primary', 0, 3.6, 0),
    mesh(new THREE.BoxGeometry(6.2, 0.35, 6.2), mat('#24262c'), 'trim', 0, 7.35, 0),
    mesh(new THREE.BoxGeometry(6.1, 0.18, 6.1), mat('#24262c'), 'trim', 0, 3.3, 0)
  )
  // Shop window and door: the warm glow is what makes a street at night.
  const shopGlow = pick(['#ffb870', '#ffcf8a', '#8fd0ff', '#ff9ac8', '#ffd27a'])
  g.add(mesh(new THREE.BoxGeometry(3.4, 2.2, 0.08), glowMat(shopGlow, 0.5), 'glow', -0.9, 1.45, 3.02))
  g.add(mesh(new THREE.BoxGeometry(1.1, 2.3, 0.08), glowMat('#3a2a18', 0.4), null, 1.9, 1.15, 3.02))
  g.add(mesh(new THREE.BoxGeometry(3.6, 0.12, 0.14), mat('#24262c'), 'trim', -0.9, 2.6, 3.04))
  const awning = mesh(new THREE.BoxGeometry(5.6, 0.08, 1.2), mat(pick(AWNINGS), { roughness: 0.9 }), null, 0, 2.95, 3.55)
  awning.rotation.x = 0.22
  g.add(awning)
  // Upstairs windows: some lit, some dark.
  for (const x of [-1.8, 0, 1.8]) {
    const lit = rand() > 0.35
    g.add(mesh(new THREE.BoxGeometry(1.1, 1.3, 0.08), lit ? glowMat(pick(['#ffd98a', '#ffe7b0', '#bfe0ff']), 0.8) : mat('#1a1c22', { roughness: 0.2 }), lit ? 'glow' : null, x, 5.1, 3.02))
  }
  const word = (text || '').toUpperCase().slice(0, 12)
  if (word) {
    const w = Math.min(5.2, 1.4 + word.length * 0.34)
    const color = pick(SIGN_COLORS)
    const tex = neonTexture(word)
    const sign = mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ color, map: tex, transparent: true, depthWrite: false, toneMapped: false }), null, 0, 3.75, 3.12)
    sign.castShadow = false
    sign.receiveShadow = false
    sign.renderOrder = 3
    g.add(sign)
    // A blade sign sticking out over the sidewalk, so the name reads from down the street.
    // Two back-to-back planes so the text is never mirrored.
    const bw = Math.min(2.8, 0.9 + word.length * 0.2)
    const bx = 2.75
    g.add(mesh(new THREE.BoxGeometry(0.06, bw / 3.4 + 0.12, bw + 0.12), mat('#121216', { roughness: 0.6 }), null, bx, 5.2, 3 + bw / 2 + 0.2))
    for (const side of [1, -1]) {
      const blade = mesh(new THREE.PlaneGeometry(bw, bw / 3.4), new THREE.MeshBasicMaterial({ color, map: tex, transparent: true, depthWrite: false, toneMapped: false }), null, bx + side * 0.04, 5.2, 3 + bw / 2 + 0.2)
      blade.rotation.y = side * Math.PI / 2
      blade.castShadow = false
      blade.renderOrder = 3
      g.add(blade)
    }
  }
  return g
}

export const car: Build = () => {
  const g = group(
    mesh(new THREE.BoxGeometry(1.8, 0.62, 4.4), mat('#c0453a', { metalness: 0.5, roughness: 0.35 }), 'primary', 0, 0.62, 0),
    mesh(new THREE.BoxGeometry(1.6, 0.55, 2.2), mat('#c0453a', { metalness: 0.5, roughness: 0.35 }), 'primary', 0, 1.2, -0.25),
    mesh(new THREE.BoxGeometry(1.62, 0.42, 2.0), mat('#1a2230', { metalness: 0.3, roughness: 0.1 }), null, 0, 1.22, -0.25)
  )
  for (const x of [-0.82, 0.82]) {
    for (const z of [-1.35, 1.35]) {
      const wheel = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.26, 14), mat('#1f1f22', { roughness: 0.9 }), 'trim', x, 0.34, z)
      wheel.rotation.z = Math.PI / 2
      g.add(wheel)
    }
  }
  for (const x of [-0.6, 0.6]) {
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.14, 0.05), glowMat('#fff4d6', 2.4), 'glow', x, 0.72, 2.21))
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.12, 0.05), glowMat('#ff2a2a', 1.8), null, x, 0.74, -2.21))
  }
  return g
}
