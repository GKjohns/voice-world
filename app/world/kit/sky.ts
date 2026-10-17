// Sky kinds (Loop 2): a paper sky lantern and a flapping bird. Both are meant to fly (altitude + motion).
// No real lights here: forty lanterns can't each own a PointLight, so the warmth is emissive paper, a
// flame and an additive halo sprite. Make one cast light with `modify set.light`.
import * as THREE from 'three'
import { softDot } from '../fx/common'
import { glowMat, group, mat, mesh } from './helpers'
import type { Build } from './helpers'

const lanternGeo = new THREE.CylinderGeometry(0.46, 0.32, 1.0, 16, 1, true)
lanternGeo.userData.shared = true
const rimGeo = new THREE.TorusGeometry(0.32, 0.03, 6, 20).rotateX(Math.PI / 2)
rimGeo.userData.shared = true
const capGeo = new THREE.CircleGeometry(0.46, 16).rotateX(-Math.PI / 2)
capGeo.userData.shared = true
const flameGeo = new THREE.SphereGeometry(0.1, 10, 8).scale(1, 1.6, 1)
flameGeo.userData.shared = true

/** The classic wish lantern: a glowing paper shell, a dark rim at the open bottom, a flame burning inside. */
export const lantern: Build = () => {
  const paper = mat('#ff9440', { side: THREE.DoubleSide, emissive: '#ff9440', emissiveIntensity: 1.05, roughness: 0.9, transparent: true, opacity: 0.95 })
  const shell = mesh(lanternGeo, paper, 'primary', 0, 0.62, 0)
  shell.userData.emissiveFollows = 1
  const top = mesh(capGeo, paper, null, 0, 1.12, 0)
  top.userData.baseColor = undefined
  const rim = mesh(rimGeo, mat('#3a2618'), 'trim', 0, 0.13, 0)
  const flame = mesh(flameGeo, glowMat('#ffe9b0', 3), 'glow', 0, 0.26, 0)
  for (const m of [shell, top, rim, flame]) m.castShadow = false
  // The halo: a soft additive bloom that makes a sky of them read as warm light, not paper.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: '#ff8a2a', transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
  halo.scale.setScalar(6)
  halo.position.y = 0.6
  halo.userData.halo = 0.85
  halo.raycast = () => {}
  const g = group(shell, top, rim, flame, halo)
  const phase = Math.random() * 10
  g.userData.animate = (t: number) => {
    const k = 0.88 + 0.12 * Math.sin(t * 7.3 + phase) * Math.sin(t * 2.1 + phase * 0.7)
    paper.emissiveIntensity = 1.05 * k
    halo.material.opacity = (halo.userData.halo as number) * (0.85 + 0.15 * k)
  }
  return g
}

const bodyGeo = new THREE.SphereGeometry(0.5, 12, 8).scale(0.2, 0.18, 0.55)
bodyGeo.userData.shared = true
const wingGeo = new THREE.BoxGeometry(0.6, 0.025, 0.22).translate(0.3, 0, 0)
wingGeo.userData.shared = true
const tipGeo = new THREE.BoxGeometry(0.16, 0.026, 0.16).translate(0.68, 0, -0.02)
tipGeo.userData.shared = true
const beakGeo = new THREE.ConeGeometry(0.035, 0.12, 6).rotateX(Math.PI / 2)
beakGeo.userData.shared = true

/** A gull: white body, dark wingtips, wings that beat and glide. Front faces +z. */
export const bird: Build = () => {
  const white = mat('#f2efe9', { roughness: 0.7 })
  const body = mesh(bodyGeo, white, 'primary', 0, 0.2, 0)
  const beak = mesh(beakGeo, mat('#e8b04a'), null, 0, 0.21, 0.32)
  const wings = [1, -1].map((side) => {
    const pivot = new THREE.Group()
    pivot.position.set(0.06 * side, 0.24, 0.02)
    pivot.scale.x = side
    pivot.userData.side = side
    pivot.add(mesh(wingGeo, white, 'primary'), mesh(tipGeo, mat('#2a2d33'), 'trim'))
    return pivot
  })
  const g = group(body, beak, ...wings)
  const phase = Math.random() * 10
  g.userData.animate = (t: number) => {
    // Beat for a while, then glide with wings held slightly up.
    const glide = Math.sin(t * 0.6 + phase) > 0.4
    const a = glide ? 0.12 : Math.sin(t * 9 + phase) * 0.55
    for (const w of wings) w.rotation.z = a * (w.userData.side as number)
  }
  return g
}
