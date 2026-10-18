/**
 * Apply an entity's props to its built meshes: slot colours, per-instance hue jitter, glow and the
 * material preset. Kept separate from building so a recolour never has to rebuild geometry.
 */
import * as THREE from 'three'
import type { Material, Props } from '#shared/world/ops'
import { stylize } from '#shared/world/palette'

// Stylised for the toon shading (style/toon.ts): metal keeps some body colour (a toy's painted tin, not a
// black mirror), glass is a pale tinted shell the rim light outlines.
const PRESETS: Record<Material, Partial<THREE.MeshStandardMaterial>> = {
  matte: { roughness: 0.9, metalness: 0, transparent: false, opacity: 1 },
  wood: { roughness: 0.8, metalness: 0, transparent: false, opacity: 1 },
  metal: { roughness: 0.35, metalness: 0.55, transparent: false, opacity: 1 },
  glass: { roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45 },
  stone: { roughness: 1, metalness: 0, transparent: false, opacity: 1 }
}

export function materialLook(material?: Material): Partial<THREE.MeshStandardMaterial> {
  return material ? PRESETS[material] : {}
}

export interface LookTarget {
  color: THREE.Color
  mesh: THREE.Mesh
}

/** Target colours for every slotted mesh. Returned (not applied) so the renderer can tween to them. */
export function lookTargets(root: THREE.Object3D, props: Props, hue = 0): LookTarget[] {
  const out: LookTarget[] = []
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || !m.userData.baseColor) return
    const slot = m.userData.slot as string | undefined
    let hex = m.userData.baseColor as string
    if (slot === 'primary' && props.color) hex = props.color
    if (slot === 'trim' && props.trim) hex = props.trim
    // Snapped onto the palette (a model's "#ff0000" becomes the palette's red), then jittered.
    const color = safeColor(hex, m.userData.baseColor as string)
    color.set(stylize('#' + color.getHexString(), slot === 'glow' ? 'glow' : 'surface'))
    // Jitter only touches the primary slot (a cluster of pines varies its needles, not its trunks), and
    // mostly in lightness, so a cluster varies without leaving the palette.
    if (hue && slot === 'primary') {
      const h = props.color ? hue * 0.1 : hue * 0.35
      const hsl = { h: 0, s: 0, l: 0 }
      color.getHSL(hsl)
      color.setHSL((hsl.h + h + 1) % 1, hsl.s, Math.min(0.92, Math.max(0.08, hsl.l + hue * 0.6)))
    }
    out.push({ color, mesh: m })
  })
  return out
}

/**
 * Glow and material presets apply instantly; colour goes through lookTargets so it can wipe.
 * Loop 2: `glow` works on everything. A kind with no glow parts (a tree, a rock) or a learned kind (a castle
 * someone wished for) glows with its body: primary and trim turn emissive in their own colour (via
 * `emissiveFollows`, which the colour wipe honours). `bodyGlow` is recorded for the renderer's halo.
 */
export function applyMaterialProps(root: THREE.Object3D, props: Props, learned = false): void {
  let glowParts = false
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.userData.slot === 'glow') glowParts = true
  })
  const body = (learned || !glowParts) && (props.glow ?? 0) > 0
  root.userData.bodyGlow = body
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m.userData.slot !== 'primary' && m.userData.slot !== 'trim')) return
    const mat = m.material as THREE.MeshStandardMaterial
    if (!mat.emissive) return
    if (body) {
      if (m.userData.glowOwned === undefined) m.userData.glowOwned = m.userData.emissiveFollows ?? null
      m.userData.emissiveFollows = Math.min(1.1, 0.24 * props.glow!) * (m.userData.slot === 'trim' ? 0.6 : 1)
      // Without an asked-for colour the glow is mostly warm light; with one ("glow gold") it keeps that hue.
      m.userData.glowTint = props.color ? 0.15 : 0.5
      mat.emissiveIntensity = 1
    } else if (m.userData.glowOwned !== undefined) {
      // Glow taken away (or undone): back to the builder's own emissive behaviour.
      if (m.userData.glowOwned === null) {
        delete m.userData.emissiveFollows
        mat.emissive.setRGB(0, 0, 0)
      } else {
        m.userData.emissiveFollows = m.userData.glowOwned
      }
      delete m.userData.glowOwned
      delete m.userData.glowTint
    }
  })
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const material = m.material as THREE.MeshStandardMaterial
    const slot = m.userData.slot as string | undefined
    if (slot === 'glow') {
      material.emissiveIntensity = (m.userData.baseGlow ?? 1) * (props.glow ?? 1)
    }
    if (slot === 'primary' && props.material) {
      Object.assign(material, PRESETS[props.material])
      material.needsUpdate = true
    }
  })
  root.traverse((o) => {
    const light = o as THREE.PointLight
    if (light.isPointLight && !light.userData.cast) light.intensity = (light.userData.baseIntensity ?? 10) * (props.glow ?? 1)
  })
}

export function safeColor(hex: string, fallback: string): THREE.Color {
  // three warns and leaves the colour untouched on a bad string, so start from an impossible sentinel.
  const c = new THREE.Color(-1, -1, -1)
  c.set(hex)
  return c.r < 0 ? c.set(fallback) : c
}

// ---------- gaze override (Sprint 5: pointing) ----------

/**
 * Where the gaze ray goes through the screen, in NDC. `null` = the centre crosshair (the default).
 * Hand pointing sets it; renderer.gaze() reads it, so the reticle, HUD gaze label, `useWorld().snapshot()`
 * and `useIntent().capture()` all follow the pointed spot ("put a tower there" while pointing).
 */
let gazeOverride: [number, number] | null = null

export function setGazeOverride(ndc: [number, number] | null): void {
  gazeOverride = ndc ? [Math.max(-1, Math.min(1, ndc[0])), Math.max(-1, Math.min(1, ndc[1]))] : null
}

export function getGazeOverride(): [number, number] | null {
  return gazeOverride
}

/** The gaze ray's screen point for Raycaster.setFromCamera: the override, or the centre. */
export function gazeNdc(): THREE.Vector2 {
  return gazeOverride ? new THREE.Vector2(gazeOverride[0], gazeOverride[1]) : new THREE.Vector2(0, 0)
}
