/**
 * The forge's studio shots: one instance (or a candidate body shown at its spot) rendered from the
 * front-right as a JPEG data URL. Drawn with the main renderer into a corner of the canvas just before the
 * frame paints over it (same renderer, same programs, no second GL context), one shot per frame.
 */
import * as THREE from 'three'
import { meshesOf } from './fx/refine'
import type { Post } from './style/post'

// Studio shots render on their own layer (lights join it, nothing else does).
const STUDIO_LAYER = 30
const STUDIO_W = 640
const STUDIO_H = 480

export interface StudioReq {
  id: string
  body?: THREE.Group
  resolve: (url: string | null) => void
}

/** What a shot needs from the instance: its body, the group a candidate joins, and its yaw. */
export interface StudioSubject {
  body: THREE.Group
  stretch: THREE.Group
  holder: THREE.Group
}

/** The parts of the main renderer a shot borrows (and puts back). */
export interface StudioStage {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.Camera
  hemi: THREE.HemisphereLight
  sun: THREE.DirectionalLight
  post: Post
}

export class Studio {
  private queue: StudioReq[] = []
  private target: THREE.WebGLRenderTarget | null = null
  private cam = new THREE.PerspectiveCamera(40, STUDIO_W / STUDIO_H, 0.05, 2000)
  private pixels = new Uint8Array(STUDIO_W * STUDIO_H * 4)

  constructor() {
    this.cam.layers.set(STUDIO_LAYER)
  }

  enqueue(req: StudioReq): void {
    this.queue.push(req)
  }

  next(): StudioReq | undefined {
    return this.queue.shift()
  }

  shoot(req: StudioReq, item: StudioSubject | undefined, stage: StudioStage): void {
    if (!item) return req.resolve(null)
    const obj = req.body ?? item.body
    if (req.body) {
      req.body.traverse(o => o.layers.set(STUDIO_LAYER))
      item.stretch.add(req.body)
    }
    // Lights join the studio layer (the light count, and so every program key, stays the same).
    stage.scene.traverse((o) => {
      if ((o as THREE.Light).isLight && o.layers.test(stage.camera.layers)) o.layers.enable(STUDIO_LAYER)
    })
    const meshes = meshesOf(obj)
    for (const m of meshes) m.layers.enable(STUDIO_LAYER)
    obj.updateWorldMatrix(true, true)
    const box = new THREE.Box3().setFromObject(obj)
    const c = box.getCenter(new THREE.Vector3())
    const r = Math.max(0.3, box.getSize(new THREE.Vector3()).length() / 2)
    const d = (r / Math.sin(0.35)) * 1.05
    const dir = new THREE.Vector3(0.62, 0.28, 0.73).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), item.holder.rotation.y)
    const cam = this.cam
    cam.position.copy(c).addScaledVector(dir, d)
    cam.near = Math.max(0.05, d - r * 2)
    cam.far = d + r * 3
    cam.updateProjectionMatrix()
    cam.lookAt(c)
    cam.updateMatrixWorld()
    const { scene, hemi, sun } = stage
    const fog = scene.fog as THREE.Fog
    const fogNF = [fog.near, fog.far]
    fog.near = 1e5
    fog.far = 2e5
    const hemiI = hemi.intensity
    const sunI = sun.intensity
    hemi.intensity = Math.max(hemiI, 1.2)
    sun.intensity = Math.max(sunI, 2.3)
    const r3 = stage.renderer
    const pr = r3.getPixelRatio()
    const size = r3.getSize(new THREE.Vector2())
    const clear = r3.getClearColor(new THREE.Color())
    const alpha = r3.getClearAlpha()
    let url: string | null = null
    try {
      // Rendered like the main frame (same target type, so the same programs), then graded into a corner.
      this.target ??= new THREE.WebGLRenderTarget(STUDIO_W, STUDIO_H, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(STUDIO_W, STUDIO_H, THREE.UnsignedIntType) })
      r3.setClearColor(0x9fb7cf, 1)
      const bg = scene.background
      scene.background = null
      r3.setRenderTarget(this.target)
      r3.render(scene, cam)
      r3.setRenderTarget(null)
      scene.background = bg
      r3.setViewport(0, 0, STUDIO_W / pr, STUDIO_H / pr)
      r3.setScissor(0, 0, STUDIO_W / pr, STUDIO_H / pr)
      r3.setScissorTest(true)
      stage.post.composite(r3, this.target, cam)
      const gl = r3.getContext()
      gl.readPixels(0, 0, STUDIO_W, STUDIO_H, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels)
      url = encodeJpeg(this.pixels, STUDIO_W, STUDIO_H)
    } catch (err) {
      console.warn('[forge] studio shot failed', err)
    } finally {
      r3.setScissorTest(false)
      r3.setViewport(0, 0, size.x, size.y)
      r3.setClearColor(clear, alpha)
      fog.near = fogNF[0]!
      fog.far = fogNF[1]!
      hemi.intensity = hemiI
      sun.intensity = sunI
      for (const m of meshes) m.layers.disable(STUDIO_LAYER)
      if (req.body) req.body.removeFromParent()
    }
    req.resolve(url)
  }

  dispose(): void {
    this.target?.dispose()
  }
}

/** RGBA pixels from readPixels (bottom-up) → a JPEG data URL. */
function encodeJpeg(px: Uint8Array, w: number, h: number): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  const img = g.createImageData(w, h)
  const row = w * 4
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * row, (h - y) * row), y * row)
  g.putImageData(img, 0, 0)
  return c.toDataURL('image/jpeg', 0.86)
}
