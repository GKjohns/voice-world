/**
 * Shared bits for the spectacle effects: a one-shot effect shape the renderer drives with its tween clock,
 * a soft dot texture for additive particles, and an additive particle cloud.
 */
import * as THREE from 'three'

/** A one-shot effect: add `obj` to the scene, call `update(t)` with t in 0..1, then `dispose()`. */
export interface Fx {
  obj: THREE.Object3D
  update: (t: number, cam: THREE.Camera, dt: number) => void
  dispose: () => void
}

let dot: THREE.Texture | null = null
/** A soft round glow for additive points and sprites. */
export function softDot(): THREE.Texture {
  if (dot) return dot
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.2, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.22)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  dot = new THREE.CanvasTexture(c)
  dot.colorSpace = THREE.SRGBColorSpace
  dot.userData.shared = true
  return dot
}

export function additivePoints(n: number, color: THREE.ColorRepresentation, size: number): { pts: THREE.Points, pos: Float32Array, mat: THREE.PointsMaterial, geo: THREE.BufferGeometry } {
  const pos = new Float32Array(n * 3)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  const mat = new THREE.PointsMaterial({ color, size, map: softDot(), transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  const pts = new THREE.Points(geo, mat)
  pts.frustumCulled = false
  pts.renderOrder = 3
  pts.raycast = () => {}
  return { pts, pos, mat, geo }
}

/** Bright, slightly desaturated version of a colour, so sparks read as light rather than paint. */
export function lightOf(c: THREE.ColorRepresentation, lift = 0.45): THREE.Color {
  const col = new THREE.Color(c)
  return col.lerp(new THREE.Color(0xffffff), lift)
}
