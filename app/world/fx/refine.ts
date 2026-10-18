/**
 * The progressive replace (conjure-progressive's staged look, in this renderer):
 * - `ghost`: the draft turns into a translucent gold ghost while the refined version grows through it;
 *   the ghost level falls as refined parts arrive. `unghost` brings it back if the forge is discarded.
 * - `popIn`: one refined part grows in with an elastic scale and a gold flash that decays (1 − t)².
 * - `sweep`: the swap. A band of light (arrival.ts' shimmer) climbs the object with glints riding it; the
 *   old body fades out below the band while the new one fades in above it.
 * Only existing material parameters change (opacity, transparent, depthWrite, emissive), so no program
 * variant appears that the warm-up hasn't compiled (renderer.warmExtras adds a transparent standard mesh).
 */
import * as THREE from 'three'
import { additivePoints, lightOf } from './common'
import type { Fx } from './common'
import { shimmer } from './arrival'

const GOLD = new THREE.Color('#ffc65a')

interface Orig {
  transparent: boolean
  opacity: number
  depthWrite: boolean
  emissive: THREE.Color
  emissiveIntensity: number
}

function std(m: THREE.Mesh): THREE.MeshStandardMaterial | null {
  const mat = m.material as THREE.MeshStandardMaterial
  return mat && (mat as { isMeshStandardMaterial?: boolean }).isMeshStandardMaterial ? mat : null
}

export function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh)
  })
  return out
}

function remember(m: THREE.Mesh, mat: THREE.MeshStandardMaterial): Orig {
  if (!m.userData.ghostOrig) {
    m.userData.ghostOrig = { transparent: mat.transparent, opacity: mat.opacity, depthWrite: mat.depthWrite, emissive: mat.emissive.clone(), emissiveIntensity: mat.emissiveIntensity } satisfies Orig
  }
  return m.userData.ghostOrig as Orig
}

/** Set the ghost level (1 = solid draft, ~0.5 = ghost, → 0.1 as the refined version fills in). */
export function ghost(body: THREE.Object3D, level: number): void {
  for (const m of meshesOf(body)) {
    const mat = std(m)
    if (!mat) continue
    const o = remember(m, mat)
    if (!mat.transparent) {
      mat.transparent = true
      mat.needsUpdate = true
    }
    mat.depthWrite = false
    mat.opacity = o.opacity * level
    if (m.userData.slot !== 'glow') {
      mat.emissive.copy(GOLD)
      mat.emissiveIntensity = 0.18
    }
    m.castShadow = false
  }
}

/** Blend a ghosted body back toward solid (t 0 → 1); at 1 it is exactly as it was. */
export function unghost(body: THREE.Object3D, t: number, from = 0.5): void {
  for (const m of meshesOf(body)) {
    const mat = std(m)
    const o = m.userData.ghostOrig as Orig | undefined
    if (!mat || !o) continue
    mat.opacity = o.opacity * (from + (1 - from) * t)
    if (m.userData.slot !== 'glow') {
      mat.emissive.copy(GOLD).lerp(o.emissive, t)
      mat.emissiveIntensity = 0.18 + (o.emissiveIntensity - 0.18) * t
    }
    if (t >= 1) {
      mat.opacity = o.opacity
      mat.emissive.copy(o.emissive)
      mat.emissiveIntensity = o.emissiveIntensity
      mat.depthWrite = o.depthWrite
      if (mat.transparent !== o.transparent) {
        mat.transparent = o.transparent
        mat.needsUpdate = true
      }
      m.castShadow = true
      delete m.userData.ghostOrig
    }
  }
}

/** An elastic pop with a little overshoot. */
export function elastic(t: number): number {
  if (t <= 0) return 0
  if (t >= 1) return 1
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1
}

/**
 * Prepare a freshly built part mesh for its pop: scale from nothing, gold flash. Returns the per-frame
 * update for t in 0..1 (call with 1 to finish).
 */
export function popIn(m: THREE.Mesh): (t: number) => void {
  const base = m.scale.clone()
  const mat = std(m)
  const glow = m.userData.slot === 'glow'
  const e0 = mat?.emissive.clone()
  const i0 = mat?.emissiveIntensity ?? 0
  m.scale.setScalar(0.001)
  if (mat && !glow) {
    mat.emissive.copy(GOLD)
    mat.emissiveIntensity = 0.9
  }
  return (t) => {
    m.scale.copy(base).multiplyScalar(Math.max(0.001, elastic(t)))
    if (mat && !glow) {
      const k = (1 - t) ** 2
      mat.emissive.copy(e0!).lerp(GOLD, k)
      mat.emissiveIntensity = i0 + (0.9 - i0) * k
    }
  }
}

/** Make every material of `body` fade-able (remembering what it should end at). */
interface Fade { mat: THREE.MeshStandardMaterial, start: number, target: number, transparent: boolean, depthWrite: boolean, y: number }

function fadeable(body: THREE.Object3D): Fade[] {
  const out: Fade[] = []
  body.updateWorldMatrix(true, true)
  const box = new THREE.Box3()
  for (const m of meshesOf(body)) {
    const mat = std(m)
    if (!mat) continue
    const o = m.userData.ghostOrig as Orig | undefined
    box.setFromObject(m)
    out.push({ mat, start: mat.opacity, target: o ? o.opacity : mat.opacity, transparent: o ? o.transparent : mat.transparent, depthWrite: o ? o.depthWrite : mat.depthWrite, y: (box.min.y + box.max.y) / 2 })
    if (!mat.transparent) {
      mat.transparent = true
      mat.needsUpdate = true
    }
  }
  return out
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The swap: a band of light climbs from below the object to above it over the effect's duration. `old`
 * (if given) fades out below the band, `next` fades in above it. At t = 1 `next` is exactly solid, and
 * the caller removes `old`. World-space y range [y0, y1]; centre and radius for the band and the glints.
 */
export function sweep(center: THREE.Vector3, radius: number, y0: number, y1: number, color: THREE.ColorRepresentation, next: THREE.Object3D | null, old: THREE.Object3D[] = []): Fx {
  const band = shimmer(center.clone().setY(0), radius, Math.max(0.5, y1), color)
  const n = 60
  const glints = additivePoints(n, lightOf('#fff0c8', 0.3), 0.18)
  const seeds = Array.from({ length: n }, () => [Math.random() * Math.PI * 2, 0.6 + Math.random() * 0.5, Math.random()])
  const obj = new THREE.Group()
  obj.add(band.obj, glints.pts)
  const fresh = next ? fadeable(next) : []
  const gone = old.flatMap(o => fadeable(o))
  for (const f of fresh) {
    f.mat.opacity = 0
    f.mat.depthWrite = false
  }
  const span = Math.max(0.6, y1 - y0)
  const bw = Math.max(0.5, span * 0.18)
  let done = false
  return {
    obj,
    update: (t, cam, dt) => {
      band.update(t, cam, dt)
      const s = y0 - bw + (span + 2 * bw) * smoothstep(0, 1, t)
      for (const f of fresh) f.mat.opacity = f.target * smoothstep(f.y - bw, f.y + bw * 0.3, s)
      for (const f of gone) f.mat.opacity = f.start * (1 - smoothstep(f.y - bw * 0.3, f.y + bw, s))
      const p = glints.pos
      for (let i = 0; i < n; i++) {
        const [a, rr, ph] = seeds[i]!
        const ang = a! + t * 2.2
        p[i * 3] = center.x + Math.cos(ang) * radius * rr!
        p[i * 3 + 1] = s + Math.sin(ph! * 20 + t * 9) * 0.12
        p[i * 3 + 2] = center.z + Math.sin(ang) * radius * rr!
      }
      glints.geo.attributes.position!.needsUpdate = true
      glints.mat.opacity = Math.sin(Math.PI * t) * 0.9
      if (t >= 1 && !done) {
        done = true
        for (const f of fresh) {
          f.mat.opacity = f.target
          f.mat.depthWrite = f.depthWrite
          if (f.mat.transparent !== f.transparent) {
            f.mat.transparent = f.transparent
            f.mat.needsUpdate = true
          }
        }
      }
    },
    dispose: () => {
      band.dispose()
      glints.geo.dispose()
      glints.mat.dispose()
    }
  }
}
