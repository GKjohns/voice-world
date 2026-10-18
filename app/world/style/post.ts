/**
 * The one post pass (art_direction.md §3.4). The scene renders into a multisampled half-float target with a
 * depth texture; one full-screen shader then tone-maps (Neutral, which keeps palette colours on-model),
 * grades (shadows lifted toward a tint, highlights warmed, a touch of saturation and an S-curve), draws soft
 * depth edges (a 4-tap depth discontinuity, darkening near overlaps, fading out by ~40 m) and a vignette.
 * No bloom, no blur pyramid: glow is carried by halo sprites.
 *
 * Every scene program is compiled for this target (no tone mapping, linear output), so warm-up must compile
 * with the target bound too: `bindForCompile` (used by perf/precompile.ts).
 *
 * Dynamic resolution: if frames run long the target drops to 85% then 70% scale, and recovers when calm.
 */
import * as THREE from 'three'

const FRAG = /* glsl */`
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uNear;
uniform float uFar;
uniform vec3 uShadow;
uniform vec3 uHighlight;
uniform float uSat;
uniform float uLift;
uniform float uVignette;
uniform float uEdge;
varying vec2 vUv;

float linDepth( float d ) {
  return uNear * uFar / ( uFar - d * ( uFar - uNear ) );
}

void main() {
  vec3 hdr = texture2D( tColor, vUv ).rgb;
  // Soft depth edges: where the depth jumps (one prop in front of another) darken a little.
  float zc = linDepth( texture2D( tDepth, vUv ).r );
  float zl = linDepth( texture2D( tDepth, vUv - vec2( uTexel.x, 0.0 ) ).r );
  float zr = linDepth( texture2D( tDepth, vUv + vec2( uTexel.x, 0.0 ) ).r );
  float zu = linDepth( texture2D( tDepth, vUv + vec2( 0.0, uTexel.y ) ).r );
  float zd = linDepth( texture2D( tDepth, vUv - vec2( 0.0, uTexel.y ) ).r );
  float jump = max( max( zl, zr ), max( zu, zd ) ) - zc; // only the nearer side of an edge darkens
  float edge = smoothstep( 0.06, 0.2, jump / max( zc, 0.05 ) ) * ( 1.0 - smoothstep( 18.0, 40.0, zc ) );
  hdr *= 1.0 - uEdge * edge;

  gl_FragColor = vec4( hdr, 1.0 );
  #include <tonemapping_fragment>
  vec3 c = gl_FragColor.rgb;
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( vec3( l ), c, uSat );
  c += uShadow * uLift * ( 1.0 - smoothstep( 0.0, 0.45, l ) );
  c = mix( c, c * uHighlight, smoothstep( 0.45, 1.0, l ) * 0.3 );
  c = clamp( c, 0.0, 1.0 );
  c = mix( c, c * c * ( 3.0 - 2.0 * c ), 0.12 );
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * smoothstep( 0.25, 0.75, length( q * vec2( 1.15, 1.0 ) ) );
  gl_FragColor = vec4( c, 1.0 );
  #include <colorspace_fragment>
}
`

export interface Grade {
  shadow: string // lift tint for the darks
  highlight: string // multiply tint for the lights
  sat: number // saturation multiplier (1.08)
}

function makeTarget(w: number, h: number): THREE.WebGLRenderTarget {
  const depth = new THREE.DepthTexture(w, h)
  depth.type = THREE.UnsignedIntType
  return new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: 4, depthTexture: depth, depthBuffer: true })
}

export class Post {
  readonly target: THREE.WebGLRenderTarget
  readonly uniforms = {
    tColor: { value: null as THREE.Texture | null },
    tDepth: { value: null as THREE.Texture | null },
    uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 800) },
    uNear: { value: 0.1 },
    uFar: { value: 1000 },
    uShadow: { value: new THREE.Color('#3a3060') },
    uHighlight: { value: new THREE.Color('#fff2e0') },
    uSat: { value: 1.08 },
    uLift: { value: 0.05 },
    uVignette: { value: 0.12 },
    uEdge: { value: 0.18 }
  }

  private quad: THREE.Mesh
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private w = 1
  private h = 1
  private scale = 1
  // dynamic resolution: a 1 s running average of frame time and how long it has been over/under
  private avg = 16.7
  private overSince = 0
  private calmSince = 0

  constructor() {
    this.target = makeTarget(1, 1)
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
    this.quad.frustumCulled = false
  }

  setSize(w: number, h: number): void {
    this.w = Math.max(1, Math.round(w))
    this.h = Math.max(1, Math.round(h))
    this.applySize()
  }

  private applySize(): void {
    const w = Math.max(1, Math.round(this.w * this.scale))
    const h = Math.max(1, Math.round(this.h * this.scale))
    this.target.setSize(w, h)
  }

  setGrade(g: Grade): void {
    this.uniforms.uShadow.value.set(g.shadow)
    this.uniforms.uHighlight.value.set(g.highlight)
    this.uniforms.uSat.value = g.sat
  }

  /** Programs compile for whatever target is bound: compile scene objects with ours bound. */
  bindForCompile<T>(renderer: THREE.WebGLRenderer, fn: () => T): T {
    const prev = renderer.getRenderTarget()
    renderer.setRenderTarget(this.target)
    try {
      return fn()
    } finally {
      renderer.setRenderTarget(prev)
    }
  }

  /** The scene into the target, then the composite to the screen. `dtMs` feeds dynamic resolution. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, dtMs: number, now: number): void {
    this.adapt(dtMs, now)
    renderer.setRenderTarget(this.target)
    renderer.render(scene, camera)
    renderer.setRenderTarget(null)
    this.composite(renderer, this.target, camera)
  }

  /** Composite `src` (a target rendered like ours) into whatever viewport is current on the screen. */
  composite(renderer: THREE.WebGLRenderer, src: THREE.WebGLRenderTarget, camera: THREE.PerspectiveCamera): void {
    const u = this.uniforms
    u.tColor.value = src.texture
    u.tDepth.value = src.depthTexture
    u.uTexel.value.set(1 / src.width, 1 / src.height)
    u.uNear.value = camera.near
    u.uFar.value = camera.far
    const auto = renderer.autoClear
    renderer.autoClear = false
    renderer.render(this.quad, this.cam)
    renderer.autoClear = auto
  }

  private adapt(dtMs: number, now: number): void {
    if (!(dtMs > 0) || dtMs > 250) return // a hitch or a background tab says nothing about steady load
    this.avg += (dtMs - this.avg) * 0.06
    let next = this.scale
    if (this.avg > 18) {
      this.calmSince = 0
      if (!this.overSince) this.overSince = now
      if (now - this.overSince > 2000) {
        next = this.avg > 22 ? 0.7 : Math.min(this.scale, 0.85)
        this.overSince = now
      }
    } else {
      this.overSince = 0
      if (this.avg < 14 && this.scale < 1) {
        if (!this.calmSince) this.calmSince = now
        if (now - this.calmSince > 5000) {
          next = this.scale < 0.8 ? 0.85 : 1
          this.calmSince = now
        }
      } else {
        this.calmSince = 0
      }
    }
    if (next !== this.scale) {
      this.scale = next
      this.applySize()
      ;(globalThis as { __postScale?: number }).__postScale = next
    }
  }

  dispose(): void {
    this.target.depthTexture?.dispose()
    this.target.dispose()
    this.quad.geometry.dispose()
    ;(this.quad.material as THREE.Material).dispose()
  }
}
