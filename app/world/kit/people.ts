/**
 * People (NPC): one canonical low-poly humanoid, dressed by role (villager, fisherman, shopkeeper, child,
 * elder, guard, wizard, farmer) and varied per person from their id (skin tone, hair style and colour,
 * height, build). Faceted primitives in the app's simple style; every joint hangs off a named pivot.
 *
 * Animation is procedural. The People runtime (app/world/npc/people.ts) hands the body a `PersonPose`
 * every frame through `userData.person`; `posePerson` turns it into joint angles: breathing, a walk cycle,
 * looking at you, waving, sitting, talking with the hands, dancing, pointing, bowing, cheering, flinching,
 * and the work of their routine (fishing, sweeping, reading, casting).
 *
 * Cheap: geometry is shared by every person (built once, `userData.shared`); materials are per person
 * (the recolour path writes them: primary = shirt or robe, trim = trousers); no lights (the wizard's orb
 * and the lantern glow are emissive only).
 */
import * as THREE from 'three'
import { personGender, rolePreset } from '#shared/npc/people'
import type { Role } from '#shared/world/ops'
import { glowMat, group, mat, mesh, seeded } from './helpers'
import type { Build } from './helpers'

// ---------- proportions (adult, metres; origin at the feet, front +z) ----------

const THIGH = 0.42
const SHIN = 0.4
const FOOT_H = 0.07
const HIP_Y = THIGH + SHIN + FOOT_H // 0.89
const SHOULDER_Y = 0.47 // above the hips
const NECK_Y = 0.53
const UPPER = 0.28
const FORE = 0.25

const once = <T>(make: () => T): (() => T) => {
  let v: T | undefined
  return () => (v ??= make())
}
function share<T extends THREE.BufferGeometry>(g: T): T {
  g.userData.shared = true
  return g
}

/** A tapered limb hanging down -y from its pivot. */
const limb = (len: number, r0: number, r1: number, sides = 6) => share(new THREE.CylinderGeometry(r1, r0, len, sides, 1).translate(0, -len / 2, 0))

const geo = once(() => ({
  thigh: limb(THIGH, 0.078, 0.058),
  shin: limb(SHIN, 0.056, 0.042),
  foot: share(new THREE.BoxGeometry(0.1, FOOT_H, 0.23).translate(0, -FOOT_H / 2, 0.045)),
  pelvis: share(new THREE.CylinderGeometry(0.16, 0.15, 0.16, 7, 1).scale(1, 1, 0.68).translate(0, 0.02, 0)),
  torso: share(new THREE.CylinderGeometry(0.2, 0.16, 0.42, 7, 1).scale(1, 1, 0.64).translate(0, 0.28, 0)),
  shoulders: share(new THREE.SphereGeometry(0.2, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.32, 0.64).translate(0, 0.48, 0)),
  neck: share(new THREE.CylinderGeometry(0.045, 0.055, 0.09, 6).translate(0, 0.04, 0)),
  head: share(new THREE.IcosahedronGeometry(0.118, 1).scale(0.93, 1.08, 1).translate(0, 0.13, 0)),
  nose: share(new THREE.ConeGeometry(0.022, 0.05, 4).rotateX(Math.PI / 2).translate(0, 0.12, 0.115)),
  eye: share(new THREE.SphereGeometry(0.018, 6, 4)),
  mouth: share(new THREE.BoxGeometry(0.045, 0.01, 0.01)),
  brow: share(new THREE.BoxGeometry(0.04, 0.009, 0.01)),
  // Mood mouths: a smile arc (a frown is the same arc upside down) and an open "o" for fright.
  smile: share(new THREE.TorusGeometry(0.024, 0.0055, 3, 8, Math.PI).rotateZ(Math.PI)),
  gasp: share(new THREE.CylinderGeometry(0.014, 0.014, 0.01, 8).rotateX(Math.PI / 2)),
  upper: limb(UPPER, 0.05, 0.042),
  fore: limb(FORE, 0.042, 0.034),
  hand: share(new THREE.IcosahedronGeometry(0.046, 0).scale(0.8, 1.1, 0.7).translate(0, -0.035, 0)),
  // hair styles (on the head pivot)
  // Tilted back so it sits above the brow in front and covers the nape behind (never over the eyes).
  cap: share(new THREE.SphereGeometry(0.13, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(-0.5).translate(0, 0.148, -0.012)),
  long: share(new THREE.BoxGeometry(0.22, 0.26, 0.08).translate(0, 0.07, -0.085)),
  bun: share(new THREE.SphereGeometry(0.06, 6, 4).translate(0, 0.25, -0.08)),
  spikes: share(new THREE.ConeGeometry(0.11, 0.1, 6).translate(0, 0.27, -0.01)),
  // A rounded chin beard (a hard black triangle read as a mask on pale skin).
  beard: share(new THREE.SphereGeometry(0.085, 7, 4, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55).scale(0.95, 0.85, 0.75).translate(0, 0.085, 0.035)),
  // hats and gear
  bucket: share(new THREE.CylinderGeometry(0.11, 0.13, 0.09, 8).translate(0, 0.27, 0)),
  brim: share(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 10).translate(0, 0.225, 0)),
  wideBrim: share(new THREE.CylinderGeometry(0.28, 0.28, 0.012, 12).translate(0, 0.225, 0)),
  straw: share(new THREE.CylinderGeometry(0.1, 0.13, 0.1, 8).translate(0, 0.28, 0)),
  helmet: share(new THREE.SphereGeometry(0.135, 8, 5, 0, Math.PI * 2, 0, Math.PI * 0.5).translate(0, 0.16, 0)),
  crest: share(new THREE.BoxGeometry(0.02, 0.07, 0.2).translate(0, 0.3, 0)),
  cone: share(new THREE.ConeGeometry(0.15, 0.42, 8).translate(0, 0.42, -0.01)),
  coneBrim: share(new THREE.CylinderGeometry(0.24, 0.24, 0.014, 12).translate(0, 0.21, 0)),
  // A shallow tapered front panel (theta 0 is +z, the front).
  apron: share(new THREE.CylinderGeometry(0.17, 0.21, 0.5, 4, 1, true, -Math.PI * 0.3, Math.PI * 0.6).scale(1, 1, 0.66).translate(0, -0.03, 0.01)),
  robe: share(new THREE.CylinderGeometry(0.19, 0.33, 0.86, 8, 1, true).translate(0, -0.42, 0)),
  vest: share(new THREE.CylinderGeometry(0.205, 0.17, 0.3, 7, 1, true).scale(1, 1, 0.66).translate(0, 0.33, 0)),
  strap: share(new THREE.BoxGeometry(0.04, 0.32, 0.015)),
  tabard: share(new THREE.BoxGeometry(0.26, 0.56, 0.02).translate(0, 0.18, 0.115)),
  stick: share(new THREE.CylinderGeometry(0.014, 0.018, 1.25, 5).translate(0, -0.25, 0)),
  orb: share(new THREE.IcosahedronGeometry(0.06, 1)),
  spearTip: share(new THREE.ConeGeometry(0.035, 0.16, 5).translate(0, 0.43, 0)),
  rod: share(new THREE.CylinderGeometry(0.008, 0.016, 2.1, 4).translate(0, 1.05, 0)),
  line: share(new THREE.CylinderGeometry(0.002, 0.002, 1.8, 3).translate(0, -0.9, 0)),
  book: share(new THREE.BoxGeometry(0.18, 0.025, 0.13)),
  broom: share(new THREE.CylinderGeometry(0.012, 0.014, 1.15, 4).translate(0, -0.35, 0)),
  cue: share(new THREE.CylinderGeometry(0.007, 0.013, 1.3, 5).rotateX(Math.PI / 2).translate(0, -0.03, 0.45)),
  rag: share(new THREE.BoxGeometry(0.1, 0.02, 0.08)),
  bristles: share(new THREE.ConeGeometry(0.09, 0.22, 6).translate(0, -1.0, 0))
}))

const SKIN = ['#f1c9a5', '#e0ac85', '#c98e63', '#a96f48', '#7d4e30', '#5a3722', '#f5d6bc', '#d49b74']
const HAIR = ['#2a1d14', '#4a3020', '#6b4428', '#a8743f', '#d8b36a', '#1a1a1a', '#7a3a1e', '#3b2a22']
const GREY = ['#d9d6d0', '#bdb9b2', '#efede8']
const SHIRT = ['#7a5a8a', '#3f6b8a', '#8a4a3a', '#5a7a4a', '#b08a4a', '#4a5a7a', '#9a6a5a', '#6a7a8a', '#a85a6a', '#5f8a7a']
const PANTS = ['#3a3f4a', '#4a3a2a', '#2f3a4f', '#5a4a3a', '#3a4a3a']

interface Dress {
  shirt: string
  pants: string
  hair: 'cap' | 'long' | 'bun' | 'spikes' | 'bald'
  hairColor: string
  beard: boolean
  hat?: 'bucket' | 'straw' | 'helmet' | 'cone'
  hatColor?: string
  over?: 'apron' | 'robe' | 'vest' | 'tabard' | 'straps'
  overColor?: string
  hold?: 'cane' | 'spear' | 'staff'
  height: number
  build: number
  stoop: number
  headScale: number
}

function dress(role: Role, seed: string, name?: string): Dress {
  const r = seeded(seed || 'person')
  const pick = <T>(l: T[]) => l[Math.floor(r() * l.length) % l.length]!
  // The same gender the name and the voice were chosen by (shared/npc/people.ts).
  const fem = personGender(seed || 'person', name) === 'f'
  const base: Dress = {
    shirt: pick(SHIRT), pants: pick(PANTS),
    hair: fem ? pick(['long', 'bun', 'cap', 'long'] as const) : pick(['cap', 'cap', 'spikes', 'bald'] as const),
    hairColor: pick(HAIR), beard: !fem && r() < 0.35,
    height: 0.94 + r() * 0.12, build: 0.9 + r() * 0.25, stoop: 0, headScale: 1
  }
  switch (role) {
    case 'fisherman': return { ...base, shirt: pick(['#3f5a6a', '#5a6a4a', '#6a4a3a']), hat: 'bucket', hatColor: '#d9a63a', over: 'vest', overColor: '#c9a13a', beard: !fem && r() < 0.7 }
    case 'shopkeeper': return { ...base, over: 'apron', overColor: '#efe8da' }
    case 'child': return { ...base, height: 0.6 + r() * 0.08, build: 0.95, headScale: 1.22, beard: false, shirt: pick(['#d9603a', '#3a8ad9', '#e0b23a', '#5ab05a', '#c05aa0']) }
    case 'elder': return { ...base, hairColor: pick(GREY), hair: fem ? (r() < 0.5 ? 'bun' : 'long') : r() < 0.3 ? 'bald' : 'cap', stoop: 0.22, height: 0.9 + r() * 0.06, hold: 'cane', shirt: pick(['#6a5a4a', '#5a5a6a', '#7a6a5a']) }
    case 'guard': return { ...base, hat: 'helmet', hatColor: '#9aa0a8', over: 'tabard', overColor: pick(['#9e2a2b', '#22355e', '#2f5d3c']), hold: 'spear', build: 1.05 + r() * 0.15, beard: !fem && r() < 0.3 }
    case 'wizard': return { ...base, hat: 'cone', hatColor: pick(['#3a2f7a', '#22355e', '#5a2a6a']), over: 'robe', overColor: pick(['#3a2f7a', '#22355e', '#5a2a6a']), hold: 'staff', beard: !fem, hairColor: pick(GREY), hair: 'long' }
    case 'farmer': return { ...base, hat: 'straw', hatColor: '#d8c07a', over: 'straps', overColor: '#3f5f8a', shirt: pick(['#c9b79a', '#b05a3a', '#8a9a6a']) }
    default: return base
  }
}

/** What the People runtime hands a person every frame. Weights are 0..1 and blended by the runtime. */
export interface PersonPose {
  t: number
  /** Walking speed (m/s) and stride phase (cycles). */
  speed: number
  stride: number
  /** Head turn relative to the body (radians, + = toward their left / +x), and pitch (+ = look up). */
  headYaw: number
  headPitch: number
  wave: number
  talk: number
  sit: number
  dance: number
  point: number
  /** Where the point goes, relative to the body: yaw (+ = their left) and pitch (+ = up). */
  pointYaw: number
  pointPitch: number
  cheer: number
  bow: number
  flinch: number
  /** The routine's work, and which: fish, sweep, read, cast, tend, work. */
  work: number
  workKind: string
  /** Lying low for the night: head down, still. */
  sleep: number
  /** How they feel (shared/npc/reply.ts MOODS) and how much it shows (0..1, blended by the runtime). */
  mood: string
  moodW: number
  seed: number
}

export function restPose(): PersonPose {
  return { t: 0, speed: 0, stride: 0, headYaw: 0, headPitch: 0, wave: 0, talk: 0, sit: 0, dance: 0, point: 0, pointYaw: 0, pointPitch: 0, cheer: 0, bow: 0, flinch: 0, work: 0, workKind: '', sleep: 0, mood: 'calm', moodW: 0, seed: 0 }
}

const pivot = (x = 0, y = 0, z = 0, ...children: THREE.Object3D[]): THREE.Group => {
  const p = group(...children)
  p.position.set(x, y, z)
  return p
}

const TAU = Math.PI * 2

export const person: Build = (props) => {
  const role = rolePreset(props.role)
  const d = dress(role, props.seed ?? 'person', props.name)
  const G = geo()
  const r = seeded(`${props.seed ?? 'person'}:skin`)
  const skinHex = SKIN[Math.floor(r() * SKIN.length) % SKIN.length]!
  const skin = mat(skinHex, { flatShading: true, roughness: 0.75 })
  const hair = mat(d.hairColor, { flatShading: true, roughness: 0.9 })
  const shirt = mat(d.shirt, { flatShading: true, roughness: 0.85 })
  const pants = mat(d.pants, { flatShading: true, roughness: 0.9 })
  const shoe = mat('#2a221c', { flatShading: true, roughness: 0.8 })
  const dark = mat('#141210', { roughness: 0.85 })

  // ---- legs ----
  const legs = ([1, -1] as const).map((s) => {
    const hip = pivot(0.095 * s, 0, 0, mesh(G.thigh, pants, 'trim'))
    const knee = pivot(0, -THIGH, 0, mesh(G.shin, pants, 'trim'))
    const ankle = pivot(0, -SHIN, 0, mesh(G.foot, shoe, null))
    knee.add(ankle)
    hip.add(knee)
    return { hip, knee, ankle, s }
  })
  const hips = pivot(0, HIP_Y, 0, mesh(G.pelvis, pants, 'trim'), ...legs.map(l => l.hip))

  // ---- torso, neck, head ----
  const torso = mesh(G.torso, shirt, 'primary')
  const shoulders = mesh(G.shoulders, shirt, 'primary')
  const spine = pivot(0, 0.04, 0, torso, shoulders)
  hips.add(spine)
  const head = pivot(0, 0.08, 0, mesh(G.head, skin, null), mesh(G.nose, skin, null))
  const eyes: THREE.Mesh[] = []
  const brows: THREE.Mesh[] = []
  for (const s of [1, -1]) {
    const eye = mesh(G.eye, dark, null, 0.042 * s, 0.142, 0.103)
    eyes.push(eye)
    head.add(eye)
    const brow = mesh(G.brow, hair, null, 0.042 * s, 0.172, 0.107)
    brow.rotation.z = 0.12 * s
    brows.push(brow)
    head.add(brow)
  }
  const lipM = mat('#5a2a22', { roughness: 0.6 })
  const mouth = mesh(G.mouth, lipM, null, 0, 0.075, 0.108)
  const smile = mesh(G.smile, lipM, null, 0, 0.082, 0.106)
  const gasp = mesh(G.gasp, lipM, null, 0, 0.072, 0.11)
  smile.visible = false
  gasp.visible = false
  head.add(mouth, smile, gasp)
  const hairMeshes: THREE.Mesh[] = []
  if (d.hair !== 'bald') head.add(mesh(G.cap, hair, null))
  if (d.hair === 'long') head.add(mesh(G.long, hair, null))
  if (d.hair === 'bun') head.add(mesh(G.bun, hair, null))
  if (d.hair === 'spikes') head.add(mesh(G.spikes, hair, null))
  if (d.beard) head.add(mesh(G.beard, hair, null))
  head.traverse(o => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).material === hair && hairMeshes.push(o as THREE.Mesh))
  if (d.hat) {
    const hatM = mat(d.hatColor ?? '#7a5233', { flatShading: true, roughness: d.hat === 'helmet' ? 0.35 : 0.9, metalness: d.hat === 'helmet' ? 0.7 : 0 })
    if (d.hat === 'bucket') head.add(mesh(G.bucket, hatM, null), mesh(G.brim, hatM, null))
    if (d.hat === 'straw') head.add(mesh(G.straw, hatM, null), mesh(G.wideBrim, hatM, null))
    if (d.hat === 'helmet') head.add(mesh(G.helmet, hatM, null), mesh(G.crest, mat('#9e2a2b', { flatShading: true }), null))
    if (d.hat === 'cone') head.add(mesh(G.cone, hatM, null), mesh(G.coneBrim, hatM, null))
  }
  head.scale.setScalar(d.headScale)
  const neck = pivot(0, NECK_Y, 0, mesh(G.neck, skin, null), head)
  spine.add(neck)

  // ---- arms ----
  const arms = ([1, -1] as const).map((s) => {
    const shoulder = pivot(0.205 * s, SHOULDER_Y, 0, mesh(G.upper, shirt, 'primary'))
    const elbow = pivot(0, -UPPER, 0, mesh(G.fore, shirt, 'primary'))
    const hand = pivot(0, -FORE, 0, mesh(G.hand, skin, null))
    elbow.add(hand)
    shoulder.add(elbow)
    spine.add(shoulder)
    return { shoulder, elbow, hand, s }
  })
  const right = arms[1]!
  const left = arms[0]!

  // ---- over-garments ----
  if (d.over) {
    const overM = mat(d.overColor ?? '#efe8da', { flatShading: true, roughness: 0.9, side: THREE.DoubleSide })
    if (d.over === 'apron') spine.add(mesh(G.apron, overM, null, 0, 0.2, 0))
    if (d.over === 'tabard') spine.add(mesh(G.tabard, overM, null))
    if (d.over === 'vest') spine.add(mesh(G.vest, overM, null))
    if (d.over === 'straps') {
      for (const s of [1, -1]) {
        const st = mesh(G.strap, overM, null, 0.08 * s, 0.32, 0.112)
        spine.add(st)
      }
      spine.add(mesh(G.apron, overM, null, 0, 0.12, -0.005))
    }
    if (d.over === 'robe') {
      // The robe hangs from the hips over the legs; it's the wizard's primary colour.
      const robe = mesh(G.robe, mat(d.overColor ?? '#3a2f7a', { flatShading: true, roughness: 0.9, side: THREE.DoubleSide }), 'primary', 0, 0.06, 0)
      hips.add(robe)
      for (const l of legs) l.hip.traverse(o => o.userData.slot === 'trim' && ((o as THREE.Mesh).visible = false))
      torso.material = robe.material
      shoulders.material = robe.material
      for (const a of arms) a.shoulder.children.forEach(c => (c as THREE.Mesh).isMesh && ((c as THREE.Mesh).material = robe.material))
    }
  }

  // ---- held things (in the right hand) ----
  let staffOrb: THREE.Mesh | null = null
  // The held pole hangs off a grip pivot that the pose keeps upright (a spear stands, never juts out).
  const grip = pivot(0, -0.04, 0.02)
  if (d.hold) {
    const wood = mat(d.hold === 'spear' ? '#6b4a30' : '#5a3d28', { flatShading: true, roughness: 0.9 })
    const stick = mesh(G.stick, wood, null, 0, d.hold === 'spear' ? 0.15 : 0, 0)
    if (d.hold === 'cane') stick.scale.y = 0.72
    grip.add(stick)
    if (d.hold === 'spear') grip.add(mesh(G.spearTip, mat('#c0c4c8', { metalness: 0.8, roughness: 0.3, flatShading: true }), null, 0, 0.18, 0))
    if (d.hold === 'staff') {
      staffOrb = mesh(G.orb, glowMat('#9fd0ff', 2.2), null, 0, 0.42, 0)
      staffOrb.castShadow = false
      grip.add(staffOrb)
    }
    right.hand.add(grip)
  }
  // Props for the routine's work: hidden until that work begins.
  const rod = group(mesh(G.rod, mat('#6b4a30', { flatShading: true }), null), mesh(G.line, mat('#e8e2d0'), null, 0, 2.1, 0))
  rod.children[1]!.position.set(0, 2.1, 0)
  rod.rotation.x = 1.05
  rod.visible = false
  right.hand.add(rod)
  const book = mesh(G.book, mat('#7a2e2e', { flatShading: true }), null, -0.05, -0.06, 0.06)
  book.visible = false
  left.hand.add(book)
  const broom = group(mesh(G.broom, mat('#8a6a48', { flatShading: true }), null), mesh(G.bristles, mat('#c9a86a', { flatShading: true }), null))
  broom.visible = false
  right.hand.add(broom)
  const cue = mesh(G.cue, mat('#c9a06a', { flatShading: true }), null)
  cue.visible = false
  right.hand.add(cue)
  const rag = mesh(G.rag, mat('#e8e0cc', { flatShading: true }), null, 0, -0.05, 0.02)
  rag.visible = false
  right.hand.add(rag)

  const bodyScale = pivot(0, 0, 0, hips)
  bodyScale.scale.set(d.height * d.build, d.height, d.height * (0.5 + d.build * 0.5))
  const root = group(bodyScale)
  root.userData.personHeight = (HIP_Y + 0.04 + NECK_Y + 0.08 + 0.26 * d.headScale) * d.height
  root.userData.mouthY = (HIP_Y + 0.04 + NECK_Y + 0.08 + 0.12 * d.headScale) * d.height

  // ---- age (the persona's, once it's known): grey hair and a stoop past sixty, a child's size under thirteen ----
  const baseScale = bodyScale.scale.clone()
  const baseHeight = root.userData.personHeight as number
  let stoop = d.stoop
  root.userData.setAge = (age: number) => {
    if (root.userData.age === age) return
    root.userData.age = age
    if (age >= 60 && role !== 'child') {
      const g = GREY[Math.floor(seeded(`${props.seed}:grey`)() * GREY.length) % GREY.length]!
      const greyM = mat(age >= 70 ? g : '#9a958c', { flatShading: true, roughness: 0.9 })
      for (const m of hairMeshes) m.material = greyM
      stoop = Math.max(d.stoop, Math.min(0.24, (age - 55) * 0.009))
    }
    const kid = age < 13 && role !== 'child'
    bodyScale.scale.copy(baseScale).multiplyScalar(kid ? 0.66 : 1)
    head.scale.setScalar(kid ? 1.2 : d.headScale)
    root.userData.personHeight = baseHeight * (kid ? 0.7 : 1)
  }

  // ---- the pose ----
  const holdArm = d.hold ? 1 : 0
  root.userData.person = (p: PersonPose) => {
    const t = p.t
    const ph = p.seed * TAU
    const step = Math.min(1, p.speed / 1.4)
    const run = Math.max(0, Math.min(1, (p.speed - 2) / 2))
    const s = p.stride * TAU
    const breath = Math.sin(t * 1.6 + ph)
    const sit = p.sit
    const dance = p.dance
    const sleep = p.sleep

    // Legs: a walk cycle (hip swing, knee lift in the swing), folding to a seat.
    legs.forEach((l, i) => {
      const phase = s + (i === 0 ? 0 : Math.PI)
      const swing = Math.sin(phase)
      const lift = Math.max(0, Math.cos(phase))
      let hip = -swing * (0.42 + 0.3 * run) * step
      let knee = lift * (0.7 + 0.5 * run) * step
      // Dancing: a side-to-side step and a little knee pop.
      hip += dance * 0.3 * Math.sin(t * 5 + i * Math.PI)
      knee += dance * 0.55 * Math.max(0, Math.sin(t * 5 + i * Math.PI))
      l.hip.rotation.x = hip * (1 - sit) - 1.45 * sit
      l.hip.rotation.z = 0.04 * l.s * (1 - sit) + dance * 0.08 * l.s
      l.knee.rotation.x = knee * (1 - sit) + 1.5 * sit
      l.ankle.rotation.x = -0.25 * lift * step * (1 - sit) - 0.05 * sit
    })
    // Hips: bob with the stride, drop into the seat, sway to the music.
    const bob = Math.abs(Math.cos(s)) * 0.035 * step + Math.abs(Math.sin(t * 5)) * 0.09 * dance - 0.05 * dance
    hips.position.y = HIP_Y + bob - (HIP_Y - 0.48) * sit - 0.04 * p.flinch + 0.18 * p.cheer * Math.max(0, Math.sin(t * 9))
    hips.position.z = -0.05 * sit
    hips.rotation.y = 0.08 * Math.sin(s) * step + dance * 0.5 * Math.sin(t * 2.5)
    hips.rotation.z = dance * 0.16 * Math.sin(t * 5)
    hips.position.x = dance * 0.06 * Math.sin(t * 5)

    // Spine: upright, a stoop with age, a lean into the walk, a bow, a flinch, a little breath.
    const mw = p.moodW
    const afraid = p.mood === 'afraid' ? mw : 0
    const sad = p.mood === 'sad' ? mw : 0
    const annoyed = p.mood === 'annoyed' ? mw : 0
    const glad = p.mood === 'happy' || p.mood === 'amused' ? mw : 0
    const curious = p.mood === 'curious' ? mw : 0
    spine.rotation.x = stoop + 0.06 * step + 0.12 * run + 0.75 * p.bow + 0.25 * p.flinch + 0.18 * sleep + 0.2 * p.work * (p.workKind === 'sweep' || p.workKind === 'tend' ? 1 : 0) + 0.55 * p.work * (p.workKind === 'play' ? 1 : 0) + 0.15 * p.work * (p.workKind === 'serve' ? 1 : 0) + 0.1 * afraid + 0.12 * sad - 0.04 * glad - 0.02 * breath
    spine.rotation.y = -hips.rotation.y * 0.8 + 0.35 * p.point * Math.max(-1, Math.min(1, p.pointYaw))
    spine.rotation.z = dance * -0.22 * Math.sin(t * 5)
    spine.scale.set(1 + 0.012 * breath, 1, 1 + 0.015 * breath)

    // Head: look where the runtime says (you, the sky, the dragon), bob while talking, nod off asleep.
    const talkBob = p.talk * (0.05 * Math.sin(t * 7.3 + ph) + 0.03 * Math.sin(t * 3.1))
    neck.rotation.y = Math.max(-1.2, Math.min(1.2, p.headYaw - spine.rotation.y)) * 0.5
    head.rotation.y = Math.max(-1.2, Math.min(1.2, p.headYaw - spine.rotation.y)) * 0.5
    head.rotation.x = -p.headPitch * 0.6 - stoop * 0.7 - talkBob + 0.5 * sleep + 0.35 * p.flinch + 0.25 * p.work * (p.workKind === 'read' ? 1 : 0)
    neck.rotation.x = -p.headPitch * 0.3 - stoop * 0.3
    head.rotation.x += 0.22 * sad - 0.08 * glad - 0.3 * p.work * (p.workKind === 'play' ? 1 : 0)
    head.rotation.z = dance * 0.12 * Math.sin(t * 3 + 1) + 0.05 * p.talk * Math.sin(t * 2.3 + ph) + 0.16 * curious
    // The face: brows (inner ends down when annoyed, up and raised when afraid or sad), eyes (wide with
    // fright, a squint when amused), and the mouth (a smile, a frown, a gasp, or the talking box).
    brows.forEach((b, i) => {
      const side = i === 0 ? 1 : -1
      // + on the left brow (and - on the right) drops the inner end: a scowl; the other way is worry.
      b.rotation.z = side * (0.12 + 0.42 * annoyed - 0.38 * (afraid + sad) - 0.05 * glad) + (i === 0 ? -0.25 * curious : 0)
      b.position.y = 0.172 + 0.012 * afraid + 0.006 * sad - 0.006 * annoyed + (i === 0 ? 0.014 * curious : 0) + 0.004 * glad
    })
    for (const e of eyes) e.scale.set(1 + 0.3 * afraid, 1 + 0.45 * afraid - 0.4 * (p.mood === 'amused' ? mw : 0), 1)
    const smiling = glad > 0.3 && p.talk < 0.6
    const frowning = (sad > 0.3 || annoyed > 0.3) && p.talk < 0.6
    const gasping = afraid > 0.5 && p.talk < 0.3
    smile.visible = smiling || frowning
    smile.rotation.z = frowning ? Math.PI : 0
    smile.position.y = frowning ? 0.066 : 0.082
    smile.scale.set(1 + 0.25 * glad, 1, 1)
    gasp.visible = gasping
    mouth.visible = !smile.visible && !gasp.visible
    mouth.scale.y = 1 + p.talk * 3.5 * Math.max(0, Math.sin(t * 13 + ph) * Math.sin(t * 5.3))
    mouth.scale.x = 1 + 0.3 * glad

    // Arms: counter-swing, then whatever they're doing on top.
    arms.forEach((a, i) => {
      const phase = s + (i === 0 ? Math.PI : 0)
      let sx = Math.sin(phase) * (0.38 + 0.5 * run) * step * -1 // shoulder pitch (- = forward)
      let sz = (0.08 + 0.04 * breath * 0.2) * a.s // out from the body
      let ey = 0
      let ex = -0.12 - 0.5 * run * step // elbow bend (- = forward)
      const isRight = a.s < 0
      // Carrying a cane, spear or staff: the right arm holds it out a little, forearm forward.
      if (isRight && holdArm) {
        sx = sx * 0.3 - 0.25
        ex = -0.9
      }
      // Talking: the hands come up and move with the words.
      if (p.talk > 0) {
        const g = Math.max(0, Math.sin(t * 1.7 + ph + i * 2.1)) * p.talk
        sx += (-0.55 - 0.25 * Math.sin(t * 4.1 + i)) * g
        ex += -0.9 * g
        sz += 0.1 * a.s * g
      }
      // Feelings in the arms: folded when annoyed, pulled in and up when afraid (only when idle).
      const idle = (1 - step) * (1 - p.talk) * (1 - p.work)
      if (annoyed * idle > 0) {
        const w = annoyed * idle
        sx += (-0.5 - sx) * w
        sz += (0.1 * a.s - sz) * w
        ex += (-1.95 - ex) * w
      }
      if (afraid * idle > 0) {
        const w = afraid * idle * 0.7
        sx += (-0.55 - sx) * w
        sz += (0.06 * a.s - sz) * w
        ex += (-1.6 - ex) * w
      }
      // Sitting: hands on the knees.
      sx += (-0.55 - sx) * sit * 0.9
      ex += (-0.55 - ex) * sit * 0.9
      // Dancing: arms up and swinging.
      if (dance > 0) {
        // Arms up, alternating high and low, swinging out with the beat.
        const beat = Math.sin(t * 5 + i * Math.PI)
        sx += (-1.6 + 0.9 * beat - sx) * dance
        sz += ((1.0 + 0.6 * Math.max(0, -beat)) * a.s - sz) * dance
        ex += (-1.0 - 0.5 * beat - ex) * dance
      }
      // Cheering: both arms straight up.
      if (p.cheer > 0) {
        sz += (2.6 * a.s - sz) * p.cheer
        ex += (-0.15 * Math.max(0, Math.sin(t * 9)) - ex) * p.cheer
      }
      // Flinching: arms pulled in and up in front.
      if (p.flinch > 0) {
        sx += (-1.0 - sx) * p.flinch
        ex += (-1.8 - ex) * p.flinch
        sz += (0.05 * a.s - sz) * p.flinch
      }
      // Bowing: arms hang forward.
      sx += (-0.3 - sx) * p.bow * 0.6
      if (isRight) {
        // Waving: the right arm up to the side, the forearm swinging.
        if (p.wave > 0) {
          sz += (-2.5 - sz) * p.wave
          sx += (-0.25 - sx) * p.wave
          ex += (-0.35 - ex) * p.wave
          ey = 0
          a.elbow.rotation.z = p.wave * 0.55 * Math.sin(t * 9)
        } else {
          a.elbow.rotation.z = 0
        }
        // Work in the right hand: a rod held out over the water, a broom sweeping, a staff raised.
        if (p.work > 0) {
          const w = p.work
          if (p.workKind === 'fish') {
            sx += (-0.9 + 0.05 * Math.sin(t * 0.7 + ph) - sx) * w
            ex += (-0.5 - ex) * w
          } else if (p.workKind === 'sweep') {
            sx += (-0.55 + 0.35 * Math.sin(t * 3 + ph) - sx) * w
            ex += (-0.6 - ex) * w
          } else if (p.workKind === 'cast') {
            sx += (-2.2 + 0.25 * Math.sin(t * 2 + ph) - sx) * w
            ex += (-0.2 - ex) * w
          } else if (p.workKind === 'read') {
            sx += (-0.7 - sx) * w
            ex += (-1.3 - ex) * w
          } else if (p.workKind === 'play') {
            // Lining up a shot: the cue held low and level, drawn back and forth.
            sx += (-0.35 + 0.12 * Math.sin(t * 2.2 + ph) - sx) * w
            ex += (-1.1 - ex) * w
          } else if (p.workKind === 'serve') {
            // Wiping the counter in slow circles.
            sx += (-0.75 + 0.15 * Math.sin(t * 3 + ph) - sx) * w
            ex += (-0.9 + 0.2 * Math.cos(t * 3 + ph) - ex) * w
            sz += (-0.15 * Math.sin(t * 3 + ph) - sz) * w
          } else {
            sx += (-0.6 + 0.4 * Math.sin(t * 2.6 + ph) - sx) * w
            ex += (-1.0 + 0.4 * Math.sin(t * 2.6 + ph + 1) - ex) * w
          }
        }
      } else if (p.work > 0 && p.workKind === 'play') {
        // The bridge hand rests forward on the table.
        sx += (-1.0 - sx) * p.work
        ex += (-0.25 - ex) * p.work
      } else if (p.work > 0 && (p.workKind === 'read' || p.workKind === 'fish' || p.workKind === 'tend' || p.workKind === 'work')) {
        const w = p.work
        sx += ((p.workKind === 'read' ? -0.7 : -0.5 + 0.35 * Math.sin(t * 2.6 + ph + 2)) - sx) * w
        ex += ((p.workKind === 'read' ? -1.3 : -0.9) - ex) * w
      }
      // Pointing: the arm on the target's side goes straight out toward it (yaw applied last, so it swings the raised arm).
      if (p.point > 0 && (p.pointYaw >= 0) === (a.s > 0)) {
        sx += (-1.45 - Math.max(-0.6, Math.min(0.9, p.pointPitch)) - sx) * p.point
        sz += (0.12 * a.s - sz) * p.point
        ex += (0 - ex) * p.point
        ey += Math.max(-1.1, Math.min(1.1, p.pointYaw - spine.rotation.y)) * p.point
      }
      a.shoulder.rotation.set(sx, ey, sz, 'YXZ')
      a.elbow.rotation.x = ex
      // The pole stays upright whatever the arm does (spine and arm pitch undone at the grip).
      if (isRight && holdArm) grip.rotation.set(-(sx + ex + spine.rotation.x), 0, -sz)
    })
    // Sleeping: arms limp, nothing moves.
    rod.visible = p.workKind === 'fish' && p.work > 0.3
    broom.visible = p.workKind === 'sweep' && p.work > 0.3 && !d.hold
    book.visible = p.workKind === 'read' && p.work > 0.3
    cue.visible = p.workKind === 'play' && p.work > 0.3 && !d.hold
    rag.visible = p.workKind === 'serve' && p.work > 0.3 && !d.hold
    if (staffOrb) {
      const m = staffOrb.material as THREE.MeshStandardMaterial
      m.emissiveIntensity = 1.6 + 1.2 * Math.max(p.work * (p.workKind === 'cast' ? 1 : 0), p.point) * (0.7 + 0.3 * Math.sin(t * 8))
    }
  }
  root.userData.person(restPose())
  return root
}
