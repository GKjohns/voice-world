/**
 * A fixed light budget. three.js bakes the number of point/spot lights into every lit shader (and even
 * unlit ones, through the program cache key), so each lamp that switched on used to recompile every
 * material in the scene: 0.3–0.9 s frames in the middle of a teleport build.
 *
 * The kit still puts real PointLight/SpotLight objects in its bodies, but they're only *sources* now:
 * they move to a layer the camera never renders, so three never counts them. A constant pool of real
 * lights (always in the scene, intensity 0 when idle) copies the nearest visible sources every frame.
 * The light count never changes, so nothing ever recompiles; the bulbs' emissive carries everything else.
 */
import * as THREE from 'three'

/** The layer kit lights live on: never enabled on the camera, so the renderer never counts them. */
export const SOURCE_LAYER = 31
const REPICK_MS = 200

export class LightPool {
  readonly obj = new THREE.Group()
  private points: THREE.PointLight[] = []
  private spots: THREE.SpotLight[] = []
  private sources: THREE.Light[] = []
  private pickedAt = -Infinity
  private picked: { point: THREE.PointLight[], spot: THREE.SpotLight[] } = { point: [], spot: [] }
  private v = new THREE.Vector3()

  constructor(nPoint = 6, nSpot = 6) {
    this.obj.name = 'light-pool'
    for (let i = 0; i < nPoint; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2)
      this.points.push(l)
      this.obj.add(l)
    }
    for (let i = 0; i < nSpot; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 10, 0.8, 0.5, 1.3)
      this.spots.push(l)
      this.obj.add(l, l.target)
    }
  }

  /** Re-collect the source lights under `roots` (call after the scene's items change). */
  collect(roots: Iterable<THREE.Object3D>): void {
    const out: THREE.Light[] = []
    for (const root of roots) {
      root.traverse((o) => {
        const l = o as THREE.Light
        if (!l.isLight) return
        l.layers.set(SOURCE_LAYER)
        out.push(l)
      })
    }
    this.sources = out
    this.pickedAt = -Infinity
  }

  /** Copy the nearest lit sources into the pool. Cheap: a re-pick every 200 ms, a param copy per frame. */
  update(camera: THREE.Camera, now: number): void {
    if (now - this.pickedAt > REPICK_MS) {
      this.pickedAt = now
      const cam = camera.getWorldPosition(this.v).clone()
      const live = this.sources.filter(lit).map(l => ({ l, d: l.getWorldPosition(this.v).distanceToSquared(cam) }))
      live.sort((a, b) => a.d - b.d)
      const spot: THREE.SpotLight[] = []
      const point: THREE.PointLight[] = []
      for (const { l } of live) {
        if ((l as THREE.SpotLight).isSpotLight) {
          if (spot.length < this.spots.length) spot.push(l as THREE.SpotLight)
        } else if ((l as THREE.PointLight).isPointLight) {
          if (point.length < this.points.length) point.push(l as THREE.PointLight)
        }
      }
      this.picked = { point, spot }
    }
    this.points.forEach((dst, i) => {
      const src = this.picked.point[i]
      if (!src || !src.parent) {
        dst.intensity = 0
        return
      }
      src.getWorldPosition(dst.position)
      dst.color.copy(src.color)
      dst.intensity = src.intensity
      dst.distance = src.distance
      dst.decay = src.decay
    })
    this.spots.forEach((dst, i) => {
      const src = this.picked.spot[i]
      if (!src || !src.parent) {
        dst.intensity = 0
        return
      }
      src.getWorldPosition(dst.position)
      src.target.getWorldPosition(dst.target.position)
      dst.color.copy(src.color)
      dst.intensity = src.intensity
      dst.distance = src.distance
      dst.decay = src.decay
      dst.angle = src.angle
      dst.penumbra = src.penumbra
    })
    this.obj.updateMatrixWorld(true)
  }

  dispose(): void {
    for (const l of [...this.points, ...this.spots]) l.dispose()
  }
}

/** Wanted and actually in the world (a flicker at intensity 0 keeps its slot): the light and every ancestor visible, attached to a scene. */
function lit(l: THREE.Light): boolean {
  let o: THREE.Object3D | null = l
  while (o) {
    if (!o.visible) return false
    if ((o as THREE.Scene).isScene) return true
    o = o.parent
  }
  return false
}
