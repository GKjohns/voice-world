// Outdoor set (Sprint 4): water, shore, dock, boat, campfire, tent, reeds. Water and shore are ovals of
// props.length × props.width; the dock runs props.length metres out of its back (-z).
import * as THREE from 'three'
import { glowMat, group, mat, mesh, seeded, snapColor } from './helpers'
import { waterMaterial } from '../style/water'
import type { Build } from './helpers'
import { flicker } from './interior'

export const water: Build = ({ length = 60, width = 60 }) => {
  const m = mesh(new THREE.CircleGeometry(0.5, 72).rotateX(-Math.PI / 2), waterMaterial(snapColor('#3f7f9a')), 'primary', 0, 0.05, 0)
  m.scale.set(length, 1, width)
  m.castShadow = false
  // A faint second sheet that drifts, so the surface isn't dead still.
  const sheen = new THREE.Mesh(new THREE.CircleGeometry(0.5, 72).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.05, depthWrite: false }))
  sheen.scale.set(length * 0.96, 1, width * 0.96)
  sheen.position.y = 0.06
  const g = group(m, sheen)
  g.userData.animate = (t: number) => {
    ;(sheen.material as THREE.MeshBasicMaterial).opacity = 0.035 + 0.025 * Math.sin(t * 0.7)
  }
  return g
}

export const shore: Build = ({ length = 60, width = 60 }) => {
  // A unit ring scaled to the oval: inner edge tucked just under the water's edge, ~4 m of sand outside it.
  const band = 4 / Math.max(10, Math.min(length, width))
  const m = mesh(new THREE.RingGeometry(0.49, 0.5 + band, 72).rotateX(-Math.PI / 2), mat('#b9a27a', { roughness: 1 }), 'primary', 0, 0.035, 0)
  m.scale.set(length, 1, width)
  m.castShadow = false
  return group(m)
}

export const dock: Build = ({ length = 10 }) => {
  const g = group()
  const n = Math.max(3, Math.round(length / 0.45))
  const step = length / n
  for (let i = 0; i < n; i++) {
    g.add(mesh(new THREE.BoxGeometry(2.4, 0.1, step * 0.9), mat(i % 2 ? '#8a6a48' : '#7c5e3f', { roughness: 0.9 }), 'primary', 0, 0.5, -(i + 0.5) * step))
  }
  for (const x of [-1.05, 1.05]) {
    g.add(mesh(new THREE.BoxGeometry(0.16, 0.14, length), mat('#5a4330'), 'trim', x, 0.4, -length / 2))
    for (let z = 0; z <= length + 0.01; z += Math.max(2, length / 5)) {
      g.add(mesh(new THREE.CylinderGeometry(0.1, 0.11, 1.5, 8), mat('#5a4330'), 'trim', x, -0.15 + 0.1, -Math.min(z, length - 0.1)))
    }
  }
  // Two mooring bollards at the far end.
  for (const x of [-0.95, 0.95]) g.add(mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.35, 8), mat('#5a4330'), 'trim', x, 0.72, -length + 0.25))
  return g
}

export const boat: Build = () => {
  // The lower half of a cylinder lying along z: the keel down, open to the sky.
  const hull = mesh(new THREE.CylinderGeometry(0.75, 0.75, 3.2, 16, 1, false, -Math.PI / 2, Math.PI), mat('#c9b79a', { side: THREE.DoubleSide }), 'primary', 0, 0.5, 0)
  hull.rotation.x = Math.PI / 2
  hull.scale.set(1, 1, 0.55)
  const g = group(hull)
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.06, 3.1), mat('#7a3b2e'), 'trim', 0, 0.52, 0))
  for (const z of [-0.6, 0.5]) g.add(mesh(new THREE.BoxGeometry(1.3, 0.06, 0.3), mat('#8a6a48'), null, 0, 0.42, z))
  const oar = mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.4, 6), mat('#8a6a48'), null, 0.3, 0.55, 0)
  oar.rotation.set(Math.PI / 2, 0, 0.25)
  g.add(oar)
  return g
}

export const campfire: Build = () => {
  const g = group()
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2
    g.add(mesh(new THREE.DodecahedronGeometry(0.17, 0), mat('#6e6a62', { flatShading: true }), 'primary', Math.cos(a) * 0.62, 0.1, Math.sin(a) * 0.62))
  }
  for (let i = 0; i < 3; i++) {
    const log = mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.9, 6), mat('#4a3020'), null, 0, 0.12, 0)
    log.rotation.set(Math.PI / 2 - 0.25, (i / 3) * Math.PI, 0)
    g.add(log)
  }
  const flames: THREE.Mesh[] = []
  for (const [x, z, s] of [[0, 0, 1], [0.12, 0.08, 0.7], [-0.1, -0.06, 0.75]] as const) {
    const f = mesh(new THREE.ConeGeometry(0.22 * s, 0.75 * s, 8), glowMat('#ffb347', 2.8), 'glow', x, 0.2 + 0.37 * s, z)
    f.castShadow = false
    flames.push(f)
    g.add(f)
  }
  const light = new THREE.PointLight(0xff9a4a, 26, 14, 1.4)
  light.position.y = 0.9
  light.userData.baseIntensity = 26
  g.add(light)
  g.userData.animate = (t: number) => flicker(flames, light, t)
  return g
}

export const tent: Build = () => {
  const g = group()
  for (const side of [-1, 1]) {
    const panel = mesh(new THREE.BoxGeometry(0.04, 2.15, 2.6), mat('#d07a3a', { roughness: 0.9, side: THREE.DoubleSide }), 'primary', side * 0.62, 0.9, 0)
    panel.rotation.z = side * 0.6
    g.add(panel)
  }
  g.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.8, 6).rotateX(Math.PI / 2), mat('#5a4330'), 'trim', 0, 1.8, 0))
  const door = mesh(new THREE.ConeGeometry(0.62, 1.5, 3), mat('#2a1a10'), null, 0, 0.75, 1.27)
  door.scale.z = 0.05
  g.add(door)
  return g
}

export const reeds: Build = () => {
  const g = group()
  const rand = seeded('reeds')
  for (let i = 0; i < 9; i++) {
    const x = (rand() - 0.5) * 0.7
    const z = (rand() - 0.5) * 0.7
    const h = 0.8 + rand() * 0.6
    const stalk = mesh(new THREE.CylinderGeometry(0.012, 0.018, h, 5), mat('#6b7a3a'), 'primary', x, h / 2, z)
    stalk.rotation.set((rand() - 0.5) * 0.25, 0, (rand() - 0.5) * 0.25)
    g.add(stalk)
    if (rand() > 0.35) g.add(mesh(new THREE.CapsuleGeometry(0.035, 0.14, 3, 6), mat('#5a3d28'), 'trim', x, h + 0.02, z))
  }
  return g
}
