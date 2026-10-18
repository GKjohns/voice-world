// Terrain kit (Loop 2): mountains, a mountain range, hills, cliffs, a volcano, a waterfall, a river, an
// island, a canyon, and a giant moon and a ringed planet for the sky. The landforms mesh the pure height
// functions in shared/world/terrain.ts, so `groundHeight` and what you see agree. Faceted, flat-shaded,
// with an aerial-perspective fog (distant peaks fade toward the sky but keep their silhouette).
import * as THREE from 'three'
import { KIT } from '#shared/world/kinds'
import type { Slot } from '#shared/world/ops'
import { fbm, surfaceHeight } from '#shared/world/terrain'
import type { Surface } from '#shared/world/terrain'
import { group, mesh, seeded, snapColor } from './helpers'
import { styleShader } from '../style/toon'
import { waterMaterial, waterPatch } from '../style/water'
import type { Build } from './helpers'

// ---------- aerial perspective ----------

/**
 * Terrain fog. Normal scene fog swallows everything past ~150–240 m, which would hide a mountain on the
 * horizon entirely. Terrain fades on a far longer scale (to ~7× the fog distance), and high faces fade
 * less than low ones, so a range at 800 m is a soft blue-grey silhouette with bright snow, while its foot
 * sinks into the same ground mist as everything else. During a teleport (fog pulled in to metres) it veils fully.
 */
const AERIAL = `#ifdef USE_FOG
  float nearF = smoothstep(fogNear, fogFar, vFogDepth);
  float aerial = smoothstep(fogFar * 0.8, fogFar * 7.0, vFogDepth) * (0.9 - 0.34 * clamp(vTerrainY / 320.0, 0.0, 1.0));
  float mist = nearF * (1.0 - smoothstep(0.0, 26.0, vTerrainY));
  float veil = 1.0 - smoothstep(12.0, 40.0, fogFar);
  float fogFactor = max(max(aerial, mist), veil);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
#endif`

function aerial<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (sh) => {
    styleShader(sh) // the shared toon/fog uniforms (style/toon.ts): this hook replaces the global one
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vTerrainY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvTerrainY = (modelMatrix * vec4(transformed, 1.0)).y;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vTerrainY;')
      .replace('#include <fog_fragment>', AERIAL)
  }
  m.customProgramCacheKey = () => 'conjure-aerial'
  return m
}

/** The island's sea: stylised water that also keeps the terrain's long aerial fade to the horizon. */
function aerialWater(color: THREE.Color): THREE.MeshStandardMaterial {
  const m = aerial(new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0 }))
  const fogPatch = m.onBeforeCompile
  m.onBeforeCompile = (sh, r) => {
    fogPatch.call(m, sh, r)
    waterPatch(sh)
  }
  m.customProgramCacheKey = () => 'conjure-aerial-water'
  return m
}

function tmat(color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return aerial(new THREE.MeshStandardMaterial({ color: snapColor(color, 'terrain'), roughness: 0.95, flatShading: true, vertexColors: true, ...opts }))
}

function land(geo: THREE.BufferGeometry, material: THREE.Material, slot: Slot | null): THREE.Mesh {
  const m = mesh(geo, material, slot)
  // Far terrain is outside the sun's 90 m shadow box anyway; near hills still catch shadows.
  m.castShadow = false
  return m
}

// ---------- heightfield → faceted meshes ----------

interface Tri { cx: number, cy: number, cz: number, ny: number }
type Classify = (t: Tri) => Slot

/**
 * Mesh a height function over a jittered grid, splitting triangles into slots (rock / snow / lava…).
 * Every slot shares the same vertices, so the seams are invisible. Off-shape cells are skipped; the
 * outline tucks just under the ground.
 */
function heightfield(h: (x: number, z: number) => number, x0: number, x1: number, z0: number, z1: number, nx: number, nz: number, classify: Classify, seed: string): Map<Slot, THREE.BufferGeometry> {
  const rand = seeded(seed)
  const dx = (x1 - x0) / nx
  const dz = (z1 - z0) / nz
  const P: number[][] = []
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      const edge = i === 0 || j === 0 || i === nx || j === nz
      const x = x0 + i * dx + (edge ? 0 : (rand() - 0.5) * dx * 0.6)
      const z = z0 + j * dz + (edge ? 0 : (rand() - 0.5) * dz * 0.6)
      const y = h(x, z)
      P.push([x, y > 0.02 ? y : -0.8, z])
    }
  }
  const buckets = new Map<Slot, { pos: number[], col: number[] }>()
  const a = new THREE.Vector3()
  const b = new THREE.Vector3()
  const c = new THREE.Vector3()
  const n = new THREE.Vector3()
  const push = (p: number[], q: number[], r: number[]) => {
    if (p[1]! <= 0 && q[1]! <= 0 && r[1]! <= 0) return
    a.fromArray(p)
    b.fromArray(q)
    c.fromArray(r)
    n.subVectors(c, b).cross(a.clone().sub(b)).normalize()
    if (n.y < 0) n.negate()
    const slot = classify({ cx: (a.x + b.x + c.x) / 3, cy: (a.y + b.y + c.y) / 3, cz: (a.z + b.z + c.z) / 3, ny: n.y })
    let bk = buckets.get(slot)
    if (!bk) buckets.set(slot, bk = { pos: [], col: [] })
    // Facet brightness jitter: low-poly terrain reads as carved, not plastic.
    const k = 0.84 + rand() * 0.22
    // Wind each triangle so its normal points up.
    const up = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y >= 0
    const verts = up ? [p, q, r] : [p, r, q]
    for (const v of verts) {
      bk.pos.push(v[0]!, v[1]!, v[2]!)
      bk.col.push(k, k, k)
    }
  }
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const p00 = P[j * (nx + 1) + i]!
      const p10 = P[j * (nx + 1) + i + 1]!
      const p01 = P[(j + 1) * (nx + 1) + i]!
      const p11 = P[(j + 1) * (nx + 1) + i + 1]!
      if ((i + j) % 2) {
        push(p00, p10, p11)
        push(p00, p11, p01)
      } else {
        push(p00, p10, p01)
        push(p10, p11, p01)
      }
    }
  }
  const out = new Map<Slot, THREE.BufferGeometry>()
  for (const [slot, bk] of buckets) {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(bk.col, 3))
    g.computeVertexNormals()
    g.computeBoundingSphere()
    out.set(slot, g)
  }
  return out
}

function dims(kind: string): { R: number, H: number } {
  const d = KIT[kind]!
  return { R: d.footprint, H: d.baseHeight }
}

function landform(surface: Surface, kind: string, props: { length?: number }, extent: [number, number, number, number], res: [number, number], classify: Classify, mats: Partial<Record<Slot, THREE.MeshStandardMaterial>>): THREE.Group {
  const { R, H } = dims(kind)
  const geos = heightfield((x, z) => surfaceHeight(surface, x, z, R, H, props), ...extent, ...res, classify, kind)
  const g = group()
  for (const [slot, geo] of geos) g.add(land(geo, mats[slot] ?? mats.primary!, slot))
  return g
}

// ---------- landforms ----------

const snowline = (H: number) => (t: Tri) => {
  const line = H * (0.5 + 0.09 * fbm(t.cx / 40, t.cz / 40, 77))
  return t.cy > line && t.ny > 0.42 ? 'trim' : 'primary'
}

export const mountain: Build = () => {
  const { R, H } = dims('mountain')
  return landform('mountain', 'mountain', {}, [-R * 1.4, R * 1.4, -R * 1.05, R * 1.05], [46, 36], snowline(H), {
    primary: tmat('#6f6a72'), trim: tmat('#f3f5fa', { roughness: 0.7 })
  })
}

export const mountain_range: Build = ({ length = 800 }) => {
  const { R, H } = dims('mountain_range')
  const half = length / 2 + R * 1.6
  const bow = (length / 2) ** 2 / (2 * 650)
  const nx = Math.min(160, Math.round(length / 9))
  return landform('range', 'mountain_range', { length }, [-half, half, -R * 1.4, R * 1.4 + bow], [nx, 34], snowline(H * 0.92), {
    primary: tmat('#66647a'), trim: tmat('#f3f5fa', { roughness: 0.7 })
  })
}

export const hill: Build = () => {
  const { R } = dims('hill')
  return landform('hill', 'hill', {}, [-R, R, -R, R], [30, 30], t => t.ny < 0.8 ? 'trim' : 'primary', {
    primary: tmat('#5f8046'), trim: tmat('#7a7466')
  })
}

export const island: Build = () => {
  const { R } = dims('island')
  const g = landform('island', 'island', {}, [-R, R, -R, R], [28, 28], t => t.cy < 1.6 ? 'trim' : 'primary', {
    primary: tmat('#5f8a46'), trim: tmat('#d8c38f')
  })
  const sea = mesh(new THREE.CircleGeometry(R * 2.5, 64).rotateX(-Math.PI / 2), aerialWater(snapColor('#3f7f9a')), null, 0, 0.3, 0)
  sea.castShadow = false
  g.add(sea)
  // A few windswept trees on the crown.
  const rand = seeded('island-trees')
  for (let i = 0; i < 7; i++) {
    const a = rand() * Math.PI * 2
    const d = rand() * R * 0.45
    const x = Math.cos(a) * d
    const z = Math.sin(a) * d
    const y = surfaceHeight('island', x, z, R, dims('island').H)
    const tree = mesh(new THREE.ConeGeometry(1.6, 5.5, 6), tmat('#355f34'), null, x, y + 2.6, z)
    g.add(tree)
  }
  return g
}

export const cliff: Build = () => {
  const { R, H } = dims('cliff')
  const strata = (t: Tri): Slot => t.ny > 0.82 && t.cy > H * 0.8 ? 'trim' : 'primary'
  const g = landform('mesa', 'cliff', {}, [-R * 1.9, R * 1.9, -R * 1.1, R * 1.1], [44, 26], strata, {
    primary: tmat('#8a6e58'), trim: tmat('#5f7d45')
  })
  bandColors(g, 5.5)
  return g
}

export const canyon: Build = ({ length = 320 }) => {
  const { H } = dims('canyon')
  const g = landform('canyon', 'canyon', { length }, [-110, 110, -length / 2, length / 2], [64, Math.min(110, Math.round(length / 3))], t => t.ny > 0.85 && t.cy > H * 0.55 ? 'trim' : 'primary', {
    primary: tmat('#b0623e'), trim: tmat('#d89a6a')
  })
  bandColors(g, 7)
  return g
}

/** Sedimentary banding: darken and lighten the vertex colours in horizontal layers. */
function bandColors(g: THREE.Group, every: number): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const pos = m.geometry.getAttribute('position')
    const col = m.geometry.getAttribute('color')
    if (!col) return
    for (let i = 0; i < pos.count; i += 3) {
      const y = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3
      const band = 0.82 + 0.2 * Math.sin(y / every) + 0.08 * Math.sin(y / (every * 0.37))
      for (let k = 0; k < 3; k++) col.setXYZ(i + k, col.getX(i + k) * band, col.getY(i + k) * band, col.getZ(i + k) * band)
    }
    col.needsUpdate = true
  })
}

// ---------- volcano ----------

let puffTex: THREE.Texture | null = null
function puffTexture(): THREE.Texture {
  if (puffTex) return puffTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62)
  grad.addColorStop(0, 'rgba(255,255,255,0.9)')
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 128, 128)
  puffTex = new THREE.CanvasTexture(c)
  return puffTex
}

/** A looping plume of soft sprites rising from `y0`, widening and fading as it climbs. */
function plume(n: number, y0: number, rise: number, width: number, color: string, opacity: number, speed: number, glowBase?: string): THREE.Group {
  const g = group()
  const rand = seeded('plume' + n + color)
  const items: { s: THREE.Sprite, phase: number, drift: number, ang: number }[] = []
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color, transparent: true, depthWrite: false, opacity: 0, fog: false }))
    s.raycast = () => {} // smoke is not something you can look at or bump into
    g.add(s)
    items.push({ s, phase: i / n, drift: 0.4 + rand() * 0.8, ang: rand() * Math.PI * 2 })
  }
  const base = new THREE.Color(color)
  const hot = new THREE.Color(glowBase ?? color)
  g.userData.animate = (t: number) => {
    for (const it of items) {
      const k = (it.phase + t * speed) % 1
      const y = y0 + k * rise
      const r = width * (0.35 + k * 1.6)
      it.s.position.set(Math.cos(it.ang) * r * 0.25 * it.drift + k * width * 0.9, y, Math.sin(it.ang) * r * 0.25 * it.drift)
      it.s.scale.setScalar(r)
      const m = it.s.material
      m.opacity = opacity * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k * 0.6)
      m.color.copy(hot).lerp(base, Math.min(1, k * 3))
    }
  }
  return g
}

export const volcano: Build = () => {
  const { R, H } = dims('volcano')
  const tc = 0.14
  const classify = (t: Tri): Slot => {
    const d = Math.hypot(t.cx, t.cz) / R
    if (d < tc * 0.85) return 'glow'
    // Lava rivers: narrow radial streaks down the upper flanks.
    const ang = Math.atan2(t.cz, t.cx)
    const streak = Math.abs(Math.sin(ang * 5 + fbm(d * 6, ang, 81) * 2.2))
    if (d < 0.62 && streak < 0.07 + 0.05 * (1 - d)) return 'glow'
    return d < 0.4 ? 'trim' : 'primary'
  }
  const glow = tmat('#ff3b0a', { emissive: '#ff2a00', emissiveIntensity: 2.6, roughness: 0.6 })
  const g = landform('volcano', 'volcano', {}, [-R, R, -R, R], [56, 56], classify, {
    primary: tmat('#3d3533'), trim: tmat('#26201f'), glow
  })
  const smoke = plume(40, H * 0.98, H * 1.7, R * 0.42, '#5a5456', 0.8, 0.028, '#ff6a2a')
  const ash = plume(10, H * 0.98, H * 0.5, R * 0.07, '#ffb070', 0.5, 0.11)
  // The crater's glow lights the underside of the plume: an additive halo over the rim.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTexture(), color: '#ff5a1a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
  halo.raycast = () => {}
  halo.position.set(0, H * 1.02, 0)
  halo.scale.set(R * 0.75, R * 0.4, 1)
  g.add(smoke, ash, halo)
  // The renderer animates every descendant (the plumes tick themselves); this just breathes the lava.
  const lava = g.children.find(m => m.userData.slot === 'glow') as THREE.Mesh | undefined
  g.userData.animate = (t: number) => {
    if (lava) (lava.material as THREE.MeshStandardMaterial).emissiveIntensity = 2.6 * (0.85 + 0.15 * Math.sin(t * 2.3) + 0.06 * Math.sin(t * 7.1))
  }
  return g
}

// ---------- water ----------

let streakTex: THREE.CanvasTexture | null = null
/** Vertical foam streaks; scrolled along v it reads as falling or flowing water. */
function streakTexture(): THREE.CanvasTexture {
  if (streakTex) return streakTex
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 256
  const g = c.getContext('2d')!
  g.fillStyle = '#b8d4e6'
  g.fillRect(0, 0, 128, 256)
  const rand = seeded('streaks')
  for (let i = 0; i < 70; i++) {
    const x = rand() * 128
    const w = 1 + rand() * 4
    const y = rand() * 256
    const h = 40 + rand() * 160
    g.fillStyle = `rgba(255,255,255,${0.35 + rand() * 0.55})`
    g.fillRect(x, y, w, h)
    g.fillRect(x, y - 256, w, h)
  }
  streakTex = new THREE.CanvasTexture(c)
  streakTex.wrapS = streakTex.wrapT = THREE.RepeatWrapping
  streakTex.colorSpace = THREE.SRGBColorSpace
  return streakTex
}

export const waterfall: Build = () => {
  const { H } = dims('waterfall')
  const g = group()
  // Its own rock lip and face, so it stands alone or merges into a cliff behind it.
  const rock = aerial(new THREE.MeshStandardMaterial({ color: '#6b6460', roughness: 0.95, flatShading: true }))
  const face = new THREE.DodecahedronGeometry(1, 0)
  const rand = seeded('falls')
  // A dark wet rock face behind the sheet (hidden against a cliff, the backdrop when it stands alone),
  // and boulders around the plunge pool.
  const back = land(new THREE.BoxGeometry(11, H, 4, 3, 8, 1), rock, 'trim')
  const bp = back.geometry.getAttribute('position')
  for (let i = 0; i < bp.count; i++) bp.setXYZ(i, bp.getX(i) * (1 + (rand() - 0.5) * 0.25), bp.getY(i), bp.getZ(i) + (rand() - 0.5) * 1.2)
  back.geometry.computeVertexNormals()
  back.position.set(0, H / 2, -8)
  g.add(back)
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.05 + 0.9 * (i / 6))
    const m = land(face.clone(), rock, 'trim')
    m.position.set(Math.cos(a) * 9.5, 0.6, 2 - Math.sin(a) * 4 + (i % 2) * 1.5 - 6)
    m.scale.set(2 + rand() * 1.6, 1.4 + rand(), 2 + rand())
    m.rotation.set(rand() * 3, rand() * 3, rand() * 3)
    g.add(m)
  }
  // The sheet: a curved ribbon that bows out from the lip, streaks scrolling down it.
  const tex = streakTexture().clone()
  tex.needsUpdate = true
  tex.repeat.set(1.5, 3)
  const sheet = new THREE.PlaneGeometry(8, H, 4, 24)
  const p = sheet.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + H / 2
    const fall = 1 - y / H
    p.setXYZ(i, p.getX(i) * (1 + fall * 0.35), y, -6 + 5 * fall * fall)
  }
  sheet.computeVertexNormals()
  const water = new THREE.MeshStandardMaterial({ color: '#cfe8f6', map: tex, emissive: '#5f8fae', emissiveIntensity: 0.35, emissiveMap: tex, transparent: true, opacity: 0.92, roughness: 0.3, side: THREE.DoubleSide })
  const fallMesh = mesh(sheet, water, 'primary')
  fallMesh.castShadow = false
  g.add(fallMesh)
  const pool = mesh(new THREE.CircleGeometry(10, 40).rotateX(-Math.PI / 2), waterMaterial(snapColor('#3f7f9a')), null, 0, 0.08, 0)
  pool.castShadow = false
  const foam = mesh(new THREE.RingGeometry(1.5, 6, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false }), null, 0, 0.12, -1)
  foam.castShadow = false
  const mist = plume(14, 0.5, 10, 2.6, '#ffffff', 0.45, 0.18)
  mist.position.set(0, 0, -1)
  g.add(pool, foam, mist)
  g.userData.animate = (t: number) => {
    tex.offset.y = (t * 0.9) % 1
    ;(foam.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.12 * Math.sin(t * 5)
    foam.scale.setScalar(1 + 0.06 * Math.sin(t * 3.3))
  }
  return g
}

/** The river's centreline offset at z (gentle meanders). */
function meander(z: number, length: number): number {
  return Math.sin((z / length) * Math.PI * 3.1) * 14 + Math.sin(z / 23) * 3
}

function ribbon(length: number, width: number, y: number, segs: number): THREE.BufferGeometry {
  const pos: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  for (let i = 0; i <= segs; i++) {
    const z = -length / 2 + (i / segs) * length
    const x = meander(z, length)
    const dxdz = (meander(z + 0.5, length) - meander(z - 0.5, length))
    const nx = 1 / Math.hypot(1, dxdz)
    const nz = -dxdz * nx
    pos.push(x - nx * width / 2, y, z - nz * width / 2, x + nx * width / 2, y, z + nz * width / 2)
    uv.push(0, i / segs * length / 20, 1, i / segs * length / 20)
    if (i < segs) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

export const river: Build = ({ length = 240, width = 14 }) => {
  const segs = Math.min(200, Math.round(length / 2))
  const water = mesh(ribbon(length, width, 0.07, segs), waterMaterial(snapColor('#3f7f9a'), { side: THREE.DoubleSide }), 'primary')
  const banks = mesh(ribbon(length, width + 7, 0.035, segs), new THREE.MeshStandardMaterial({ color: '#b9a27a', roughness: 1, side: THREE.DoubleSide }), 'trim')
  const tex = streakTexture().clone()
  tex.needsUpdate = true
  tex.repeat.set(1, 1)
  const flow = new THREE.Mesh(ribbon(length, width * 0.9, 0.09, segs), new THREE.MeshBasicMaterial({ map: tex, color: '#ffffff', transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }))
  for (const m of [water, banks]) m.castShadow = false
  const g = group(banks, water, flow)
  g.userData.animate = (t: number) => {
    tex.offset.y = -(t * 0.12) % 1
  }
  return g
}

// ---------- sky bodies ----------

export const giant_moon: Build = () => {
  const geo = new THREE.IcosahedronGeometry(45, 3)
  const p = geo.getAttribute('position')
  const v = new THREE.Vector3()
  const col: number[] = []
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const n = fbm(v.x / 14, v.z / 14 + v.y / 9, 5)
    v.multiplyScalar(1 + 0.025 * n)
    p.setXYZ(i, v.x, v.y, v.z)
    const k = 0.78 + 0.25 * (n > 0.15 ? 0.4 : 1) * (0.7 + 0.3 * n)
    col.push(k, k, k)
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  geo.computeVertexNormals()
  const m = mesh(geo, new THREE.MeshStandardMaterial({ color: '#e9e6dc', emissive: '#bdb8aa', emissiveIntensity: 0.45, vertexColors: true, flatShading: true, roughness: 1, fog: false }), 'primary', 0, 330, 0)
  m.castShadow = false
  m.receiveShadow = false
  const g = group(m)
  g.userData.animate = (t: number) => {
    m.rotation.y = t * 0.01
  }
  return g
}

export const planet: Build = () => {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 256
  const ctx = c.getContext('2d')!
  const rand = seeded('bands')
  for (let y = 0; y < 256; y += 4 + Math.floor(rand() * 10)) {
    const l = 70 + Math.floor(rand() * 35)
    ctx.fillStyle = `hsl(0, 0%, ${l}%)`
    ctx.fillRect(0, y, 32, 14)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const body = mesh(new THREE.SphereGeometry(60, 48, 32), new THREE.MeshStandardMaterial({ color: '#d9925a', map: tex, emissive: '#7a4a2a', emissiveIntensity: 0.45, emissiveMap: tex, roughness: 1, fog: false }), 'primary')
  const rings = mesh(new THREE.RingGeometry(80, 132, 96), new THREE.MeshStandardMaterial({ color: '#e8d6b0', emissive: '#6a5a40', emissiveIntensity: 0.5, transparent: true, opacity: 0.75, side: THREE.DoubleSide, roughness: 1, fog: false }), 'trim')
  rings.rotation.set(-Math.PI / 2 + 0.42, 0.25, 0)
  for (const m of [body, rings]) {
    m.castShadow = false
    m.receiveShadow = false
  }
  const g = group(body, rings)
  g.position.y = 0
  const tilt = group(g)
  tilt.position.y = 370
  const root = group(tilt)
  root.userData.animate = (t: number) => {
    body.rotation.y = t * 0.02
  }
  return root
}
