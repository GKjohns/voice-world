// Interior set (Sprint 4): the shell (floor, wall, window, rug) and the furniture a Director recipe puts
// in a bar, a pool hall, a lounge or a library. Fronts face +z like every other kind; sized kinds read
// props.length / props.width; colour goes through the slots afterwards, so builders use default colours.
import * as THREE from 'three'
import { emissiveFollows, glowMat, group, mat, mesh, neonTexture, plankTexture, seeded } from './helpers'
import type { Build } from './helpers'

const metal = (c: string) => mat(c, { metalness: 0.75, roughness: 0.35 })

export const floor: Build = ({ length = 16, width = 16 }) => {
  const m = mesh(new THREE.BoxGeometry(length, 0.1, width), mat('#b98a5e', { map: plankTexture(length / 3, width / 2.4), roughness: 0.62 }), 'primary', 0, 0.05, 0)
  m.castShadow = false
  return group(m)
}

export const wall: Build = ({ length = 8 }) => {
  const h = 4
  const g = group(
    mesh(new THREE.BoxGeometry(length, h, 0.25), mat('#6e4a3a', { roughness: 0.9 }), 'primary', 0, h / 2, 0),
    // Wainscot and crown in the trim colour: a wall reads as a wall, not a slab.
    mesh(new THREE.BoxGeometry(length, 1.1, 0.29), mat('#3a2618', { roughness: 0.7 }), 'trim', 0, 0.55, 0),
    mesh(new THREE.BoxGeometry(length, 0.06, 0.33), mat('#3a2618'), 'trim', 0, 1.13, 0),
    mesh(new THREE.BoxGeometry(length, 0.16, 0.32), mat('#3a2618'), 'trim', 0, h - 0.08, 0)
  )
  return g
}

export const windowPane: Build = () => {
  const g = group(
    mesh(new THREE.BoxGeometry(1.6, 1.4, 0.06), glowMat('#9fc3e8', 0.7), 'glow', 0, 1.7, 0.16),
    mesh(new THREE.BoxGeometry(1.8, 0.12, 0.22), mat('#3a2618'), 'primary', 0, 0.96, 0.2),
    mesh(new THREE.BoxGeometry(1.8, 0.1, 0.12), mat('#3a2618'), 'primary', 0, 2.45, 0.17),
    mesh(new THREE.BoxGeometry(0.1, 1.5, 0.12), mat('#3a2618'), 'primary', -0.85, 1.7, 0.17),
    mesh(new THREE.BoxGeometry(0.1, 1.5, 0.12), mat('#3a2618'), 'primary', 0.85, 1.7, 0.17),
    mesh(new THREE.BoxGeometry(0.05, 1.4, 0.1), mat('#3a2618'), 'primary', 0, 1.7, 0.18),
    mesh(new THREE.BoxGeometry(1.6, 0.05, 0.1), mat('#3a2618'), 'primary', 0, 1.7, 0.18)
  )
  // The pane glows by itself; it shouldn't cast a shadow on the room.
  g.children[0]!.castShadow = false
  return g
}

export const ceiling: Build = ({ length = 16, width = 16 }) => {
  const slab = mesh(new THREE.BoxGeometry(length, 0.12, width), mat('#2a1d14', { roughness: 1 }), 'primary', 0, 4.06, 0)
  const g = group(slab)
  // Beams every ~2.5 m across the short side read as a ceiling, not a lid.
  const across = length >= width
  const span = across ? length : width
  const n = Math.max(2, Math.floor(span / 2.5))
  for (let i = 1; i < n; i++) {
    const t = -span / 2 + (i * span) / n
    g.add(mesh(new THREE.BoxGeometry(across ? 0.22 : length, 0.26, across ? width : 0.22), mat('#1a120c'), 'trim', across ? t : 0, 3.87, across ? 0 : t))
  }
  g.traverse((o) => {
    o.castShadow = false
  })
  return g
}

export const rug: Build = ({ length = 3, width = 2 }) => {
  const border = mesh(new THREE.BoxGeometry(length, 0.02, width), mat('#8a6a3a', { roughness: 1 }), 'trim', 0, 0.11, 0)
  const field = mesh(new THREE.BoxGeometry(Math.max(0.2, length - 0.3), 0.022, Math.max(0.2, width - 0.3)), mat('#7a2e2e', { roughness: 1 }), 'primary', 0, 0.112, 0)
  border.castShadow = field.castShadow = false
  return group(border, field)
}

export const pool_table: Build = () => {
  const g = group(
    mesh(new THREE.BoxGeometry(2.6, 0.1, 1.42), mat('#1f6b45', { roughness: 0.95 }), 'primary', 0, 0.86, 0),
    mesh(new THREE.BoxGeometry(2.9, 0.22, 1.72), mat('#4a2a18', { roughness: 0.5 }), 'trim', 0, 0.75, 0)
  )
  // Cushion rails sit proud of the felt.
  for (const z of [-0.78, 0.78]) g.add(mesh(new THREE.BoxGeometry(2.9, 0.08, 0.16), mat('#4a2a18', { roughness: 0.5 }), 'trim', 0, 0.92, z))
  for (const x of [-1.37, 1.37]) g.add(mesh(new THREE.BoxGeometry(0.16, 0.08, 1.72), mat('#4a2a18', { roughness: 0.5 }), 'trim', x, 0.92, 0))
  for (const x of [-1.15, 1.15]) {
    for (const z of [-0.6, 0.6]) g.add(mesh(new THREE.BoxGeometry(0.2, 0.66, 0.2), mat('#3a2012'), 'trim', x, 0.33, z))
  }
  for (const [x, z] of [[-1.3, -0.7], [0, -0.72], [1.3, -0.7], [-1.3, 0.7], [0, 0.72], [1.3, 0.7]] as const) {
    g.add(mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.02, 12), mat('#0c0c0c'), null, x, 0.915, z))
  }
  const balls = ['#f4d03f', '#2e86de', '#e74c3c', '#8e44ad', '#f39c12', '#27ae60', '#c0392b', '#141414', '#f6f2e8', '#1e3799']
  const rack: [number, number][] = [[0, 0], [0.1, -0.06], [0.1, 0.06], [0.2, -0.12], [0.2, 0], [0.2, 0.12], [0.3, -0.06], [0.3, 0.06], [0.3, 0.18], [0.3, -0.18]]
  rack.forEach(([x, z], i) => g.add(mesh(new THREE.SphereGeometry(0.052, 12, 8), mat(balls[i]!, { roughness: 0.2 }), null, 0.55 + x, 0.963, z)))
  g.add(mesh(new THREE.SphereGeometry(0.052, 12, 8), mat('#fbfbf6', { roughness: 0.2 }), null, -0.7, 0.963, 0.05))
  const cue = mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.45, 8), mat('#d9c8a9'), null, -0.2, 0.96, 0.32)
  cue.rotation.z = Math.PI / 2 + 0.02
  cue.rotation.y = 0.18
  g.add(cue)
  return g
}

export const hanging_lamp: Build = () => {
  const shade = emissiveFollows(mesh(new THREE.CylinderGeometry(0.3, 0.75, 0.38, 16, 1, true), mat('#2f7d4a', { side: THREE.DoubleSide, roughness: 0.5, emissive: '#2f7d4a', emissiveIntensity: 0.35 }), 'primary', 0, 2.15, 0), 1)
  shade.castShadow = false
  const g = group(
    mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.7, 6), mat('#151515'), 'trim', 0, 3.2, 0),
    mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.1, 12), metal('#151515'), 'trim', 0, 2.37, 0),
    shade,
    mesh(new THREE.SphereGeometry(0.13, 14, 10), glowMat('#fff1cf', 3.2), 'glow', 0, 2.06, 0)
  )
  g.children[3]!.castShadow = false
  const light = new THREE.SpotLight(0xffe2b0, 38, 9, 0.95, 0.55, 1.3)
  light.position.y = 2.05
  light.target.position.set(0, 0, 0)
  light.userData.baseIntensity = 38
  g.add(light, light.target)
  return g
}

export const bar_counter: Build = ({ length = 6 }) => {
  const g = group(
    mesh(new THREE.BoxGeometry(length, 1.06, 0.7), mat('#4a2a18', { roughness: 0.6 }), 'primary', 0, 0.53, 0),
    mesh(new THREE.BoxGeometry(length + 0.2, 0.08, 0.92), mat('#2a1a10', { roughness: 0.25 }), 'trim', 0, 1.1, 0.04),
    // Raised panel strip and a brass foot rail on the customer side.
    mesh(new THREE.BoxGeometry(length - 0.2, 0.7, 0.04), mat('#5a3420', { roughness: 0.6 }), 'primary', 0, 0.55, 0.37),
    mesh(new THREE.CylinderGeometry(0.03, 0.03, length - 0.3, 8).rotateZ(Math.PI / 2), metal('#c9a34a'), null, 0, 0.22, 0.52)
  )
  const rand = seeded(`bar${length}`)
  const glass = ['#7fbf7f', '#c97f3f', '#9fc3ff', '#e0d090', '#b04040']
  const n = Math.max(3, Math.floor(length / 0.45))
  for (let i = 0; i < n; i++) {
    if (rand() < 0.35) continue
    const x = -length / 2 + 0.3 + (i * (length - 0.6)) / (n - 1)
    const h = 0.26 + rand() * 0.12
    g.add(mesh(new THREE.CylinderGeometry(0.045, 0.05, h, 8), mat(glass[Math.floor(rand() * glass.length)]!, { transparent: true, opacity: 0.85, roughness: 0.1, emissive: '#3a2a10', emissiveIntensity: 0.25 }), null, x, 1.14 + h / 2, -0.15 + rand() * 0.1))
  }
  return g
}

export const stool: Build = () => group(
  mesh(new THREE.CylinderGeometry(0.22, 0.2, 0.09, 16), mat('#8b1e2b', { roughness: 0.55 }), 'primary', 0, 0.78, 0),
  mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.74, 8), metal('#9a9ea4'), 'trim', 0, 0.38, 0),
  mesh(new THREE.TorusGeometry(0.16, 0.015, 6, 16).rotateX(Math.PI / 2), metal('#9a9ea4'), 'trim', 0, 0.3, 0),
  mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.04, 16), metal('#9a9ea4'), 'trim', 0, 0.02, 0)
)

export const jukebox: Build = () => {
  const arch = mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 24, 1, false, 0, Math.PI), glowMat('#ff9a3c', 1.5), 'glow', 0, 1.2, 0)
  arch.rotation.set(Math.PI / 2, Math.PI / 2, 0)
  const g = group(
    mesh(new THREE.BoxGeometry(1.1, 1.2, 0.6), mat('#6d2a14', { roughness: 0.4 }), 'primary', 0, 0.6, 0),
    arch,
    mesh(new THREE.BoxGeometry(0.8, 0.5, 0.04), mat('#d4a537', { metalness: 0.7, roughness: 0.3 }), 'trim', 0, 0.45, 0.31),
    mesh(new THREE.BoxGeometry(0.7, 0.32, 0.04), glowMat('#ffe7b0', 1.1), null, 0, 0.98, 0.31)
  )
  for (const x of [-0.5, 0.5]) g.add(mesh(new THREE.BoxGeometry(0.06, 1.1, 0.05), glowMat('#ff4fa3', 1.6), null, x, 0.75, 0.31))
  return g
}

export const neon_sign: Build = ({ text = 'OPEN' }) => {
  const word = (text || 'OPEN').toUpperCase().slice(0, 20)
  const w = Math.min(5.5, 1.6 + word.length * 0.36)
  const sign = emissiveFollows(mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ color: '#ff4fa3', map: neonTexture(word), transparent: true, depthWrite: false, toneMapped: false }), 'primary', 0, 3.1, 0.05))
  sign.castShadow = false
  sign.receiveShadow = false
  sign.renderOrder = 3
  return group(sign)
}

export const sofa: Build = () => {
  const g = group(
    mesh(new THREE.BoxGeometry(2.2, 0.42, 0.9), mat('#7a3b3b', { roughness: 0.95 }), 'primary', 0, 0.3, 0),
    mesh(new THREE.BoxGeometry(2.2, 0.55, 0.22), mat('#7a3b3b', { roughness: 0.95 }), 'primary', 0, 0.72, -0.36)
  )
  for (const x of [-1.0, 1.0]) g.add(mesh(new THREE.BoxGeometry(0.22, 0.62, 0.9), mat('#7a3b3b', { roughness: 0.95 }), 'primary', x, 0.4, 0))
  for (const x of [-0.6, 0, 0.6]) g.add(mesh(new THREE.BoxGeometry(0.58, 0.12, 0.66), mat('#7a3b3b', { roughness: 1 }), 'primary', x, 0.57, 0.08))
  for (const x of [-0.95, 0.95]) {
    for (const z of [-0.35, 0.35]) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.03, 0.1, 6), mat('#3a2618'), 'trim', x, 0.05, z))
  }
  return g
}

export const bookshelf: Build = () => {
  const g = group(
    mesh(new THREE.BoxGeometry(1.2, 2.2, 0.06), mat('#5a3a22'), 'primary', 0, 1.1, -0.17),
    mesh(new THREE.BoxGeometry(0.06, 2.2, 0.4), mat('#5a3a22'), 'primary', -0.57, 1.1, 0),
    mesh(new THREE.BoxGeometry(0.06, 2.2, 0.4), mat('#5a3a22'), 'primary', 0.57, 1.1, 0)
  )
  const rand = seeded('books')
  const spines = ['#7a2e2e', '#2e4a7a', '#3a6a3a', '#c9a34a', '#5a3a6a', '#d9c8a9', '#2a2a2a', '#8a4a2a']
  for (let s = 0; s < 5; s++) {
    const y = 0.06 + s * 0.52
    g.add(mesh(new THREE.BoxGeometry(1.1, 0.04, 0.38), mat('#5a3a22'), 'primary', 0, y, 0))
    let x = -0.5
    while (x < 0.48) {
      const bw = 0.04 + rand() * 0.05
      const bh = 0.28 + rand() * 0.14
      if (rand() > 0.08) g.add(mesh(new THREE.BoxGeometry(bw, bh, 0.26), mat(spines[Math.floor(rand() * spines.length)]!), null, x + bw / 2, y + 0.02 + bh / 2, 0.02))
      x += bw + 0.006
    }
  }
  return g
}

export const fireplace: Build = () => {
  const g = group(
    mesh(new THREE.BoxGeometry(2.1, 1.4, 0.7), mat('#7a6a5e', { roughness: 1, flatShading: true }), 'primary', 0, 0.7, 0),
    mesh(new THREE.BoxGeometry(1.5, 2.6, 0.45), mat('#7a6a5e', { roughness: 1 }), 'primary', 0, 2.7, -0.1),
    mesh(new THREE.BoxGeometry(2.4, 0.14, 0.85), mat('#3a2a20'), 'trim', 0, 1.47, 0.04),
    mesh(new THREE.BoxGeometry(1.1, 0.85, 0.2), mat('#120c08'), null, 0, 0.5, 0.27)
  )
  const flames: THREE.Mesh[] = []
  for (const [x, s] of [[-0.2, 0.8], [0.15, 1], [0.0, 0.7]] as const) {
    const f = mesh(new THREE.ConeGeometry(0.16 * s, 0.5 * s, 8), glowMat('#ffb347', 2.6), 'glow', x, 0.3 + 0.25 * s, 0.32)
    f.castShadow = false
    flames.push(f)
    g.add(f)
  }
  const light = new THREE.PointLight(0xff9a4a, 22, 11, 1.4)
  light.position.set(0, 0.7, 0.9)
  light.userData.baseIntensity = 22
  g.add(light)
  g.userData.animate = (t: number) => flicker(flames, light, t)
  return g
}

export const cue_rack: Build = () => {
  const g = group(mesh(new THREE.BoxGeometry(1.2, 0.14, 0.08), mat('#4a2a18'), 'primary', 0, 1.9, 0.04))
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.1, 0.12), mat('#4a2a18'), 'primary', 0, 0.55, 0.06))
  for (let i = 0; i < 6; i++) {
    g.add(mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.45, 6), mat('#d9c8a9'), 'trim', -0.5 + i * 0.2, 1.25, 0.1))
  }
  return g
}

export const potted_plant: Build = () => {
  const g = group(
    mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.45, 12), mat('#a0522d'), 'trim', 0, 0.225, 0),
    mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.7, 6), mat('#4a3a20'), null, 0, 0.75, 0)
  )
  const blobs: [number, number, number, number][] = [[0, 1.05, 0, 0.36], [0.22, 0.9, 0.1, 0.26], [-0.2, 0.95, -0.08, 0.28], [0.05, 1.3, -0.05, 0.24]]
  for (const [x, y, z, r] of blobs) g.add(mesh(new THREE.IcosahedronGeometry(r, 0), mat('#3e7a3a', { flatShading: true }), 'primary', x, y, z))
  return g
}

/** Shared flame flicker: scale the cones and breathe the light. */
export function flicker(flames: THREE.Object3D[], light: THREE.Light | null, t: number): void {
  flames.forEach((f, i) => {
    const k = 0.85 + 0.15 * Math.sin(t * 11 + i * 2.1) + 0.08 * Math.sin(t * 23 + i)
    f.scale.set(1, k, 1)
  })
  if (light && light.intensity > 0) {
    const base = light.userData.baseIntensity ?? 10
    const glow = light.userData.glow ?? 1
    light.intensity = base * glow * (0.85 + 0.1 * Math.sin(t * 9) + 0.06 * Math.sin(t * 21))
  }
}
