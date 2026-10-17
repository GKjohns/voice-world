/**
 * Arrival, edit and removal spectacle: a beam of light from the sky, a ground shockwave, a sparkle burst,
 * a shimmer band sweeping up a modified thing and a dissolve into rising sparks. Each returns an `Fx` the
 * renderer adds to the scene and drives with its tween clock (t in 0..1 over the effect's duration).
 */
import * as THREE from 'three'
import { additivePoints, lightOf, softDot } from './common'
import type { Fx } from './common'

const beamGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0)
beamGeo.userData.shared = true
const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true)
bandGeo.userData.shared = true
const ringGeo = new THREE.RingGeometry(0.82, 1, 72).rotateX(-Math.PI / 2)
ringGeo.userData.shared = true
const discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2)
discGeo.userData.shared = true

/**
 * A column of light from the sky at `pos`, `radius` wide. It swells in over the first `lead` of t, holds
 * until `land` (flaring as the thing touches down), then fades. The quad turns to face the camera
 * (around y) so it reads as a volume from anywhere.
 */
export function beam(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, lead = 0.25, land = 0.7): Fx {
  const uniforms = { color: { value: lightOf(color, 0.55) }, opacity: { value: 0 }, time: { value: 0 } }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    // A soft gaussian column with a hot core, brightest at the ground and fading into the sky, with faint
    // streaks running down it (light pouring).
    fragmentShader: 'uniform vec3 color; uniform float opacity; uniform float time; varying vec2 vUv; void main() { float x = (vUv.x - 0.5) * 2.0; float halo = exp(-x * x * 3.2); float core = exp(-x * x * 22.0); float fall = pow(1.0 - vUv.y, 1.1) * 0.9 + 0.1; float streak = 0.88 + 0.12 * sin(vUv.y * 24.0 + time * 9.0 + x * 2.0); float a = (halo * 0.5 + core * 0.8) * fall * streak * opacity; gl_FragColor = vec4(color * a, a); }'
  })
  const quad = new THREE.Mesh(beamGeo, mat)
  const height = 140 + radius * 6
  quad.scale.set(radius * 3.2, height, 1)
  quad.renderOrder = 4
  quad.raycast = () => {}
  const glowMat = new THREE.MeshBasicMaterial({ color: lightOf(color, 0.5), map: softDot(), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })
  const glow = new THREE.Mesh(discGeo, glowMat)
  glow.scale.setScalar(radius * 2.4)
  glow.position.y = 0.05
  glow.renderOrder = 3
  glow.raycast = () => {}
  const obj = new THREE.Group()
  obj.add(quad, glow)
  obj.position.copy(pos).setY(0)
  return {
    obj,
    update: (t, cam, dt) => {
      // In, hold, a flare at touchdown, then a slow fade.
      const flare = t > land ? Math.exp(-(t - land) * 18) * 0.8 : 0
      const env = t < lead ? smooth(t / lead) : t < land ? 1 : (1 - smooth((t - land) / (1 - land))) * (1 + flare)
      uniforms.opacity.value = env
      uniforms.time.value += dt
      glowMat.opacity = Math.min(1, 0.7 * env + flare)
      quad.rotation.y = Math.atan2(cam.position.x - obj.position.x, cam.position.z - obj.position.z)
    },
    dispose: () => {
      mat.dispose()
      glowMat.dispose()
    }
  }
}

/** An expanding ring of light along the ground where something heavy landed (`spread` m beyond its foot). */
export function shockwave(pos: THREE.Vector3, radius: number, color: THREE.ColorRepresentation = 0xfff1d6, spread = 9, level = 0.9): Fx {
  const mat = new THREE.MeshBasicMaterial({ color: lightOf(color, 0.4), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide })
  const ring = new THREE.Mesh(ringGeo, mat)
  ring.position.set(pos.x, 0.08, pos.z)
  ring.renderOrder = 3
  ring.raycast = () => {}
  const r0 = Math.max(0.6, radius * 0.9)
  const r1 = radius * 3.2 + spread
  return {
    obj: ring,
    update: (t) => {
      const k = 1 - (1 - t) ** 3
      ring.scale.setScalar(r0 + (r1 - r0) * k)
      mat.opacity = level * (1 - t) ** 1.5
    },
    dispose: () => mat.dispose()
  }
}

/** A burst of glitter around a point: small things arriving, lamps lighting, a morph. */
export function sparkle(center: THREE.Vector3, radius: number, color: THREE.ColorRepresentation, n = 36): Fx {
  const size = 0.16 + Math.min(0.5, radius * 0.08)
  const { pts, pos, mat, geo } = additivePoints(n, lightOf(color, 0.6), size)
  const start: number[] = []
  const vel: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const u = Math.random() * 2 - 1
    const s = Math.sqrt(1 - u * u)
    const dir = [Math.cos(a) * s, Math.abs(u) * 0.8 + 0.2, Math.sin(a) * s]
    const r0 = radius * 0.4 * Math.random()
    start.push(center.x + dir[0]! * r0, center.y + dir[1]! * r0, center.z + dir[2]! * r0)
    const sp = (0.8 + radius * 0.9) * (0.4 + Math.random() * 0.8)
    vel.push(dir[0]! * sp, dir[1]! * sp + 0.6, dir[2]! * sp)
  }
  return {
    obj: pts,
    update: (t) => {
      const k = 1 - (1 - t) ** 2.5
      for (let i = 0; i < n * 3; i++) pos[i] = start[i]! + vel[i]! * k
      geo.attributes.position!.needsUpdate = true
      // Glitter: the whole cloud twinkles as it fades.
      mat.opacity = (1 - t) ** 1.2 * (0.75 + 0.25 * Math.sin(t * 40))
    },
    dispose: () => {
      geo.dispose()
      mat.dispose()
    }
  }
}

/** A bright band sweeping bottom to top around a modified thing, in step with the colour wipe. */
export function shimmer(center: THREE.Vector3, radius: number, height: number, color: THREE.ColorRepresentation): Fx {
  const uniforms = { color: { value: lightOf(color, 0.65) }, opacity: { value: 0 } }
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 color; uniform float opacity; varying vec2 vUv; void main() { float a = pow(sin(3.14159 * vUv.y), 2.0) * opacity; gl_FragColor = vec4(color * a, a); }'
  })
  const band = new THREE.Mesh(bandGeo, mat)
  const r = Math.max(0.4, radius * 1.08)
  const bh = Math.max(0.35, height * 0.18)
  band.scale.set(r, bh, r)
  band.renderOrder = 4
  band.raycast = () => {}
  band.position.set(center.x, 0, center.z)
  return {
    obj: band,
    update: (t) => {
      band.position.y = -bh / 2 + (height + bh) * smooth(t)
      uniforms.opacity.value = 0.85 * Math.sin(Math.PI * Math.min(1, t * 1.15))
    },
    dispose: () => mat.dispose()
  }
}

/**
 * A thing coming apart into sparks that drift upward. `rise` metres of drift: a removal floats a few
 * metres; a teleport sends the whole old world up into the sky.
 */
export function dissolve(center: THREE.Vector3, radius: number, height: number, color: THREE.ColorRepresentation, n: number, rise = 3.5): Fx {
  const { pts, pos, mat, geo } = additivePoints(n, lightOf(color, 0.5), 0.14 + Math.min(0.4, radius * 0.05))
  const start: number[] = []
  const drift: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const rr = radius * Math.sqrt(Math.random())
    start.push(center.x + Math.cos(a) * rr, center.y + Math.random() * Math.max(0.3, height), center.z + Math.sin(a) * rr)
    drift.push((Math.random() - 0.5) * 1.2, rise * (0.5 + Math.random()), (Math.random() - 0.5) * 1.2, a)
  }
  return {
    obj: pts,
    update: (t) => {
      const k = 1 - (1 - t) ** 1.6
      for (let i = 0; i < n; i++) {
        const sw = Math.sin(t * 6 + drift[i * 4 + 3]!) * 0.35 * t
        pos[i * 3] = start[i * 3]! + drift[i * 4]! * k + sw
        pos[i * 3 + 1] = start[i * 3 + 1]! + drift[i * 4 + 1]! * k
        pos[i * 3 + 2] = start[i * 3 + 2]! + drift[i * 4 + 2]! * k + sw
      }
      geo.attributes.position!.needsUpdate = true
      mat.opacity = Math.min(1, t * 6) * (1 - t) ** 1.3
    },
    dispose: () => {
      geo.dispose()
      mat.dispose()
    }
  }
}

function smooth(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return x * x * (3 - 2 * x)
}
