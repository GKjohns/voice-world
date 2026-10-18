/**
 * Shared bits for the kit builders. Every mesh is tagged with a material slot so `modify` can recolour
 * any kind the same way: 'primary' takes `color`, 'trim' takes `trim`, 'glow' is emissive and takes `glow`.
 */
import * as THREE from 'three'
import type { Slot } from '#shared/world/ops'
import { stylize } from '#shared/world/palette'
import type { PaletteRole } from '#shared/world/palette'

/** Props a builder may read. Most read nothing (colour is applied afterwards through the slots). */
export interface BuildProps {
  floors?: number
  text?: string
  length?: number
  width?: number
  color?: string
  /** People: the role preset to dress for and the entity id that seeds their looks (skin, hair, height). */
  role?: string
  seed?: string
  name?: string
}
export type Build = (props: BuildProps) => THREE.Group

/**
 * Every colour a builder, a model or a forged part picks is snapped onto the curated palette here
 * (shared/world/palette.ts, art direction §3.2): the material boundary, so kit, learned kinds and forge
 * output all share one palette. The shading itself is global (style/toon.ts).
 */
export function snapColor(color: THREE.ColorRepresentation, role: PaletteRole = 'surface'): THREE.Color {
  const c = new THREE.Color(color)
  return c.set(stylize('#' + c.getHexString(), role))
}

export function mat(color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}, role: PaletteRole = 'surface'): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: snapColor(color, role), roughness: 0.8, ...opts })
}

export function glowMat(color: THREE.ColorRepresentation, intensity = 1.6): THREE.MeshStandardMaterial {
  const c = snapColor(color, 'glow')
  return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: intensity, roughness: 0.5 })
}

/** A shadow-casting mesh in a slot. Slot-less meshes keep their own colour forever (door, windows). */
export function mesh(geo: THREE.BufferGeometry, material: THREE.Material, slot: Slot | null, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, material)
  m.position.set(x, y, z)
  m.castShadow = true
  m.receiveShadow = true
  if (slot) m.userData.slot = slot
  // The colour the builder chose is the default a recolour falls back to (e.g. after undo).
  const std = material as THREE.MeshStandardMaterial
  if (std.color) m.userData.baseColor = '#' + std.color.getHexString()
  if (std.emissiveIntensity !== undefined) m.userData.baseGlow = std.emissiveIntensity
  return m
}

export function group(...children: THREE.Object3D[]): THREE.Group {
  const g = new THREE.Group()
  if (children.length) g.add(...children)
  return g
}

/** Text on a transparent canvas, for blob labels and signs. */
export function textTexture(text: string, color = '#c9c2ff', glow = true): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 128
  const g = c.getContext('2d')!
  g.clearRect(0, 0, c.width, c.height)
  let size = 64
  g.font = `600 ${size}px Geist, system-ui, sans-serif`
  while (g.measureText(text).width > 480 && size > 24) {
    size -= 4
    g.font = `600 ${size}px Geist, system-ui, sans-serif`
  }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  if (glow) {
    g.shadowColor = color
    g.shadowBlur = 18
  }
  g.fillStyle = color
  g.fillText(text, 256, 66)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Deterministic little rng for builders (book colours, lit windows), so a rebuild looks the same. */
export function seeded(seed: string | number): () => number {
  let h = 2166136261
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  let a = h >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

let planks: HTMLCanvasElement | null = null
/** A light plank pattern (the material colour tints it), repeated per metre by the caller. */
export function plankTexture(repeatX: number, repeatY: number): THREE.CanvasTexture {
  if (!planks) {
    planks = document.createElement('canvas')
    planks.width = 256
    planks.height = 256
    const g = planks.getContext('2d')!
    const rand = seeded('planks')
    for (let row = 0; row < 8; row++) {
      let x = -rand() * 120
      while (x < 256) {
        const w = 90 + rand() * 110
        const v = 200 + Math.floor(rand() * 45)
        g.fillStyle = `rgb(${v},${v - 6},${v - 14})`
        g.fillRect(x, row * 32, w, 32)
        g.fillStyle = 'rgba(40,25,10,0.55)'
        g.fillRect(x, row * 32, 2, 32)
        x += w
      }
      g.fillStyle = 'rgba(40,25,10,0.6)'
      g.fillRect(0, row * 32 + 31, 256, 1)
    }
  }
  const t = new THREE.CanvasTexture(planks)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeatX, repeatY)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  return t
}

/** Sign text: white glyphs with a soft halo, so the material colour tints it like neon. */
export function neonTexture(text: string): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 256
  const g = c.getContext('2d')!
  let size = 150
  const font = (n: number) => `700 ${n}px "Avenir Next Condensed", "Arial Narrow", system-ui, sans-serif`
  g.font = font(size)
  while (g.measureText(text).width > 940 && size > 40) {
    size -= 6
    g.font = font(size)
  }
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillStyle = '#ffffff'
  for (const blur of [42, 18]) {
    g.shadowColor = 'rgba(255,255,255,0.9)'
    g.shadowBlur = blur
    g.fillText(text, 512, 132)
  }
  g.shadowBlur = 0
  g.fillText(text, 512, 132)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** Mark a mesh whose emissive should follow its slot colour (neon, lamp shades), scaled down by `k`. */
export function emissiveFollows(m: THREE.Mesh, k = 1): THREE.Mesh {
  m.userData.emissiveFollows = k
  return m
}
