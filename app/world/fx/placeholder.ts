/**
 * "Something is being made": while a wish is still being designed (a `define` streaming, or the answer
 * taking > 700 ms), a swirling silhouette of warm motes stands where you looked. It slowly grows the longer
 * it takes, and when the thing arrives the motes collapse into it and flash out.
 */
import * as THREE from 'three'
import { additivePoints } from './common'

const N = 260

export class Placeholder {
  readonly obj = new THREE.Group()
  private motes = additivePoints(N, 0xffe2a8, 0.16)
  private core = additivePoints(40, 0xffffff, 0.3)
  private seeds = new Float32Array(N * 4)
  private level = 0
  private target = 0
  private time = 0
  private age = 0
  /** 0 while forming; counts 0→1 while collapsing into the arrival. */
  private collapse = -1
  private to = new THREE.Vector3()
  /** The forge's refine swirl: a fixed body size and a dimmer level (see `shape`). */
  private hs = 1
  private rs = 1
  private cap = 1
  private fixed = false

  constructor() {
    for (let i = 0; i < N; i++) {
      // height fraction, angle, radius fraction, speed
      this.seeds.set([Math.random(), Math.random() * Math.PI * 2, Math.sqrt(Math.random()), 0.6 + Math.random() * 0.8], i * 4)
    }
    this.obj.add(this.motes.pts, this.core.pts)
    this.obj.visible = false
  }

  get active(): boolean {
    return this.target > 0
  }

  /** Start forming at `point` (or keep forming there), or fade out without an arrival (`null`). */
  set(point: THREE.Vector3 | null): void {
    if (point) {
      if (this.level < 0.05) {
        this.obj.position.set(point.x, 0, point.z)
        this.age = 0
      }
      this.collapse = -1
      this.target = 1
    } else {
      this.target = 0
    }
  }

  /**
   * Size the swirl to an object (`height`, `radius` in m) at a fraction of full brightness, and stop it
   * swelling: the forge uses it as a gentle "being perfected" swirl around a thing that already stands.
   */
  shape(height: number, radius: number, level = 0.4): void {
    this.hs = Math.max(0.3, height / 2.4)
    this.rs = Math.max(0.3, radius / 1.25)
    this.cap = level
    this.fixed = true
  }

  /** The thing arrived at `at`: pull every mote into it and flash. */
  resolve(at?: THREE.Vector3): void {
    if (this.level < 0.05) {
      this.target = 0
      return
    }
    this.to.copy(at ?? this.obj.position).setY(0)
    this.collapse = 0
    this.target = 0
  }

  tick(dt: number): void {
    this.time += dt
    if (this.collapse >= 0) {
      this.collapse = Math.min(1, this.collapse + dt / 0.7)
      this.obj.position.lerp(this.to, Math.min(1, dt * 6))
      this.level = (1 - this.collapse) * Math.max(this.level, 0.6)
      if (this.collapse >= 1) {
        this.collapse = -1
        this.level = 0
      }
    } else {
      // Fades in over ~0.5 s so a quick answer barely shows it.
      this.level += (this.target - this.level) * Math.min(1, dt * (this.target ? 2.2 : 3))
      if (this.target) this.age += dt
    }
    this.obj.visible = this.level > 0.01
    if (!this.obj.visible) return

    // A rough body that slowly swells: about 2.4 m tall at first, up to ~5 m after a long design.
    const grow = this.fixed ? 1 : 1 + Math.min(1, this.age / 8)
    const H = 2.4 * grow * this.hs
    const R = 1.25 * grow * this.rs
    const pull = this.collapse >= 0 ? this.collapse ** 0.7 : 0
    const p = this.motes.pos
    const s = this.seeds
    for (let i = 0; i < N; i++) {
      const hf = s[i * 4]!
      const a = s[i * 4 + 1]! + this.time * s[i * 4 + 3]! * (1.1 + pull * 6)
      // A spindle: widest a third of the way up, narrowing to a crown.
      const prof = Math.sin(Math.PI * Math.min(1, hf * 1.15)) ** 0.8
      const wob = 1 + 0.18 * Math.sin(this.time * 2.3 + i)
      const r = R * s[i * 4 + 2]! * prof * wob * (1 - pull)
      p[i * 3] = Math.cos(a) * r
      p[i * 3 + 1] = (0.15 + hf * H + 0.12 * Math.sin(this.time * 3 + i * 0.7)) * (1 - pull * 0.6)
      p[i * 3 + 2] = Math.sin(a) * r
    }
    this.motes.geo.attributes.position!.needsUpdate = true
    const flicker = 0.85 + 0.15 * Math.sin(this.time * 7)
    this.motes.mat.opacity = this.level * 0.85 * flicker * this.cap
    this.motes.mat.size = 0.16 * (1 + pull * 1.5)

    const c = this.core.pos
    for (let i = 0; i < 40; i++) {
      const a = i * 2.4 + this.time * 0.8
      const y = 0.3 + (i / 40) * H * 0.8
      c[i * 3] = Math.cos(a) * 0.12 * (1 - pull)
      c[i * 3 + 1] = y * (1 - pull * 0.6)
      c[i * 3 + 2] = Math.sin(a) * 0.12 * (1 - pull)
    }
    this.core.geo.attributes.position!.needsUpdate = true
    this.core.mat.opacity = this.cap * this.level * (0.35 + 0.25 * Math.sin(this.time * 4)) + (pull > 0 ? pull * (1 - pull) * 2.4 : 0)
  }

  dispose(): void {
    this.motes.geo.dispose()
    this.motes.mat.dispose()
    this.core.geo.dispose()
    this.core.mat.dispose()
  }
}
