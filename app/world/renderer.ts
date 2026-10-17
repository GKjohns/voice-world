/**
 * The three.js side of the world. It owns no world data: `sync(state, effects)` reconciles objects from
 * a WorldState, and effects say what to animate (staggered arrivals, springs, colour wipes, shrink-outs).
 * It also owns the first-person camera, the gaze ray and the reticle/ghost rings.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { isTerrain, kindHeight } from '#shared/world/kinds'
import type { Fall, KindDescriptor } from '#shared/world/kinds'
import type { Vec3 } from '#shared/world/ops'
import { kindOf } from '#shared/world/select'
import { groundHeight } from '#shared/world/terrain'
import { ceilingOver } from '#shared/world/layout'
import type { Effects, Entity, GazeSnapshot, Player, WorldState } from '#shared/world/types'
import { ATMOSPHERES } from './atmosphere'
import type { AtmospherePreset } from './atmosphere'
import { BUILD_READS_COLOR, KIT_BUILDERS, blob } from './kit'
import { applyMaterialProps, gazeNdc, lookTargets } from './look'
import { buildFromParts } from './parts'
import { Ambience } from './sound'
import { Gathering } from './fx/anticipate'
import { Placeholder } from './fx/placeholder'
import { beam, dissolve, shimmer, shockwave, sparkle } from './fx/arrival'
import type { Fx } from './fx/common'
import { skyTilt, solveFrame } from './fx/frame'
import type { FrameBox, View } from './fx/frame'
import { Vortex } from './fx/vortex'
import { applyPose, blendedPose, driveOf, motionPose } from './fx/motion'
import type { Drive, MotionStyle } from './fx/motion'
import { WeatherFx } from './fx/weather'
import { softDot } from './fx/common'
import { LightPool } from './perf/lights'
import { precompile, warmKit } from './perf/precompile'

const EYE = 1.6
const WALK = 6
const RUN = 14
const MAX_SLOPE = 1 // rise per metre (over a 2.5 m stride) you can walk up (45°): hills yes, a peak's flanks slide you along them
const MAX_LIGHTS = 10
// Loop 3: things you can stand on (the camera rides their top surface), and how high a step up may be (m).
const WALKABLE_TAGS = new Set(['floor', 'rug', 'carpet', 'dock', 'pier', 'road', 'path', 'bridge', 'deck', 'platform', 'stage', 'boardwalk', 'walkway', 'stairs', 'plaza', 'patio'])
const WALKABLE_KIND = /bridge|dock|pier|deck|floor|platform|stage|walkway|boardwalk|stair|plaza|patio|terrace|rug|carpet/
const STEP_UP = 0.75
const INDOOR_GLOW = 8 // glowing floaters a room takes at full halo before they share the budget
const INDOOR_CAST = 2 // floaters under a ceiling that may keep a real point light
const DOWN = new THREE.Vector3(0, -1, 0)
const REVEAL_TIGHT = 4.5 // fog radius (m) around the player while a place is being summoned
const BIG = 8 // metres tall: arrivals this big get the beam from the sky, the thump and the shake
const MID = 3
const GLOW_TINT = new THREE.Color('#ffe2a8')
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
  /** Where you stood before the god view lifted you, and where it put you (to land you again later). */
  private preLift: { from: View, to: View } | null = null
  private wallRay = new THREE.Raycaster()
  private downRay = new THREE.Raycaster()
  private upN = new THREE.Vector3()
  /** The terrain under your feet, smoothed (the camera rides on it). */
  private groundY = 0
  private lastInput = 0
  private dt = 0
  private vortex = new Vortex()
  private gathering = new Gathering()
  // Loop 2 (sky): weather and sky events, per-item motion clocks, the player's size.
  private weather = new WeatherFx()
  private atmosBase: AtmospherePreset = { ...ATMOSPHERES.dusk }
  private motionStart = new Map<string, { key: string, t0: number }>()
  private playerScale = 1
  private playerScaleTo = 1
  private forming = new Placeholder()
  private revealChord = false
  private rings = 0 // heavy-landing budget per sync, so a global scale-up isn't 40 overlapping shockwaves
  // Loop 3 (perf): a constant set of real lights fed by the kit's lamps, and bodies built this sync to precompile.
  private lightPool = new LightPool()
  private fresh: THREE.Object3D[] = []

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

    // Far plane well past the horizon anchor (300–1200 m) so mountain ranges and moons fit in the frustum.
    this.camera = new THREE.PerspectiveCamera(65, w / h, 0.1, 3200)
    this.camera.position.set(0, EYE, 0)

    this.hemi = new THREE.HemisphereLight(0xbfd4ff, 0x3a3328, 1)
    this.sun = new THREE.DirectionalLight(0xffd2a1, 2)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.bias = -0.0004
    this.sun.shadow.normalBias = 0.04
    Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 220 })
    this.scene.add(this.hemi, this.sun, this.sun.target)

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 1 }))
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
    this.scene.add(this.vortex.obj, this.gathering.obj, this.forming.obj)
    this.scene.add(this.weather.obj, this.lightPool.obj)
    this.weather.onThunder = (d, ms) => this.sound.sfxThunder(d, ms)
    this.weather.onStar = () => this.sound.sfxStar()

    this.scene.fog = new THREE.Fog(0x2a3550, 20, 140)
    this.applyAtmosphere(ATMOSPHERES.dusk)

    this.raycaster.camera = this.camera
    this.wallRay.camera = this.camera // belt and braces: a Sprite's raycast reads it
    this.raycaster.far = 160
    this.bindInput()
    this.ro = new ResizeObserver(() => this.resize())
    this.ro.observe(host)
    this.renderer.setAnimationLoop(now => this.frame(now))
    // Compile every kit kind's shaders in the background, so the first pool hall doesn't (perf/precompile.ts).
    // The scene's own hidden fx (the vortex, the floor patch, weather) too: they first show mid-teleport.
    void this.renderer.compileAsync(this.scene, this.camera)
    void warmKit(this.renderer, this.camera, this.scene, KIT_BUILDERS, () => this.warmExtras())
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
    // The forming silhouette collapses into what arrived (or just fades if the wish changed something else).
    if (fx && this.forming.active) {
      const first = fx.spawned.map(id => wanted.get(id)).find(e => !!e)
      if (first) this.forming.resolve(new THREE.Vector3(first.pos[0], 0, first.pos[2]))
      else if (fx.modified.length || fx.removed.length || fx.teleport) this.forming.set(null)
    }

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
    // Weather, sky events and the player's size (Loop 2). Events are one-shots: a page load never replays them.
    this.weather.set(state.atmosphere.weather)
    this.sound.setWeather(state.atmosphere.weather)
    this.setPlayerScale(state.atmosphere.playerScale ?? 1, prev ? 1800 : 0)
    if (prev) {
      for (const ev of fx?.events ?? []) {
        if (ev.kind === 'sunrise') this.sunrise()
        else this.weather.event(ev.kind, this.camera, ev.at)
      }
    }
    this.budgetLights()
    precompile(this.renderer, this.fresh.splice(0), this.camera, this.scene)

    // Always frame the wish: what just arrived or changed shape should end up in shot, foot to top.
    if (fanfare && !this.reveal && !fx?.teleport) {
      const news = fanfare ? spawned.map(id => wanted.get(id)!) : []
      // Inside a room its own shell (floor, walls, ceiling) is all around you: frame what's in it, not the box.
      const shell = (e: Entity) => !!ceilingOver(state, this.camera.position.x, this.camera.position.z) && ['floor', 'wall', 'ceiling', 'roof'].some(t => this.desc(e).tags.includes(t))
      const framed = [...news, ...reshaped].filter(e => this.frameable(e) && !shell(e))
      // Lifted by a scale-up and this wish isn't another one: come back down first (undo puts you back exactly).
      // An undo always lands you; otherwise stay up only if the landing spot is inside scaled-up geometry.
      const undid = state.log.length < (prev?.log.length ?? 0)
      const land = !swelling && this.lift > 0.5 ? this.landing(undid) : undefined
      const base = land && (undid || !this.engulfed(land.x, land.z)) ? land : undefined
      // Loop 3: a batch that lands mostly in the sky (or a storm, an aurora) tilts you up to it instead.
      if (!base && !swelling && this.skyLook(state, prev, spawned, modified, now)) return
      if (framed.length) this.frameWish(framed, swelling, base)
      else if (base) this.camMove = { from: this.view(), to: base, start: now, dur: 1400 }
    }
  }

  /**
   * Loop 3, "look up": when what just arrived (or just took flight) is mostly above your eye, or the sky
   * itself turned (a storm, an aurora), tilt up to it over two seconds from where you stand. Returns true
   * when it took the shot (so the ground framing doesn't fight it).
   */
  private skyLook(state: WorldState, prev: WorldState | null, spawned: string[], modified: Set<string>, now: number): boolean {
    if (!prev || this.userActive()) return false
    const before = new Map(prev.entities.map(e => [e.id, e]))
    const eye = this.camera.position
    const cand = state.entities.filter((e) => {
      if (spawned.includes(e.id)) return true
      const b = before.get(e.id)
      return modified.has(e.id) && !!b && (e.pos[1] > b.pos[1] + 1 || e.props.motion !== b.props.motion)
    }).filter(e => !this.desc(e).tags.includes('particles') && !isTerrain(this.desc(e)))
    const high = cand.filter(e => e.pos[1] + kindHeight(this.desc(e), e.props) * 0.5 > eye.y + 3)
    const w = state.atmosphere.weather
    const sky = w !== prev.atmosphere.weather && (w === 'storm' || w === 'aurora') ? (w === 'aurora' ? 0.5 : 0.34) : 0
    if (!sky && (!high.length || high.length < cand.length * 0.6)) return false
    const pts = high.map(e => [e.pos[0], e.pos[1] + kindHeight(this.desc(e), e.props) * 0.5, e.pos[2]] as [number, number, number])
    const t = skyTilt([eye.x, eye.y, eye.z], this.yaw, this.pitch, pts)
    const pitch = Math.max(t?.pitch ?? this.pitch, sky)
    if (pitch <= this.pitch + 0.04 && !t) return !!high.length
    const cur = this.view()
    this.camMove = { from: cur, to: { ...cur, yaw: t?.yaw ?? cur.yaw, pitch }, start: now + 250, dur: 2100 }
    return true
  }

  // ---------- framing, shake, lift ----------

  private frameable(e: Entity): boolean {
    const d = this.desc(e)
    if (d.tags.includes('particles')) return false
    // A sky full of small things (lanterns, a flock) is all around you: look up, don't get turned (Loop 2).
    if (e.pos[1] > 4 && kindHeight(d, e.props) < BIG) return false
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
  frameWish(entities: Entity[], preferLift = false, base?: View): void {
    if (!this.state || (this.userActive() && !base)) return
    const boxes: FrameBox[] = entities.map((e) => {
      const d = this.desc(e)
      return { x: e.pos[0], z: e.pos[2], r: Math.max(0.3, entityReach(d, e)), h: e.pos[1] + kindHeight(d, e.props) }
    })
    if (boxes.length === 1 && boxes[0]!.h < 1.2 && boxes[0]!.r < 1) return
    const now = this.view()
    const cur = base ?? now
    const free = (x: number, z: number, dx: number, dz: number, max: number) => this.freeDist(x, z, dx, dz, max)
    // Inside a room (a ceiling over you), framing only turns and tilts: a step back would leave through a
    // wall that may not even have arrived yet (the room's own build backed players 6 m out of it).
    const indoors = !!ceilingOver(this.state, cur.x, cur.z)
    const to = (preferLift && !indoors ? this.godView(boxes, cur) : solveFrame(this.camera, cur, boxes, this.eyeAt(cur.x, cur.z), { free, maxBack: indoors ? 0 : undefined })) ?? base
    if (!to) return
    if (base) {
      this.camMove = { from: now, to, start: performance.now(), dur: 1400 }
      return
    }
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
    if (H < 6) return solveFrame(this.camera, cur, boxes, this.eyeAt(cur.x, cur.z), { free: (x, z, dx, dz, max) => this.freeDist(x, z, dx, dz, max) })
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
    const to = { yaw: cur.yaw + wrapAngle(yaw - cur.yaw), pitch, x, z, lift }
    // Only the first lift remembers the ground; a second 10× keeps the original spot.
    this.preLift = { from: this.preLift?.from ?? { ...cur, lift: 0 }, to }
    return to
  }

  /**
   * Where to land after a lift: on undo, exactly where you stood before it. On any other ground-level wish,
   * the same spot unless you've flown off somewhere (then straight down where you are). Never stays aloft.
   */
  private landing(undid: boolean): View {
    const cur = this.view()
    const pl = this.preLift
    const roamed = pl ? Math.hypot(cur.x - pl.to.x, cur.z - pl.to.z) > 8 : true
    if (pl && (undid || !roamed)) return { ...pl.from, yaw: cur.yaw + wrapAngle(pl.from.yaw - cur.yaw), lift: 0 }
    return { ...cur, lift: 0, pitch: Math.max(cur.pitch, -0.15) }
  }

  /**
   * Would standing at (x, z) put you inside something scaled up around you (a giant's leg, a colossal
   * house)? Only things whose footprint covers the spot and that tower over you count; terrain never does
   * (you stand on it), and a mountain on the horizon is irrelevant.
   */
  private engulfed(x: number, z: number): boolean {
    if (!this.state) return false
    for (const e of this.state.entities) {
      const d = this.desc(e)
      if (isTerrain(d) || d.tags.includes('particles')) continue
      const h = kindHeight(d, e.props)
      if (h < 6 || e.pos[1] > EYE + this.groundAt(x, z)) continue
      if (Math.hypot(x - e.pos[0], z - e.pos[2]) < entityReach(d, e) * 0.9) return true
    }
    return false
  }

  /**
   * Loop 3: what you stand on at (x, z). The terrain, or the top of a walkable structure there (a dock deck,
   * a floor, a rug, a bridge) if it's within a step of your feet: a short ray straight down against its
   * visible meshes. So "make me tiny" on a dock keeps you on the planks, never under them.
   */
  private standAt(x: number, z: number): number {
    const terrain = this.groundAt(x, z)
    const step = STEP_UP * Math.max(1, this.playerScale)
    const top = Math.max(terrain, this.groundY) + step
    const targets: THREE.Object3D[] = []
    for (const item of this.items.values()) {
      const e = item.entity
      if (!WALKABLE_KIND.test(e.kind) && !e.tags.some(t => WALKABLE_TAGS.has(t))) continue
      if (Math.abs(item.holder.position.x - x) + Math.abs(item.holder.position.z - z) > 90) continue
      item.holder.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh) targets.push(o)
      })
    }
    if (!targets.length) return terrain
    this.downRay.set(new THREE.Vector3(x, top, z), DOWN)
    this.downRay.far = top - terrain + 0.05
    for (const h of safeHits(this.downRay, targets)) {
      if (!h.face) continue
      if (this.upN.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.6) return Math.max(terrain, h.point.y)
    }
    return terrain
  }

  /** Ground height at (x, z): the terrain surface, or 0 on the flat world. */
  private groundAt(x: number, z: number): number {
    return this.state ? groundHeight(this.state, x, z) : 0
  }

  /** Eye height at (x, z) for the framing solver: the ground there plus your (scaled) eye. */
  private eyeAt(x: number, z: number): number {
    return this.groundAt(x, z) + EYE * this.playerScale
  }

  /**
   * Walk by `move` over the terrain: downhill and gentle slopes are free; anything steeper than MAX_SLOPE
   * slides you along the contour instead of up it, and a wall of rock stops you.
   */
  private walk(move: THREE.Vector3): void {
    const p = this.camera.position
    if (this.lift > 0.5 || !this.state) {
      p.add(move)
      return
    }
    const h0 = this.groundAt(p.x, p.z)
    // Slope over a 2.5 m stride ahead, so one steep facet of a faceted hill doesn't stop you.
    const slope = (m: THREE.Vector3) => {
      const len = Math.hypot(m.x, m.z)
      if (len < 1e-6) return Infinity
      const probe = Math.max(len, 2.5)
      return (this.groundAt(p.x + (m.x / len) * probe, p.z + (m.z / len) * probe) - h0) / probe
    }
    const steep = (m: THREE.Vector3) => slope(m) > MAX_SLOPE
    const s0 = slope(move)
    if (s0 <= MAX_SLOPE) {
      // Climbing is slower than strolling: a hill takes effort, a mountain's foothills take a while.
      p.addScaledVector(move, s0 > 0 ? Math.max(0.35, 1 - s0 * 0.6) : 1)
      return
    }
    // Slide: drop the uphill part of the step (the gradient direction) and keep the rest.
    const e = 0.3
    const gx = this.groundAt(p.x + e, p.z) - this.groundAt(p.x - e, p.z)
    const gz = this.groundAt(p.x, p.z + e) - this.groundAt(p.x, p.z - e)
    const gl = Math.hypot(gx, gz)
    if (gl < 1e-6) return
    const up = (move.x * gx + move.z * gz) / gl
    if (up <= 0) {
      p.add(move)
      return
    }
    const slide = new THREE.Vector3(move.x - (gx / gl) * up, 0, move.z - (gz / gl) * up)
    if (!steep(slide)) p.add(slide)
  }

  /** Free walking distance from (x, z) along (dx, dz), up to `max`: a ray at eye and knee height against every thing. */
  private freeDist(x: number, z: number, dx: number, dz: number, max: number): number {
    const targets = this.rayTargets()
    const g = this.groundAt(x, z)
    let d = max
    for (const y of [EYE, 0.6]) {
      this.wallRay.set(new THREE.Vector3(x, g + y, z), new THREE.Vector3(dx, 0, dz).normalize())
      this.wallRay.far = max
      const hit = safeHits(this.wallRay, targets)[0]
      if (hit) d = Math.min(d, hit.distance)
    }
    return d
  }

  /** Every visible mesh of every item: what rays may hit. Sprites, points and lines never are. */
  private rayTargets(): THREE.Object3D[] {
    const out: THREE.Object3D[] = []
    for (const item of this.items.values()) {
      item.holder.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh) out.push(o)
      })
    }
    return out
  }

  /** A shake proportional to size and nearness: a castle 10 m away rattles you, a pine doesn't. */
  private addShake(tall: number, at: THREE.Vector3, when: number, dur?: number): void {
    const d = Math.hypot(at.x - this.camera.position.x, at.z - this.camera.position.z)
    const near = Math.min(1, (tall * 2) / (d + 4))
    const amp = (0.006 + 0.03 * Math.min(1, tall / 60)) * near
    if (amp < 0.002) return
    const cur = this.shake
    if (cur && cur.amp > amp && when < cur.start + cur.dur * 0.5) return
    this.shake = { amp, start: when, dur: dur ?? 420 + Math.min(500, tall * 8) }
  }

  /** "The world listens": a soft glow gathers at `point` while a request is pending; null lets it go. */
  anticipate(point: Vec3 | null): void {
    this.gathering.set(point ? new THREE.Vector3(point[0], 0, point[2]) : null)
  }

  /** A wish is still being designed: a swirling silhouette stands at `point` until it arrives; null fades it. */
  placeholder(point: Vec3 | null): void {
    this.forming.set(point ? new THREE.Vector3(point[0], 0, point[2]) : null)
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
    // You arrive standing and looking ahead: any god's-eye lift comes down and a sky tilt (lanterns, a storm)
    // levels out while the vortex spins up, so the new place is revealed at eye level, not as a strip of sky.
    if (this.lift > 0.05 || this.pitch > 0.1 || this.pitch < -0.2) {
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
    this.fresh.push(holder)
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
    // Terrain and sky bodies don't come down a beam: they heave up out of the earth (or swell into the sky) with a rumble.
    const colossal = tier === 'big' && isTerrain(desc)
    const lead = tier === 'big' && loud && !colossal ? 420 : 0
    const at = at0 + lead
    const now = performance.now()
    const center = new THREE.Vector3(e.pos[0], y0, e.pos[2])
    const show = () => {
      holder.visible = true
    }
    if (loud && cue.count > 1 && (!cue.reveal || cue.index % 2 === 0)) this.sound.sfxChime(cue.index, cue.count, at - now)

    // The beam from the sky arrives first and holds while the thing comes down through it.
    let fallDur: number
    // Airborne things (a lantern released, a bird) rise into their place from below instead of falling.
    const airborne = y0 > 4 && tall < BIG && fall !== 'flicker'
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

    // Creatures with an entrance (Loop 3): the dragon stoops out of the sky and roars, the whale sinks slowly down.
    const theatre = item.body.userData.arrival as 'dive' | 'descend' | undefined
    if (theatre === 'dive') {
      fallDur = 2600
      const style = item.body.userData.motionStyle as MotionStyle | undefined
      // From high behind where it will be heading, so it dives nose first into its flight.
      const yaw = motionPose(e, 0.6, tall, style)?.yaw ?? e.rotY
      const D = 48
      const H = 40
      const body = item.body
      holder.scale.setScalar(s)
      stretch.scale.y = h
      body.userData.dive = 1
      this.tween(at, fallDur, (t) => {
        const back = 1 - ease.out(t)
        holder.position.set(e.pos[0] - Math.sin(yaw) * D * back, y0 + H * back * back, e.pos[2] - Math.cos(yaw) * D * back)
        body.userData.dive = Math.max(0, 1 - t * 1.3)
      }, () => {
        holder.position.set(...e.pos)
        body.userData.dive = 0
        body.userData.roarAt = performance.now()
      }, show)
      if (loud || cue.index === 0) this.sound.sfxDragon(at - now, fallDur)
    } else if (theatre === 'descend') {
      fallDur = 6500
      holder.scale.setScalar(s)
      stretch.scale.y = h
      this.tween(at, fallDur, (t) => {
        holder.position.y = y0 + 32 * (1 - ease.inOut(t))
      }, () => {
        holder.position.y = y0
      }, show)
      if (loud || cue.index === 0) this.sound.sfxWhaleSong(at - now)
    } else if (airborne) {
      const rise = Math.min(14, y0 * 0.6)
      fallDur = 1900
      holder.scale.setScalar(0.001)
      stretch.scale.y = h
      this.tween(at, fallDur, (t) => {
        holder.position.y = y0 - rise * (1 - ease.out(t))
        holder.scale.setScalar(Math.max(0.001, s * Math.min(1, t * 2.5)))
      }, () => {
        holder.position.y = y0
      }, show)
      sparkleAt(at + 80, tall * 0.5 - rise)
    } else if (fall === 'drop') {
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
    } else if (colossal && loud && fall === 'rise') {
      // Up through the ground: the hidden part is below the floor, so it reads as land heaving up, not inflating.
      fallDur = 2600 + Math.min(1400, tall * 4)
      holder.scale.set(s, s * 0.55, s)
      stretch.scale.y = h
      holder.position.y = y0 - tall * 0.75
      this.tween(at, fallDur, (t) => {
        const k = ease.out(t)
        holder.position.y = y0 - tall * 0.75 * (1 - k)
        holder.scale.y = s * (0.55 + 0.45 * k)
      }, () => {
        holder.position.y = y0
        holder.scale.setScalar(s)
        impact(performance.now())
      }, show)
      this.puff(center, Math.min(60, reach * 0.5), 1.4, 70)
      this.addShake(tall, center, at, fallDur)
      this.sound.sfxSummon(tall, fallDur * 0.8, at - now)
    } else if (fall === 'grow' || fall === 'rise') {
      fallDur = tier === 'big' && loud ? (colossal ? 2400 : 1100) : fall === 'grow' ? 620 : 700
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

    if (tier === 'big' && loud && !colossal) {
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
    // Glow, light and motion changes are changes too (Loop 2): they get the shimmer and the whoosh.
    const lit = (e.props.glow ?? 0) !== (before.props.glow ?? 0) || (e.props.light ?? 0) !== (before.props.light ?? 0) || e.props.motion !== before.props.motion
    const changed = resized || moved || recolored || rebuilt || lit
    if (fx && (resized || recolored || lit) && tall1 >= 0.3) {
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
    this.fresh.push(body)
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
    applyMaterialProps(item.body, e.props, !!this.desc(e).learned)
    this.glowExtras(item, e)
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
      else if (m.userData.emissiveFollows !== undefined && mat.emissive) {
        mat.emissive.copy(c)
        // A body glow (Loop 2) leans toward warm light, so "make the castle glow" reads as light, not grey paint.
        if (m.userData.glowTint) mat.emissive.lerp(GLOW_TINT, m.userData.glowTint as number)
        mat.emissive.multiplyScalar(m.userData.emissiveFollows as number)
      }
    }
    if (!animate) {
      for (const { mesh, color } of targets) setColor(mesh, color)
      for (const { light, to } of lights) light.color.copy(to)
      return false
    }
    const from = targets.map(t => (t.mesh.material as THREE.MeshStandardMaterial).color.clone())
    const lightFrom = lights.map(l => l.light.color.clone())
    if (targets.every((t, i) => from[i]!.equals(t.color)) && lights.every((l, i) => lightFrom[i]!.equals(l.to))) {
      // Same colours, but a glow change still has to reach the emissive.
      for (const { mesh, color } of targets) setColor(mesh, color)
      return false
    }
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
    const indoor = this.dimIndoorGlow()
    let indoorCast = 0
    for (const item of this.items.values()) {
      const inside = indoor.has(item)
      item.body.traverse((o) => {
        if (!(o as THREE.Light).isLight) return
        // Indoors, at most two floating things keep a real light; the rest glow without casting (Loop 3).
        if (inside && o.userData.cast && ++indoorCast > INDOOR_CAST) {
          o.visible = false
          return
        }
        lights.push({ l: o as THREE.Light, d: item.holder.position.distanceTo(this.camera.position) })
      })
    }
    lights.sort((a, b) => a.d - b.d)
    lights.forEach(({ l }, i) => {
      l.visible = i < MAX_LIGHTS
    })
    // The kit's lights are only sources: the pool's constant set of real lights copies the nearest (perf/lights.ts).
    this.lightPool.collect([...[...this.items.values()].map(i => i.body), ...[...this.leaving].map(i => i.body)])
  }

  /** One of each arrival effect, the dust puff and a label blob, for the shader warm-up (perf/precompile.ts). */
  private warmExtras(): THREE.Object3D[] {
    const o = new THREE.Vector3(0, -50, 0)
    const fx = [beam(o, 1, '#ffffff'), shockwave(o, 1), sparkle(o, 1, '#ffffff', 4), shimmer(o, 1, 1, '#ffffff'), dissolve(o, 1, 1, '#ffffff', 4)]
    const dust = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xd8d0c0, size: 0.3, transparent: true, opacity: 0.7, depthWrite: false, alphaMap: radialTexture() }))
    return [...fx.map(f => f.obj), dust, blob({ text: 'warm' }), contactShadow(1)]
  }

  /**
   * Loop 3: glowing floating things under a ceiling (lanterns in a pool hall) share a fixed light budget, so
   * a room of them reads as warm lanterns, not a white-out: halos shrink and dim, the paper glows softer.
   * Returns the items that are indoors.
   */
  private dimIndoorGlow(): Set<Item> {
    const inside = new Set<Item>()
    if (!this.state) return inside
    const glowing: Item[] = []
    for (const item of this.items.values()) {
      const e = item.entity
      if (e.pos[1] <= 0.5 && !e.tags.includes('lantern')) continue
      if (!e.tags.includes('lantern') && !((e.props.glow ?? 0) > 0) && !((e.props.light ?? 0) > 0)) continue
      glowing.push(item)
      const lid = ceilingOver(this.state, e.pos[0], e.pos[2])
      if (lid && e.pos[1] < lid.y) inside.add(item)
    }
    const k = Math.min(1, INDOOR_GLOW / Math.max(1, inside.size))
    for (const item of glowing) {
      const dim = inside.has(item) ? 0.3 + 0.35 * k : 1
      item.body.traverse((o) => {
        if (o.userData.animate) o.userData.dim = inside.has(item) ? 0.55 : 1
        if (o.userData.halo !== undefined) {
          o.userData.haloBase ??= o.userData.halo
          o.userData.halo = (o.userData.haloBase as number) * dim
        }
      })
      const gh = item.body.userData.glowHalo as THREE.Sprite | undefined
      if (gh && inside.has(item)) gh.material.opacity = Math.min(gh.material.opacity, 0.6 * dim)
    }
    return inside
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
    const from = { ...this.atmosBase }
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

  private applyAtmosphere(base: AtmospherePreset): void {
    // The weather grades the time-of-day preset (a storm greys it, snow whitens the ground, a flash lights it).
    this.atmosBase = base
    const a = this.weather.grade(base)
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
    const targets = [this.ground, ...this.rayTargets()]
    const hits = safeHits(this.raycaster, targets)
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
      this.groundY = this.groundAt(pos[0], pos[1])
      this.camera.position.set(pos[0], this.groundY + EYE, pos[1])
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
    if (this.preLift && !this.camMove && this.lift < 0.5) this.preLift = null
    // Ride the terrain: ease toward the ground under you (quick up a rise, a touch slower dropping off it).
    const gy = this.standAt(this.camera.position.x, this.camera.position.z)
    this.groundY += (gy - this.groundY) * (1 - Math.exp(-dt * (gy > this.groundY ? 12 : 7)))
    if (Math.abs(gy - this.groundY) > 60) this.groundY = gy // a teleport or a mountain rising under you: no long glide
    this.camera.position.y = this.groundY + EYE * this.playerScale + this.lift

    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const r = new THREE.Vector3(-f.z, 0, f.x)
    // Walking speed scales with the eye lift: a giant strides.
    const sp = (this.keys.shift ? RUN : WALK) * dt * (1 + this.lift / 12) * Math.max(0.2, Math.sqrt(this.playerScale))
    const k = this.keys
    const move = new THREE.Vector3()
    if (k.w || k.arrowup) move.addScaledVector(f, sp)
    if (k.s || k.arrowdown) move.addScaledVector(f, -sp)
    if (k.a || k.arrowleft) move.addScaledVector(r, -sp)
    if (k.d || k.arrowright) move.addScaledVector(r, sp)
    if (move.lengthSq() > 0) this.walk(move)
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
    this.moveItems(now)

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
    this.forming.tick(dt)
    if (this.weather.tick(dt, this.camera, this.atmosBase)) this.applyAtmosphere(this.atmosBase)

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

    this.lightPool.update(this.camera, now)
    this.renderer.render(this.scene, this.camera)
    const w = window as unknown as { __sceneReady?: boolean }
    if (!w.__sceneReady) w.__sceneReady = true
  }

  // ---------- Loop 2: glow, light, motion, player size, sunrise ----------

  /**
   * `glow` on a thing with no glow parts makes its body luminous (look.ts); this adds the soft halo that
   * sells it at night. `light` gives it a real point light (counted by budgetLights like any lamp).
   */
  private glowExtras(item: Item, e: Entity): void {
    const desc = this.desc(e)
    const tall = Math.max(0.5, kindHeight(desc, { ...e.props, scale: 1 }))
    const reach = Math.max(0.5, desc.footprint)
    const color = e.props.color ?? desc.defaults.color ?? '#ffe2b0'
    const glowing = (e.props.glow ?? 0) > 0 && !!item.body.userData.bodyGlow
    let halo = item.body.userData.glowHalo as THREE.Sprite | undefined
    if (glowing && !halo) {
      halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
      halo.raycast = () => {}
      item.body.add(halo)
      item.body.userData.glowHalo = halo
    }
    if (halo) {
      halo.visible = glowing
      halo.material.color.set(color).lerp(new THREE.Color('#ffffff'), 0.25)
      halo.material.opacity = Math.min(0.6, 0.18 * (e.props.glow ?? 0))
      halo.position.y = tall * 0.55
      halo.scale.setScalar(Math.max(reach * 3.2, tall * 1.6))
    }
    const want = e.props.light ?? 0
    let light = item.body.userData.castLight as THREE.PointLight | undefined
    if (want > 0 && !light) {
      light = new THREE.PointLight('#ffd9a0', 0, 0, 2)
      light.userData.cast = true
      item.body.add(light)
      item.body.userData.castLight = light
    }
    if (light) {
      light.visible = want > 0
      light.color.set(this.lampTint(e) ?? color).lerp(new THREE.Color('#fff1d6'), 0.3)
      light.intensity = want * 14 * Math.max(1, tall * 0.5)
      light.distance = 10 + reach * 3 + tall * 1.5
      light.position.set(0, tall * 0.6, 0)
    }
  }

  /** Per-frame motion (fx/motion.ts): each moving item's pose goes on its stretch group, blended in from rest. */
  private moveItems(now: number): void {
    for (const item of this.items.values()) {
      const e = item.entity
      const m = e.props.motion
      // Creatures (Loop 3) are posed every frame, moving or not: wings, legs, tail and head follow the drive.
      const drive = item.body.userData.drive as ((d: Drive) => void) | undefined
      const style = item.body.userData.motionStyle as MotionStyle | undefined
      if (!m) {
        if (this.motionStart.delete(e.id)) applyPose(item, null)
        if (drive) this.driveCreature(item, drive, now / 1000, style)
        continue
      }
      // The clock restarts when the motion (or where it is) changes, so a modify blends in from where it stands.
      const key = `${m}|${e.props.speed ?? 1}|${e.path?.c.join(',') ?? ''}|${e.path?.r ?? ''}|${e.pos.join(',')}`
      let clock = this.motionStart.get(e.id)
      if (!clock || clock.key !== key) {
        clock = { key, t0: now }
        this.motionStart.set(e.id, clock)
      }
      const t = (now - clock.t0) / 1000
      applyPose(item, blendedPose(e, t, kindHeight(this.desc(e), e.props), style))
      if (drive) this.driveCreature(item, drive, t, style)
    }
  }

  private driveCreature(item: Item, drive: (d: Drive) => void, t: number, style?: MotionStyle): void {
    const e = item.entity
    const c = this.camera.position
    const d = driveOf(e, t, kindHeight(this.desc(e), e.props), style, [c.x, c.y, c.z], this.groundAt(e.pos[0], e.pos[2]))
    // An arrival tween lifts the holder (the dragon's dive): it's flying then, whatever the pose says.
    d.air += item.holder.position.y - e.pos[1]
    drive(d)
  }

  /**
   * "Make me tiny": the player's size changes, not the world's. Eye height, stride and the near plane all
   * scale; shrinking a lot tips your gaze up at the giants around you.
   */
  private setPlayerScale(k: number, dur: number): void {
    if (Math.abs(k - this.playerScaleTo) < 1e-3) return
    const from = this.playerScale
    this.playerScaleTo = k
    if (!dur) {
      this.playerScale = k
      this.camera.near = Math.max(0.02, Math.min(0.1, 0.1 * k))
      this.camera.updateProjectionMatrix()
      return
    }
    const p0 = this.pitch
    const lookUp = k < from * 0.5 && !this.userActive() ? Math.max(p0, 0.2) : p0
    this.sound.sfxWhoosh(k > from, 0, true)
    this.tween(performance.now(), dur, (t) => {
      const e = ease.inOut(t)
      // Geometric, so a 10× shrink feels even all the way down.
      this.playerScale = from * (k / from) ** e
      this.camera.near = Math.max(0.02, Math.min(0.1, 0.1 * this.playerScale))
      this.camera.updateProjectionMatrix()
      if (lookUp !== p0 && !this.userActive()) this.pitch = p0 + (lookUp - p0) * e
    })
  }

  /** A sunrise sweep: through dawn's rose light to the full day, over about seven seconds. */
  private sunrise(): void {
    const version = ++this.atmosVersion
    const from = { ...this.atmosBase }
    const dawn = ATMOSPHERES.dawn
    const day = ATMOSPHERES[this.state?.atmosphere.time ?? 'day']
    const now = performance.now()
    this.tween(now, 3400, (t) => {
      if (version === this.atmosVersion) this.applyAtmosphere(lerpPreset(from, dawn, ease.inOut(t)))
    })
    this.tween(now + 3400, 3800, (t) => {
      if (version === this.atmosVersion) this.applyAtmosphere(lerpPreset(dawn, day, ease.inOut(t)))
    })
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
      // defaultPrevented: the HUD took this key as a letter of a sentence (it listens in the capture phase).
      if (typing(e) || e.metaKey || e.ctrlKey || e.defaultPrevented) return
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

  /** The HUD decided a W/A/S/D tap was the first letter of a sentence: stop walking and step back to `at`. */
  cancelWalk(at?: [number, number]): void {
    this.keys = {}
    if (at && !this.camMove) {
      this.camera.position.x = at[0]
      this.camera.position.z = at[1]
    }
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
    this.weather.dispose()
    this.forming.dispose()
    this.lightPool.dispose()
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

/** Raycast `targets` (already flattened to meshes) without recursing: nothing exotic can throw in here. */
function safeHits(ray: THREE.Raycaster, targets: THREE.Object3D[]): THREE.Intersection[] {
  try {
    return ray.intersectObjects(targets, false)
  } catch {
    return []
  }
}
