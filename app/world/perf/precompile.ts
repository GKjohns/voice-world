/**
 * Shader warm-up. A program compiles the first time a material variant is drawn, and on a cold GPU cache
 * that costs ~100 ms each, blocking the frame: a pool hall used to compile ~35 of them mid-reveal.
 *
 * - `warmKit` builds one of every kit kind (plus the arrival fx) off-scene shortly after load and
 *   compiles them with `compileAsync` (KHR_parallel_shader_compile: the GPU compiles while frames keep
 *   coming). Their materials are kept, never drawn, so the programs stay cached even after the place that
 *   used them dissolves (three releases a program when its last material is disposed).
 * - `precompile` compiles a batch of freshly built (still hidden) holders the moment they're made, so
 *   learned kinds, glass looks and anything the warm-up missed compile while they wait for their cue.
 *
 * Both rely on a constant light count (perf/lights.ts): the light count is part of every program's key.
 */
import type * as THREE from 'three'
import type { Build } from '../kit/helpers'
import { SOURCE_LAYER } from './lights'

const pinned: THREE.Material[] = []

export function precompile(renderer: THREE.WebGLRenderer, objs: THREE.Object3D[], camera: THREE.Camera, scene: THREE.Scene): void {
  for (const o of objs) {
    try {
      void renderer.compileAsync(o, camera, scene)
    } catch {
      // A compile failure shows up again (and is reported) when the object is drawn.
    }
  }
}

/**
 * Warm every kit builder (and `extras`, e.g. fx objects) a couple per tick so loading stays smooth.
 * Resolves with the number of materials warmed once everything has compiled.
 */
export async function warmKit(renderer: THREE.WebGLRenderer, camera: THREE.Camera, scene: THREE.Scene, builders: Record<string, Build>, extras: () => THREE.Object3D[] = () => [], perTick = 3): Promise<number> {
  const jobs: (() => THREE.Object3D | THREE.Object3D[])[] = Object.values(builders).map(b => () => b({}))
  jobs.push(extras)
  const waits: Promise<unknown>[] = []
  const t0 = performance.now()
  let n = 0
  for (let i = 0; i < jobs.length; i += perTick) {
    await new Promise(r => setTimeout(r, 16))
    for (const job of jobs.slice(i, i + perTick)) {
      let made: THREE.Object3D[]
      try {
        const out = job()
        made = Array.isArray(out) ? out : [out]
      } catch {
        continue
      }
      for (const root of made) {
        root.traverse((o) => {
          const l = o as THREE.Light
          if (l.isLight) l.layers.set(SOURCE_LAYER)
        })
        try {
          waits.push(renderer.compileAsync(root, camera, scene))
        } catch {
          continue
        }
        root.traverse((o) => {
          const m = o as THREE.Mesh
          if (m.geometry) m.geometry.dispose()
          const mats = m.material ? (Array.isArray(m.material) ? m.material : [m.material]) : []
          for (const mat of mats) {
            pinned.push(mat)
            n++
          }
        })
      }
    }
  }
  await Promise.all(waits)
  // For the perf scripts: when the warm-up finished and how much it covered.
  ;(globalThis as { __kitWarmed?: unknown }).__kitWarmed = { materials: n, ms: Math.round(performance.now() - t0) }
  return n
}
