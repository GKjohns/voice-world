/**
 * The three.js side of the world. It owns no world data: `sync(state, effects)` reconciles objects from
 * a WorldState, and effects say what to animate (staggered arrivals, springs, colour wipes, shrink-outs).
 * It also owns the first-person camera, the gaze ray and the reticle/ghost rings.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { kindHeight } from '#shared/world/kinds'
import type { Fall, KindDescriptor } from '#shared/world/kinds'
import type { Vec3 } from '#shared/world/ops'
import { kindOf } from '#shared/world/select'
import type { Effects, Entity, GazeSnapshot, Player, WorldState } from '#shared/world/types'
import { ATMOSPHERES } from './atmosphere'
import type { AtmospherePreset } from './atmosphere'
import { BUILD_READS_COLOR, KIT_BUILDERS, blob } from './kit'
import { applyMaterialProps, gazeNdc, lookTargets } from './look'
import { buildFromParts } from './parts'
import { Ambience } from './sound'
import { Gathering } from './fx/anticipate'
import { beam, dissolve, shimmer, shockwave, sparkle } from './fx/arrival'
import type { Fx } from './fx/common'
import { solveFrame } from './fx/frame'
import type { FrameBox, View } from './fx/frame'
import { Vortex } from './fx/vortex'

const EYE = 1.6
const WALK = 6
const RUN = 14
const MAX_LIGHTS = 10
const REVEAL_TIGHT = 4.5 // fog radius (m) around the player while a place is being summoned
const BIG = 8 // metres tall: arrivals this big get the beam from the sky, the thump and the shake
const MID = 3
const PARTICLE_BUDGET = 1600 // dissolve sparks per sync (a teleport dissolves the whole old world)

interface Item {
  entity: Entity
  holder: THREE.Group // position, yaw, uniform scale
  stretch: THREE.Group // vertical stretch (props.height)
  body: THREE.Group // what the builder made
  buildKey: string
  leaving: boolean
}

/** Where an arrival sits in its batch, so the chimes climb and teleport builds stay light. */
interface Cue {
  index: number
  count: number
  reveal: boolean
  /** false for page loads and restores: things appear without fanfare */
  loud: boolean
}

interface Tween {
  start: number
  dur: number
  fn: (t: number) => void
  done?: () => void
  begin?: () => void
  begun?: boolean
}

export interface GazeInfo {
  kind: 'ground' | 'entity' | 'sky'
  entity?: string
  dist: number
}

const ease = {
  out: (t: number) => 1 - (1 - t) ** 3,
  inOut: (t: number) => t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2,
  back: (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
  bounce: (t: number) => {
    const n = 7.5625
    const d = 2.75
    if (t < 1 / d) return n * t * t
    if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75
    if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375
    return n * (t -= 2.625 / d) * t + 0.984375
  },
  // A damped spring that overshoots once: "the house stretches up a floor with a springy ease".
  spring: (t: number) => 1 - Math.exp(-6 * t) * Math.cos(9 * t)
}

export class WorldRenderer {
  readonly renderer: THREE.WebGLRenderer
  readonly scene = new THREE.Scene()
  readonly camera: THREE.PerspectiveCamera
  yaw = 0
  pitch = -0.12
  onGaze?: (g: GazeInfo) => void

  private host: HTMLElement
  private items = new Map<string, Item>()
  private leaving = new Set<Item>()
  private tweens: Tween[] = []
  private state: WorldState | null = null
  private keys: Record<string, boolean> = {}
  private drag: [number, number] | null = null
  private raycaster = new THREE.Raycaster()
  private hemi: THREE.HemisphereLight
  private sun: THREE.DirectionalLight
  private ground: THREE.Mesh
  private grid: THREE.Mesh
  private gridUniforms: { color: { value: THREE.Color }, opacity: { value: number }, fadeDist: { value: number } }
  private sky: THREE.Mesh
  private skyUniforms: { top: { value: THREE.Color }, horizon: { value: THREE.Color }, fogColor: { value: THREE.Color }, veil: { value: number } }
  private reticle: THREE.Mesh
  private highlight: THREE.Mesh
  private ghost: THREE.Mesh
  private ghostUntil = 0
  private atmos: AtmospherePreset = { ...ATMOSPHERES.dusk }
  private fogFactor = 1
  private pmrem: THREE.PMREMGenerator
  private gazeTick = 0
  private lastGaze = ''
  private prev = performance.now()
  private ro: ResizeObserver
  // Teleport: the world fogs in to a few metres around you, then the fog recedes as the place builds outward.
  private reveal: { cur: number, target: number, readyAt: number, ending: boolean, center: THREE.Vector3, bumpedAt: number, t0: number, minCur: number } | null = null
  private atmosVersion = 0
  private veil = 0
  private patch: THREE.Mesh
  private stars: THREE.Points
  private moon: THREE.Sprite
  private sunGlow: THREE.Sprite
  readonly sound = new Ambience()
  private cleanup: (() => void)[] = []
  // Spectacle: a smooth camera move that frames a wish, a size-scaled shake, the eye lift (god's-eye
  // height after a huge scale-up), the teleport vortex and the "world listens" gathering glow.
  private camMove: { from: View, to: View, start: number, dur: number } | null = null
  private shake: { amp: number, start: number, dur: number } | null = null
  private lift = 0
  private lastInput = 0
  private dt = 0
  private vortex = new Vortex()
  private gathering = new Gathering()
  private revealChord = false
  private rings = 0 // heavy-landing budget per sync, so a global scale-up isn't 40 overlapping shockwaves

  constructor(host: HTMLElement) {
    this.host = host
    const w = host.clientWidth || window.innerWidth
    const h = host.clientHeight || window.innerHeight

    // Renderer setup mirrors workspace-3d: ACES, sRGB out, soft shadows, a dim room environment for speculars.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.domElement.classList.add('world-canvas')
    host.appendChild(this.renderer.domElement)

    this.pmrem = new THREE.PMREMGenerator(this.renderer)
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture

    this.camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 600)
    this.camera.position.set(0, EYE, 0)

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a3328, 1)
    this.sun = new THREE.DirectionalLight(0xffd2a1, 2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.04
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 })
    this.scene.add(this.hemi, this.sun, this.sun.target)

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 1 }))
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.ground.name = 'ground'
    this.scene.add(this.ground)

    // An analytic grid (anti-aliased with fwidth, fading with distance) instead of GridHelper, whose far
    // lines alias into scanlines at a standing eye height.
    this.gridUniforms = { color: { value: new THREE.Color(0x7d8bab) }, opacity: { value: 0.3 }, fadeDist: { value: 55 } }
    this.grid = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160).rotateX(-Math.PI / 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: this.gridUniforms,
        vertexShader: 'varying vec3 vWorld; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: 'uniform vec3 color; uniform float opacity; uniform float fadeDist; varying vec3 vWorld; void main() { vec2 c = vWorld.xz / 2.0; vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c); float line = 1.0 - min(min(g.x, g.y), 1.0); float d = distance(vWorld.xz, cameraPosition.xz); float fade = 1.0 - smoothstep(fadeDist * 0.3, fadeDist, d); gl_FragColor = vec4(color, line * opacity * fade); }'
      })
    )
    this.grid.position.y = 0.012
    this.grid.renderOrder = 1
    this.scene.add(this.grid)

    // Gradient sky dome; it follows the camera so you never reach its edge.
    this.skyUniforms = { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, fogColor: { value: new THREE.Color() }, veil: { value: 0 } }
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(500, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: this.skyUniforms,
        vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        // The bottom of the dome blends into the fog colour so the ground's far edge meets the sky with no seam.
        // `veil` drowns the whole dome in fog colour while a teleport is summoning the next place.
        fragmentShader: 'uniform vec3 top; uniform vec3 horizon; uniform vec3 fogColor; uniform float veil; varying vec3 vDir; void main() { float h = vDir.y; vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55)); c = mix(fogColor, c, smoothstep(-0.02, 0.16, h)); c = mix(c, fogColor, veil); gl_FragColor = vec4(c, 1.0);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}'
      })
    )
    this.sky.renderOrder = -1
    this.scene.add(this.sky)

    // Night sky: stars, a moon; by day a soft sun halo. All ride on the dome so they never get closer.
    this.stars = starfield()
    this.moon = glowSprite('#e8eeff', true)
    this.sunGlow = glowSprite('#ffc27a', false)
    this.sky.add(this.stars, this.moon, this.sunGlow)

    // The floor patch you keep under your feet while a teleport fogs everything else out.
    this.patch = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 48).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x8a7a68, roughness: 0.9, transparent: true, opacity: 0, alphaMap: radialTexture(), depthWrite: false })
    )
    this.patch.position.y = 0.02
    this.patch.receiveShadow = true
    this.patch.visible = false
    this.scene.add(this.patch)

    this.reticle = ring(0.32, 0.42, 0xffffff, 0.6)
    this.highlight = ring(0.94, 1, 0xffffff, 0.45) // unit ring scaled to the hovered entity's footprint
    this.ghost = ring(1.5, 1.8, 0x7dd3a8, 0)
    this.scene.add(this.reticle, this.highlight, this.ghost)
    this.scene.add(this.vortex.obj, this.gathering.obj)

    this.scene.fog = new THREE.Fog(0x2a3550, 20, 140)
    this.applyAtmosphere(ATMOSPHERES.dusk)

    this.raycaster.camera = this.camera
    this.raycaster.far = 160
    this.bindInput()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.renderer.setAnimationLoop(now => this.frame(now))
  }

  // ---------- reconcile ----------

  sync(state: WorldState, effects?: Effects): void {
    const prev = this.state
    this.state = state
    const now = performance.now()
    const fx = effects
    const wanted = new Map(state.entities.map(e => [e.id, e]))
    // A teleport fogs the old place out first; what was there dissolves upward into motes behind the fog.
    if (fx?.teleport) this.beginReveal(now)
    const removeAt = fx?.teleport ? now + 520 : now
    // Anything landing answers the wish, so the "world listens" glow lets go.
    if (fx && (fx.spawned.length || fx.modified.length || fx.removed.length || fx.teleport)) this.gathering.set(null)

    // Removals first (dissolve into sparks), including anything the effects missed.
    const removed = new Set(fx?.removed ?? [])
    for (const id of this.items.keys()) if (!wanted.has(id)) removed.add(id)
    let budget = PARTICLE_BUDGET
    let dissolved = 0
    for (const id of removed) {
      const item = this.items.get(id)
      if (!item) continue
      this.items.delete(id)
      budget -= this.removeItem(item, removeAt, !!fx?.teleport, prev ? budget : 0)
      dissolved++
    }
    if (dissolved && prev && !fx?.teleport) this.sound.sfxDissolve()

    // Learned kinds that changed (or placeholders that just got defined) morph in place.
    for (const kind of fx?.redefined ?? []) {
      for (const item of this.items.values()) if (item.entity.kind === kind) this.rebuild(item, wanted.get(item.entity.id) ?? item.entity, now, true)
    }

    // Spawns, staggered tk-tk-tk. Big batches tick faster so a forest still lands in about two seconds.
    const spawned = (fx?.spawned ?? []).filter(id => wanted.has(id))
    for (const e of state.entities) if (!this.items.has(e.id) && !spawned.includes(e.id)) spawned.push(e.id)
    const stepMs = spawned.length > 1 ? Math.min(110, Math.max(30, 1600 / spawned.length)) : 0
    const origin0 = this.reveal?.center ?? this.camera.position
    const distOf = (id: string) => {
      const p = wanted.get(id)!.pos
      return Math.hypot(p[0] - origin0.x, p[2] - origin0.z)
    }
    // While a place is being built, arrivals radiate outward: nearer things land first, the fog recedes behind them.
    if (this.reveal) spawned.sort((a, b) => distOf(a) - distOf(b))
    // The first sync (page load) and a restore are not wishes: no fanfare, no camera move.
    const fanfare = !!prev && Math.abs(state.log.length - prev.log.length) <= 1
    spawned.forEach((id, i) => {
      const e = wanted.get(id)!
      const stale = this.items.get(id)
      if (stale) {
        this.items.delete(id)
        this.removeItem(stale, now, false, 0)
      }
      if (this.reveal) {
        const d = distOf(id)
        const at = Math.max(now, this.reveal.readyAt) + Math.min(900, d * 22) + Math.min(i * 18, 400)
        this.spawnItem(e, at, { index: i, count: spawned.length, reveal: true, loud: !!prev })
        if (!this.revealChord && prev) {
          this.revealChord = true
          this.sound.sfxArrive(at - now)
        }
        // Big flat things (a lake, a floor) only pull the fog back a little; the rest unveils as it lands.
        this.revealTo(d + Math.min(entityReach(this.desc(e), e), 10) + 6)
      } else {
        this.spawnItem(e, now + i * stepMs, { index: i, count: spawned.length, reveal: false, loud: fanfare })
      }
    })

    // Modifies: colour wipes ripple across the set with a shimmer; height/scale spring; floors rebuild.
    const modified = new Set(fx?.modified ?? [])
    for (const e of state.entities) {
      const item = this.items.get(e.id)
      if (item && item.entity !== e && !spawned.includes(e.id)) modified.add(e.id)
    }
    const mods = [...modified].map(id => this.items.get(id)).filter((x): x is Item => !!x && wanted.has(x.entity.id))
    const origin = this.camera.position
    mods.sort((a, b) => a.holder.position.distanceTo(origin) - b.holder.position.distanceTo(origin))
    // A global scale-up lifts you first, then the world swells beneath you (you never end up inside a leg).
    const swelling = mods.filter(m => (wanted.get(m.entity.id)!.props.scale ?? 1) > (m.entity.props.scale ?? 1) * 1.5).length >= 6
    const modAt = now + (swelling && fanfare ? 450 : 0)
    this.rings = 4
    const reshaped: Entity[] = []
    let grew = 0
    let shrank = 0
    let changed = 0
    mods.forEach((item, i) => {
      const e = wanted.get(item.entity.id)!
      const r = this.modifyItem(item, e, modAt + Math.min(i * 40, 900), i < 32 && fanfare)
      if (r.reshaped) reshaped.push(e)
      if (r.grew) grew++
      if (r.shrank) shrank++
      if (r.changed) changed++
    })
    if (changed && fanfare) this.sound.sfxWhoosh(shrank <= grew, 0, grew + shrank > 0)

    if (!prev || fx?.atmosphere || prev.atmosphere !== state.atmosphere) this.setAtmosphere(state, prev ? 900 : 0)
    this.sound.set(state.atmosphere.ambient)
    this.budgetLights()

    // Always frame the wish: what just arrived or changed shape should end up in shot, foot to top.
    if (fanfare && !this.reveal && !fx?.teleport) {
      const news = fanfare ? spawned.map(id => wanted.get(id)!) : []
      const framed = [...news, ...reshaped].filter(e => this.frameable(e))
      if (framed.length) this.frameWish(framed, swelling)
      else this.settleLift(state)
    }
  }

  // ---------- framing, shake, lift ----------

  private frameable(e: Entity): boolean {
    const d = this.desc(e)
    if (d.tags.includes('particles')) return false
    return kindHeight(d, e.props) >= 0.6
  }

  private view(): View {
    return { yaw: this.yaw, pitch: this.pitch, x: this.camera.position.x, z: this.camera.position.z, lift: this.lift }
  }

  private userActive(): boolean {
    const k = this.keys
    const moving = k.w || k.a || k.s || k.d || k.arrowup || k.arrowdown || k.arrowleft || k.arrowright
    return !!this.drag || !!moving || performance.now() - this.lastInput < 250
  }

  /**
   * Turn, tilt, back away or rise so `entities` are all in shot. Never while you're dragging or walking,
   * and any input hands control straight back.
   */
  frameWish(entities: Entity[], preferLift = false): void {
    if (this.userActive() || !this.state) return
    const boxes: FrameBox[] = entities.map((e) => {
      const d = this.desc(e)
      return { x: e.pos[0], z: e.pos[2], r: Math.max(0.3, entityReach(d, e)), h: e.pos[1] + kindHeight(d, e.props) }
    })
    if (boxes.length === 1 && boxes[0]!.h < 1.2 && boxes[0]!.r < 1) return
    const cur = this.view()
    const to = preferLift ? this.godView(boxes, cur) : solveFrame(this.camera, cur, boxes, EYE)
    if (!to) return
    const travel = Math.hypot(to.x - cur.x, to.z - cur.z) + Math.abs(to.lift - cur.lift)
    this.camMove = preferLift
      ? { from: cur, to, start: performance.now(), dur: 1300 }
      : { from: cur, to, start: performance.now() + 120, dur: Math.min(1600, 1050 + travel * 9) }
  }

  /**
   * "Make everything ten times bigger": rise above the new giants and look down on them, from a little
   * way off their middle, instead of standing inside a table leg.
   */
  private godView(boxes: FrameBox[], cur: View): View | null {
    const tops = boxes.map(b => b.h).sort((a, b) => b - a)
    const H = tops[Math.min(tops.length - 1, Math.floor(tops.length * 0.2))]!
    if (H < 6) return solveFrame(this.camera, cur, boxes, EYE)
    let cx = 0
    let cz = 0
    for (const b of boxes) {
      cx += b.x / boxes.length
      cz += b.z / boxes.length
    }
    const away = Math.hypot(cur.x - cx, cur.z - cz)
    const dir: [number, number] = away > 0.5 ? [(cur.x - cx) / away, (cur.z - cz) / away] : [Math.sin(cur.yaw), Math.cos(cur.yaw)]
    const lift = Math.min(160, H * 1.45)
    const back = Math.min(220, H * 1.7 + 8)
    const x = cx + dir[0] * back
    const z = cz + dir[1] * back
    const yaw = Math.atan2(-(cx - x), -(cz - z))
    const pitch = Math.max(-1.15, -Math.atan2(lift + EYE - H * 0.25, back))
    return { yaw: cur.yaw + wrapAngle(yaw - cur.yaw), pitch, x, z, lift }
  }

  /** After a giant scale-up is undone (nothing tall left), drift back down to standing height. */
  private settleLift(state: WorldState): void {
    if (this.lift < 0.5 || this.userActive()) return
    const tallest = state.entities.reduce((m, e) => Math.max(m, kindHeight(this.desc(e), e.props)), 0)
    if (tallest > 14) return
    const cur = this.view()
    this.camMove = { from: cur, to: { ...cur, lift: 0, pitch: Math.max(cur.pitch, -0.15) }, start: performance.now(), dur: 1200 }
  }

  /** A shake proportional to size and nearness: a castle 10 m away rattles you, a pine doesn't. */
  private addShake(tall: number, at: THREE.Vector3, when: number): void {
    const d = Math.hypot(at.x - this.camera.position.x, at.z - this.camera.position.z)
    const near = Math.min(1, (tall * 2) / (d + 4))
    const amp = (0.006 + 0.03 * Math.min(1, tall / 60)) * near
    if (amp < 0.002) return
    const cur = this.shake
    if (cur && cur.amp > amp && when < cur.start + cur.dur * 0.5) return
    this.shake = { amp, start: when, dur: 420 + Math.min(500, tall * 8) }
  }

  /** "The world listens": a soft glow gathers at `point` while a request is pending; null lets it go. */
  anticipate(point: Vec3 | null): void {
    this.gathering.set(point ? new THREE.Vector3(point[0], 0, point[2]) : null)
  }

  private playFx(fx: Fx, at: number, dur: number): void {
    this.tween(at, dur, t => fx.update(t, this.camera, this.dt), () => {
      this.scene.remove(fx.obj)
      fx.dispose()
    }, () => this.scene.add(fx.obj))
  }

  // ---------- teleport reveal ----------

  /** Fog in to a few metres around the player and show the floor patch under their feet. */
  beginReveal(now = performance.now()): void {
    const far = (this.scene.fog as THREE.Fog).far
    this.reveal = { cur: this.reveal?.cur ?? far, target: REVEAL_TIGHT, readyAt: now + 650, ending: false, center: this.camera.position.clone(), bumpedAt: now, t0: now, minCur: this.reveal?.cur ?? far }
    this.patch.position.set(this.camera.position.x, 0.02, this.camera.position.z)
    this.patch.visible = true
    this.revealChord = false
    this.sound.sfxPortal()
    // You arrive standing: any god's-eye lift comes down while the vortex spins up.
    if (this.lift > 0.05) {
      const cur = this.view()
      this.camMove = { from: cur, to: { ...cur, lift: 0, pitch: Math.max(-0.2, Math.min(0.1, cur.pitch)) }, start: now, dur: 700 }
    }
    const pm = this.patch.material as THREE.MeshStandardMaterial
    this.tween(now, 500, (t) => {
      pm.opacity = 0.9 * ease.out(t)
    })
  }

  /** Let the fog recede to at least `radius` metres (a new arrival just landed that far out). */
  revealTo(radius: number): void {
    if (this.reveal && !this.reveal.ending) {
      this.reveal.target = Math.max(this.reveal.target, radius)
      this.reveal.bumpedAt = performance.now()
    }
  }

  /** The place is built (or the Director gave up): lift the fog back to the preset and drop the patch. */
  endReveal(): void {
    if (!this.reveal) return
    this.reveal.ending = true
    this.reveal.target = 1e4
    const pm = this.patch.material as THREE.MeshStandardMaterial
    const from = pm.opacity
    this.tween(performance.now() + 400, 900, (t) => {
      pm.opacity = from * (1 - t)
    }, () => {
      this.patch.visible = false
    })
  }

  get revealing(): boolean {
    return !!this.reveal && !this.reveal.ending
  }

  private desc(e: Entity): KindDescriptor {
    return kindOf(this.state!, e.kind)
  }

  private build(e: Entity): { body: THREE.Group, key: string } {
    const desc = this.desc(e)
    const kit = KIT_BUILDERS[e.kind]
    let body: THREE.Group
    if (kit) body = kit({ floors: e.props.floors ?? desc.defaults.floors, text: e.props.text ?? desc.defaults.text, length: e.props.length ?? desc.defaults.length, width: e.props.width ?? desc.defaults.width, color: e.props.color ?? desc.defaults.color })
    else if (desc.learned && desc.parts) body = buildFromParts(desc.parts)
    else body = blob({ text: (e.props.text ?? desc.label ?? e.kind).replace(/_/g, ' ') })
    return { body, key: this.buildKeyOnly(e) }
  }

  private spawnItem(e: Entity, at: number, cue: Cue = { index: 0, count: 1, reveal: false, loud: false }): void {
    const { body, key } = this.build(e)
    const holder = new THREE.Group()
    const stretch = new THREE.Group()
    stretch.add(body)
    holder.add(stretch)
    holder.position.set(...e.pos)
    holder.rotation.y = e.rotY
    holder.userData.entityId = e.id
    const d = this.desc(e)
    if (d.contact || d.learned) holder.add(contactShadow(Math.max(0.5, d.footprint * 1.25)))
    const item: Item = { entity: e, holder, stretch, body, buildKey: key, leaving: false }
    this.items.set(e.id, item)
    this.applyLook(item, e, false)
    holder.visible = false
    this.scene.add(holder)
    this.arrive(item, this.desc(e).fall, at, cue)
  }

  /**
   * Arrival choreography, scaled to the size of the wish. Small things pop in with a sparkle; big things
   * (≥ 8 m) come down a beam of light from the sky (or grow inside it) and land with a thump, a
   * shockwave, dust and a shake. A batch chimes up a scale as it lands, tk-tk-tk.
   */
  private arrive(item: Item, fall: Fall, at0: number, cue: Cue): void {
    const { holder, stretch } = item
    const e = item.entity
    const desc = this.desc(e)
    const s = e.props.scale ?? 1
    const h = e.props.height ?? 1
    const y0 = e.pos[1]
    const tall = kindHeight(desc, e.props)
    const reach = entityReach(desc, e)
    const flat = tall < 0.6 || desc.tags.includes('particles')
    const tier = flat ? 'flat' : tall >= BIG ? 'big' : tall >= MID ? 'mid' : 'small'
    const loud = cue.loud
    const color = e.props.color ?? desc.defaults.color ?? '#ffffff'
    const lead = tier === 'big' && loud ? 420 : 0
    const at = at0 + lead
    const now = performance.now()
    const center = new THREE.Vector3(e.pos[0], y0, e.pos[2])
    const show = () => {
      holder.visible = true
    }
    if (loud && cue.count > 1 && (!cue.reveal || cue.index % 2 === 0)) this.sound.sfxChime(cue.index, cue.count, at - now)

    // The beam from the sky arrives first and holds while the thing comes down through it.
    let fallDur: number
    const impact = (when: number) => {
      if (!loud || flat) return
      if (tier === 'big') {
        this.playFx(shockwave(center, reach), when, 1300)
        this.puff(center, reach * 1.2, 0.5 + Math.min(1.4, tall * 0.02), 70)
        this.sound.sfxThump(tall, when - performance.now())
        if (!cue.reveal) this.addShake(tall, center, when)
      } else if (tier === 'mid') {
        if (!cue.reveal && cue.count === 1) this.playFx(shockwave(center, reach * 0.5, 0xffffff, 2.5, 0.45), when, 700)
        if (cue.count === 1) this.sound.sfxPop(tall, when - performance.now())
      } else if (cue.count === 1) {
        this.sound.sfxPop(Math.max(0.5, tall), when - performance.now())
      }
    }
    const sparkleAt = (when: number, y = tall * 0.6) => {
      if (!loud || flat) return
      this.playFx(sparkle(new THREE.Vector3(center.x, y0 + y, center.z), Math.max(0.5, reach), color, tier === 'small' ? 26 : 40), when, 800)
    }

    if (fall === 'drop') {
      holder.scale.setScalar(s)
      stretch.scale.y = h
      if (tier === 'big' && loud) {
        const H0 = 12 + tall * 0.9
        fallDur = 950 + Math.min(650, tall * 9)
        holder.position.y = y0 + H0
        // Accelerating down (it has weight), then a short squash as it hits.
        this.tween(at, fallDur, (t) => {
          holder.position.y = y0 + H0 * (1 - t * t)
        }, () => {
          holder.position.y = y0
          this.tween(performance.now(), 380, (t) => {
            const k = Math.sin(Math.PI * t) * (1 - t)
            holder.scale.set(s * (1 + 0.05 * k), s * (1 - 0.09 * k), s * (1 + 0.05 * k))
          }, () => holder.scale.setScalar(s))
          impact(performance.now())
        }, show)
      } else {
        fallDur = 850
        holder.position.y = y0 + 7
        this.tween(at, 850, (t) => {
          holder.position.y = y0 + 7 * (1 - ease.bounce(t))
        }, () => {
          this.puff(holder.position, this.desc(item.entity).footprint * s)
          if (tier === 'small') sparkleAt(performance.now(), tall * 0.5)
          impact(performance.now())
        }, show)
      }
    } else if (fall === 'grow' || fall === 'rise') {
      fallDur = tier === 'big' && loud ? 1100 : fall === 'grow' ? 620 : 700
      if (fall === 'grow') holder.scale.setScalar(0.001)
      else holder.scale.set(s, 0.001, s)
      stretch.scale.y = h
      this.tween(at, fallDur, (t) => {
        if (fall === 'grow') holder.scale.setScalar(Math.max(0.001, s * ease.back(t)))
        else holder.scale.y = Math.max(0.001, s * ease.out(t))
      }, tier === 'big' ? () => impact(performance.now()) : undefined, show)
      if (tier !== 'big') {
        sparkleAt(at + 60, tall * 0.4)
        impact(at + fallDur * 0.5)
      }
    } else {
      // flicker: the fixture rises, then its glow stutters on like a sodium lamp warming up.
      holder.scale.set(s, 0.001, s)
      stretch.scale.y = h
      const glows = slotMeshes(item.body, 'glow')
      const lights: THREE.Light[] = []
      item.body.traverse(o => (o as THREE.Light).isLight && lights.push(o as THREE.Light))
      fallDur = 940
      this.tween(at, 420, (t) => {
        holder.scale.y = Math.max(0.001, s * ease.out(t))
      }, undefined, show)
      const pattern = [0, 1, 0, 1, 1, 0, 1]
      this.tween(at + 420, 520, (t) => {
        const on = pattern[Math.min(pattern.length - 1, Math.floor(t * pattern.length))]!
        for (const g of glows) g.visible = !!on
        for (const l of lights) l.intensity = on ? (l.userData.baseIntensity ?? 10) * (item.entity.props.glow ?? 1) : 0
      }, () => {
        for (const g of glows) g.visible = true
        this.applyLook(item, item.entity, false)
      })
      if (!flat) sparkleAt(at + 900, tall * 0.92)
      if (cue.count === 1 && loud && !flat) this.sound.sfxPop(1.2, at + 900 - now)
    }

    if (tier === 'big' && loud) {
      const tint = new THREE.Color('#ffe2ad').lerp(new THREE.Color(color), 0.25)
      const total = lead + fallDur + 900
      this.playFx(beam(center, Math.max(1.4, reach * 0.95), tint, lead / total + 0.04, (lead + fallDur) / total), at0, total)
      this.sound.sfxSummon(tall, lead + fallDur * 0.85, at0 - now)
    }
  }

  /** Animate one entity to its new props. With `fx`, a shimmer sweeps it and a big growth lands with weight. */
  private modifyItem(item: Item, e: Entity, at: number, fx = false): { reshaped: boolean, grew: boolean, shrank: boolean, changed: boolean } {
    const before = item.entity
    const desc = this.desc(e)
    const s0 = item.holder.scale.x
    const s1 = e.props.scale ?? 1
    const h0 = item.stretch.scale.y
    const h1 = e.props.height ?? 1
    const tall0 = kindHeight(desc, before.props)
    const tall1 = kindHeight(desc, e.props)
    const rebuilt = this.buildKeyOnly(e) !== item.buildKey
    if (rebuilt) this.rebuild(item, e, at, false, h0)
    item.entity = e
    const resized = Math.abs(s1 - s0) > 1e-4 || (!rebuilt && Math.abs(h1 - h0) > 1e-4)
    const grew = tall1 > tall0 * 1.05
    const shrank = tall1 < tall0 * 0.95

    if (resized) {
      // Big growth is slower and heavier: you watch it swell, then it settles with a thump.
      const dur = grew && tall1 >= BIG ? 1150 : 750
      this.tween(at, dur, (t) => {
        const k = ease.spring(t)
        if (!rebuilt) item.stretch.scale.y = h0 + (h1 - h0) * k
        item.holder.scale.setScalar(s0 + (s1 - s0) * k)
      })
      if (fx && grew && tall1 >= BIG && this.rings-- > 0) {
        const c = item.holder.position.clone()
        const reach = entityReach(desc, e)
        this.playFx(shockwave(c, reach), at + dur * 0.35, 1300)
        this.puff(c, reach, 0.5 + Math.min(1.4, tall1 * 0.02), 60)
        this.sound.sfxThump(tall1, at + dur * 0.35 - performance.now())
        this.addShake(tall1, c, at + dur * 0.35)
      }
    }

    const moved = before.pos.some((v, i) => Math.abs(v - e.pos[i]!) > 1e-4) || Math.abs(before.rotY - e.rotY) > 1e-4
    if (moved) {
      const p0 = item.holder.position.clone()
      const p1 = new THREE.Vector3(...e.pos)
      const r0 = item.holder.rotation.y
      this.tween(at, 650, (t) => {
        const k = ease.inOut(t)
        item.holder.position.lerpVectors(p0, p1, k)
        item.holder.position.y += Math.sin(Math.PI * t) * 1.2
        item.holder.rotation.y = r0 + (e.rotY - r0) * k
      })
    }
    const recolored = this.applyLook(item, e, true, at)
    const changed = resized || moved || recolored || rebuilt
    if (fx && (resized || recolored) && tall1 >= 0.3) {
      const color = e.props.color ?? this.lampTint(e)?.getStyle() ?? '#ffffff'
      this.playFx(shimmer(new THREE.Vector3(e.pos[0], 0, e.pos[2]), entityReach(desc, e), tall1 + e.pos[1], color), at, resized ? 900 : 620)
    }
    return { reshaped: resized || moved, grew, shrank, changed }
  }

  private buildKeyOnly(e: Entity): string {
    const desc = this.desc(e)
    if (KIT_BUILDERS[e.kind]) {
      const p = e.props
      return `${e.kind}|${p.floors ?? desc.defaults.floors ?? ''}|${p.length ?? ''}|${p.width ?? ''}|${p.text ?? ''}${BUILD_READS_COLOR.has(e.kind) ? `|${p.color ?? ''}` : ''}`
    }
    if (desc.learned && desc.parts) return `${e.kind}|learned|${hashParts(desc)}`
    return `${e.kind}|blob|${e.props.text ?? desc.label ?? e.kind}`
  }

  /**
   * Swap the body for a fresh build (floors changed, or a learned kind arrived). A floors change keeps the
   * old silhouette for a frame and springs into the new one; a morph pops in with a puff.
   */
  private rebuild(item: Item, e: Entity, at: number, morph: boolean, fromStretch = item.stretch.scale.y): void {
    const oldH = boxHeight(item.body)
    const { body, key } = this.build(e)
    disposeObject(item.body)
    item.stretch.remove(item.body)
    item.stretch.add(body)
    item.body = body
    item.buildKey = key
    item.entity = e
    this.applyLook(item, e, false)
    const newH = boxHeight(body)
    const h1 = e.props.height ?? 1
    if (morph) {
      const s = e.props.scale ?? 1
      item.stretch.scale.y = h1
      this.tween(at, 520, (t) => {
        item.holder.scale.setScalar(Math.max(0.001, s * ease.back(t)))
      })
      this.puff(item.holder.position, this.desc(e).footprint * s)
    } else if (newH > 0 && oldH > 0) {
      const start = fromStretch * oldH / newH
      item.stretch.scale.y = start
      this.tween(at, 750, (t) => {
        item.stretch.scale.y = start + (h1 - start) * ease.spring(t)
      })
    }
  }

  /** Lamps cast the colour they glow: "make the lamps blue" turns their light pools blue. */
  private lampTint(e: Entity): THREE.Color | null {
    const tags = this.desc(e).tags
    const lampLike = tags.includes('lamp') || (tags.includes('light') && !tags.includes('fire'))
    const hex = lampLike ? e.props.color ?? e.props.trim : undefined
    if (!hex) return null
    const c = new THREE.Color(-1, -1, -1).set(hex)
    if (c.r < 0) return null
    // Keep the hue, but as light: bright enough to read as a lamp, never a dark pool.
    const hsl = { h: 0, s: 0, l: 0 }
    c.getHSL(hsl)
    return c.setHSL(hsl.h, Math.min(1, hsl.s * 1.2 + 0.15), Math.max(0.55, Math.min(0.7, hsl.l)))
  }

  /** Apply colours (tweened bottom-to-top when `animate`). Returns whether any colour changed. */
  private applyLook(item: Item, e: Entity, animate: boolean, at = performance.now()): boolean {
    applyMaterialProps(item.body, e.props)
    const targets = lookTargets(item.body, e.props, e.hue)
    const tint = this.lampTint(e)
    if (tint) for (const t of targets) if (t.mesh.userData.slot === 'glow') t.color.copy(tint)
    const lights: { light: THREE.Light, to: THREE.Color }[] = []
    item.body.traverse((o) => {
      const l = o as THREE.Light
      if (!l.isLight) return
      if (l.userData.baseColor === undefined) l.userData.baseColor = '#' + l.color.getHexString()
      lights.push({ light: l, to: tint ? tint.clone() : new THREE.Color(l.userData.baseColor as string) })
    })
    const setColor = (m: THREE.Mesh, c: THREE.Color) => {
      const mat = m.material as THREE.MeshStandardMaterial
      mat.color.copy(c)
      if (m.userData.slot === 'glow') mat.emissive.copy(c)
      else if (m.userData.emissiveFollows !== undefined && mat.emissive) mat.emissive.copy(c).multiplyScalar(m.userData.emissiveFollows as number)
    }
    if (!animate) {
      for (const { mesh, color } of targets) setColor(mesh, color)
      for (const { light, to } of lights) light.color.copy(to)
      return false
    }
    const from = targets.map(t => (t.mesh.material as THREE.MeshStandardMaterial).color.clone())
    const lightFrom = lights.map(l => l.light.color.clone())
    if (targets.every((t, i) => from[i]!.equals(t.color)) && lights.every((l, i) => lightFrom[i]!.equals(l.to))) return false
    const tmp = new THREE.Color()
    // The paint wipes bottom to top: lower meshes change first.
    const ys = targets.map(t => t.mesh.position.y)
    const minY = Math.min(...ys)
    const span = Math.max(0.01, Math.max(...ys) - minY)
    this.tween(at, 520, (t) => {
      targets.forEach(({ mesh, color }, i) => {
        const local = Math.min(1, Math.max(0, t * 1.6 - ((ys[i]! - minY) / span) * 0.6))
        setColor(mesh, tmp.copy(from[i]!).lerp(color, ease.out(local)))
      })
      lights.forEach(({ light, to }, i) => light.color.copy(lightFrom[i]!).lerp(to, ease.inOut(t)))
    })
    return true
  }

  /**
   * Shrink a thing away as it comes apart into sparks. A teleport sends them high, so the old world rises
   * into the sky as motes. Returns how many particles it used (from `budget`).
   */
  private removeItem(item: Item, now: number, teleport = false, budget = 0): number {
    item.leaving = true
    this.leaving.add(item)
    const s = item.holder.scale.clone()
    this.tween(now, teleport ? 520 : 420, (t) => {
      const k = Math.max(0.001, 1 - ease.out(t))
      item.holder.scale.set(s.x * k, s.y * (0.4 + 0.6 * k), s.z * k)
    }, () => {
      this.scene.remove(item.holder)
      disposeObject(item.holder)
      this.leaving.delete(item)
    })
    if (budget <= 0) return 0
    const e = item.entity
    const d = this.desc(e)
    const tall = Math.max(0.3, kindHeight(d, e.props))
    const reach = Math.max(0.4, entityReach(d, e))
    const n = Math.min(budget, Math.round(Math.min(teleport ? 46 : 80, 10 + reach * Math.min(tall, 12) * 2.2)))
    if (n < 4) return 0
    const color = e.props.color ?? d.defaults.color ?? '#ffe2b0'
    this.playFx(dissolve(item.holder.position.clone().setY(e.pos[1]), reach, tall, teleport ? '#ffe9c4' : color, n, teleport ? 16 : 3.2), now, teleport ? 1900 : 1150)
    return n
  }

  /** Real lights are expensive; keep the nearest few lamps lit and let emissive bulbs carry the rest. */
  private budgetLights(): void {
    const lights: { l: THREE.Light, d: number }[] = []
    for (const item of this.items.values()) {
      item.body.traverse((o) => {
        if ((o as THREE.Light).isLight) lights.push({ l: o as THREE.Light, d: item.holder.position.distanceTo(this.camera.position) })
      })
    }
    lights.sort((a, b) => a.d - b.d)
    lights.forEach(({ l }, i) => {
      l.visible = i < MAX_LIGHTS
    })
  }

  // ---------- atmosphere ----------

  private setAtmosphere(state: WorldState, dur: number): void {
    const target = ATMOSPHERES[state.atmosphere.time]
    const fog = state.atmosphere.fog
    const factorTo = fog === undefined ? 1 : 1.8 - 1.5 * fog
    if (!dur) {
      this.atmosVersion++
      this.fogFactor = factorTo
      this.applyAtmosphere(target)
      return
    }
    const from = { ...this.atmos }
    const factorFrom = this.fogFactor
    // A newer change (clear, then "make it day" straight after) takes over from an older tween.
    const version = ++this.atmosVersion
    this.tween(performance.now(), dur, (t) => {
      if (version !== this.atmosVersion) return
      const k = ease.inOut(t)
      this.fogFactor = factorFrom + (factorTo - factorFrom) * k
      this.applyAtmosphere(lerpPreset(from, target, k))
    })
  }

  private applyAtmosphere(a: AtmospherePreset): void {
    this.atmos = a
    this.skyUniforms.top.value.set(a.skyTop)
    this.skyUniforms.horizon.value.set(a.skyHorizon)
    this.skyUniforms.fogColor.value.set(a.fog)
    const fog = this.scene.fog as THREE.Fog
    fog.color.set(a.fog)
    this.applyFogDistances()
    this.stars.visible = a.stars > 0.01
    this.moon.visible = a.moon > 0.01
    this.moon.position.copy(skyDir(a.sunPos).multiplyScalar(420))
    this.sunGlow.visible = a.sunGlow > 0.01
    this.sunGlow.material.color.set(a.glowColor)
    this.sunGlow.position.copy(skyDir([a.sunPos[0], Math.max(4, a.sunPos[1] * 0.6), a.sunPos[2]]).multiplyScalar(430))
    this.scene.background = new THREE.Color(a.fog)
    this.sun.color.set(a.sun)
    this.sun.intensity = a.sunIntensity
    this.hemi.color.set(a.hemiSky)
    this.hemi.groundColor.set(a.hemiGround)
    this.hemi.intensity = a.hemiIntensity
    ;(this.ground.material as THREE.MeshStandardMaterial).color.set(a.ground)
    this.gridUniforms.opacity.value = a.grid
    this.grid.visible = a.grid > 0.01
    this.scene.environmentIntensity = a.env
    this.renderer.toneMappingExposure = a.exposure
  }

  /** Fog distances from the preset, clamped by the teleport reveal radius while a place is being built. */
  private applyFogDistances(): void {
    const fog = this.scene.fog as THREE.Fog
    const near = this.atmos.fogNear * this.fogFactor
    const far = this.atmos.fogFar * this.fogFactor
    const r = this.reveal?.cur ?? Infinity
    fog.far = Math.min(far, r)
    fog.near = Math.min(near, r * 0.25)
    this.skyUniforms.veil.value = this.veil
    // The fog swallows the stars, the moon and the sun's halo too.
    const clear = 1 - this.veil
    ;(this.stars.material as THREE.PointsMaterial).opacity = this.atmos.stars * clear
    this.moon.material.opacity = this.atmos.moon * clear
    this.sunGlow.material.opacity = this.atmos.sunGlow * clear
  }

  // ---------- gaze, ghost, player ----------

  /** Snapshot what the crosshair is on. Deictics ("there", "that") resolve against this. */
  gaze(): GazeSnapshot & { info: GazeInfo } {
    // The centre crosshair, unless pointing has moved the gaze (look.ts setGazeOverride).
    this.raycaster.setFromCamera(gazeNdc(), this.camera)
    const targets: THREE.Object3D[] = [this.ground]
    for (const item of this.items.values()) targets.push(item.holder)
    const hits = this.raycaster.intersectObjects(targets, true)
    for (const h of hits) {
      if (h.object === this.ground) {
        return { point: v3(h.point), dist: round2(h.distance), info: { kind: 'ground', dist: h.distance } }
      }
      let o: THREE.Object3D | null = h.object
      while (o && o.userData.entityId === undefined) o = o.parent
      if (o) {
        const id = o.userData.entityId as string
        return { point: v3(h.point), entity: id, dist: round2(h.distance), info: { kind: 'entity', entity: id, dist: h.distance } }
      }
    }
    // Looking at the sky: "over there" means a comfortable distance ahead on the ground.
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)).multiplyScalar(14)
    const p = this.camera.position.clone().add(f)
    return { point: [round2(p.x), 0, round2(p.z)], dist: 14, info: { kind: 'sky', dist: 14 } }
  }

  player(): Player {
    const p = this.camera.position
    return { pos: [round2(p.x), round2(p.y), round2(p.z)], yaw: round2(this.yaw) }
  }

  showGhost(point: Vec3, radius = 1.6, holdMs = 1100): void {
    this.ghost.position.set(point[0], 0.03, point[2])
    this.ghost.scale.setScalar(radius / 1.6)
    this.ghostUntil = performance.now() + holdMs
  }

  look(yaw: number, pitch: number, pos?: [number, number]): void {
    this.camMove = null
    this.yaw = yaw
    this.pitch = pitch
    if (pos) {
      this.lift = 0
      this.camera.position.set(pos[0], EYE, pos[1])
    }
  }

  // ---------- loop ----------

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.prev) / 1000)
    this.prev = now
    this.dt = dt
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]!
      if (now < tw.start) continue
      if (!tw.begun) {
        tw.begun = true
        tw.begin?.()
      }
      const t = Math.min(1, (now - tw.start) / tw.dur)
      tw.fn(t)
      if (t >= 1) {
        this.tweens.splice(i, 1)
        tw.done?.()
      }
    }

    // A framing glide (ease in-out): turn, tilt, back away or rise until the wish is in shot.
    const cm = this.camMove
    if (cm && now >= cm.start) {
      const t = Math.min(1, (now - cm.start) / cm.dur)
      const k = ease.inOut(t)
      this.yaw = cm.from.yaw + (cm.to.yaw - cm.from.yaw) * k
      this.pitch = cm.from.pitch + (cm.to.pitch - cm.from.pitch) * k
      this.camera.position.x = cm.from.x + (cm.to.x - cm.from.x) * k
      this.camera.position.z = cm.from.z + (cm.to.z - cm.from.z) * k
      this.lift = cm.from.lift + (cm.to.lift - cm.from.lift) * k
      if (t >= 1) this.camMove = null
    }
    this.camera.position.y = EYE + this.lift

    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const r = new THREE.Vector3(-f.z, 0, f.x)
    // Walking speed scales with the eye lift: a giant strides.
    const sp = (this.keys.shift ? RUN : WALK) * dt * (1 + this.lift / 12)
    const k = this.keys
    if (k.w || k.arrowup) this.camera.position.addScaledVector(f, sp)
    if (k.s || k.arrowdown) this.camera.position.addScaledVector(f, -sp)
    if (k.a || k.arrowleft) this.camera.position.addScaledVector(r, -sp)
    if (k.d || k.arrowright) this.camera.position.addScaledVector(r, sp)
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')
    // Weight: a decaying, slightly irregular shake after something big lands.
    const sh = this.shake
    if (sh && now >= sh.start) {
      const t = (now - sh.start) / sh.dur
      if (t >= 1) {
        this.shake = null
      } else {
        const a = sh.amp * (1 - t) ** 2
        const w = now / 1000
        this.camera.rotation.x += a * (Math.sin(w * 47) * 0.6 + Math.sin(w * 31 + 1) * 0.4)
        this.camera.rotation.y += a * 0.5 * Math.sin(w * 39 + 2)
        this.camera.rotation.z += a * 0.6 * Math.sin(w * 53 + 3)
        this.camera.position.y += a * 6 * Math.sin(w * 61)
      }
    }

    // Sky, grid and the sun's shadow box follow the player so the world feels endless.
    const cp = this.camera.position
    this.sky.position.copy(cp)
    this.grid.position.set(Math.round(cp.x / 2) * 2, 0.012, Math.round(cp.z / 2) * 2)
    const sp3 = this.atmos.sunPos
    this.sun.position.set(cp.x + sp3[0], sp3[1], cp.z + sp3[2])
    this.sun.target.position.set(cp.x, 0, cp.z)

    const g = this.gaze()
    const hovered = g.info.kind === 'entity' && g.entity ? this.items.get(g.entity) : undefined
    this.highlight.visible = !!hovered
    this.reticle.visible = !hovered
    if (hovered) {
      const rr = Math.max(0.5, this.desc(hovered.entity).footprint * (hovered.entity.props.scale ?? 1) + 0.25)
      this.highlight.position.set(hovered.holder.position.x, 0.04, hovered.holder.position.z)
      this.highlight.scale.setScalar(rr)
    } else {
      this.reticle.position.set(g.point[0], 0.04, g.point[2])
    }

    const gm = this.ghost.material as THREE.MeshBasicMaterial
    const left = this.ghostUntil - now
    gm.opacity = left > 0 ? 0.55 + 0.35 * Math.sin(now / 90) : Math.max(0, gm.opacity - dt * 2.5)

    const tSec = now / 1000
    const animate = (o: THREE.Object3D) => {
      if (o.userData.spin) o.rotation.y += dt * 0.8
      if (o.userData.animate) (o.userData.animate as (t: number, dt: number) => void)(tSec, dt)
    }
    for (const item of this.items.values()) item.body.traverse(animate)
    for (const item of this.leaving) item.body.traverse(animate)

    // The teleport vortex: full while the place is summoned, gone once the fog has pulled back ~14 m.
    // It spins up within ~300 ms of the wish (so the screen is never an empty wall of fog) and fades as the
    // fog pulls back from its tightest point.
    let vs = 0
    if (this.reveal) {
      const rv = this.reveal
      rv.minCur = Math.min(rv.minCur, rv.cur)
      vs = Math.min(1, (now - rv.t0) / 300) * Math.max(0, Math.min(1, 1 - (rv.cur - rv.minCur) / 14))
    }
    this.vortex.strength += (vs - this.vortex.strength) * Math.min(1, dt * (vs > this.vortex.strength ? 8 : 3))
    this.vortex.tick(dt, this.camera.position)
    this.gathering.tick(dt)

    if (this.reveal) {
      const r = this.reveal
      // Fail-safe: nobody ended the reveal (a dropped stream): don't leave the player in fog forever.
      if (!r.ending && now - r.bumpedAt > 25_000) this.endReveal()
      const presetFar = this.atmos.fogFar * this.fogFactor
      // Tight fast (the fog rolls in), wide gently (the place unveils as it builds).
      const rate = r.target < r.cur ? 6 : r.ending ? 1.6 : 1.1
      const step = (Math.min(r.target, presetFar * 1.05) - r.cur) * Math.min(1, dt * rate)
      // Outward at walking-the-room pace while building (≤ 9 m/s), quicker once the place is done.
      r.cur += step > 0 ? Math.min(step, (r.ending ? 70 : 9) * dt) : step
      this.veil = Math.max(0, Math.min(1, 1 - (r.cur - REVEAL_TIGHT) / Math.max(1, presetFar * 0.7)))
      if (r.ending && r.cur >= presetFar * 0.98) {
        this.reveal = null
        this.veil = 0
      }
      this.applyFogDistances()
    }

    if (this.onGaze && now - this.gazeTick > 150) {
      this.gazeTick = now
      const key = `${g.info.kind}|${g.entity ?? ''}|${Math.round(g.info.dist * 2)}`
      if (key !== this.lastGaze) {
        this.lastGaze = key
        this.onGaze(g.info)
      }
    }

    this.renderer.render(this.scene, this.camera)
    const w = window as unknown as { __sceneReady?: boolean }
    if (!w.__sceneReady) w.__sceneReady = true
  }

  private tween(start: number, dur: number, fn: (t: number) => void, done?: () => void, begin?: () => void): void {
    this.tweens.push({ start, dur, fn, done, begin })
  }

  /** A ring of dust where something landed. */
  private puff(at: THREE.Vector3, radius: number, size = 0.3, n = 46): void {
    const pos = new Float32Array(n * 3)
    const vel: [number, number, number][] = []
    const spread = 1.5 + radius * 0.8
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = spread * (0.7 + Math.random() * 0.6)
      vel.push([Math.cos(a) * sp, (0.3 + Math.random() * 0.9) * (1 + Math.max(0, size - 0.3) * 4), Math.sin(a) * sp])
      pos.set([at.x + Math.cos(a) * radius * 0.6, 0.15, at.z + Math.sin(a) * radius * 0.6], i * 3)
    }
    const start = pos.slice()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const matl = new THREE.PointsMaterial({ color: 0xd8d0c0, size, transparent: true, opacity: 0.7, depthWrite: false, alphaMap: radialTexture() })
    const pts = new THREE.Points(geo, matl)
    this.scene.add(pts)
    this.tween(performance.now(), 850 + size * 500, (t) => {
      const k = ease.out(t)
      for (let i = 0; i < n; i++) {
        pos[i * 3] = start[i * 3]! + vel[i]![0] * k
        pos[i * 3 + 1] = start[i * 3 + 1]! + vel[i]![1] * k
        pos[i * 3 + 2] = start[i * 3 + 2]! + vel[i]![2] * k
      }
      geo.attributes.position!.needsUpdate = true
      matl.opacity = 0.7 * (1 - t)
    }, () => {
      this.scene.remove(pts)
      geo.dispose()
      matl.dispose()
    })
  }

  // ---------- input ----------

  private bindInput(): void {
    const el = this.renderer.domElement
    const typing = (e: Event) => {
      const t = e.target as HTMLElement | null
      return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
    }
    const on = <K extends keyof WindowEventMap>(target: Window | HTMLElement, type: K, fn: (e: WindowEventMap[K]) => void) => {
      target.addEventListener(type, fn as EventListener)
      this.cleanup.push(() => target.removeEventListener(type, fn as EventListener))
    }
    // Audio can only start after a gesture; any click or key counts.
    on(window, 'pointerdown', () => this.sound.unlock())
    on(window, 'keydown', () => this.sound.unlock())
    on(el, 'pointerdown', (e) => {
      this.drag = [e.clientX, e.clientY]
      ;(document.activeElement as HTMLElement | null)?.blur?.()
    })
    on(window, 'pointerup', () => {
      this.drag = null
    })
    on(window, 'pointermove', (e) => {
      if (document.pointerLockElement === el) {
        this.turn(e.movementX, e.movementY)
      } else if (this.drag) {
        this.turn(e.clientX - this.drag[0], e.clientY - this.drag[1])
        this.drag = [e.clientX, e.clientY]
      }
    })
    // Double-click locks the pointer for mouse-look; Esc releases it (browser default).
    on(el, 'dblclick', () => {
      if (document.pointerLockElement !== el) el.requestPointerLock?.()
    })
    on(window, 'keydown', (e) => {
      if (typing(e) || e.metaKey || e.ctrlKey) return
      const key = e.key.toLowerCase()
      if ('wasd'.includes(key) || key.startsWith('arrow')) this.takeControl()
      this.keys[key] = true
    })
    on(window, 'keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false
    })
    on(window, 'blur', () => {
      this.keys = {}
    })
  }

  /** Any look or walk input takes the camera back instantly. */
  private takeControl(): void {
    this.camMove = null
    this.lastInput = performance.now()
  }

  private turn(dx: number, dy: number): void {
    if (dx || dy) this.takeControl()
    this.yaw -= dx * 0.004
    this.pitch = Math.max(-1.25, Math.min(0.7, this.pitch - dy * 0.004))
  }

  private resize(): void {
    const w = this.host.clientWidth
    const h = this.host.clientHeight
    if (!w || !h) return
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  dispose(): void {
    this.sound.dispose()
    this.vortex.dispose()
    this.gathering.dispose()
    this.renderer.setAnimationLoop(null)
    this.ro.disconnect()
    for (const fn of this.cleanup) fn()
    disposeObject(this.scene)
    this.pmrem.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}

// ---------- helpers ----------

function ring(inner: number, outer: number, color: number, opacity: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.RingGeometry(inner, outer, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, fog: false })
  )
  m.renderOrder = 2
  return m
}

function slotMeshes(root: THREE.Object3D, slot: string): THREE.Mesh[] {
  const out: THREE.Mesh[] = []
  root.traverse(o => (o as THREE.Mesh).isMesh && o.userData.slot === slot && out.push(o as THREE.Mesh))
  return out
}

function boxHeight(o: THREE.Object3D): number {
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

function disposeObject(root: THREE.Object3D): void {
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

function hashParts(desc: KindDescriptor): number {
  let h = 0
  for (const ch of JSON.stringify(desc.parts)) h = (h * 31 + ch.charCodeAt(0)) | 0
  return h
}

function lerpPreset(a: AtmospherePreset, b: AtmospherePreset, k: number): AtmospherePreset {
  const c = (x: string, y: string) => '#' + new THREE.Color(x).lerp(new THREE.Color(y), k).getHexString()
  const n = (x: number, y: number) => x + (y - x) * k
  return {
    skyTop: c(a.skyTop, b.skyTop), skyHorizon: c(a.skyHorizon, b.skyHorizon), fog: c(a.fog, b.fog),
    fogNear: n(a.fogNear, b.fogNear), fogFar: n(a.fogFar, b.fogFar), sun: c(a.sun, b.sun), sunIntensity: n(a.sunIntensity, b.sunIntensity),
    sunPos: [n(a.sunPos[0], b.sunPos[0]), n(a.sunPos[1], b.sunPos[1]), n(a.sunPos[2], b.sunPos[2])],
    hemiSky: c(a.hemiSky, b.hemiSky), hemiGround: c(a.hemiGround, b.hemiGround), hemiIntensity: n(a.hemiIntensity, b.hemiIntensity),
    ground: c(a.ground, b.ground), grid: n(a.grid, b.grid), env: n(a.env, b.env), exposure: n(a.exposure, b.exposure),
    stars: n(a.stars, b.stars), moon: n(a.moon, b.moon), sunGlow: n(a.sunGlow, b.sunGlow), glowColor: c(a.glowColor, b.glowColor)
  }
}

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

function v3(p: THREE.Vector3): Vec3 {
  return [round2(p.x), round2(p.y), round2(p.z)]
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** How far an entity reaches from its origin, so the reveal fog clears all of a wall or a lake. */
function entityReach(desc: KindDescriptor, e: Entity): number {
  const s = e.props.scale ?? 1
  const len = e.props.length ?? desc.defaults.length ?? 0
  const wid = e.props.width ?? desc.defaults.width ?? 0
  return Math.max(desc.footprint, len / 2, wid / 2) * s
}

function skyDir(p: [number, number, number]): THREE.Vector3 {
  return new THREE.Vector3(p[0], p[1], p[2]).normalize()
}

let radial: THREE.Texture | null = null
/** White centre fading to black at the rim: alpha maps for the floor patch and contact shadows. */
function radialTexture(): THREE.Texture {
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
function contactShadow(radius: number): THREE.Mesh {
  const m = new THREE.Mesh(contactGeo, new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.42, alphaMap: radialTexture(), depthWrite: false }))
  m.scale.setScalar(radius)
  m.position.y = 0.115 // just above a floor slab (0.1 m) so it shows indoors too
  m.renderOrder = 1
  m.userData.contactShadow = true
  m.raycast = () => {} // the gaze ray should hit the furniture, not its shadow
  return m
}

function starfield(): THREE.Points {
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
function glowSprite(color: string, disc: boolean): THREE.Sprite {
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
