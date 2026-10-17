/**
 * The teleport tunnel: while the next place is being summoned, a swirling column of light and rising motes
 * wraps the player so the screen is never an empty wall of fog. It fades as the new place unveils.
 */
import * as THREE from 'three'
import { additivePoints } from './common'

const N = 520
const TOP = 26
const BOTTOM = -6

export class Vortex {
  readonly obj = new THREE.Group()
  private walls: THREE.Mesh[] = []
  private uniforms: { time: { value: number }, opacity: { value: number }, a: { value: THREE.Color }, b: { value: THREE.Color } }[] = []
  private motes: ReturnType<typeof additivePoints>
  private seeds: Float32Array
  strength = 0

  constructor(tint: THREE.ColorRepresentation = 0xffe2b0) {
    const a = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.35)
    const b = new THREE.Color(0x8fb4ff)
    for (const [radius, speed, twist] of [[7.5, 1, 7], [4.2, -1.4, 5]] as const) {
      const u = { time: { value: 0 }, opacity: { value: 0 }, a: { value: a.clone() }, b: { value: b.clone() } }
      const mat = new THREE.ShaderMaterial({
        uniforms: u,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
        vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        // Spiral arms (angle + height − time), soft-edged, fading top and bottom, with a slow colour drift.
        fragmentShader: `uniform float time; uniform float opacity; uniform vec3 a; uniform vec3 b; varying vec2 vUv; void main() { float ang = vUv.x * 6.28318; float h = vUv.y; float arm = sin(ang * ${twist.toFixed(1)} + h * 18.0 - time * ${(3 * speed).toFixed(2)}); float arms = smoothstep(0.35, 1.0, arm); float fine = 0.5 + 0.5 * sin(ang * 23.0 - h * 40.0 + time * ${(5 * speed).toFixed(2)}); float edge = smoothstep(0.0, 0.25, h) * smoothstep(1.0, 0.55, h); vec3 c = mix(a, b, 0.5 + 0.5 * sin(h * 6.0 + time * 0.7)); float al = (arms * 0.75 + fine * 0.12) * edge * opacity; gl_FragColor = vec4(c * al, al); }`
      })
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 0.7, TOP - BOTTOM, 64, 1, true), mat)
      wall.position.y = (TOP + BOTTOM) / 2
      wall.renderOrder = 5
      wall.raycast = () => {}
      this.walls.push(wall)
      this.uniforms.push(u)
      this.obj.add(wall)
    }
    this.motes = additivePoints(N, a, 0.22)
    this.seeds = new Float32Array(N * 4)
    for (let i = 0; i < N; i++) {
      this.seeds.set([1.8 + Math.random() * 8, Math.random() * Math.PI * 2, BOTTOM + Math.random() * (TOP - BOTTOM), 1.5 + Math.random() * 5], i * 4)
    }
    this.obj.add(this.motes.pts)
    this.obj.visible = false
  }

  /** `strength` 0..1 is set by the renderer from the reveal; the vortex follows the camera. */
  tick(dt: number, cam: THREE.Vector3): void {
    this.obj.visible = this.strength > 0.005
    if (!this.obj.visible) return
    this.obj.position.set(cam.x, cam.y - 1.6, cam.z)
    for (const u of this.uniforms) {
      u.time.value += dt
      u.opacity.value = this.strength
    }
    const s = this.seeds
    const p = this.motes.pos
    for (let i = 0; i < N; i++) {
      const r = s[i * 4]!
      s[i * 4 + 1] = s[i * 4 + 1]! + dt * (2.4 / r + 0.2)
      s[i * 4 + 2] = s[i * 4 + 2]! + dt * s[i * 4 + 3]!
      if (s[i * 4 + 2]! > TOP) s[i * 4 + 2] = BOTTOM
      const ang = s[i * 4 + 1]!
      p[i * 3] = Math.cos(ang) * r
      p[i * 3 + 1] = s[i * 4 + 2]!
      p[i * 3 + 2] = Math.sin(ang) * r
    }
    this.motes.geo.attributes.position!.needsUpdate = true
    this.motes.mat.opacity = this.strength
  }

  dispose(): void {
    for (const w of this.walls) {
      w.geometry.dispose()
      ;(w.material as THREE.Material).dispose()
    }
    this.motes.geo.dispose()
    this.motes.mat.dispose()
  }
}
