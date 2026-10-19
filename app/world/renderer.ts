/**
 * The three.js side of the world. It owns no world data: `sync(state, effects)` reconciles objects from
 * a WorldState, and effects say what to animate (staggered arrivals, springs, colour wipes, shrink-outs).
 * It also owns the first-person camera, the gaze ray and the reticle/ghost rings.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { isTerrain, kindHeight } from '#shared/world/kinds'
import type { Fall, KindDescriptor } from '#shared/world/kinds'
import type { Vec3, Part } from '#shared/world/ops'
import { kindOf } from '#shared/world/select'
import { groundHeight } from '#shared/world/terrain'
import { ceilingOver } from '#shared/world/layout'
import type { Effects, Entity, GazeSnapshot, Player, WorldState } from '#shared/world/types'
import { ATMOSPHERES, lerpPreset } from './atmosphere'
import type { AtmospherePreset } from './atmosphere'
import { BUILD_READS_COLOR, KIT_BUILDERS, blob } from './kit'
import { applyMaterialProps, gazeNdc, lookTargets } from './look'
import { buildFromParts, buildFromPartsMerged, partMesh } from './parts'
import { boundsOf, maxDim, sizeK, transformPart } from '#shared/world/forge'
import { crossfade, ghost, growIn, meshesOf } from './fx/refine'
import { Ambience } from './sound'
import { Gathering } from './fx/anticipate'
import { Placeholder } from './fx/placeholder'
import { beam, dissolve, shimmer, shockwave, sparkle } from './fx/arrival'
import type { Fx } from './fx/common'
import { OUTDOOR_BACK, fitFrame, skyTilt, solveFrame } from './fx/frame'
import type { FrameBox, View } from './fx/frame'
import { Vortex } from './fx/vortex'
import { applyPose, blendedPose, driveOf, flightPose, flightTimes, followStep, motionPose, tipPose, weightlessPose, GRAVITY, TIP_SECONDS } from './fx/motion'
import { customizeSky, moonSpot } from './fx/skymods'
import { slideOut } from './fx/collide'
import type { Circle } from './fx/collide'
import { isLoose } from '#shared/world/state'
import type { Drive, FollowState, MotionStyle, Pose } from './fx/motion'
import { WeatherFx } from './fx/weather'
import { softDot } from './fx/common'
import { LightPool } from './perf/lights'
import { precompile, setCompileTarget, warmKit } from './perf/precompile'
import { STYLE_UNIFORMS } from './style/toon'
import { Post } from './style/post'
import { skyDome, skyUniforms } from './style/sky'
import type { SkyUniforms } from './style/sky'
import { GROUND_UNIFORMS, groundMaterial } from './style/ground'
import { Grass, grassCircles, nearMasks } from './style/grass'
import { Studio } from './studio'
import { boxHeight, contactShadow, disposeObject, entityReach, glowSprite, hashParts, radialTexture, ring, round2, safeHits, skyDir, slotMeshes, starfield, v3, wrapAngle } from './sceneHelpers'

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
// The forge (progressive generation): refined parts stream in at most this many new meshes per frame,
// the swap sweep's length, and how faint the draft ghosts while it's refined (studio shots: studio.ts).
// Gen loop 1 ("one honest build"): no ghost, no hold, no sweep. Parts grow in as they arrive; the draft
// hands over to the refined version in one quick cross-fade once its first few (biggest) parts are on screen.
const PARTS_PER_FRAME = 4
const GROW_MS = 320
const HANDOFF_PARTS = 3
const CROSSFADE_MS = 350
/** Gen loop 3: a newly landed design is framed with more air than a spawn (bottoms were clipping). */
const LANDED_MARGIN = 0.8
/** Gen loop 4: a newly landed design is dollied to fill about this much of the view (worst |NDC|). */
const LANDED_FILL = 0.74
/** How many instances of a kind show its draft streaming in (the rest get it when the define lands). */
const DRAFT_STREAM_MAX = 12

/** A kind being refined: the instance nearest the camera grows the refined parts in an overlay. */
interface RefineJob {
  kind: string
  focusId: string
  overlay: THREE.Group
  queue: Part[]
  streamed: Part[]
  added: number
  /** The draft on the focused instance has faded out (the refined parts are the object now). */
  handed: boolean
  /** Kept for the gauntlet's timeline (was the ghost level): 1 = draft solid, 0 = handed over. */
  level: number
  /** Gen loop 2: the scale that holds the streaming refine to the kind's target size (shrink-only). */
  k: number
}

/** A kind's draft streaming in part by part before its define closes: one overlay per instance. */
interface DraftStream {
  overlays: Map<string, THREE.Group>
  parts: Part[]
  /** Gen loop 2: the scale that holds the streaming draft to its kind's target size (shrink-only). */
  k: number
}

/** Gauntlet loop 1 (track B): one item's physics-lite clocks (its flight, its tip, when it first appeared). */
interface PhysClock {
  key: string
  t0: number
  hits: number
  tipFrom: number
  tipTo: number
  tipAt: number
  seen: number
}

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
  /** Called every frame after motion (the People runtime walks and poses the NPCs here). */
  onFrame?: (dt: number, now: number) => void
  /** A thunderclap (distance m): people flinch. */
  onThunder?: (dist: number) => void
  /** This frame's gaze (what the crosshair is on), so per-frame readers don't each cast their own ray. */
  gazeNow: (GazeSnapshot & { info: GazeInfo }) | null = null

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
  private skyUniforms: SkyUniforms
  // Painted Toy World: the one post pass (MSAA target, Neutral tone map, grade, depth edges, vignette).
  private post = new Post()
  private gridShown = 0
  private grass = new Grass()
  private grassMasks: [number, number, number][] = []
  private grassMaskAt = 0
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
  private tmpV = new THREE.Vector3()
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
  // The forge: kinds being refined, a gentle swirl round the focused one, and queued studio shots.
  private refining = new Map<string, RefineJob>()
  private drafting = new Map<string, DraftStream>()
  /** Gen loop 2: each new kind's target size (largest dimension, m), decided at its spawn. */
  private sizes = new Map<string, number>()
  private refineMotes = new Placeholder()
  private studio = new Studio()
  // Gauntlet loop 1 (track B): physics-lite clocks per item, followers, no-gravity, flight, the "take me to
  // the top" glide, a soft camera track on things that arrive moving, and the extra moons.
  private phys = new Map<string, PhysClock>()
  private posed = new Set<string>()
  private follow = new Map<string, FollowState & { speed: number, stride: number }>()
  private live = new Set<string>()
  private gravityOff: number | null = null
  private gravityOn: number | null = null
  private flying = false
  private falling = false
  private flyY = 0
  private flyVel = 0
  private glide: { from: THREE.Vector3, to: THREE.Vector3, start: number, dur: number, yaw0: number, yaw1: number, pitch0: number, pitch1: number } | null = null
  private track: { ids: string[], start: number, until: number } | null = null
  private extraMoons: THREE.Sprite[] = []
  private moonYaw = 0
  /** Where a goto left you standing (the top of a tower): you stay up there until you step off it. */
  private perch: { x: number, z: number, r: number, y: number, id: string } | null = null

  constructor(host: HTMLElement) {
    this.host = host
    const w = host.clientWidth || window.innerWidth
    const h = host.clientHeight || window.innerHeight

    // Painted Toy World (style/*): the scene renders into the post pass's MSAA target (so no canvas AA), and
    // Neutral tone mapping runs there, keeping palette colours on-model. Pixel ratio capped at 1.5 with post on.
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(w, h)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFShadowMap
    this.renderer.toneMapping = THREE.NeutralToneMapping
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.post.setSize(db.x, db.y)
    setCompileTarget(this.post.target)
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

    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), groundMaterial())
    this.ground.rotation.x = -Math.PI / 2
    this.ground.receiveShadow = true
    this.ground.name = 'ground'
    this.scene.add(this.ground)
    this.scene.add(this.grass.mesh)

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

    // The painted sky dome (style/sky.ts): gradient, horizon band, sun disc, clouds. Follows the camera.
    this.skyUniforms = skyUniforms()
    this.sky = skyDome(this.skyUniforms)
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
    this.scene.add(this.vortex.obj, this.gathering.obj, this.forming.obj, this.refineMotes.obj)
    this.scene.add(this.weather.obj, this.lightPool.obj)
    this.weather.onThunder = (d, ms) => {
      this.sound.sfxThunder(d, ms)
      setTimeout(() => this.onThunder?.(d), Math.max(0, ms))
    }
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
    void this.post.bindForCompile(this.renderer, () => this.renderer.compileAsync(this.scene, this.camera))
    void warmKit(this.renderer, this.camera, this.scene, KIT_BUILDERS, () => this.warmExtras())
  }

  // ---------- reconcile ----------

  sync(state: WorldState, effects?: Effects): void {
    const prev = this.state
    this.state = state
    this.grassMasks = grassCircles(state.entities, (e) => {
      const d = kindOf(state, e.kind)
      return { length: d.defaults.length ?? d.length, width: d.defaults.width ?? d.width, footprint: d.footprint }
    })
    this.grassMaskAt = 0
    const now = performance.now()
    const fx = effects
    const wanted = new Map(state.entities.map(e => [e.id, e]))
    // A teleport fogs the old place out first; what was there dissolves upward into motes behind the fog.
    if (fx?.teleport) this.beginReveal(now)
    const removeAt = fx?.teleport ? now + 520 : now
    // Anything landing answers the wish, so the "world listens" glow lets go.
    if (fx && (fx.spawned.length || fx.modified.length || fx.removed.length || fx.teleport)) this.gathering.set(null)
    // The forming silhouette collapses into what arrived (or just fades if the wish changed something else).
    // Spawn before define: a labelled blob holding a not-yet-designed kind's spot keeps the motes swirling
    // round it; they collapse when its define lands (the blob morphs) or anything real arrives.
    if (fx && this.forming.active) {
      const first = fx.spawned.map(id => wanted.get(id)).find(e => !!e && !!state.kinds[e.kind])
      const drafted = fx.redefined.length ? state.entities.find(e => fx.redefined.includes(e.kind) && (state.kinds[e.kind]?.quality ?? 'draft') === 'draft') : undefined
      const landed = first ?? drafted
      if (landed) this.forming.resolve(new THREE.Vector3(landed.pos[0], 0, landed.pos[2]))
      else if (!fx.spawned.length && (fx.modified.length || fx.removed.length || fx.teleport)) this.forming.set(null)
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

    // Learned kinds that changed (or placeholders that just got defined) morph in place. A forged upgrade
    // (quality good / hero) instead sweeps in: every instance, nearest first, 60 ms apart.
    for (const kind of fx?.redefined ?? []) {
      const forged = (state.kinds[kind]?.quality ?? 'draft') !== 'draft'
      const list = [...this.items.values()].filter(i => i.entity.kind === kind && !i.leaving)
      list.sort((a, b) => a.holder.position.distanceTo(this.camera.position) - b.holder.position.distanceTo(this.camera.position))
      const streamed = this.drafting.get(kind)
      const job = this.refining.get(kind)
      list.forEach((item, i) => {
        const e = wanted.get(item.entity.id) ?? item.entity
        if (forged) this.refineSwap(item, e, now + i * 60)
        else this.rebuild(item, e, now, !streamed?.overlays.has(item.entity.id), undefined, !!streamed?.overlays.has(item.entity.id))
        // The refined version already took over this instance: the late draft stays out of sight.
        if (!forged && job?.handed && job.focusId === item.entity.id) item.body.visible = false
      })
      if (streamed) this.endDraft(kind)
      // Gen loop 2: once a new design lands (the draft's define, then its forged upgrade), frame it if any
      // of it (height, width or depth) is off-screen; solveFrame leaves the camera alone when it already fits.
      if (list[0] && state.kinds[kind] && prev && !this.reveal && !this.userActive()) this.frameWish([wanted.get(list[0].entity.id) ?? list[0].entity], false, undefined, LANDED_MARGIN)
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
    this.syncPlayer(state, prev, fx, now)
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
    // Flat but wide things (a picnic blanket, a pond) count too, so a far-off one gets an approach (track B).
    return kindHeight(d, e.props) >= 0.6 || (!d.sized && d.footprint * (e.props.scale ?? 1) >= 0.9)
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
  frameWish(entities: Entity[], preferLift = false, base?: View, margin?: number): void {
    if (!this.state || (this.userActive() && !base)) return
    const boxes: FrameBox[] = entities.map((e) => {
      const d = this.desc(e)
      return { x: e.pos[0], z: e.pos[2], r: Math.max(0.3, entityReach(d, e)), h: e.pos[1] + kindHeight(d, e.props), pts: this.corners(e) }
    })
    if (boxes.length === 1 && boxes[0]!.h < 1.2 && boxes[0]!.r < 1) return
    const now = this.view()
    const cur = base ?? now
    const free = (x: number, z: number, dx: number, dz: number, max: number) => this.freeDist(x, z, dx, dz, max)
    // Inside a room (a ceiling over you), framing only turns and tilts: a step back would leave through a
    // wall that may not even have arrived yet (the room's own build backed players 6 m out of it).
    const indoors = !!ceilingOver(this.state, cur.x, cur.z)
    // Gen loop 4: one newly landed design outdoors is dollied to fill the view (closer or back) from its real box.
    const fit = margin !== undefined && !indoors && !preferLift && boxes.length === 1 && boxes[0]!.pts
    const to = fit
      ? fitFrame(this.camera, cur, boxes, this.eyeAt(cur.x, cur.z), { free, maxBack: OUTDOOR_BACK, margin, fill: LANDED_FILL, minDist: boxes[0]!.r + 1.5 })
      : (preferLift && !indoors ? this.godView(boxes, cur) : solveFrame(this.camera, cur, boxes, this.eyeAt(cur.x, cur.z), { free, maxBack: indoors ? 0 : OUTDOOR_BACK, margin })) ?? base ?? (indoors || preferLift ? null : this.approach(boxes, cur))
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
   * Gen loop 4: a learned thing's world-space box as 8 corners: its parts' bounds, scaled, turned by its yaw
   * (three's rotation.y) and moved to where it stands. Undefined for kit kinds (no parts).
   */
  private corners(e: Entity): [number, number, number][] | undefined {
    const parts = this.state?.kinds[e.kind]?.parts
    const b = parts?.length ? boundsOf(parts) : null
    if (!b) return undefined
    const s = e.props.scale ?? 1
    const sy = s * (e.props.height ?? 1)
    const c = Math.cos(e.rotY)
    const sn = Math.sin(e.rotY)
    const out: [number, number, number][] = []
    for (const x of [b.min[0], b.max[0]]) {
      for (const y of [b.min[1], b.max[1]]) {
        for (const z of [b.min[2], b.max[2]]) {
          out.push([e.pos[0] + (x * c + z * sn) * s, e.pos[1] + y * sy, e.pos[2] + (-x * sn + z * c) * s])
        }
      }
    }
    return out
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
  private standAt(x: number, z: number, from = this.groundY): number {
    const terrain = this.groundAt(x, z)
    const step = STEP_UP * Math.max(1, this.playerScale)
    const top = Math.max(terrain, from) + step
    // Gauntlet loop 1: the top of any solid thing under you (its bounding box) holds you up too: a roof you
    // flew onto, the tower you were carried to the top of, a crate you stepped up on.
    let box = Math.max(terrain, this.topAt(x, z, top))
    const pc = this.perch
    if (pc) {
      if (Math.hypot(x - pc.x, z - pc.z) <= pc.r && this.items.has(pc.id)) box = Math.max(box, pc.y)
      else if (from < pc.y - 0.5 || !this.items.has(pc.id)) this.perch = null
    }
    const targets: THREE.Object3D[] = []
    for (const item of this.items.values()) {
      const e = item.entity
      if (!WALKABLE_KIND.test(e.kind) && !e.tags.some(t => WALKABLE_TAGS.has(t))) continue
      if (Math.abs(item.holder.position.x - x) + Math.abs(item.holder.position.z - z) > 90) continue
      item.holder.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh) targets.push(o)
      })
    }
    if (!targets.length) return box
    this.downRay.set(new THREE.Vector3(x, top, z), DOWN)
    this.downRay.far = top - terrain + 0.05
    for (const h of safeHits(this.downRay, targets)) {
      if (!h.face) continue
      if (this.upN.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.6) return Math.max(box, h.point.y)
    }
    return box
  }

  /** Solid things you collide with and can stand on: not people, movers, flat or walkable kinds, terrain or floaters. */
  private solid(e: Entity): boolean {
    if (e.kind === 'person' || (e.props.motion && e.props.motion !== 'none')) return false
    const d = this.desc(e)
    if (d.footprint <= 0 || d.surface || isTerrain(d) || d.tags.includes('particles')) return false
    if (WALKABLE_KIND.test(e.kind) || e.tags.some(t => WALKABLE_TAGS.has(t))) return false
    if (this.gravityOff !== null && this.state && isLoose(this.state, e)) return false
    return true
  }

  /** The built mesh's half-extent on the ground (cached per build): a forged shell can overhang its parts' footprint. */
  private meshReach(item: Item): number {
    const u = item.body.userData as { reachKey?: string, reach?: number }
    if (u.reachKey === item.buildKey && u.reach !== undefined) return u.reach * (item.entity.props.scale ?? 1)
    // World-space box around the holder (its yaw included, so a rotated square overstates a little: safe side).
    const box = new THREE.Box3().setFromObject(item.body)
    const hp = item.holder.position
    const reach = box.isEmpty() ? 0 : Math.max(box.max.x - hp.x, hp.x - box.min.x, box.max.z - hp.z, hp.z - box.min.z) / Math.max(1e-3, item.entity.props.scale ?? 1)
    u.reachKey = item.buildKey
    u.reach = Math.min(reach, 60)
    return u.reach * (item.entity.props.scale ?? 1)
  }

  /** The highest solid bounding-box top over (x, z) no higher than `below` (−Infinity if none). */
  private topAt(x: number, z: number, below: number): number {
    let best = -Infinity
    for (const item of this.items.values()) {
      if (item.leaving || !this.solid(item.entity)) continue
      const e = item.entity
      const d = this.desc(e)
      const r = d.footprint * (e.props.scale ?? 1) * 0.85
      if (Math.abs(e.pos[0] - x) > r || Math.abs(e.pos[2] - z) > r || Math.hypot(e.pos[0] - x, e.pos[2] - z) > r) continue
      const t = e.pos[1] + kindHeight(d, e.props)
      if (t <= below && t > best) best = t
    }
    return best
  }

  /**
   * Gauntlet loop 1: you no longer walk through things. Each solid thing is a cylinder (its footprint, its
   * height); a step that would enter one slides along it instead. Things you can step onto (lower than a
   * step), things above your head and anything you're already inside (it landed on you) never block, so you
   * can't get stuck. Walls (thin slabs with no footprint) stop you with a knee-high ray.
   */
  private collide(move: THREE.Vector3): THREE.Vector3 {
    if (!this.state) return move
    const p = this.camera.position
    const feet = this.flying || this.falling ? this.flyY : this.groundY
    const step = STEP_UP * Math.max(1, this.playerScale)
    // The body plus the lens: the camera's near plane must never reach the surface it stops at.
    const me = 0.5 * this.playerScale
    const out = move.clone()
    const walls: THREE.Object3D[] = []
    const circles: Circle[] = []
    for (const item of this.items.values()) {
      if (item.leaving) continue
      const e = item.entity
      if (e.tags.includes('wall') && Math.abs(e.pos[0] - p.x) + Math.abs(e.pos[2] - p.z) < 30) {
        item.holder.traverseVisible((o) => {
          if ((o as THREE.Mesh).isMesh) walls.push(o)
        })
        continue
      }
      if (!this.solid(e)) continue
      const d = this.desc(e)
      const R = Math.max(d.footprint * (e.props.scale ?? 1) * 0.95, this.meshReach(item)) + me
      if (Math.abs(p.x - e.pos[0]) > R + 2 || Math.abs(p.z - e.pos[2]) > R + 2) continue
      const top = e.pos[1] + kindHeight(d, e.props)
      if (top <= feet + step || e.pos[1] >= feet + EYE * this.playerScale) continue
      // Tall things keep you a little further off, so you see them instead of pressing your face to them.
      circles.push({ x: e.pos[0], z: e.pos[2], r: R + (top - feet > 4 ? 0.7 : 0) })
    }
    ;[out.x, out.z] = slideOut(p.x, p.z, out.x, out.z, circles)
    const len = Math.hypot(out.x, out.z)
    if (walls.length && len > 1e-5) {
      this.wallRay.set(new THREE.Vector3(p.x, feet + 0.6, p.z), new THREE.Vector3(out.x / len, 0, out.z / len))
      this.wallRay.far = len + me + 0.1
      const hit = safeHits(this.wallRay, walls)[0]
      if (hit?.face) {
        const n = this.upN.copy(hit.face.normal).transformDirection(hit.object.matrixWorld)
        n.y = 0
        if (n.lengthSq() > 1e-6) {
          n.normalize()
          const into = out.x * n.x + out.z * n.z
          if (into < 0) {
            out.x -= into * n.x
            out.z -= into * n.z
          }
        }
      }
    }
    return out
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
  private walk(move0: THREE.Vector3): void {
    const p = this.camera.position
    if (this.lift > 0.5 || !this.state) {
      p.add(move0)
      return
    }
    const move = this.collide(move0)
    if (this.flying || this.falling) {
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
    if (kit) body = kit({ floors: e.props.floors ?? desc.defaults.floors, text: e.props.text ?? desc.defaults.text, length: e.props.length ?? desc.defaults.length, width: e.props.width ?? desc.defaults.width, color: e.props.color ?? desc.defaults.color, role: e.props.role, seed: e.id, name: e.props.name })
    else if (desc.learned && desc.parts) body = (desc.quality ?? 'draft') === 'draft' ? buildFromParts(desc.parts) : buildFromPartsMerged(desc.parts)
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
    // Where it rests is read live (item.entity.pos): a stack can settle onto its real size mid-arrival.
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
        holder.position.y = item.entity.pos[1] + 32 * (1 - ease.inOut(t))
      }, () => {
        holder.position.y = item.entity.pos[1]
      }, show)
      if (loud || cue.index === 0) this.sound.sfxWhaleSong(at - now)
    } else if (airborne) {
      const rise = Math.min(14, y0 * 0.6)
      fallDur = 1900
      holder.scale.setScalar(0.001)
      stretch.scale.y = h
      this.tween(at, fallDur, (t) => {
        holder.position.y = item.entity.pos[1] - rise * (1 - ease.out(t))
        holder.scale.setScalar(Math.max(0.001, s * Math.min(1, t * 2.5)))
      }, () => {
        holder.position.y = item.entity.pos[1]
      }, show)
      sparkleAt(at + 80, tall * 0.5 - rise)
    } else if (fall === 'drop') {
      holder.scale.setScalar(s)
      stretch.scale.y = h
      if (tier === 'big' && loud) {
        const H0 = 12 + tall * 0.9
        fallDur = 950 + Math.min(650, tall * 9)
        holder.position.y = item.entity.pos[1] + H0
        // Accelerating down (it has weight), then a short squash as it hits.
        this.tween(at, fallDur, (t) => {
          holder.position.y = item.entity.pos[1] + H0 * (1 - t * t)
        }, () => {
          holder.position.y = item.entity.pos[1]
          this.tween(performance.now(), 380, (t) => {
            const k = Math.sin(Math.PI * t) * (1 - t)
            holder.scale.set(s * (1 + 0.05 * k), s * (1 - 0.09 * k), s * (1 + 0.05 * k))
          }, () => holder.scale.setScalar(s))
          impact(performance.now())
        }, show)
      } else {
        fallDur = 850
        holder.position.y = item.entity.pos[1] + 7
        this.tween(at, 850, (t) => {
          holder.position.y = item.entity.pos[1] + 7 * (1 - ease.bounce(t))
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
      holder.position.y = item.entity.pos[1] - tall * 0.75
      this.tween(at, fallDur, (t) => {
        const k = ease.out(t)
        holder.position.y = item.entity.pos[1] - tall * 0.75 * (1 - k)
        holder.scale.y = s * (0.55 + 0.45 * k)
      }, () => {
        holder.position.y = item.entity.pos[1]
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
      return `${e.kind}|${p.floors ?? desc.defaults.floors ?? ''}|${p.length ?? ''}|${p.width ?? ''}|${p.text ?? ''}${BUILD_READS_COLOR.has(e.kind) ? `|${p.color ?? ''}` : ''}${e.kind === 'person' ? `|${p.role ?? ''}|${p.name ?? ''}` : ''}`
    }
    if (desc.learned && desc.parts) return `${e.kind}|learned|${hashParts(desc)}`
    return `${e.kind}|blob|${e.props.text ?? desc.label ?? e.kind}`
  }

  /**
   * Swap the body for a fresh build (floors changed, or a learned kind arrived). A floors change keeps the
   * old silhouette for a frame and springs into the new one; a morph pops in with a puff.
   */
  private rebuild(item: Item, e: Entity, at: number, morph: boolean, fromStretch = item.stretch.scale.y, still = false): void {
    this.settleHolder(item, e, at)
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
    if (still) {
      // Its parts already streamed in at their final size (draftPart): exchange in place, no animation.
      item.stretch.scale.y = h1
    } else if (morph) {
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

  // ---------- the forge: progressive replace ----------

  /** The instance of `kind` nearest the camera (the one the refined version grows on), or null. */
  focusOf(kind: string): string | null {
    let best: Item | null = null
    let bd = Infinity
    for (const it of this.items.values()) {
      if (it.entity.kind !== kind || it.leaving) continue
      const d = it.holder.position.distanceTo(this.camera.position)
      if (d < bd) {
        bd = d
        best = it
      }
    }
    return best?.entity.id ?? null
  }

  /**
   * Gen loop 1: one part of a kind's draft, the moment Haiku closed it (before the whole define has).
   * It grows in on each instance (up to DRAFT_STREAM_MAX), replacing the labelled stand-in, at the size
   * the define will have, so the define's landing is an exchange in place, not a morph.
   */
  draftPart(kind: string, part: Part): void {
    let d = this.drafting.get(kind)
    if (!d) {
      d = { overlays: new Map(), parts: [], k: 1 }
      this.drafting.set(kind, d)
    }
    d.parts.push(part)
    d.k = sizeK(d.parts, this.sizes.get(kind), false)
    const job = this.refining.get(kind)
    const now = performance.now()
    let n = 0
    for (const it of this.items.values()) {
      if (it.entity.kind !== kind || it.leaving) continue
      if (n++ >= DRAFT_STREAM_MAX) break
      if (job?.handed && job.focusId === it.entity.id) continue
      let g = d.overlays.get(it.entity.id)
      if (!g) {
        g = new THREE.Group()
        g.scale.setScalar(d.k)
        it.stretch.add(g)
        d.overlays.set(it.entity.id, g)
        it.body.visible = false
      }
      const m = partMesh(part)
      if (!m) continue
      this.tintPart(m, it.entity)
      g.add(m)
      this.tween(now, GROW_MS, growIn(m))
    }
  }

  /** The draft stream is over (its define landed, or never will): drop the overlays, show what's built. */
  endDraft(kind: string): void {
    const d = this.drafting.get(kind)
    if (!d) return
    this.drafting.delete(kind)
    const job = this.refining.get(kind)
    for (const [id, g] of d.overlays) {
      g.removeFromParent()
      disposeObject(g)
      const it = this.items.get(id)
      if (it && !(job?.handed && job.focusId === id)) it.body.visible = true
    }
  }

  private tintPart(m: THREE.Mesh, e: Entity): void {
    const slot = m.userData.slot as string | undefined
    const hex = slot === 'primary' && e.props.color ? e.props.color : slot === 'trim' && e.props.trim ? e.props.trim : null
    if (hex) {
      const mat = m.material as THREE.MeshStandardMaterial
      mat.color.set(hex)
      if (slot === 'glow') mat.emissive.set(hex)
    }
  }

  /**
   * A kind starts being refined: the instance nearest the camera gets an overlay the refined parts will
   * grow in. Nothing else changes on screen until real parts arrive. Returns the focused id.
   */
  beginRefine(kind: string): string | null {
    const focusId = this.focusOf(kind)
    const focus = focusId ? this.items.get(focusId) : undefined
    if (!focus) return null
    this.endRefine(kind, false)
    const overlay = new THREE.Group()
    overlay.userData.refineOverlay = true
    focus.stretch.add(overlay)
    this.refining.set(kind, { kind, focusId: focus.entity.id, overlay, queue: [], streamed: [], added: 0, handed: false, level: 1, k: 1 })
    const S = this.targetSize(kind)
    if (S) this.sizes.set(kind, S)
    return focus.entity.id
  }

  /** Gen loop 2: a new kind's target size, decided once at its spawn (both streams are held to it). */
  setTargetSize(kind: string, size: number): void {
    this.sizes.set(kind, size)
  }

  /** The target size of `kind`: the one set at its spawn, else the size of its current design. */
  targetSize(kind: string): number | undefined {
    const desc = this.state?.kinds[kind]
    return this.sizes.get(kind) ?? (desc?.parts?.length ? maxDim(desc.parts) : undefined)
  }

  /** The scale for a refine's final parts: its target size, now that the object is complete. */
  refineFinalK(kind: string, parts: Part[]): number {
    return sizeK(parts, this.targetSize(kind), true)
  }

  /** Refined parts arrived (in the kind's own coordinates, at their final size): queue them to grow in. */
  refineParts(kind: string, parts: Part[]): void {
    const job = this.refining.get(kind)
    if (!job) return
    job.queue.push(...parts)
    job.streamed.push(...parts)
  }

  /**
   * The refine is over. Accepted: the upgrade's sync already exchanged the overlay for the merged body,
   * so there is nothing left to do. Discarded: the half-grown parts shrink away and the draft fades back.
   */
  endRefine(kind: string, accepted: boolean): void {
    const job = this.refining.get(kind)
    if (!job) return
    this.refining.delete(kind)
    if (accepted && !job.overlay.parent) return
    const now = performance.now()
    const overlay = job.overlay
    const meshes = meshesOf(overlay)
    const bases = meshes.map(m => m.scale.clone())
    this.tween(now, 380, (t) => {
      meshes.forEach((m, i) => m.scale.copy(bases[i]!).multiplyScalar(Math.max(0.001, 1 - t)))
    }, () => {
      overlay.removeFromParent()
      disposeObject(overlay)
    })
    const item = this.items.get(job.focusId)
    if (job.handed && item && !item.leaving) {
      item.body.visible = true
      const fx = crossfade(item.body)
      this.playFx(fx, now, CROSSFADE_MS)
    }
  }

  /** Per frame: grow up to PARTS_PER_FRAME queued refined parts; hand over from the draft once a few are in. */
  private growRefined(now: number): void {
    // Gen loop 2: streaming objects are held to their target size: each overlay eases to its scale (the
    // first part snaps, so nothing appears big and then shrinks).
    const ease1 = Math.min(1, this.dt * 10)
    for (const d of this.drafting.values()) {
      for (const g of d.overlays.values()) g.scale.setScalar(g.scale.x + (d.k - g.scale.x) * ease1)
    }
    for (const job of this.refining.values()) {
      if (job.streamed.length) {
        const k = sizeK(job.streamed, this.sizes.get(job.kind), false)
        const s = job.added ? job.overlay.scale.x + (k - job.overlay.scale.x) * ease1 : k
        job.k = k
        job.overlay.scale.setScalar(s)
      }
      const item = this.items.get(job.focusId)
      if (!item || item.leaving) {
        job.queue.length = 0
        continue
      }
      let n = 0
      while (job.queue.length && n < PARTS_PER_FRAME) {
        const p = job.queue.shift()!
        const m = partMesh(p)
        n++
        if (!m) continue
        this.tintPart(m, item.entity)
        job.overlay.add(m)
        this.tween(now, GROW_MS, growIn(m))
        job.added++
      }
      if (!job.handed && job.added >= HANDOFF_PARTS) this.handOff(job, item, now)
    }
  }

  /** The refined version's main masses are on screen: the draft (or its stand-in) fades out once, quickly. */
  private handOff(job: RefineJob, item: Item, now: number): void {
    job.handed = true
    job.level = 0
    const body = item.body
    const draft = this.drafting.get(job.kind)?.overlays.get(item.entity.id)
    if (draft) this.drafting.get(job.kind)!.overlays.delete(item.entity.id)
    const fx = crossfade(null, draft ? [body, draft] : [body])
    this.tween(now, CROSSFADE_MS, t => fx.update(t, this.camera, this.dt), () => {
      if (this.refining.get(job.kind) === job && item.body === body) body.visible = false
      if (draft) {
        draft.removeFromParent()
        disposeObject(draft)
      }
    })
  }

  /**
   * A forged upgrade lands on one instance. On the focused instance the overlay already IS the new
   * version (the refine is no longer fitted after the fact), so it is exchanged for the identical merged
   * body in one frame. Other instances, and anything that doesn't match, cross-fade quickly.
   */
  private refineSwap(item: Item, e: Entity, at: number): void {
    this.settleHolder(item, e, at)
    const job = this.refining.get(e.kind)
    const desc = this.desc(e)
    const next = buildFromPartsMerged(desc.parts!)
    const old = item.body
    item.stretch.add(next)
    item.body = next
    item.buildKey = this.buildKeyOnly(e)
    item.entity = e
    this.applyLook(item, e, false)
    this.fresh.push(next)
    let overlay: THREE.Group | null = null
    let same = false
    if (job && job.focusId === e.id && job.overlay.parent === item.stretch) {
      overlay = job.overlay
      job.queue.length = 0
      const a = boundsOf(job.k === 1 ? job.streamed : job.streamed.map(p => transformPart(p, job.k, [0, 0, 0])))
      const b = boundsOf(desc.parts!)
      if (a && b) {
        const size = Math.max(...[0, 1, 2].map(i => b.max[i]! - b.min[i]!), 0.1)
        same = [0, 1, 2].every(i => Math.abs(a.min[i]! - b.min[i]!) < size * 0.03 && Math.abs(a.max[i]! - b.max[i]!) < size * 0.03)
      }
    }
    const drop = () => {
      old.removeFromParent()
      disposeObject(old)
      if (overlay) {
        overlay.removeFromParent()
        disposeObject(overlay)
      }
    }
    if (overlay && same && job?.handed) {
      drop()
      return
    }
    const fx = crossfade(next, overlay ? [old, overlay] : [old])
    this.tween(at, CROSSFADE_MS, t => fx.update(t, this.camera, this.dt), drop)
  }

  /**
   * A studio render of one instance (or of `body`, a candidate built for the judge, shown at that
   * instance's spot) from the front-right, as a JPEG data URL. Drawn with the main renderer into a corner
   * of the canvas just before the frame paints over it.
   */
  studioShot(id: string, body?: THREE.Group): Promise<string | null> {
    return new Promise((resolve) => {
      if (!this.items.has(id)) return resolve(null)
      if (body) this.fresh.push(body)
      this.studio.enqueue({ id, body, resolve })
    })
  }

  /** Build a candidate body from parts (merged), compiled ahead, for a judge's studio shot. */
  candidate(parts: Part[]): THREE.Group {
    return buildFromPartsMerged(parts)
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
    // The forge's cross-fades fade standard materials (transparent, no depth write): warm those variants.
    const ghostBody = buildFromParts([{ shape: 'box', size: [1, 1, 1], at: [0, 0, 0], color: '#ffffff' }, { shape: 'sphere', size: [1, 1, 1], at: [0, 0, 0], color: '#ffffff', slot: 'glow' }])
    ghost(ghostBody, 0.5)
    return [...fx.map(f => f.obj), dust, blob({ text: 'warm' }), contactShadow(1), ghostBody]
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
    const a = customizeSky(this.weather.grade(base), this.state?.atmosphere)
    this.atmos = a
    this.skyUniforms.top.value.set(a.skyTop)
    this.skyUniforms.horizon.value.set(a.skyHorizon)
    this.skyUniforms.fogColor.value.set(a.fog)
    const sd = skyDir(a.sunPos)
    this.skyUniforms.sunDir.value.copy(sd)
    this.skyUniforms.sunColor.value.set(a.sun)
    this.skyUniforms.sunDisc.value = a.sunDisc * Math.min(1, Math.max(0, (sd.y + 0.02) * 12))
    this.skyUniforms.sunGlow.value = a.sunGlow
    this.skyUniforms.glowColor.value.set(a.glowColor)
    this.skyUniforms.cloudLit.value.set(a.cloudLit)
    this.skyUniforms.cloudShade.value.set(a.cloudShade)
    this.skyUniforms.cloudCover.value = a.cloudCover
    STYLE_UNIFORMS.uCjToon.value = a.toon
    STYLE_UNIFORMS.uCjRim.value = a.rim
    STYLE_UNIFORMS.uCjRimColor.value.set(a.skyHorizon)
    STYLE_UNIFORMS.uCjFogWarm.value.set(a.fogWarm)
    STYLE_UNIFORMS.uCjFogHeight.value = a.fogHeight
    GROUND_UNIFORMS.uGroundAlt.value.set(a.groundAlt)
    GROUND_UNIFORMS.uGroundPatch.value = a.groundPatch
    this.grass.setColor(a.ground)
    // Grass on meadows only: not indoors, not on snow (the weather whitens the ground).
    const gc = new THREE.Color(a.ground)
    this.grass.setWanted(this.state?.atmosphere.time !== 'interior' && this.weather.snowCover() < 0.15 && gc.g >= gc.r * 0.9)
    this.post.setGrade({ shadow: a.gradeShadow, highlight: a.gradeHighlight, sat: a.gradeSat })
    const fog = this.scene.fog as THREE.Fog
    fog.color.set(a.fog)
    this.applyFogDistances()
    this.stars.visible = a.stars > 0.01
    this.moon.visible = a.moon > 0.01
    this.moon.position.copy(skyDir(a.sunPos).multiplyScalar(420))
    this.placeMoons(a)
    // The sun's disc and horizon band are painted by the sky shader now; the old halo sprite stays dark.
    this.sunGlow.visible = false
    this.sunGlow.material.color.set(a.glowColor)
    this.sunGlow.position.copy(skyDir([a.sunPos[0], Math.max(4, a.sunPos[1] * 0.6), a.sunPos[2]]).multiplyScalar(430))
    this.scene.background = new THREE.Color(a.fog)
    this.sun.color.set(a.sun)
    this.sun.intensity = a.sunIntensity
    this.hemi.color.set(a.hemiSky)
    this.hemi.groundColor.set(a.hemiGround)
    this.hemi.intensity = a.hemiIntensity
    ;(this.ground.material as THREE.MeshStandardMaterial).color.set(a.ground)
    // The grid is only the faint "dream canvas" of the empty first-run world (faded in frame()).
    this.gridUniforms.opacity.value = a.grid * this.gridShown
    this.grid.visible = a.grid * this.gridShown > 0.005
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
    this.sunGlow.material.opacity = 0
  }

  // ---------- people (NPC): what the People runtime needs from the scene ----------

  /** Every person's item (entity, holder, stretch, body), for the People runtime to walk and pose. */
  * people(): Generator<{ entity: Entity, holder: THREE.Group, stretch: THREE.Group, body: THREE.Group, leaving: boolean }> {
    for (const item of this.items.values()) if (item.body.userData.person) yield item
  }

  /**
   * Where a person's feet go at (x, z): the terrain, or the deck of something walkable under them (a dock,
   * a floor) within a step of `footY`. The same down-ray the camera rides on, from the feet, not the eye.
   */
  feetAt(x: number, z: number, footY: number): number {
    const terrain = this.groundAt(x, z)
    const top = Math.max(terrain, footY) + STEP_UP
    let best = terrain
    for (const item of this.items.values()) {
      const e = item.entity
      if (!WALKABLE_KIND.test(e.kind) && !e.tags.some(t => WALKABLE_TAGS.has(t))) continue
      if (Math.abs(item.holder.position.x - x) + Math.abs(item.holder.position.z - z) > 90) continue
      const targets: THREE.Object3D[] = []
      item.holder.traverseVisible((o) => {
        if ((o as THREE.Mesh).isMesh) targets.push(o)
      })
      this.downRay.set(new THREE.Vector3(x, top, z), DOWN)
      this.downRay.far = top - terrain + 0.05
      for (const h of safeHits(this.downRay, targets)) {
        if (h.face && this.upN.copy(h.face.normal).transformDirection(h.object.matrixWorld).y > 0.6) {
          best = Math.max(best, h.point.y)
          break
        }
      }
    }
    return best
  }

  /** Terrain height at (x, z) (public for the People runtime). */
  terrainAt(x: number, z: number): number {
    return this.groundAt(x, z)
  }

  /** A world point → CSS pixels on the canvas, and whether it's in front of the camera and on screen. */
  toScreen(p: Vec3): { x: number, y: number, visible: boolean } {
    const v = new THREE.Vector3(p[0], p[1], p[2]).project(this.camera)
    const el = this.renderer.domElement
    const w = el.clientWidth
    const h = el.clientHeight
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 }
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
    this.trackView(now, dt)
    if (!this.rideAir(dt, now)) {
      // Ride the terrain: ease toward the ground under you (quick up a rise, a touch slower dropping off it).
      const gy = this.standAt(this.camera.position.x, this.camera.position.z)
      this.groundY += (gy - this.groundY) * (1 - Math.exp(-dt * (gy > this.groundY ? 12 : 7)))
      if (Math.abs(gy - this.groundY) > 60) this.groundY = gy // a teleport or a mountain rising under you: no long glide
      this.camera.position.y = this.groundY + EYE * this.playerScale + this.lift
    }

    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const r = new THREE.Vector3(-f.z, 0, f.x)
    // Walking speed scales with the eye lift: a giant strides.
    const sp = (this.keys.shift ? RUN : WALK) * dt * (1 + this.lift / 12) * Math.max(0.2, Math.sqrt(this.playerScale)) * (this.flying ? 1.6 : 1)
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
    this.gazeNow = g
    const hovered = g.info.kind === 'entity' && g.entity ? this.items.get(g.entity) : undefined
    this.highlight.visible = !!hovered
    this.reticle.visible = !hovered
    if (hovered) {
      const rr = Math.max(0.5, this.desc(hovered.entity).footprint * (hovered.entity.props.scale ?? 1) + 0.25)
      // Where it really is now (a walking person, a wandering horse), not where it was spawned.
      const wp = hovered.stretch.getWorldPosition(this.tmpV)
      this.highlight.position.set(wp.x, (hovered.body.userData.person ? wp.y : 0) + 0.04, wp.z)
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
    this.onFrame?.(dt, now)

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
    this.refineMotes.tick(dt)
    this.growRefined(now)
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
    STYLE_UNIFORMS.uCjTime.value = now / 1000
    this.grass.tick(dt, this.camera.position)
    if (now - this.grassMaskAt > 400) {
      this.grassMaskAt = now
      this.grass.setMasks(nearMasks(this.grassMasks, this.camera.position.x, this.camera.position.z))
    }
    this.skyUniforms.time.value = now / 1000
    const gridTo = this.items.size === 0 ? 1 : 0
    if (gridTo !== this.gridShown) {
      this.gridShown = Math.max(0, Math.min(1, this.gridShown + (gridTo - this.gridShown > 0 ? dt * 0.8 : -dt * 3)))
      this.gridUniforms.opacity.value = this.atmos.grid * this.gridShown
      this.grid.visible = this.atmos.grid * this.gridShown > 0.005
    }
    // One studio shot per frame (the forge's render of a draft), drawn just before the frame paints over it.
    const shot = this.studio.next()
    if (shot) this.studio.shoot(shot, this.items.get(shot.id), { renderer: this.renderer, scene: this.scene, camera: this.camera, hemi: this.hemi, sun: this.sun, post: this.post })
    this.post.render(this.renderer, this.scene, this.camera, dt * 1000, now)
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
    if (this.gravityOn !== null && now - this.gravityOn > 9000) this.gravityOff = this.gravityOn = null
    for (const item of this.items.values()) {
      const e = item.entity
      // People (NPC) are walked and posed by the People runtime (onFrame), not by motion props.
      if (item.body.userData.person) continue
      const m = e.props.motion
      // Creatures (Loop 3) are posed every frame, moving or not: wings, legs, tail and head follow the drive.
      const drive = item.body.userData.drive as ((d: Drive) => void) | undefined
      const style = item.body.userData.motionStyle as MotionStyle | undefined
      const h = kindHeight(this.desc(e), e.props)
      let t = now / 1000
      let pose: Pose | null = null
      if (m === 'follow') {
        this.motionStart.delete(e.id)
        pose = this.followPose(e)
      } else if (m) {
        // The clock restarts when the motion (or where it is) changes, so a modify blends in from where it stands.
        const key = `${m}|${e.props.speed ?? 1}|${e.path?.c.join(',') ?? ''}|${e.path?.r ?? ''}|${e.pos.join(',')}`
        let clock = this.motionStart.get(e.id)
        if (!clock || clock.key !== key) {
          clock = { key, t0: now }
          this.motionStart.set(e.id, clock)
        }
        t = (now - clock.t0) / 1000
        pose = blendedPose(e, t, h, style)
      } else {
        this.motionStart.delete(e.id)
        this.follow.delete(e.id)
      }
      pose = this.physicsPose(item, pose, h, now)
      if (pose) {
        applyPose(item, pose)
        this.posed.add(e.id)
      } else if (this.posed.delete(e.id)) {
        applyPose(item, null)
      }
      if (drive) this.driveCreature(item, drive, t, style)
    }
  }

  // ---------- Gauntlet loop 1 (track B): physics-lite, followers, flight, goto, tracking, moons ----------

  /** What a sync means for the player and the physics clocks: gravity, flight, a goto glide, a camera track. */
  private syncPlayer(state: WorldState, prev: WorldState | null, fx: Effects | undefined, now: number): void {
    const at = state.atmosphere
    if (at.gravity === false && (this.gravityOff === null || this.gravityOn !== null)) {
      this.gravityOff = prev ? now : now - 60_000
      this.gravityOn = null
    } else if (at.gravity !== false && this.gravityOff !== null && this.gravityOn === null) {
      this.gravityOn = now
    }
    const live = !!prev && Math.abs(state.log.length - prev.log.length) <= 1
    if (live) for (const id of [...(fx?.spawned ?? []), ...(fx?.modified ?? [])]) this.live.add(id)
    const ids = new Set(state.entities.map(e => e.id))
    for (const id of this.phys.keys()) if (!ids.has(id)) this.phys.delete(id)
    for (const id of this.follow.keys()) if (!ids.has(id)) this.follow.delete(id)
    // Flight: a hop up into the air (the drag in rideAir settles it ~4 m up); landing falls with gravity.
    if (at.fly && !this.flying) {
      this.flying = true
      this.falling = false
      this.flyY = this.groundY
      this.flyVel = prev ? 10 : 0
    } else if (!at.fly && this.flying) {
      this.flying = false
      this.falling = this.flyY > this.groundY + 0.2
      this.flyVel = 0
    }
    this.weather.intensity = at.intensity ?? 0.5
    if (at.moons !== prev?.atmosphere.moons) this.moonYaw = this.yaw
    if (fx?.goto && prev) {
      const cp = this.camera.position
      const feet = this.flying || this.falling ? this.flyY : this.groundY
      const to = new THREE.Vector3(...fx.goto.to)
      const [lx, ly, lz] = fx.goto.look
      const it = this.items.get(fx.goto.id)
      let perchR = 1.2
      if (it && fx.goto.to[1] > 0.5) {
        // The thing as built (a parapet or roof box a little above its nominal height), and a step toward its
        // far edge so the view drops away over the world instead of looking at the roof.
        const box = new THREE.Box3().setFromObject(it.holder)
        if (box.max.y > to.y && box.max.y - to.y < 4) to.y = box.max.y
        const r = this.desc(it.entity).footprint * (it.entity.props.scale ?? 1)
        const ox = lx - to.x
        const oz = lz - to.z
        const ol = Math.hypot(ox, oz) || 1
        to.x += (ox / ol) * r * 0.45
        to.z += (oz / ol) * r * 0.45
        perchR = Math.max(1.2, r * 0.9)
      }
      this.perch = fx.goto.to[1] > 0.5 ? { x: to.x, z: to.z, r: perchR, y: to.y, id: fx.goto.id } : null
      const eye = to.y + EYE * this.playerScale
      const yaw1 = Math.atan2(-(lx - to.x), -(lz - to.z))
      const pitch1 = Math.max(-0.9, Math.min(0.3, Math.atan2(ly - eye, Math.max(1, Math.hypot(lx - to.x, lz - to.z)))))
      const dist = Math.hypot(to.x - cp.x, to.z - cp.z) + Math.abs(to.y - feet)
      this.camMove = null
      this.lift = 0
      this.falling = false
      this.glide = { from: new THREE.Vector3(cp.x, feet, cp.z), to, start: now, dur: Math.min(4200, 1400 + dist * 30), yaw0: this.yaw, yaw1: this.yaw + wrapAngle(yaw1 - this.yaw), pitch0: this.pitch, pitch1 }
    }
    // Something that arrives moving (a thrown ball, a dragon taking off) is followed for a few seconds.
    if (live && fx?.spawned.length && !fx.teleport) {
      const movers = fx.spawned.map(id => state.entities.find(e => e.id === id)).filter((e): e is Entity => !!e && (e.launch?.kind === 'throw'
        || ((e.props.motion === 'fly' || e.props.motion === 'orbit') && kindHeight(this.desc(e), e.props) >= 2)))
      if (movers.length && movers.length <= 3) this.track = { ids: movers.map(e => e.id), start: now + 500, until: now + 5500 }
    }
  }

  /** The camera eases its aim onto tracked movers (never while you look or walk yourself). */
  private trackView(now: number, dt: number): void {
    const tr = this.track
    if (!tr) return
    if (now > tr.until || this.glide || this.userActive()) {
      this.track = null
      return
    }
    if (now < tr.start) return
    // The mover outranks a framing glide (a sky tilt would otherwise run out the clock looking at empty sky).
    this.camMove = null
    let x = 0
    let y = 0
    let z = 0
    let n = 0
    for (const id of tr.ids) {
      const it = this.items.get(id)
      if (!it) continue
      const wp = it.stretch.getWorldPosition(this.tmpV)
      x += wp.x
      y += wp.y + kindHeight(this.desc(it.entity), it.entity.props) * 0.5
      z += wp.z
      n++
    }
    if (!n) {
      this.track = null
      return
    }
    const c = this.camera.position
    const dx = x / n - c.x
    const dz = z / n - c.z
    const yawTo = Math.atan2(-dx, -dz)
    const pitchTo = Math.max(-1.0, Math.min(0.7, Math.atan2(y / n - c.y, Math.max(1, Math.hypot(dx, dz)))))
    const k = 1 - Math.exp(-dt * 3.4)
    this.yaw += wrapAngle(yawTo - this.yaw) * k
    this.pitch += (pitchTo - this.pitch) * k
  }

  /**
   * Flight, landing and the goto glide: true when it set the camera height itself this frame. Flying: Space
   * (or PageUp) rises, Shift+Space (or PageDown) sinks, and walking while looking up or down climbs or dives;
   * a drag settles you. Landing falls with gravity onto whatever is under you (a roof, the ground).
   */
  private rideAir(dt: number, now: number): boolean {
    const cp = this.camera.position
    const eye = EYE * this.playerScale
    const g = this.glide
    if (g) {
      const t = Math.min(1, (now - g.start) / g.dur)
      const k = ease.inOut(t)
      cp.x = g.from.x + (g.to.x - g.from.x) * k
      cp.z = g.from.z + (g.to.z - g.from.z) * k
      const arc = Math.sin(Math.PI * k) * Math.min(14, 2 + Math.hypot(g.to.x - g.from.x, g.to.z - g.from.z) * 0.15)
      const feet = g.from.y + (g.to.y - g.from.y) * k + arc
      if (!this.userActive()) {
        this.yaw = g.yaw0 + (g.yaw1 - g.yaw0) * k
        this.pitch = g.pitch0 + (g.pitch1 - g.pitch0) * k
      }
      cp.y = feet + eye + this.lift
      this.groundY = feet
      if (this.flying) this.flyY = feet
      if (t >= 1) this.glide = null
      return true
    }
    if (!this.flying && !this.falling) return false
    const floor = this.standAt(cp.x, cp.z, this.flyY)
    if (this.flying) {
      const k = this.keys
      const up = (k[' '] && !k.shift) || k.pageup
      const down = (k[' '] && k.shift) || k.pagedown
      if (up) this.flyVel = Math.min(9, this.flyVel + 22 * dt)
      if (down) this.flyVel = Math.max(-9, this.flyVel - 22 * dt)
      this.flyVel *= Math.exp(-dt * (up || down ? 0.6 : 2.6))
      // Walking while looking up or down climbs or dives (a dead zone keeps level flight level).
      const fwd = (k.w || k.arrowup ? 1 : 0) - (k.s || k.arrowdown ? 1 : 0)
      const tilt = Math.abs(this.pitch) > 0.22 ? Math.sin(this.pitch) : 0
      this.flyY += fwd * tilt * (k.shift ? RUN : WALK) * 1.6 * dt
    } else {
      this.flyVel -= GRAVITY * dt
    }
    this.flyY = Math.min(400, this.flyY + this.flyVel * dt)
    if (this.flyY <= floor) {
      this.flyY = floor
      this.flyVel = Math.max(0, this.flyVel)
      if (this.falling) {
        this.falling = false
        this.groundY = floor
        this.addShake(4, new THREE.Vector3(cp.x, floor, cp.z), now, 260)
      }
    }
    if (!this.flying && !this.falling) return false
    this.groundY = floor
    cp.y = this.flyY + eye + this.lift
    return true
  }

  /** A follower's spot this frame ("a dog that follows me"): a few metres ahead and to one side of you. */
  private followPose(e: Entity): Pose {
    const cam = this.camera.position
    const f = this.follow.get(e.id) ?? { x: e.pos[0], z: e.pos[2], yaw: e.rotY, speed: 0, stride: 0 }
    const size = this.desc(e).footprint * (e.props.scale ?? 1)
    const next = followStep(f, e.id, { x: cam.x, z: cam.z, yaw: this.yaw }, this.dt, size)
    const sp = Math.hypot(next.x - f.x, next.z - f.z) / Math.max(1e-3, this.dt)
    const speed = f.speed + (Math.min(20, sp) - f.speed) * Math.min(1, this.dt * 6)
    this.follow.set(e.id, { ...next, speed, stride: f.stride + (speed * this.dt) / Math.max(0.5, size * 1.8) })
    return { x: next.x, y: this.groundAt(next.x, next.z), z: next.z, yaw: next.yaw, roll: 0, pitch: 0 }
  }

  /** Flight (drop, throw), tip (flip, topple) and no-gravity on top of the motion pose. Null = at rest. */
  private physicsPose(item: Item, base: Pose | null, h: number, now: number): Pose | null {
    const e = item.entity
    let c = this.phys.get(e.id)
    if (!c) {
      c = { key: '', t0: now, hits: 0, tipFrom: e.props.tip ?? 0, tipTo: e.props.tip ?? 0, tipAt: -1e9, seen: now }
      this.phys.set(e.id, c)
    }
    let pose = base
    const rest = (): Pose => pose ?? { x: e.pos[0], y: e.pos[1], z: e.pos[2], yaw: e.rotY, roll: 0, pitch: 0 }
    if (e.launch) {
      const key = `${e.launch.from.join(',')}|${e.pos.join(',')}`
      if (c.key !== key) {
        c.key = key
        c.hits = 0
        // Only a live wish plays its flight; a page load or a replay shows it already landed.
        c.t0 = this.live.has(e.id) ? now : now - 1e7
      }
      const t = (now - c.t0) / 1000
      const fp = flightPose(e, t)
      if (fp) {
        pose = { ...fp, x: fp.x, y: fp.y, z: fp.z }
        const times = flightTimes(e)!
        const marks = [times.land, ...times.bounce]
        while (c.hits < marks.length && t >= marks[c.hits]!) this.impact(e, h, c.hits++)
      }
    }
    this.live.delete(e.id)
    const tip = e.props.tip ?? 0
    if (tip !== c.tipTo) {
      const k = Math.min(1, (now - c.tipAt) / (TIP_SECONDS * 1000))
      c.tipFrom = c.tipFrom + (c.tipTo - c.tipFrom) * k
      c.tipTo = tip
      c.tipAt = now
    }
    if (c.tipTo !== 0 || now - c.tipAt < TIP_SECONDS * 1000) {
      const w = this.desc(e).footprint * (e.props.scale ?? 1) * 0.8
      const tp = tipPose(c.tipFrom, c.tipTo, (now - c.tipAt) / 1000, w, h)
      const r = rest()
      pose = { ...r, roll: r.roll + tp.roll, y: r.y + tp.lift }
    }
    if (this.gravityOff !== null && this.state && isLoose(this.state, e)) {
      const off = (now - Math.max(this.gravityOff, c.seen)) / 1000
      const w = weightlessPose(e.id, h, off, this.gravityOn !== null ? (now - this.gravityOn) / 1000 : undefined)
      if (w) {
        const r = rest()
        pose = { ...r, y: r.y + w.dy, yaw: r.yaw + w.yaw, roll: r.roll + w.roll, pitch: r.pitch + w.pitch }
      }
    }
    return pose
  }

  /** A landing: dust, a thump, and a shake for heavy things (a piano from the sky). Bounces are smaller. */
  private impact(e: Entity, h: number, i: number): void {
    const d = this.desc(e)
    const size = Math.max(h, d.footprint * 2 * (e.props.scale ?? 1))
    const at = new THREE.Vector3(e.pos[0], e.pos[1], e.pos[2])
    const now = performance.now()
    if (i === 0) {
      this.puff(at, Math.max(0.5, size * 0.55), size > 2 ? 0.34 : 0.22, size > 2 ? 46 : 18)
      this.sound.sfxThump(Math.min(3, size), 0)
      if (size > 1.2) this.addShake(Math.max(6, size * 4), at, now, 420)
    } else if (size > 0.8) {
      this.puff(at, Math.max(0.4, size * 0.3), 0.18, 10)
    }
  }

  /**
   * Gauntlet loop 1: a small thing that landed far off ("a picnic blanket", 13 m out where the gaze hit the
   * ground) is a speck. Step toward it until it reads (about 4 m plus its size away), never through a wall.
   */
  private approach(boxes: FrameBox[], cur: View): View | null {
    if (boxes.length > 4) return null
    let cx = 0
    let cz = 0
    let size = 0
    for (const b of boxes) {
      cx += b.x / boxes.length
      cz += b.z / boxes.length
      size = Math.max(size, b.r * 2, b.h)
    }
    if (size > 4) return null
    const d = Math.hypot(cx - cur.x, cz - cur.z)
    const want = 3.2 + size * 1.2
    if (d < want + 6) return null
    const dx = (cx - cur.x) / d
    const dz = (cz - cur.z) / d
    const step = Math.min(d - want, this.freeDist(cur.x, cur.z, dx, dz, d) - 1)
    if (step < 2) return null
    const x = cur.x + dx * step
    const z = cur.z + dz * step
    const yaw = Math.atan2(-(cx - x), -(cz - z))
    const pitch = Math.max(-0.75, -Math.atan2(EYE * this.playerScale, Math.max(1, want)) * 0.8)
    return { yaw: cur.yaw + wrapAngle(yaw - cur.yaw), pitch, x, z, lift: cur.lift }
  }

  /** The kernel moved it while its kind was being (re)built (a stack settling onto the real size): glide there. */
  private settleHolder(item: Item, e: Entity, at: number): void {
    if (!item.entity.pos.some((v, i) => Math.abs(v - e.pos[i]!) > 1e-3)) return
    const p0 = item.holder.position.clone()
    const p1 = new THREE.Vector3(...e.pos)
    this.tween(at, 380, t => item.holder.position.lerpVectors(p0, p1, t * t))
  }

  /** Extra moons ("give it two moons"), spread apart from the first, smaller and warmer. */
  private placeMoons(a: AtmospherePreset): void {
    const n = Math.max(1, Math.min(3, this.state?.atmosphere.moons ?? 1))
    let base = skyDir(a.sunPos)
    if (this.state?.atmosphere.moons !== undefined) {
      // Asked-for moons rise where you were looking when you asked, a little off centre and well up.
      const el = 0.24
      const az = this.moonYaw + 0.28
      base = new THREE.Vector3(-Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
      this.moon.position.copy(base).multiplyScalar(420)
    }
    for (let i = 1; i < 3; i++) {
      let m = this.extraMoons[i - 1]
      if (i >= n) {
        if (m) m.visible = false
        continue
      }
      if (!m) {
        m = this.moon.clone()
        m.material = this.moon.material.clone()
        this.sky.add(m)
        this.extraMoons[i - 1] = m
      }
      const s = moonSpot(i, base)
      m.position.copy(s.dir.multiplyScalar(420))
      m.scale.copy(this.moon.scale).multiplyScalar(s.scale)
      m.material.color.set(s.tint)
      m.material.opacity = a.moon
      m.visible = a.moon > 0.01
    }
  }

  private driveCreature(item: Item, drive: (d: Drive) => void, t: number, style?: MotionStyle): void {
    const e = item.entity
    const c = this.camera.position
    const d = driveOf(e, t, kindHeight(this.desc(e), e.props), style, [c.x, c.y, c.z], this.groundAt(e.pos[0], e.pos[2]))
    // A follower's legs go at the pace it trots (its pose comes from followPose, not a motion path).
    const f = e.props.motion === 'follow' ? this.follow.get(e.id) : undefined
    if (f) {
      d.speed = f.speed
      d.stride = f.stride
      d.step = Math.min(1, f.speed / 2)
    }
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
      if ('wasd'.includes(key) || key.startsWith('arrow') || (this.flying && (key === ' ' || key.startsWith('page')))) this.takeControl()
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
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2())
    this.post.setSize(db.x, db.y)
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
    this.post.dispose()
    this.grass.dispose()
    this.studio.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
