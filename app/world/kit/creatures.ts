/**
 * Creatures (Loop 3): the genie's showpieces. A dragon, a sky-whale, a horse, a deer, a gull, a school of
 * fish and a swarm of butterflies, hand-built faceted low-poly and articulated: every wing, tail segment,
 * leg, jaw and fin hangs off a named pivot group.
 *
 * Animation is procedural and deterministic. The renderer hands each creature a `Drive` every frame
 * (fx/motion.ts `driveOf`: speed, turn, climb, height above ground, stride, where the player is), `rig()`
 * turns that into joint angles, and `pose()` here puts them on the pivots. The motion pose (orbit, fly,
 * gallop...) already faces the creature along its velocity and banks it into turns.
 *
 * Geometry is shared per kind (built once, `userData.shared`). Materials are per instance, a handful per
 * creature, because the recolour path writes material colours per entity ("make the dragon gold").
 * Body materials use vertex colours as shading (a paler belly, darker membranes), so a recolour keeps the
 * shading and only changes the hue. Slots: primary = hide, trim = horns, spines, claws, mane, barnacles;
 * glow = the whale's bioluminescence. Dragon eyes glow on their own, so "make it glow" lights the body.
 */
import * as THREE from 'three'
import { softDot } from '../fx/common'
import { rig } from '../fx/motion'
import type { Drive, MotionStyle, Rig, RigKind } from '../fx/motion'
import { glowMat, group, mat, mesh, seeded } from './helpers'
import type { Build } from './helpers'

// ---------- shared geometry helpers ----------

type Station = [number, number] // [z, radius]

const once = <T>(make: () => T): (() => T) => {
  let v: T | undefined
  return () => (v ??= make())
}

function share<T extends THREE.BufferGeometry>(g: T): T {
  g.userData.shared = true
  return g
}

/** A faceted body of revolution along +z (stations in ascending z), squashed to an ellipse by sx, sy. */
function lathe(st: Station[], sides: number, sx = 1, sy = 1): THREE.BufferGeometry {
  const pts = [...st].sort((a, b) => a[0] - b[0]).map(([z, r]) => new THREE.Vector2(Math.max(0.001, r), z))
  const g = new THREE.LatheGeometry(pts, sides)
  g.rotateX(Math.PI / 2)
  g.scale(sx, sy, 1)
  return g
}

/** The part of a profile between z0 and z1 (z0 > z1, the segment runs back from its pivot), re-based at z0. */
function slice(profile: Station[], z0: number, z1: number): Station[] {
  const at = (z: number): number => {
    const s = [...profile].sort((a, b) => a[0] - b[0])
    for (let i = 0; i < s.length - 1; i++) {
      const [za, ra] = s[i]!
      const [zb, rb] = s[i + 1]!
      if (z >= za && z <= zb) return ra + (rb - ra) * ((z - za) / Math.max(1e-6, zb - za))
    }
    return z < s[0]![0] ? s[0]![1] : s[s.length - 1]![1]
  }
  const inner = profile.filter(([z]) => z < z0 && z > z1)
  const out: Station[] = [[z1, at(z1)], ...inner, [z0, at(z0)]]
  return out.map(([z, r]) => [z - z0, r])
}

/** Vertex colours as shading (the material colour multiplies them): `fn(x, y, z)` → rgb. */
function paint(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, i: number) => [number, number, number]): THREE.BufferGeometry {
  const p = g.getAttribute('position')
  const c = new Float32Array(p.count * 3)
  for (let i = 0; i < p.count; i++) {
    const [r, gg, b] = fn(p.getX(i), p.getY(i), p.getZ(i), i)
    c[i * 3] = r
    c[i * 3 + 1] = gg
    c[i * 3 + 2] = b
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

const hash = (i: number) => {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** Back darker, belly lighter and warmer, a little per-vertex mottling so the facets read as scales. */
function hide(belly: [number, number, number], back = 0.82, mottle = 0.08, ref = 1): (x: number, y: number, z: number, i: number) => [number, number, number] {
  return (_x, y, _z, i) => {
    const t = Math.max(0, Math.min(1, (-y / ref + 0.15) / 0.75))
    const k = t * t * (3 - 2 * t)
    const m = 1 + (hash(i) - 0.5) * mottle
    return [(back + (belly[0] - back) * k) * m, (back + (belly[1] - back) * k) * m, (back + (belly[2] - back) * k) * m]
  }
}

/** A tapered limb hanging down -y from its pivot. */
function limb(len: number, r0: number, r1: number, sides = 6): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r0, len, sides, 1).translate(0, -len / 2, 0)
}

/** A tapered rod from a to b (wing bones, horns). */
function rod(a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number, sides = 5): THREE.BufferGeometry {
  const len = a.distanceTo(b)
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1).translate(0, len / 2, 0)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize())
  g.applyQuaternion(q)
  g.translate(a.x, a.y, a.z)
  return g
}

/** A flat fan of triangles in the x–z plane from `hub` through `rim` (a wing membrane, a fluke). */
function fan(hub: [number, number], rim: [number, number][], shade: (x: number, z: number) => number): THREE.BufferGeometry {
  const pos: number[] = []
  for (let i = 0; i < rim.length - 1; i++) {
    const a = rim[i]!
    const b = rim[i + 1]!
    pos.push(hub[0], 0, hub[1], a[0], 0, a[1], b[0], 0, b[1])
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  return paint(g, (x, _y, z) => {
    const s = shade(x, z)
    return [s, s * 0.96, s * 0.94]
  })
}

function merge(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // A tiny merge (no addons import): non-indexed concat of position/normal/color.
  const parts = geos.map(g => (g.index ? g.toNonIndexed() : g))
  const n = parts.reduce((s, g) => s + g.getAttribute('position').count, 0)
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  let o = 0
  for (const g of parts) {
    const p = g.getAttribute('position')
    const c = g.getAttribute('color')
    for (let i = 0; i < p.count; i++, o++) {
      pos.set([p.getX(i), p.getY(i), p.getZ(i)], o * 3)
      col.set(c ? [c.getX(i), c.getY(i), c.getZ(i)] : [1, 1, 1], o * 3)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.BufferAttribute(col, 3))
  g.computeVertexNormals()
  return g
}

const pivot = (x = 0, y = 0, z = 0, ...children: THREE.Object3D[]): THREE.Group => {
  const p = group(...children)
  p.position.set(x, y, z)
  return p
}

function hideMat(color: string, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return mat(color, { flatShading: true, vertexColors: true, roughness: 0.72, ...opts })
}

/** The renderer's hooks on a creature root: per-frame drive, how it moves, how it arrives. */
function rigged(g: THREE.Group, kind: RigKind, style: MotionStyle, apply: (r: Rig, d: Drive) => void, arrival?: 'dive' | 'descend'): THREE.Group {
  g.userData.motionStyle = style
  if (arrival) g.userData.arrival = arrival
  g.userData.drive = (d: Drive) => {
    // Arrival theatre (renderer-set): a dive in progress, and a roar envelope after it.
    const dive = (g.userData.dive as number | undefined) ?? 0
    const roarAt = g.userData.roarAt as number | undefined
    let roar = 0
    if (roarAt !== undefined) {
      const s = (performance.now() - roarAt) / 1000
      roar = s < 0 || s > 1.8 ? 0 : Math.sin(Math.PI * Math.min(1, s / 1.8)) ** 0.6
    }
    apply(rig(kind, { ...d, dive, roar }), d)
  }
  return g
}

/** Ember breath: a short-lived jet of additive sparks from a mouth, in the head's frame. */
function breathFx(n = 56): { pts: THREE.Points, tick: (amount: number, dt: number) => void } {
  const pos = new Float32Array(n * 3)
  const col = new Float32Array(n * 3)
  const vel = new Float32Array(n * 3)
  const life = new Float32Array(n).fill(0)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.7, map: softDot(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  pts.frustumCulled = false
  pts.raycast = () => {}
  let next = 0
  let acc = 0
  const rand = seeded('breath')
  const tick = (amount: number, dt: number) => {
    acc += amount * dt * 90
    while (acc >= 1) {
      acc -= 1
      const i = next
      next = (next + 1) % n
      life[i] = 1
      pos.set([0, 0, 0], i * 3)
      vel.set([(rand() - 0.5) * 2.2, (rand() - 0.3) * 1.6, 7 + rand() * 6], i * 3)
    }
    for (let i = 0; i < n; i++) {
      if (life[i]! <= 0) {
        col.set([0, 0, 0], i * 3)
        continue
      }
      life[i] = Math.max(0, life[i]! - dt * 1.5)
      for (let a = 0; a < 3; a++) pos[i * 3 + a] = pos[i * 3 + a]! + vel[i * 3 + a]! * dt
      vel[i * 3 + 1] = vel[i * 3 + 1]! + dt * 2.5 // embers rise as they cool
      const l = life[i]!
      col.set([0.95 * l, 0.42 * l ** 1.6, 0.08 * l ** 3], i * 3)
    }
    geo.attributes.position!.needsUpdate = true
    geo.attributes.color!.needsUpdate = true
  }
  return { pts, tick }
}

// =====================================================================================================
// Dragon: ~16 m nose to tail, 16 m wingspan, 4 m to the top of the head standing.
// =====================================================================================================

const DRAGON_TORSO: Station[] = [[-2.9, 0.3], [-2.3, 0.82], [-1.1, 1.02], [0.3, 1.12], [1.5, 1.04], [2.3, 0.78], [2.9, 0.42]]
const NECK = { segs: 4, len: 0.88, r0: 0.62, r1: 0.36, rest: [-0.62, -0.18, 0.05, 0.42] }
const TAIL = { segs: 8, len: 0.98, r0: 0.5, r1: 0.06 }

const dragonGeo = once(() => {
  const belly: [number, number, number] = [1.55, 1.3, 0.82]
  const torso = share(paint(lathe(DRAGON_TORSO, 9, 0.95, 1), hide(belly, 0.8, 0.12)))
  const spike = share(paint(new THREE.ConeGeometry(0.16, 0.6, 4).rotateX(-0.45), () => [1, 1, 1]))
  const neck = Array.from({ length: NECK.segs }, (_, i) => {
    const a = NECK.r0 + (NECK.r1 - NECK.r0) * (i / NECK.segs)
    const b = NECK.r0 + (NECK.r1 - NECK.r0) * ((i + 1) / NECK.segs)
    return share(paint(lathe([[-0.12, a * 1.02], [NECK.len * 0.5, (a + b) / 2 * 1.04], [NECK.len + 0.1, b]], 7, 1, 1.1), hide(belly, 0.8, 0.12, a)))
  })
  const tail = Array.from({ length: TAIL.segs }, (_, i) => {
    const a = TAIL.r0 + (TAIL.r1 - TAIL.r0) * (i / TAIL.segs)
    const b = TAIL.r0 + (TAIL.r1 - TAIL.r0) * ((i + 1) / TAIL.segs)
    return share(paint(lathe([[-TAIL.len - 0.08, b], [-TAIL.len * 0.5, (a + b) / 2 * 1.03], [0.08, a]], 7, 1, 1.05), hide(belly, 0.8, 0.12, a)))
  })
  // The skull is a wedge: wide brow, long snout, a ridge of scales.
  const skull = share(paint(lathe([[-0.4, 0.18], [-0.1, 0.5], [0.35, 0.54], [0.85, 0.4], [1.35, 0.28], [1.7, 0.12]], 7, 1.05, 0.72), hide(belly, 0.8, 0.12, 0.5)))
  const jaw = share(paint(lathe([[0, 0.28], [0.55, 0.24], [1.25, 0.14], [1.5, 0.04]], 6, 1, 0.42), hide([1.6, 1.35, 0.85], 1.2, 0.08, 0.2)))
  const horn = share(new THREE.ConeGeometry(0.16, 1.5, 5).translate(0, 0.75, 0))
  const hornSmall = share(new THREE.ConeGeometry(0.09, 0.62, 4).translate(0, 0.31, 0))
  const tooth = share(new THREE.ConeGeometry(0.04, 0.17, 3).rotateX(Math.PI))
  const eye = share(new THREE.OctahedronGeometry(0.11, 0).scale(1, 0.7, 1.3))
  const spade = share(paint(new THREE.OctahedronGeometry(0.62, 0).scale(1.05, 0.12, 1.25).translate(0, 0, -0.55), () => [1, 1, 1]))
  const upper = share(paint(limb(1.05, 0.4, 0.26, 6), hide(belly, 0.82, 0.1, 0.3)))
  const lower = share(paint(limb(0.9, 0.25, 0.17, 6), hide(belly, 0.82, 0.1, 0.2)))
  const foot = share(paint(new THREE.BoxGeometry(0.42, 0.18, 0.55).translate(0, -0.09, 0.12), () => [0.8, 0.8, 0.8]))
  const claw = share(new THREE.ConeGeometry(0.05, 0.24, 3).rotateX(Math.PI / 2).translate(0, -0.12, 0.45))

  // Wing (+x side; the left wing is mirrored). Inner: shoulder → wrist, membrane back to the hip.
  const W: [number, number] = [3.4, 0.25]
  const innerMem = share(fan([0, 0.3], [W, [3.3, -2.2], [2.4, -2.45], [1.4, -2.6], [0.1, -3.5]], (x, z) => 0.55 + 0.08 * Math.min(1, Math.hypot(x, z) / 3)))
  const arm = share(paint(rod(new THREE.Vector3(0, 0.05, 0.3), new THREE.Vector3(W[0], 0.05, W[1]), 0.24, 0.13), () => [0.9, 0.9, 0.9]))
  // Outer: four fingers from the wrist with the membrane scalloped between them.
  const F: [number, number][] = [[4.7, -0.55], [3.7, -2.45], [2.1, -3.05], [-0.1, -2.45]]
  const rim: [number, number][] = []
  F.forEach((f, i) => {
    rim.push(f)
    const g = F[i + 1]
    if (g) rim.push([(f[0] + g[0]) * 0.36, (f[1] + g[1]) * 0.36])
  })
  const outerMem = share(fan([0, 0], rim, (x, z) => 0.5 + 0.1 * Math.min(1, Math.hypot(x, z) / 4)))
  const fingers = share(merge(F.map((f, i) => paint(rod(new THREE.Vector3(0, 0.04, 0), new THREE.Vector3(f[0], 0.04, f[1]), i === 0 ? 0.13 : 0.08, 0.02), () => [0.9, 0.9, 0.9]))))
  const thumb = share(new THREE.ConeGeometry(0.07, 0.4, 3).rotateX(Math.PI / 2 - 0.4).translate(0, 0.16, 0.2))
  return { torso, spike, neck, tail, skull, jaw, horn, hornSmall, tooth, eye, spade, upper, lower, foot, claw, innerMem, outerMem, arm, fingers, thumb, W }
})

export const dragon: Build = () => {
  const G = dragonGeo()
  const hideM = hideMat('#8e2a1f')
  const wingM = hideMat('#8e2a1f', { side: THREE.DoubleSide, roughness: 0.9, emissive: '#000000' })
  const trimM = mat('#e6cf9a', { flatShading: true, roughness: 0.55 })
  const eyeM = glowMat('#ffb21f', 2.6)
  const toothM = mat('#f4ecd8', { roughness: 0.4 })
  const P = (geo: THREE.BufferGeometry, m: THREE.Material, slot: 'primary' | 'trim' | null, x = 0, y = 0, z = 0) => mesh(geo, m, slot, x, y, z)

  const body = pivot(0, 2.35, 0, P(G.torso, hideM, 'primary'))
  const root0 = group(body)
  for (let z = -2.1; z <= 2.2; z += 0.72) body.add(P(G.spike, trimM, 'trim', 0, 1.0 - Math.abs(z) * 0.06, z))

  // Neck chain, then the head.
  const neck: THREE.Group[] = []
  let parent: THREE.Object3D = body
  let at = new THREE.Vector3(0, 0.42, 2.55)
  for (let i = 0; i < NECK.segs; i++) {
    const seg = pivot(at.x, at.y, at.z, P(G.neck[i]!, hideM, 'primary'))
    seg.add(P(G.spike, trimM, 'trim', 0, NECK.r0 - i * 0.07 + 0.1, NECK.len * 0.4))
    seg.rotation.x = NECK.rest[i]!
    parent.add(seg)
    neck.push(seg)
    parent = seg
    at = new THREE.Vector3(0, 0, NECK.len)
  }
  const head = pivot(0, 0.02, NECK.len + 0.1, P(G.skull, hideM, 'primary'))
  for (const s of [1, -1]) {
    const h = P(G.horn, trimM, 'trim', 0.3 * s, 0.28, -0.12)
    h.rotation.set(-1.15, 0, -0.3 * s)
    const h2 = P(G.hornSmall, trimM, 'trim', 0.44 * s, 0.05, -0.05)
    h2.rotation.set(-1.3, 0, -0.95 * s)
    const e = P(G.eye, eyeM, null, 0.34 * s, 0.17, 0.62)
    e.rotation.y = 0.35 * s
    e.castShadow = false
    head.add(h, h2, e)
    for (let k = 0; k < 4; k++) head.add(P(G.tooth, toothM, null, 0.22 * s - k * 0.03 * s, -0.17, 0.75 + k * 0.22))
  }
  const jaw = pivot(0, -0.2, -0.05, P(G.jaw, hideM, 'primary'))
  head.add(jaw)
  const fire = breathFx()
  fire.pts.position.set(0, -0.12, 1.65)
  head.add(fire.pts)
  parent.add(head)

  // Tail chain, ending in a spade.
  const tail: THREE.Group[] = []
  parent = body
  at = new THREE.Vector3(0, 0.12, -2.75)
  for (let i = 0; i < TAIL.segs; i++) {
    const seg = pivot(at.x, at.y, at.z, P(G.tail[i]!, hideM, 'primary'))
    if (i < TAIL.segs - 1) seg.add(P(G.spike, trimM, 'trim', 0, TAIL.r0 * (1 - i / TAIL.segs) + 0.12, -TAIL.len * 0.5))
    parent.add(seg)
    tail.push(seg)
    parent = seg
    at = new THREE.Vector3(0, 0, -TAIL.len)
  }
  tail[TAIL.segs - 1]!.add(P(G.spade, trimM, 'trim', 0, 0, -TAIL.len))

  // Wings: shoulder (flap, sweep) → wrist (the hand flexes).
  const wings = [1, -1].map((side) => {
    const shoulder = pivot(0.72 * side, 0.78, 1.2)
    const mirror = group()
    mirror.scale.set(side * 1.18, 1.18, 1.18) // ~19 m from tip to tip
    shoulder.add(mirror)
    const inner = group(P(G.innerMem, wingM, 'primary'), P(G.arm, hideM, 'primary'))
    const wrist = pivot(G.W[0], 0, G.W[1], P(G.outerMem, wingM, 'primary'), P(G.fingers, hideM, 'primary'), P(G.thumb, trimM, 'trim'))
    inner.add(wrist)
    mirror.add(inner)
    body.add(shoulder)
    return { shoulder, wrist, side }
  })
  // Backlit membranes: a faint emissive in their own colour, so a dusk sky glows through them.
  // A touch of self-light on the hide too, so it still reads against a dusk or night sky.
  root0.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if (m === wingM) o.userData.emissiveFollows = 0.16
    else if (m === hideM) o.userData.emissiveFollows = 0.07
  })

  // Legs: hip → knee → foot with three claws.
  const legs = [[1, 1.55], [-1, 1.55], [1, -1.75], [-1, -1.75]].map(([s, z], i) => {
    const hind = i >= 2
    const hip = pivot(0.82 * s!, -0.35, z!, P(G.upper, hideM, 'primary'))
    const knee = pivot(0, -1.02, 0, P(G.lower, hideM, 'primary'))
    const foot = pivot(0, -0.86, 0, P(G.foot, hideM, 'primary'))
    for (const cx of [-0.13, 0, 0.13]) foot.add(P(G.claw, trimM, 'trim', cx, 0, 0))
    knee.add(foot)
    hip.add(knee)
    body.add(hip)
    return { hip, knee, foot, rest: hind ? [-0.32, 0.62] : [0.18, -0.22] }
  })

  const root = root0
  let last = -1
  return rigged(root, 'dragon', { pace: 1.05, creature: true }, (r, d) => {
    body.position.y = 2.35 + r.bob
    body.rotation.set(r.pitch, 0, r.roll)
    for (const w of wings) {
      w.shoulder.rotation.set(0, r.sweep * w.side, r.flap * w.side)
      w.wrist.rotation.set(0, 0, r.tip)
    }
    neck.forEach((s, i) => {
      s.rotation.x = NECK.rest[i]! + r.neck.pitch / NECK.segs
      s.rotation.y = r.neck.yaw / NECK.segs
    })
    head.rotation.set(r.head.pitch, r.head.yaw, 0)
    jaw.rotation.x = r.jaw
    tail.forEach((s, i) => {
      s.rotation.set(r.tail[i]!.pitch, r.tail[i]!.yaw, 0)
    })
    legs.forEach((l, i) => {
      l.hip.rotation.x = l.rest[0]! + r.legs[i]!.hip
      l.knee.rotation.x = l.rest[1]! + r.legs[i]!.knee
      l.foot.rotation.x = -(l.rest[0]! + l.rest[1]! + r.legs[i]!.hip + r.legs[i]!.knee) * 0.7
    })
    const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, d.t - last))
    last = d.t
    fire.tick(r.breath, dt || 1 / 60)
  }, 'dive')
}

// =====================================================================================================
// Sky-whale: a 25 m humpback that swims through the air, barnacled, glowing softly underneath.
// =====================================================================================================

const WHALE: Station[] = [[12.4, 0.3], [11.7, 1.15], [10, 2.0], [7.5, 2.75], [4.5, 3.2], [1.5, 3.15], [-1.5, 2.7], [-4.5, 1.95], [-7.5, 1.1], [-10, 0.58], [-11.6, 0.36], [-12.2, 0.28]]
const WHALE_JOINTS = [2, -2.2, -5.6, -8.6, -11.2] // spine pivots, front to back
const WHALE_SY = 0.86

const whaleGeo = once(() => {
  const belly: [number, number, number] = [2.15, 2.2, 2.25]
  const shade = (ref: number) => (x: number, y: number, z: number, i: number): [number, number, number] => {
    const c = hide(belly, 0.78, 0.1, ref)(x, y, z, i)
    // Throat pleats: the belly's facets alternate light and dark.
    if (y < -ref * 0.35 && z > -2) {
      const k = i % 2 ? 0.86 : 1.06
      return [c[0] * k, c[1] * k, c[2] * k]
    }
    return c
  }
  const front = share(paint(lathe(slice(WHALE, 12.4, WHALE_JOINTS[0]!).map(([z, r]) => [z + 12.4 - WHALE_JOINTS[0]!, r] as Station), 18, 1.06, WHALE_SY), shade(2.6)))
  const segs = WHALE_JOINTS.map((z0, i) => {
    const z1 = WHALE_JOINTS[i + 1] ?? -12.2
    // Each segment reaches 0.45 m forward into the one before, so a bent joint never opens a seam.
    return share(paint(lathe(slice(WHALE, z0 + 0.45, z1).map(([z, r]) => [z + 0.45, r * 0.995] as Station), 18, 1.06, WHALE_SY), shade(2.4 - i * 0.4)))
  })
  // Flukes: a wide notched swallowtail.
  const fluke = share(fan([0, 0.4], [[0.3, 0.2], [2.4, -0.6], [4.2, -1.9], [3.6, -2.5], [1.8, -1.9], [0.3, -2.0], [0, -1.5], [-0.3, -2.0], [-1.8, -1.9], [-3.6, -2.5], [-4.2, -1.9], [-2.4, -0.6], [-0.3, 0.2]], (x, z) => 0.78 + 0.25 * Math.min(1, Math.hypot(x, z) / 4)))
  // Long pectoral flippers, scalloped along their leading edge.
  const flipper = share(paint(lathe([[-6.2, 0.12], [-4.5, 0.55], [-2.2, 0.78], [-0.4, 0.62], [0.2, 0.3]], 6, 1, 0.22).rotateY(-Math.PI / 2), (x) => {
    const k = 1.05 + 0.08 * Math.min(1, x / 5)
    return [k, k * 1.02, k * 1.04]
  }))
  const dorsal = share(paint(new THREE.ConeGeometry(0.7, 1.1, 5).scale(0.5, 1, 1.6).rotateX(-0.6), () => [0.8, 0.8, 0.8]))
  const barnacle = share(new THREE.DodecahedronGeometry(0.2, 0).scale(1, 0.7, 1))
  const spot = share(new THREE.IcosahedronGeometry(0.13, 0))
  const eye = share(new THREE.SphereGeometry(0.2, 8, 6))
  const lip = share(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(2.55, -0.55, 7.6), new THREE.Vector3(2.0, -0.95, 9.6), new THREE.Vector3(1.15, -1.0, 11.2), new THREE.Vector3(0, -0.95, 12.0),
    new THREE.Vector3(-1.15, -1.0, 11.2), new THREE.Vector3(-2.0, -0.95, 9.6), new THREE.Vector3(-2.55, -0.55, 7.6)
  ]), 24, 0.05, 4))
  const halo = share(new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2))
  return { front, segs, fluke, flipper, dorsal, barnacle, spot, eye, lip, halo }
})

/** Radius of the whale's hull at z (for sticking barnacles and lights onto it). */
function whaleR(z: number): number {
  const s = WHALE
  for (let i = 0; i < s.length - 1; i++) {
    const [za, ra] = s[i]!
    const [zb, rb] = s[i + 1]!
    if (z <= za && z >= zb) return ra + (rb - ra) * ((za - z) / (za - zb))
  }
  return 0.3
}

/** A point on the hull at z, angle a (0 = +x side, π/2 = top), pushed out by `out`. */
function onHull(z: number, a: number, out = 0): THREE.Vector3 {
  const r = whaleR(z) + out
  return new THREE.Vector3(Math.cos(a) * r * 1.06, Math.sin(a) * r * WHALE_SY, z)
}

export const whale: Build = () => {
  const G = whaleGeo()
  const rand = seeded('whale')
  const skin = hideMat('#4b6585', { roughness: 0.8 })
  const finM = hideMat('#4b6585', { roughness: 0.8, side: THREE.DoubleSide })
  const trimM = mat('#cfc8b8', { flatShading: true, roughness: 0.95 })
  const glowM = glowMat('#7fe0ff', 1.25)
  const dark = mat('#141a24', { roughness: 0.6 })
  const lipM = mat('#26324a', { roughness: 0.8 })
  const Y = 3.4 // the belly clears the ground at rest

  const root = group()
  const body = pivot(0, Y, 0)
  root.add(body)
  const front = pivot(0, 0, WHALE_JOINTS[0]!, mesh(G.front, skin, 'primary'))
  body.add(front)
  // Spine chain from the chest back; each segment starts where the last ended.
  const spine: THREE.Group[] = []
  let parent: THREE.Object3D = body
  let prev = 0
  WHALE_JOINTS.forEach((z0, i) => {
    const seg = pivot(0, 0, z0 - prev, mesh(G.segs[i]!, skin, 'primary'))
    prev = z0
    parent.add(seg)
    spine.push(seg)
    parent = seg
  })
  spine[spine.length - 1]!.add(mesh(G.fluke, finM, 'primary', 0, 0, -0.6))
  spine[1]!.add(mesh(G.dorsal, skin, 'primary', 0, whaleR(-4.5) * WHALE_SY - 0.05, -2.6))

  // Face: eyes, the long lip line, knobbly tubercles and barnacles over the head and chin (the front
  // segment's frame starts at the first joint, so absolute z shifts back by it).
  for (const s of [1, -1]) {
    const e = mesh(G.eye, dark, null, 2.62 * s, -0.42, 7.1 - WHALE_JOINTS[0]!)
    front.add(e)
  }
  front.add(mesh(G.lip, lipM, null, 0, 0, -WHALE_JOINTS[0]!))
  for (let i = 0; i < 46; i++) {
    const z = 7 + rand() * 5
    const a = Math.PI / 2 + (rand() - 0.5) * 1.6 + (i % 3 === 0 ? -Math.PI : 0) * 0.55
    const p = onHull(z, a, -0.04)
    const b = mesh(G.barnacle, trimM, 'trim', p.x, p.y, p.z - WHALE_JOINTS[0]!)
    b.scale.setScalar(0.6 + rand() * 0.9)
    b.rotation.set(rand() * 3, rand() * 3, 0)
    b.castShadow = false
    front.add(b)
  }
  // Bioluminescence: two rows of soft lights down each flank and a scatter on the belly.
  const glowers: THREE.Mesh[] = []
  const addSpot = (z: number, a: number) => {
    // Which piece of the body this z belongs to.
    let k = -1
    for (let i = 0; i < WHALE_JOINTS.length; i++) if (z <= WHALE_JOINTS[i]!) k = i
    const host = k < 0 ? front : spine[k]!
    const base = k < 0 ? WHALE_JOINTS[0]! : WHALE_JOINTS[k]!
    const p = onHull(z, a, 0.02)
    const m = mesh(G.spot, glowM, 'glow', p.x, p.y, p.z - base)
    m.scale.setScalar(0.45 + rand() * rand() * 1.4)
    m.castShadow = false
    host.add(m)
    glowers.push(m)
  }
  for (let z = 9.5; z > -10; z -= 1.6 + rand() * 0.9) {
    for (const s of [1, -1]) {
      if (rand() > 0.25) addSpot(z + (rand() - 0.5) * 0.6, (s > 0 ? 0 : Math.PI) - s * (0.5 + rand() * 0.25))
      if (rand() > 0.55) addSpot(z - 0.6, (s > 0 ? 0 : Math.PI) - s * (0.95 + rand() * 0.2))
    }
    for (let k = 0; k < 2; k++) if (rand() > 0.3) addSpot(z - rand(), -Math.PI / 2 + (rand() - 0.5) * 1.1)
  }
  // The soft glow under the belly: an additive pool of light you see from below.
  const halo = new THREE.Mesh(G.halo, new THREE.MeshBasicMaterial({ map: softDot(), color: '#5fc8f0', transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }))
  halo.scale.set(12, 1, 30)
  halo.position.set(0, -3.3, 0)
  halo.raycast = () => {}
  halo.userData.halo = 0.45
  body.add(halo)

  // Flippers at the chest, with barnacles on their leading edges.
  const fins = [1, -1].map((s) => {
    const p = pivot(2.7 * s, -1.25, 5.6 - WHALE_JOINTS[0]!)
    const mirror = group(mesh(G.flipper, finM, 'primary'))
    mirror.scale.x = s
    for (let i = 0; i < 6; i++) {
      const b = mesh(G.barnacle, trimM, 'trim', 0.8 + i * 0.85, 0.08, 0.55 - i * 0.04)
      b.scale.setScalar(0.5 + rand() * 0.6)
      b.castShadow = false
      mirror.add(b)
    }
    p.add(mirror)
    p.rotation.set(0.25, 0.5 * s, -0.45 * s)
    front.add(p)
    return { p, s }
  })

  // A faint moonlit self-light on the skin, so its shape reads against a night sky.
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if (m === skin || m === finM) o.userData.emissiveFollows = 0.09
  })
  // The lights breathe; the renderer's glow prop sets the level they breathe around.
  let glowLevel = glowM.emissiveIntensity
  let glowSet = -1
  const haloMat = halo.material
  return rigged(root, 'whale', { pace: 0.36, creature: true }, (r, d) => {
    body.position.y = Y + r.bob
    body.rotation.set(r.pitch, 0, r.roll)
    spine.forEach((s, i) => s.rotation.set(r.spine[i] ?? 0, r.tail[i]?.yaw ?? 0, 0))
    front.rotation.set(-r.head.pitch, r.head.yaw, 0)
    for (const f of fins) f.p.rotation.set(0.25, 0.5 * f.s, (-0.45 + r.fins) * f.s)
    // The lights breathe slowly, a wave running down the body.
    if (glowM.emissiveIntensity !== glowSet) glowLevel = glowM.emissiveIntensity
    const k = 0.8 + 0.2 * Math.sin(d.t * 0.9 + d.seed * 6)
    glowSet = glowM.emissiveIntensity = glowLevel * k
    haloMat.opacity = 0.32 * Math.min(2, glowLevel / 1.25) * (0.85 + 0.15 * k)
  }, 'descend')
}

// =====================================================================================================
// Quadrupeds: horse and deer share one articulated builder.
// =====================================================================================================

interface QuadSpec {
  name: 'horse' | 'deer' | 'dog'
  torso: Station[]
  sx: number
  sy: number
  back: number // pivot height of the torso
  hipY: number
  hipX: number
  hipZ: [number, number]
  upper: [number, number, number] // length, r0, r1
  lower: [number, number, number]
  neckAt: [number, number]
  neck: { segs: number, len: number, r0: number, r1: number, rest: number[] }
  head: Station[]
  headSy: number
  headRest: number
  tail: { segs: number, len: number, r0: number, r1: number, at: [number, number] }
  belly: [number, number, number]
}

const HORSE: QuadSpec = {
  name: 'horse',
  torso: [[-1.05, 0.2], [-0.9, 0.4], [-0.45, 0.46], [0.25, 0.47], [0.8, 0.42], [1.05, 0.25]],
  sx: 0.86, sy: 1.08, back: 1.25, hipY: -0.12, hipX: 0.24, hipZ: [0.72, -0.72],
  upper: [0.55, 0.15, 0.09], lower: [0.58, 0.075, 0.06],
  neckAt: [0.25, 0.9],
  neck: { segs: 2, len: 0.48, r0: 0.25, r1: 0.17, rest: [-0.95, -0.35] },
  head: [[-0.1, 0.15], [0.12, 0.19], [0.4, 0.15], [0.62, 0.11], [0.68, 0.05]],
  headSy: 1.25, headRest: 1.55,
  tail: { segs: 3, len: 0.3, r0: 0.07, r1: 0.12, at: [0.2, -1.0] },
  belly: [1.25, 1.2, 1.12]
}

const DEER: QuadSpec = {
  name: 'deer',
  torso: [[-0.72, 0.16], [-0.6, 0.29], [-0.25, 0.33], [0.25, 0.33], [0.55, 0.29], [0.72, 0.18]],
  sx: 0.85, sy: 1.08, back: 0.98, hipY: -0.08, hipX: 0.16, hipZ: [0.48, -0.5],
  upper: [0.44, 0.1, 0.06], lower: [0.5, 0.045, 0.035],
  neckAt: [0.2, 0.62],
  neck: { segs: 2, len: 0.27, r0: 0.15, r1: 0.11, rest: [-0.95, -0.3] },
  head: [[-0.08, 0.1], [0.1, 0.13], [0.3, 0.09], [0.42, 0.05]],
  headSy: 1.15, headRest: 1.45,
  tail: { segs: 1, len: 0.16, r0: 0.07, r1: 0.04, at: [0.16, -0.7] },
  belly: [1.6, 1.5, 1.38]
}

// A dog (NPC companion): "give her a dog". Built on the deer's skeleton at a third of the size, floppy ears, a wagging tail.
const DOG: QuadSpec = {
  name: 'dog',
  torso: [[-0.4, 0.12], [-0.32, 0.2], [-0.08, 0.22], [0.14, 0.23], [0.3, 0.2], [0.4, 0.13]],
  sx: 0.82, sy: 1.0, back: 0.5, hipY: -0.06, hipX: 0.1, hipZ: [0.27, -0.28],
  upper: [0.2, 0.065, 0.048], lower: [0.19, 0.042, 0.034],
  neckAt: [0.1, 0.34],
  neck: { segs: 1, len: 0.12, r0: 0.11, r1: 0.09, rest: [-0.55] },
  head: [[-0.06, 0.09], [0.05, 0.105], [0.13, 0.075], [0.22, 0.05], [0.27, 0.035]],
  headSy: 1.0, headRest: 0.7,
  tail: { segs: 2, len: 0.17, r0: 0.035, r1: 0.02, at: [0.14, -0.4] },
  belly: [1.3, 1.25, 1.15]
}

const quadGeo = new Map<string, ReturnType<typeof makeQuadGeo>>()
function makeQuadGeo(q: QuadSpec) {
  const torso = share(paint(lathe(q.torso, 8, q.sx, q.sy), hide(q.belly, 0.86, 0.06, 0.4)))
  const neck = Array.from({ length: q.neck.segs }, (_, i) => {
    const a = q.neck.r0 + (q.neck.r1 - q.neck.r0) * (i / q.neck.segs)
    const b = q.neck.r0 + (q.neck.r1 - q.neck.r0) * ((i + 1) / q.neck.segs)
    return share(paint(lathe([[-0.08, a], [q.neck.len + 0.06, b]], 7, 0.8, 1.2), hide(q.belly, 0.9, 0.05, a)))
  })
  const head = share(paint(lathe(q.head, 7, 0.85, q.headSy), (x, y, z, i) => {
    const c = hide(q.belly, 0.9, 0.05, 0.12)(x, y, z, i)
    const muzzle = z > q.head[q.head.length - 2]![0] ? 0.45 : 1 // a dark nose
    return [c[0] * muzzle, c[1] * muzzle, c[2] * muzzle]
  }))
  const upper = share(paint(limb(q.upper[0], q.upper[1], q.upper[2], 6), () => [0.95, 0.95, 0.95]))
  const lower = share(paint(limb(q.lower[0], q.lower[1], q.lower[2], 5), () => [0.85, 0.85, 0.85]))
  const hoof = share(new THREE.CylinderGeometry(q.lower[2] * 1.15, q.lower[2] * 1.35, 0.1, 6).translate(0, -0.05, 0.01))
  // Horse hair flares toward the end (flattened, like a swishing tail); a deer's flag is short and round.
  const tail = share(new THREE.CylinderGeometry(q.tail.r0, q.tail.r1, q.tail.len, 5).scale(q.name === 'horse' ? 0.6 : 1, 1, 1).translate(0, -q.tail.len / 2, 0))
  const ear = share(new THREE.ConeGeometry(q.name === 'deer' ? 0.06 : q.name === 'dog' ? 0.045 : 0.045, q.name === 'deer' ? 0.2 : q.name === 'dog' ? 0.11 : 0.14, 4).scale(1, 1, 0.5))
  const eye = share(new THREE.SphereGeometry(q.name === 'deer' ? 0.028 : q.name === 'dog' ? 0.018 : 0.03, 6, 4))
  const mane = share(new THREE.BoxGeometry(0.05, 0.14, 0.12))
  const antler = q.name === 'deer'
    ? share(merge([
        rod(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.12, 0.34, -0.05), 0.022, 0.016),
        rod(new THREE.Vector3(0.12, 0.34, -0.05), new THREE.Vector3(0.2, 0.62, -0.18), 0.016, 0.008),
        rod(new THREE.Vector3(0.08, 0.22, -0.03), new THREE.Vector3(0.1, 0.38, 0.12), 0.012, 0.005),
        rod(new THREE.Vector3(0.15, 0.45, -0.1), new THREE.Vector3(0.3, 0.55, -0.02), 0.011, 0.005),
        rod(new THREE.Vector3(0.19, 0.58, -0.16), new THREE.Vector3(0.12, 0.74, -0.3), 0.009, 0.004)
      ].map(g => paint(g, () => [1, 1, 1]))))
    : null
  return { torso, neck, head, upper, lower, hoof, tail, ear, eye, mane, antler }
}

function quadruped(q: QuadSpec, coat: string, trim: string): THREE.Group {
  let G = quadGeo.get(q.name)
  if (!G) quadGeo.set(q.name, (G = makeQuadGeo(q)))
  const coatM = hideMat(coat, { roughness: 0.85 })
  const trimM = mat(trim, { flatShading: true, roughness: 0.85 })
  const dark = mat('#1a1410', { roughness: 0.5 })
  const white = mat('#f3eee6', { flatShading: true, roughness: 0.9 })

  const body = pivot(0, q.back, 0, mesh(G.torso, coatM, 'primary'))
  const neck: THREE.Group[] = []
  let parent: THREE.Object3D = body
  let at = new THREE.Vector3(0, q.neckAt[0], q.neckAt[1])
  for (let i = 0; i < q.neck.segs; i++) {
    const seg = pivot(at.x, at.y, at.z, mesh(G.neck[i]!, coatM, 'primary'))
    seg.rotation.x = q.neck.rest[i]!
    if (q.name === 'horse') for (let k = 0; k < 4; k++) seg.add(mesh(G.mane, trimM, 'trim', 0, q.neck.r0 * 1.15 - k * 0.006, 0.02 + k * 0.12))
    parent.add(seg)
    neck.push(seg)
    parent = seg
    at = new THREE.Vector3(0, 0, q.neck.len)
  }
  const head = pivot(0, 0, q.neck.len + 0.02, mesh(G.head, coatM, 'primary'))
  head.rotation.x = q.headRest
  for (const s of [1, -1]) {
    const dog = q.name === 'dog'
    const ear = mesh(G.ear, dog ? trimM : coatM, dog ? 'trim' : 'primary', dog ? 0.06 * s : 0.08 * s * (q.name === 'deer' ? 1.3 : 1), dog ? 0.06 : 0.14, dog ? -0.03 : -0.04)
    // A dog's ears flop down beside its head.
    ear.rotation.set(dog ? 0.3 : -0.5, 0, dog ? 2.5 * s : -0.35 * s * (q.name === 'deer' ? 2.4 : 1))
    const eye = mesh(G.eye, dark, null, dog ? 0.048 * s : 0.14 * s * (q.name === 'deer' ? 0.68 : 1), dog ? 0.04 : 0.06, dog ? 0.07 : 0.08)
    head.add(ear, eye)
    if (G.antler) {
      const a = mesh(G.antler, trimM, 'trim', 0.05 * s, 0.13, -0.02)
      a.scale.x = s
      head.add(a)
    }
  }
  parent.add(head)

  const tail: THREE.Group[] = []
  parent = body
  at = new THREE.Vector3(0, q.tail.at[0], q.tail.at[1])
  for (let i = 0; i < q.tail.segs; i++) {
    const seg = pivot(at.x, at.y, at.z, mesh(G.tail, q.name === 'deer' ? white : trimM, q.name === 'deer' ? null : 'trim'))
    seg.rotation.x = Math.PI / 2
    parent.add(seg)
    tail.push(seg)
    parent = seg
    at = new THREE.Vector3(0, -q.tail.len, 0)
  }

  const legs = [[1, q.hipZ[0]], [-1, q.hipZ[0]], [1, q.hipZ[1]], [-1, q.hipZ[1]]].map(([s, z], i) => {
    const hind = i >= 2
    const hip = pivot(q.hipX * s!, q.hipY, z!, mesh(G.upper, coatM, 'primary'))
    const knee = pivot(0, -q.upper[0], 0, mesh(G.lower, coatM, 'primary'))
    knee.add(mesh(G.hoof, q.name === 'horse' ? trimM : dark, q.name === 'horse' ? 'trim' : null, 0, -q.lower[0], 0))
    hip.add(knee)
    body.add(hip)
    // Hind legs: the thigh angles forward and the hock back, like a real horse's.
    return { hip, knee, rest: hind ? [-0.18, 0.3] : [0.04, -0.04], hind }
  })

  const root = group(body)
  if (q.name === 'dog') head.add(mesh(G.eye, dark, null, 0, 0.0, 0.25))
  return rigged(root, q.name, { pace: q.name === 'deer' ? 1.1 : q.name === 'dog' ? 0.8 : 1 }, (r) => {
    body.position.y = q.back + r.bob
    body.rotation.set(r.pitch, 0, r.roll)
    neck.forEach((s, i) => {
      s.rotation.x = q.neck.rest[i]! + r.neck.pitch / q.neck.segs
      s.rotation.y = r.neck.yaw / q.neck.segs
    })
    head.rotation.set(q.headRest + r.head.pitch, r.head.yaw, 0)
    tail.forEach((s, i) => s.rotation.set((i === 0 ? Math.PI / 2 : 0) + (r.tail[i]?.pitch ?? 0), 0, r.tail[i]?.yaw ?? 0))
    legs.forEach((l, i) => {
      // Hind knees (hocks) bend the other way from front knees.
      l.hip.rotation.x = l.rest[0]! + r.legs[i]!.hip
      l.knee.rotation.x = l.rest[1]! + r.legs[i]!.knee * (l.hind ? -0.6 : 1)
    })
  })
}

export const horse: Build = () => quadruped(HORSE, '#7a4a2a', '#24180f')
export const deer: Build = () => quadruped(DEER, '#a8703f', '#d9c7a4')
export const dog: Build = () => quadruped(DOG, '#b07a45', '#3a2618')

// =====================================================================================================
// Bird (Loop 3 rebuild of the Loop 2 gull): faceted body, inner and outer wing pivots, a tail fan.
// =====================================================================================================

const birdGeo = once(() => {
  const body = share(paint(lathe([[-0.3, 0.02], [-0.18, 0.07], [0.02, 0.1], [0.18, 0.085], [0.27, 0.05]], 6, 1, 0.9), hide([1.05, 1.05, 1.05], 0.92, 0.04, 0.08)))
  const head = share(paint(new THREE.IcosahedronGeometry(0.065, 0).scale(0.9, 0.9, 1.1), () => [1, 1, 1]))
  const beak = share(new THREE.ConeGeometry(0.022, 0.1, 4).rotateX(Math.PI / 2).translate(0, 0, 0.05))
  const inner = share(fan([0, 0.06], [[0.32, 0.03], [0.32, -0.1], [0.0, -0.12]], () => 1))
  const outer = share(fan([0, 0], [[0.28, -0.08], [0.2, -0.12], [0.0, -0.12]], () => 1))
  const tip = share(fan([0.16, -0.05], [[0.28, -0.08], [0.2, -0.12], [0.12, -0.1]], () => 1))
  const tail = share(fan([0, 0], [[0.06, -0.12], [0, -0.14], [-0.06, -0.12]], () => 1))
  return { body, head, beak, inner, outer, tip, tail }
})

/** A gull: white body, dark wingtips, wings that beat with a power stroke and glide. Front faces +z. */
export const bird: Build = () => {
  const G = birdGeo()
  const white = hideMat('#f2efe9', { roughness: 0.7, side: THREE.DoubleSide })
  const tipM = mat('#2a2d33', { side: THREE.DoubleSide, flatShading: true })
  const beakM = mat('#e8b04a')
  const body = pivot(0, 0.2, 0, mesh(G.body, white, 'primary'))
  const head = pivot(0, 0.06, 0.27, mesh(G.head, white, 'primary'), mesh(G.beak, beakM, null, 0, -0.01, 0.05))
  body.add(head)
  const wings = [1, -1].map((side) => {
    const shoulder = pivot(0.05 * side, 0.04, 0.05)
    const mirror = group(mesh(G.inner, white, 'primary'))
    mirror.scale.x = side
    const hand = pivot(0.32, 0, 0.0, mesh(G.outer, white, 'primary'), mesh(G.tip, tipM, 'trim', 0, 0.002, 0))
    mirror.add(hand)
    shoulder.add(mirror)
    body.add(shoulder)
    return { shoulder, hand, side }
  })
  const tail = pivot(0, 0.01, -0.28, mesh(G.tail, white, 'primary'))
  body.add(tail)
  for (const o of [body]) o.traverse(m => (m as THREE.Mesh).isMesh && ((m as THREE.Mesh).castShadow = false))
  const root = group(body)
  return rigged(root, 'bird', { pace: 1 }, (r) => {
    body.position.y = 0.2 + r.bob
    body.rotation.set(r.pitch, 0, r.roll)
    for (const w of wings) {
      w.shoulder.rotation.set(0, r.sweep * w.side * 0.6, r.flap * w.side)
      w.hand.rotation.set(0, 0, r.tip * 1.2)
    }
    head.rotation.set(r.head.pitch, r.head.yaw, 0)
    tail.rotation.x = -(r.tail[0]?.pitch ?? 0)
  })
}

// =====================================================================================================
// Swarms: a school of fish and a cloud of butterflies. One entity, many little bodies (instanced).
// =====================================================================================================

const fishGeo = once(() => ({
  body: share(paint(lathe([[-0.16, 0.02], [-0.08, 0.06], [0.06, 0.07], [0.16, 0.03]], 5, 0.55, 1.1), hide([1.7, 1.7, 1.7], 0.8, 0.1, 0.05))),
  tail: share(paint(new THREE.ConeGeometry(0.06, 0.12, 3).rotateX(Math.PI / 2).scale(0.25, 1.2, 1).translate(0, 0, -0.06), () => [0.85, 0.85, 0.85]))
}))

/** A shimmering school, 3–4 m across, wheeling around its spot; each fish wags its tail. Front faces +z. */
export const fish_school: Build = () => {
  const G = fishGeo()
  const n = 28
  const rand = seeded('fish')
  const bodyM = hideMat('#e2a24a', { roughness: 0.35, metalness: 0.35 })
  const finM = mat('#b9562a', { flatShading: true, side: THREE.DoubleSide })
  const bodies = new THREE.InstancedMesh(G.body, bodyM, n)
  const tails = new THREE.InstancedMesh(G.tail, finM, n)
  for (const m of [bodies, tails]) {
    m.castShadow = false
    m.frustumCulled = false
  }
  bodies.userData.slot = 'primary'
  bodies.userData.baseColor = '#e2a24a'
  tails.userData.slot = 'trim'
  tails.userData.baseColor = '#b9562a'
  const fish = Array.from({ length: n }, () => ({ r: 1.2 + rand() * 1.4, y: 1.0 + rand() * 1.6, ph: rand() * Math.PI * 2, w: 0.55 + rand() * 0.25, wob: rand() * 6, s: 0.8 + rand() * 0.6 }))
  const col = new THREE.Color()
  fish.forEach((f, i) => {
    col.setHSL(0.08 + (rand() - 0.5) * 0.04, 0.1, 0.92 + rand() * 0.16)
    bodies.setColorAt(i, col)
  })
  const M = new THREE.Matrix4()
  const T = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const v = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const g = group(bodies, tails)
  g.userData.animate = (t: number) => {
    fish.forEach((f, i) => {
      const a = f.ph + t * f.w
      const r = f.r + 0.25 * Math.sin(t * 0.7 + f.wob)
      v.set(Math.cos(a) * r, f.y + 0.25 * Math.sin(t * 0.9 + f.wob), Math.sin(a) * r * 0.8)
      // Facing along the circle (counter-clockwise from above).
      e.set(0.12 * Math.cos(t * 0.9 + f.wob), Math.atan2(-Math.sin(a), Math.cos(a) * 0.8), 0)
      q.setFromEuler(e)
      sc.setScalar(f.s)
      M.compose(v, q, sc)
      bodies.setMatrixAt(i, M)
      T.makeRotationY(0.5 * Math.sin(t * 11 + f.wob * 3)).premultiply(new THREE.Matrix4().makeTranslation(0, 0, -0.14))
      tails.setMatrixAt(i, M.clone().multiply(T))
    })
    bodies.instanceMatrix.needsUpdate = true
    tails.instanceMatrix.needsUpdate = true
  }
  g.userData.animate(0)
  return g
}

const butterflyGeo = once(() => ({
  wing: share(paint(new THREE.ShapeGeometry(new THREE.Shape([
    new THREE.Vector2(0, 0.02), new THREE.Vector2(0.09, 0.12), new THREE.Vector2(0.17, 0.1), new THREE.Vector2(0.15, 0.0),
    new THREE.Vector2(0.12, -0.04), new THREE.Vector2(0.11, -0.11), new THREE.Vector2(0.04, -0.12), new THREE.Vector2(0, -0.03)
  ])).rotateX(Math.PI / 2), (x, _y, z) => {
    const edge = Math.hypot(x / 0.17, z / 0.12)
    const k = edge > 0.8 ? 0.25 : 1 // dark wing borders
    return [k, k, k]
  })),
  body: share(new THREE.CylinderGeometry(0.008, 0.012, 0.13, 4).rotateX(Math.PI / 2))
}))

/** A cloud of butterflies, 5 m across, fluttering on wandering paths. Colour = their wings. */
export const butterflies: Build = () => {
  const G = butterflyGeo()
  const n = 18
  const rand = seeded('butterflies')
  const wingM = hideMat('#f08a24', { side: THREE.DoubleSide, roughness: 0.6, emissive: '#000000' })
  const left = new THREE.InstancedMesh(G.wing, wingM, n)
  const right = new THREE.InstancedMesh(G.wing, wingM, n)
  const bodies = new THREE.InstancedMesh(G.body, mat('#1d1a18'), n)
  for (const m of [left, right, bodies]) {
    m.castShadow = false
    m.frustumCulled = false
  }
  for (const m of [left, right]) {
    m.userData.slot = 'primary'
    m.userData.baseColor = '#f08a24'
  }
  const bugs = Array.from({ length: n }, () => ({ x: (rand() - 0.5) * 4, y: 0.6 + rand() * 1.6, z: (rand() - 0.5) * 4, ph: rand() * 6.28, f: 9 + rand() * 4, s: 0.8 + rand() * 0.5 }))
  const M = new THREE.Matrix4()
  const W = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const sc = new THREE.Vector3()
  const mirror = new THREE.Matrix4().makeScale(-1, 1, 1)
  const g = group(left, right, bodies)
  g.userData.animate = (t: number) => {
    bugs.forEach((b, i) => {
      const u = t * 0.5 + b.ph
      p.set(b.x + 1.2 * Math.sin(u) + 0.4 * Math.sin(u * 2.3), b.y + 0.35 * Math.sin(u * 1.7) + 0.1 * Math.sin(t * b.f * 0.5), b.z + 1.2 * Math.cos(u * 0.8))
      const heading = Math.atan2(1.2 * Math.cos(u) + 0.92 * Math.cos(u * 2.3), -0.96 * Math.sin(u * 0.8))
      q.setFromEuler(new THREE.Euler(-0.3, heading, 0, 'YXZ'))
      sc.setScalar(b.s)
      M.compose(p, q, sc)
      bodies.setMatrixAt(i, M)
      const flap = 0.15 + 1.05 * (0.5 + 0.5 * Math.sin(t * b.f + b.ph))
      W.makeRotationZ(flap)
      right.setMatrixAt(i, M.clone().multiply(W))
      W.makeRotationZ(-flap)
      left.setMatrixAt(i, M.clone().multiply(W).multiply(mirror))
    })
    for (const m of [left, right, bodies]) m.instanceMatrix.needsUpdate = true
  }
  g.userData.animate(0)
  return g
}
