/**
 * Learned kinds: build a THREE.Group from `Part[]` (plain data from a `define` op or a forged upgrade; no
 * code ever runs here). Each primitive is unit-sized and scaled to `size`, so `size` is always the part's
 * bounding box. Forged kinds add tube / lathe / extrude parts (geometry built from their point lists).
 *
 * Two builds:
 * - `buildFromParts`: one mesh per part. Haiku drafts use it, and the forge streams parts in with it.
 * - `buildFromPartsMerged`: one mesh per (slot, colour, material, glow): a 190-part forged object becomes a
 *   handful of draw calls. The merged geometry is cached by the parts hash and shared by every instance;
 *   each instance still gets fresh materials, because recolours (`applyMaterialProps`) mutate per item.
 * Materials are always the kit's `mat()` / `glowMat()` + `materialLook`: no flatShading or DoubleSide, so
 * no shader variants the warm-up (perf/precompile.ts) doesn't already have.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { Part, Shape, Slot } from '#shared/world/ops'
import { hashParts } from '#shared/world/forge'
import { stylize } from '#shared/world/palette'
import { glowMat, group, mat, mesh } from './kit/helpers'
import { materialLook } from './look'
import { bevelBox } from './style/bevel'

// Unit geometries are shared across every learned instance; meshes scale them.
const GEOMETRY: Record<Shape, () => THREE.BufferGeometry> = {
  // Painted Toy World: boxes get a normal bevel (rounded toon edges); the ramp hides facets, so fewer segments.
  box: () => bevelBox(),
  cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16),
  cone: () => new THREE.ConeGeometry(0.5, 1, 16),
  sphere: () => new THREE.SphereGeometry(0.5, 16, 12),
  torus: () => new THREE.TorusGeometry(0.375, 0.125, 12, 28),
  capsule: () => new THREE.CapsuleGeometry(0.5, 1, 6, 16).scale(1, 0.5, 1)
}
const cache = new Map<Shape, THREE.BufferGeometry>()

function geometry(shape: Shape): THREE.BufferGeometry {
  let g = cache.get(shape)
  if (!g) {
    g = GEOMETRY[shape]()
    g.userData.shared = true
    cache.set(shape, g)
  }
  return g
}

// Built shapes (tube / lathe / extrude) are cached by their parameters, so instances and rebuilds share them.
const built = new Map<string, THREE.BufferGeometry>()
const BUILT_CAP = 800

function builtGeometry(p: Part): THREE.BufferGeometry | null {
  const key = JSON.stringify([p.shape, p.points, p.radii, p.profile, p.outline, p.depth])
  let g = built.get(key)
  if (g) return g
  if (p.shape === 'tube' && p.points && p.points.length >= 2) g = tubeGeometry(p.points, p.radii ?? [0.2])
  else if (p.shape === 'lathe' && p.profile && p.profile.length >= 2) g = latheGeometry(p.profile)
  else if (p.shape === 'extrude' && p.outline && p.outline.length >= 3) g = extrudeGeometry(p.outline, p.depth ?? 0.1)
  if (!g) return null
  g.userData.shared = true
  if (built.size >= BUILT_CAP) {
    const first = built.keys().next().value
    if (first !== undefined) built.delete(first) // dropped from the cache, never disposed while a body may use it
  }
  built.set(key, g)
  return g
}

/** A Catmull-Rom swept, tapered body through `points` with a radius per point (conjure-progressive's tube), capped both ends. */
function tubeGeometry(points: number[][], radii: number[], radial = 12): THREE.BufferGeometry {
  const pts = points.map(p => new THREE.Vector3(p[0], p[1], p[2]))
  const curve: THREE.Curve<THREE.Vector3> = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : new THREE.LineCurve3(pts[0]!, pts[1]!)
  const segs = Math.max(8, pts.length * 6)
  const frames = curve.computeFrenetFrames(segs, false)
  const rAt = (t: number) => {
    if (radii.length === 1) return radii[0]!
    const f = t * (radii.length - 1)
    const i = Math.min(radii.length - 2, Math.floor(f))
    return radii[i]! + (radii[i + 1]! - radii[i]!) * (f - i)
  }
  const pos: number[] = []
  const idx: number[] = []
  const ring: THREE.Vector3[][] = []
  const n = new THREE.Vector3()
  for (let i = 0; i <= segs; i++) {
    const t = i / segs
    const c = curve.getPointAt(t)
    const r = Math.max(0.005, rAt(t))
    const row: THREE.Vector3[] = []
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * Math.PI * 2
      n.copy(frames.normals[i]!).multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i]!, Math.sin(a))
      const v = c.clone().addScaledVector(n, r)
      row.push(v)
      pos.push(v.x, v.y, v.z)
    }
    ring.push(row)
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j
      const b = i * radial + ((j + 1) % radial)
      const c = a + radial
      const d = b + radial
      idx.push(a, c, b, b, c, d)
    }
  }
  // End caps get their own vertices, so the rim stays crisp instead of smoothing into the side.
  for (const [i, flip] of [[0, true], [segs, false]] as const) {
    const c = curve.getPointAt(i / segs)
    const ci = pos.length / 3
    pos.push(c.x, c.y, c.z)
    for (const v of ring[i]!) pos.push(v.x, v.y, v.z)
    for (let j = 0; j < radial; j++) {
      const a = ci + 1 + j
      const b = ci + 1 + ((j + 1) % radial)
      if (flip) idx.push(ci, a, b)
      else idx.push(ci, b, a)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

/** A profile turned around y. Open ends are closed to the axis, so front-face culling never shows the inside. */
function latheGeometry(profile: [number, number][]): THREE.BufferGeometry {
  const prof = profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y))
  if (prof[0]!.x > 1e-3) prof.unshift(new THREE.Vector2(0, prof[0]!.y))
  if (prof[prof.length - 1]!.x > 1e-3) prof.push(new THREE.Vector2(0, prof[prof.length - 1]!.y))
  return new THREE.LatheGeometry(prof, 18)
}

/** A 2D outline in local x–y with `depth` thickness along z, centred on z. */
function extrudeGeometry(outline: [number, number][], depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)))
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  g.translate(0, 0, -depth / 2)
  return g
}

/** Which part takes the primary slot when the parts name none: the biggest, so "make it red" still works. */
function slotsOf(parts: Part[]): (Slot | null)[] {
  const hasPrimary = parts.some(p => p.slot === 'primary')
  const biggest = parts.reduce((bi, p, i) => volume(p) > volume(parts[bi]!) ? i : bi, 0)
  return parts.map((p, i) => p.slot ?? (!hasPrimary && i === biggest ? 'primary' : null))
}

function partMaterial(p: Part, slot: Slot | null, mass = 0): THREE.MeshStandardMaterial {
  const material = slot === 'glow' ? glowMat(p.color, 1.4) : mat(p.color)
  if (slot !== 'glow') {
    Object.assign(material, materialLook(p.material))
    // Gen loop 7: the palette's lightness floor rises with the part's volume share (no near-black masses).
    material.color.set(stylize('#' + new THREE.Color(p.color).getHexString(), 'surface', mass, p.material === 'metal'))
  }
  return material
}

/** A part's share of the summed volume of `all` (the gen loop 7 lightness floor's input). */
export function massShare(p: Part, all: Part[]): number {
  const total = all.reduce((a, q) => a + volume(q), 0)
  return total > 0 ? volume(p) / total : 0
}

/** One part as a mesh (null if its shape data can't build). `mass`: its volume share of the object. */
export function partMesh(p: Part, slot: Slot | null = p.slot ?? null, mass = 0): THREE.Mesh | null {
  const primitive = p.shape in GEOMETRY
  const geo = primitive ? geometry(p.shape as Shape) : builtGeometry(p)
  if (!geo) return null
  const m = mesh(geo, partMaterial(p, slot, mass), slot, p.at[0], p.at[1], p.at[2])
  m.userData.mass = mass
  if (primitive) m.scale.set(p.size[0], p.size[1], p.size[2])
  if (p.rot) m.rotation.set(p.rot[0], p.rot[1], p.rot[2])
  // Explicit-colour parts remember theirs, so a later trim/primary recolour only touches slotted parts.
  m.userData.baseColor = p.color
  return m
}

export function buildFromParts(parts: Part[]): THREE.Group {
  const g = group()
  const slots = slotsOf(parts)
  const total = parts.reduce((a, p) => a + volume(p), 0) || 1
  parts.forEach((p, i) => {
    const m = partMesh(p, slots[i]!, volume(p) / total)
    if (m) g.add(m)
  })
  return g
}

interface MergedPiece {
  geo: THREE.BufferGeometry
  part: Part // a representative (colour, material)
  slot: Slot | null
  mass: number // share of the object's summed part volume
}
const merged = new Map<string, MergedPiece[]>()

/**
 * One mesh per (slot, colour, material): each part's geometry is baked with its own transform, stripped to
 * position + normal and merged. Cached by the parts hash, so every instance of a forged kind shares it.
 */
export function buildFromPartsMerged(parts: Part[]): THREE.Group {
  const key = hashParts(parts)
  let pieces = merged.get(key)
  if (!pieces) {
    pieces = []
    const slots = slotsOf(parts)
    const groups = new Map<string, { part: Part, slot: Slot | null, geos: THREE.BufferGeometry[], vol: number }>()
    const total = parts.reduce((a, p) => a + volume(p), 0) || 1
    const m4 = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    parts.forEach((p, i) => {
      const slot = slots[i]!
      const primitive = p.shape in GEOMETRY
      const src = primitive ? geometry(p.shape as Shape) : builtGeometry(p)
      if (!src) return
      const g0 = src.index ? src.toNonIndexed() : src.clone()
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', g0.getAttribute('position'))
      g.setAttribute('normal', g0.getAttribute('normal'))
      e.set(p.rot?.[0] ?? 0, p.rot?.[1] ?? 0, p.rot?.[2] ?? 0)
      q.setFromEuler(e)
      m4.compose(new THREE.Vector3(...p.at), q, primitive ? new THREE.Vector3(...p.size) : new THREE.Vector3(1, 1, 1))
      g.applyMatrix4(m4)
      const k = `${slot ?? '-'}|${p.color.toLowerCase()}|${p.material ?? '-'}`
      const entry = groups.get(k) ?? { part: p, slot, geos: [], vol: 0 }
      entry.geos.push(g)
      entry.vol += volume(p)
      groups.set(k, entry)
    })
    for (const { part, slot, geos, vol } of groups.values()) {
      const geo = mergeGeometries(geos, false)
      for (const g of geos) g.dispose()
      if (!geo) continue
      geo.computeBoundingBox()
      geo.computeBoundingSphere()
      geo.userData.shared = true
      pieces.push({ geo, part, slot, mass: vol / total })
    }
    merged.set(key, pieces)
  }
  const root = group()
  for (const { geo, part, slot, mass } of pieces) {
    const m = mesh(geo, partMaterial(part, slot, mass), slot)
    m.userData.baseColor = part.color
    m.userData.mass = mass
    root.add(m)
  }
  return root
}

function volume(p: Part): number {
  return Math.abs(p.size[0] * p.size[1] * p.size[2])
}
