/**
 * "The world listens": while a wish is pending, a soft glow gathers at the gaze point. Motes spiral in and
 * up into a faint column, and a pool of light breathes on the ground, until the first op lands.
 */
import * as THREE from 'three'
import { additivePoints, softDot } from './common'

const N = 90

export class Gathering {
  readonly obj = new THREE.Group()
  private motes = additivePoints(N, 0xcfe8ff, 0.26)
  private pool: THREE.Mesh
  private poolMat: THREE.MeshBasicMaterial
  private seeds = new Float32Array(N * 3)
  private level = 0
  private target = 0
  private time = 0

  constructor() {
    this.poolMat = new THREE.MeshBasicMaterial({ color: 0xbfe0ff, map: softDot(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
    this.pool = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), this.poolMat)
    this.pool.position.y = 0.06
    this.pool.raycast = () => {}
    for (let i = 0; i < N; i++) this.seeds.set([Math.random(), Math.random() * Math.PI * 2, 0.5 + Math.random()], i * 3)
    this.obj.add(this.pool, this.motes.pts)
    this.obj.visible = false
  }

  /** Start gathering at `point`, or let it fade (`null`). */
  set(point: THREE.Vector3 | null): void {
    if (point) {
      if (this.level < 0.05) this.obj.position.set(point.x, 0, point.z)
      else this.obj.position.lerp(new THREE.Vector3(point.x, 0, point.z), 0.5)
    }
    this.target = point ? 1 : 0
  }

  tick(dt: number): void {
    this.level += (this.target - this.level) * Math.min(1, dt * (this.target ? 5 : 4))
    this.obj.visible = this.level > 0.01
    if (!this.obj.visible) return
    this.time += dt
    const breathe = 0.75 + 0.25 * Math.sin(this.time * 4.2)
    this.poolMat.opacity = 0.7 * this.level * breathe
    this.pool.scale.setScalar(1.4 + 0.25 * Math.sin(this.time * 4.2))
    const p = this.motes.pos
    const s = this.seeds
    for (let i = 0; i < N; i++) {
      // Each mote's phase runs 0→1: it starts wide and low and ends at the centre, a couple of metres up.
      let ph = s[i * 3]! + dt * 0.45 * s[i * 3 + 2]!
      if (ph > 1) ph -= 1
      s[i * 3] = ph
      const r = 3.2 * (1 - ph) ** 1.5 + 0.08
      const a = s[i * 3 + 1]! + ph * 5
      p[i * 3] = Math.cos(a) * r
      p[i * 3 + 1] = 0.2 + ph * ph * 3
      p[i * 3 + 2] = Math.sin(a) * r
    }
    this.motes.geo.attributes.position!.needsUpdate = true
    this.motes.mat.opacity = this.level * 0.9
  }

  dispose(): void {
    this.pool.geometry.dispose()
    this.poolMat.dispose()
    this.motes.geo.dispose()
    this.motes.mat.dispose()
  }
}
