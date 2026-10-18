/** Small three.js helpers for the renderer: overlay rings, sky sprites, contact shadows, measuring and disposal. */
import * as THREE from 'three'
import type { KindDescriptor } from '#shared/world/kinds'
import type { Vec3 } from '#shared/world/ops'
import type { Entity } from '#shared/world/types'

export function ring(inner: number, outer: number, color: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false })
  )
  m.renderOrder = 2
  return m
}

export function slotMeshes(root: THREE.Object3D, slot: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse(o => (o as THREE.Mesh).isMesh && o.userData.slot === slot && out.push(o as THREE.Mesh))
  return out
}

export function boxHeight(o: THREE.Object3D): number {
  // Measure in the body's own frame so the holder's current tween state doesn't skew it.
  const box = new THREE.Box3()
  o.updateMatrixWorld(true)
  const inv = new THREE.Matrix4().copy(o.matrixWorld).invert()
  o.traverse((c) => {
    const m = c as THREE.Mesh
    if (!m.isMesh || !m.geometry) return
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox()
    const b = m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld))
    box.union(b)
  })
  return box.isEmpty() ? 0 : box.max.y
}

export function disposeObject(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose()
    const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []
    for (const mat of mats) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture && !v.userData.shared) v.dispose()
      mat.dispose()
    }
  })
}

export function hashParts(desc: KindDescriptor): number {
  let h = 0
  for (const ch of JSON.stringify(desc.parts)) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

export function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export function v3(p: THREE.Vector3): Vec3 {
  return [round2(p.x), round2(p.y), round2(p.z)]
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** How far an entity reaches from its origin, so the reveal fog clears all of a wall or a lake. */
export function entityReach(desc: KindDescriptor, e: Entity): number {
  const s = e.props.scale ?? 1
  const len = e.props.length ?? desc.defaults.length ?? 0
  const wid = e.props.width ?? desc.defaults.width ?? 0
  return Math.max(desc.footprint, len / 2, wid / 2) * s
}

export function skyDir(p: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]).normalize()
}

let radial: THREE.Texture | null = null
/** White centre fading to black at the rim: alpha maps for the floor patch and contact shadows. */
export function radialTexture(): THREE.Texture {
  if (radial) return radial
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, '#ffffff')
  grad.addColorStop(0.55, '#bbbbbb')
  grad.addColorStop(1, '#000000')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  radial = new THREE.CanvasTexture(c)
  radial.userData.shared = true
  return radial
}

const contactGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)
contactGeo.userData.shared = true
/** A soft dark blob under furniture and learned kinds: grounds them where the sun casts no shadow. */
export function contactShadow(radius: number): THREE.Mesh {
  const m = new THREE.Mesh(contactGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, alphaMap: radialTexture(), depthWrite: false }))
  m.scale.setScalar(radius)
  m.position.y = 0.115 // just above a floor slab (0.1 m) so it shows indoors too
  m.renderOrder = 1
  m.userData.contactShadow = true
  m.raycast = () => {} // the gaze ray should hit the furniture, not its shadow
  return m
}

export function starfield(): THREE.Points {
  const n = 1400
  const pos = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    // Uniform on the upper hemisphere, thinning toward the horizon haze.
    const u = Math.random()
    const y = 0.06 + 0.94 * Math.sqrt(u)
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(1 - y * y)
    pos.set([Math.cos(a) * r * 450, y * 450, Math.sin(a) * r * 450], i * 3)
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xdfe6ff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }))
  pts.frustumCulled = false
  pts.renderOrder = -1
  return pts
}

/** A sky sprite: the moon (a crisp disc inside a halo) or the sun's glow (all halo). */
export function glowSprite(color: string, disc: boolean): THREE.Sprite {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  if (disc) {
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.13, 'rgba(255,255,255,1)')
    grad.addColorStop(0.16, 'rgba(255,255,255,0.35)')
    grad.addColorStop(0.45, 'rgba(255,255,255,0.08)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
  } else {
    grad.addColorStop(0, 'rgba(255,255,255,1)')
    grad.addColorStop(0.08, 'rgba(255,255,255,0.95)')
    grad.addColorStop(0.25, 'rgba(255,255,255,0.35)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
  }
  g.fillStyle = grad
  g.fillRect(0, 0, 256, 256)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthWrite: false, fog: false, opacity: 0 }))
  sprite.scale.setScalar(disc ? 130 : 260)
  sprite.renderOrder = -1
  sprite.visible = false
  return sprite
}

/** Raycast `targets` (already flattened to meshes) without recursing: nothing exotic can throw in here. */
export function safeHits(ray: THREE.Raycaster, targets: THREE.Object3D[]): THREE.Intersection[] {
  try {
    return ray.intersectObjects(targets, false)
  } catch {
    return []
  }
}
