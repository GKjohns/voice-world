/**
 * The three.js side of the world. It owns no world data: `sync(state, effects)` reconciles objects from
 * a WorldState, and effects say what to animate (staggered arrivals, springs, colour wipes, shrink-outs).
 * It also owns the first-person camera, the gaze ray and the reticle/ghost rings.
 */
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
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

const EYE = 1.6
const WALK = 6
const RUN = 14
const MAX_LIGHTS = 10
const REVEAL_TIGHT = 4.5 // fog radius (m) around the player while a place is being summoned

interface Item {
  entity: Entity
  holder: THREE.Group // position, yaw, uniform scale
  stretch: THREE.Group // vertical stretch (props.height)
  body: THREE.Group // what the builder made
  buildKey: string
  leaving: boolean
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
  private reveal: { cur: number, target: number, readyAt: number, ending: boolean, center: THREE.Vector3, bumpedAt: number } | null = null
  private veil = 0
  private patch: THREE.Mesh
  private stars: THREE.Points
  private moon: THREE.Sprite
  private sunGlow: THREE.Sprite
  readonly sound = new Ambience()
  private cleanup: (() => void)[] = []

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
    // A teleport fogs the old place out first; what was there shrinks away behind the fog.
    if (fx?.teleport) this.beginReveal(now)
    const removeAt = fx?.teleport ? now + 520 : now

    // Removals first (shrink out), including anything the effects missed.
    const removed = new Set(fx?.removed ?? [])
    for (const id of this.items.keys()) if (!wanted.has(id)) removed.add(id)
    for (const id of removed) {
      const item = this.items.get(id)
      if (!item) continue
      this.items.delete(id)
      this.removeItem(item, removeAt)
    }

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
    spawned.forEach((id, i) => {
      const e = wanted.get(id)!
      const stale = this.items.get(id)
      if (stale) {
        this.items.delete(id)
        this.removeItem(stale, now)
      }
      if (this.reveal) {
        const d = distOf(id)
        const at = Math.max(now, this.reveal.readyAt) + Math.min(900, d * 22) + Math.min(i * 18, 400)
        this.spawnItem(e, at)
        // Big flat things (a lake, a floor) only pull the fog back a little; the rest unveils as it lands.
        this.revealTo(d + Math.min(entityReach(this.desc(e), e), 10) + 6)
      } else {
        this.spawnItem(e, now + i * stepMs)
      }
    })

    // Modifies: colour wipes ripple across the set; height/scale spring; floors rebuild.
    const modified = new Set(fx?.modified ?? [])
    for (const e of state.entities) {
      const item = this.items.get(e.id)
      if (item && item.entity !== e && !spawned.includes(e.id)) modified.add(e.id)
    }
    const mods = [...modified].map(id => this.items.get(id)).filter((x): x is Item => !!x && wanted.has(x.entity.id))
    const origin = this.camera.position
    mods.sort((a, b) => a.holder.position.distanceTo(origin) - b.holder.position.distanceTo(origin))
    mods.forEach((item, i) => this.modifyItem(item, wanted.get(item.entity.id)!, now + Math.min(i * 40, 900)))

    if (!prev || fx?.atmosphere || prev.atmosphere !== state.atmosphere) this.setAtmosphere(state, prev ? 900 : 0)
    this.sound.set(state.atmosphere.ambient)
    this.budgetLights()
  }

  // ---------- teleport reveal ----------

  /** Fog in to a few metres around the player and show the floor patch under their feet. */
  beginReveal(now = performance.now()): void {
    const far = (this.scene.fog as THREE.Fog).far
    this.reveal = { cur: this.reveal?.cur ?? far, target: REVEAL_TIGHT, readyAt: now + 650, ending: false, center: this.camera.position.clone(), bumpedAt: now }
    this.patch.position.set(this.camera.position.x, 0.02, this.camera.position.z)
    this.patch.visible = true
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

  private spawnItem(e: Entity, at: number): void {
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
    this.arrive(item, this.desc(e).fall, at)
  }

  private arrive(item: Item, fall: Fall, at: number): void {
    const { holder, stretch } = item
    const s = item.entity.props.scale ?? 1
    const h = item.entity.props.height ?? 1
    const y0 = item.entity.pos[1]
    const show = () => {
      holder.visible = true
    }
    if (fall === 'drop') {
      holder.scale.setScalar(s)
      stretch.scale.y = h
      holder.position.y = y0 + 7
      this.tween(at, 850, (t) => {
        holder.position.y = y0 + 7 * (1 - ease.bounce(t))
      }, () => this.puff(holder.position, this.desc(item.entity).footprint * s), show)
    } else if (fall === 'grow') {
      holder.scale.setScalar(0.001)
      stretch.scale.y = h
      this.tween(at, 620, (t) => {
        holder.scale.setScalar(Math.max(0.001, s * ease.back(t)))
      }, undefined, show)
    } else if (fall === 'rise') {
      holder.scale.set(s, 0.001, s)
      stretch.scale.y = h
      this.tween(at, 700, (t) => {
        holder.scale.y = Math.max(0.001, s * ease.out(t))
      }, undefined, show)
    } else {
      // flicker: the fixture rises, then its glow stutters on like a sodium lamp warming up.
      holder.scale.set(s, 0.001, s)
      stretch.scale.y = h
      const glows = slotMeshes(item.body, 'glow')
      const lights: THREE.Light[] = []
      item.body.traverse(o => (o as THREE.Light).isLight && lights.push(o as THREE.Light))
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
    }
  }

  private modifyItem(item: Item, e: Entity, at: number): void {
    const before = item.entity
    const s0 = item.holder.scale.x
    const s1 = e.props.scale ?? 1
    const h0 = item.stretch.scale.y
    const h1 = e.props.height ?? 1
    const rebuilt = this.buildKeyOnly(e) !== item.buildKey
    if (rebuilt) this.rebuild(item, e, at, false, h0)
    item.entity = e

    if (Math.abs(s1 - s0) > 1e-4 || (!rebuilt && Math.abs(h1 - h0) > 1e-4)) {
      this.tween(at, 750, (t) => {
        const k = ease.spring(t)
        if (!rebuilt) item.stretch.scale.y = h0 + (h1 - h0) * k
        item.holder.scale.setScalar(s0 + (s1 - s0) * k)
      })
    }

    if (before.pos.some((v, i) => Math.abs(v - e.pos[i]!) > 1e-4) || Math.abs(before.rotY - e.rotY) > 1e-4) {
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
    this.applyLook(item, e, true, at)
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

  private applyLook(item: Item, e: Entity, animate: boolean, at = performance.now()): void {
    applyMaterialProps(item.body, e.props)
    const targets = lookTargets(item.body, e.props, e.hue)
    const setColor = (m: THREE.Mesh, c: THREE.Color) => {
      const mat = m.material as THREE.MeshStandardMaterial
      mat.color.copy(c)
      if (m.userData.slot === 'glow') mat.emissive.copy(c)
      else if (m.userData.emissiveFollows !== undefined && mat.emissive) mat.emissive.copy(c).multiplyScalar(m.userData.emissiveFollows as number)
    }
    if (!animate) {
      for (const { mesh, color } of targets) setColor(mesh, color)
      return
    }
    const from = targets.map(t => (t.mesh.material as THREE.MeshStandardMaterial).color.clone())
    if (targets.every((t, i) => from[i]!.equals(t.color))) return
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
    })
  }

  private removeItem(item: Item, now: number): void {
    item.leaving = true
    this.leaving.add(item)
    const s = item.holder.scale.clone()
    this.tween(now, 360, (t) => {
      const k = Math.max(0.001, 1 - ease.out(t))
      item.holder.scale.set(s.x * k, s.y * k, s.z * k)
    }, () => {
      this.scene.remove(item.holder)
      disposeObject(item.holder)
      this.leaving.delete(item)
    })
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
      this.fogFactor = factorTo
      this.applyAtmosphere(target)
      return
    }
    const from = { ...this.atmos }
    const factorFrom = this.fogFactor
    this.tween(performance.now(), dur, (t) => {
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
    this.yaw = yaw
    this.pitch = pitch
    if (pos) this.camera.position.set(pos[0], EYE, pos[1])
  }

  // ---------- loop ----------

  private frame(now: number): void {
    const dt = Math.min(0.05, (now - this.prev) / 1000)
    this.prev = now
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

    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw))
    const r = new THREE.Vector3(-f.z, 0, f.x)
    const sp = (this.keys.shift ? RUN : WALK) * dt
    const k = this.keys
    if (k.w || k.arrowup) this.camera.position.addScaledVector(f, sp)
    if (k.s || k.arrowdown) this.camera.position.addScaledVector(f, -sp)
    if (k.a || k.arrowleft) this.camera.position.addScaledVector(r, -sp)
    if (k.d || k.arrowright) this.camera.position.addScaledVector(r, sp)
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ')

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
  private puff(at: THREE.Vector3, radius: number): void {
    const n = 46
    const pos = new Float32Array(n * 3)
    const vel: [number, number, number][] = []
    const spread = 1.5 + radius * 0.8
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const sp = spread * (0.7 + Math.random() * 0.6)
      vel.push([Math.cos(a) * sp, 0.3 + Math.random() * 0.9, Math.sin(a) * sp])
      pos.set([at.x + Math.cos(a) * radius * 0.6, 0.15, at.z + Math.sin(a) * radius * 0.6], i * 3)
    }
    const start = pos.slice()
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    const matl = new THREE.PointsMaterial({ color: 0xd8d0c0, size: 0.3, transparent: true, opacity: 0.7, depthWrite: false, alphaMap: radialTexture() })
    const pts = new THREE.Points(geo, matl)
    this.scene.add(pts)
    this.tween(performance.now(), 850, (t) => {
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
      this.keys[e.key.toLowerCase()] = true
    })
    on(window, 'keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false
    })
    on(window, 'blur', () => {
      this.keys = {}
    })
  }

  private turn(dx: number, dy: number): void {
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
