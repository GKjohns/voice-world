/**
 * Wind-swept grass tufts (art_direction.md §3.7, Lil Gator Game): one InstancedMesh, one draw call.
 *
 * Tufts sit on a world-space grid (0.34 m) inside a disc that follows the player; the mesh snaps by whole
 * grid steps, so every tuft keeps its world spot while you walk (nothing pops). The shader jitters,
 * rotates and sizes each tuft from a hash of its grid point, sways it with a travelling gust, colours it
 * from the ground's own two-tone patches (root) to a sunlit tip, and folds it away near the disc's rim and
 * inside up to 24 masked circles (water, floors, roads, rugs: anything that shouldn't sprout grass).
 * Lit by the shared toon/fog chunks like everything else.
 */
import * as THREE from 'three'
import { styleShader, STYLE_UNIFORMS } from './toon'
import { GROUND_UNIFORMS } from './ground'

const STEP = 0.34
const RADIUS = 24
export const GRASS_MASKS = 24

function tuftGeometry(): THREE.BufferGeometry {
  // Three blades (tapered triangles) leaning out from the root. Normals point up, so blades light like the
  // ground they grow from (no dark back faces in toon light).
  const pos: number[] = []
  const nor: number[] = []
  const tip: number[] = []
  const blades: [number, number, number][] = [[0, 0.24, 0.08], [2.1, 0.19, 0.13], [4.2, 0.21, 0.11], [1.0, 0.16, 0.14]]
  for (const [a, h, lean] of blades) {
    const dx = Math.cos(a)
    const dz = Math.sin(a)
    const w = 0.055
    const ox = -dz * w
    const oz = dx * w
    pos.push(-ox, 0, -oz, ox, 0, oz, dx * lean, h, dz * lean)
    for (let i = 0; i < 3; i++) nor.push(dx * 0.25, 1, dz * 0.25)
    tip.push(0, 0, 1)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('aTip', new THREE.Float32BufferAttribute(tip, 1))
  return g
}

export class Grass {
  readonly mesh: THREE.InstancedMesh
  readonly uniforms = {
    uGrassMask: { value: Array.from({ length: GRASS_MASKS }, () => new THREE.Vector4(0, 0, 0, 0)) },
    uGrassRadius: { value: RADIUS },
    uGrassBase: { value: new THREE.Color('#5f874e') },
    uGrassHeight: { value: 1 }
  }

  private amount = 0 // 0..1, eased toward `want`
  private want = 0

  constructor() {
    const offsets: [number, number][] = []
    const n = Math.ceil(RADIUS / STEP)
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        if (Math.hypot(i, j) * STEP <= RADIUS) offsets.push([i * STEP, j * STEP])
      }
    }
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, envMapIntensity: 0, side: THREE.DoubleSide })
    material.onBeforeCompile = (sh) => {
      styleShader(sh)
      Object.assign(sh.uniforms, GROUND_UNIFORMS, this.uniforms)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', /* glsl */`#include <common>
attribute float aTip;
uniform vec4 uGrassMask[ ${GRASS_MASKS} ];
uniform float uGrassRadius;
uniform float uGrassHeight;
uniform float uGroundPatch;
uniform float uCjTime;
varying float vGrassTip;
varying float vGrassPatch;
float grHash( vec2 p ) { p = fract( p * vec2( 127.1, 311.7 ) ); p += dot( p, p + 34.5 ); return fract( p.x * p.y ); }
float grNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( grHash( i ), grHash( i + vec2( 1, 0 ) ), u.x ), mix( grHash( i + vec2( 0, 1 ) ), grHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}`)
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
  {
    vec3 root = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;
    vec2 cell = floor( root.xz / ${STEP.toFixed(2)} + 0.5 );
    float h1 = grHash( cell );
    float h2 = grHash( cell + 17.3 );
    float ang = h1 * 6.2832;
    float ca = cos( ang ); float sa = sin( ang );
    transformed.xz = mat2( ca, sa, -sa, ca ) * transformed.xz;
    vec2 world = root.xz + ( vec2( h1, h2 ) - 0.5 ) * ${(STEP * 0.9).toFixed(3)};
    // The ground's own patches (same noise as style/ground.ts): taller, lusher grass in the alt patches.
    float big = grNoise( world * 0.035 ) * 0.65 + grNoise( world * 0.09 + 7.0 ) * 0.35;
    vGrassPatch = smoothstep( 0.46, 0.6, big ) * uGroundPatch;
    float clump = grNoise( world * 0.45 );
    float size = ( 0.6 + 0.55 * clump + 0.25 * h2 ) * ( 0.9 + 0.35 * vGrassPatch ) * uGrassHeight;
    float d = distance( world, cameraPosition.xz );
    size *= 1.0 - smoothstep( uGrassRadius * 0.6, uGrassRadius * 0.98, d );
    for ( int i = 0; i < ${GRASS_MASKS}; i ++ ) {
      vec4 m = uGrassMask[ i ];
      if ( m.z > 0.0 && distance( world, m.xy ) < m.z ) size = 0.0;
    }
    transformed *= size;
    // A gust wave rolling across the field, plus a little flutter per tuft.
    float gust = sin( dot( world, vec2( 0.21, 0.13 ) ) - uCjTime * 1.6 ) * 0.5 + 0.5;
    float sway = ( 0.06 + 0.11 * gust ) * aTip * size;
    transformed.x += sway * ( 0.8 + 0.25 * sin( uCjTime * 3.1 + h1 * 9.0 ) );
    transformed.z += sway * 0.35 * sin( uCjTime * 2.3 + h2 * 7.0 );
    transformed.xz += world - root.xz;
    vGrassTip = aTip;
  }`)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uGrassBase;\nuniform vec3 uGroundAlt;\nvarying float vGrassTip;\nvarying float vGrassPatch;')
        // Both faces of a blade keep the upward normal (a flipped back face would catch the ground's
        // brown fill and the rim): grass lights like the meadow it grows from.
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize( vNormal );\nnonPerturbedNormal = normal;')
        .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
  {
    vec3 base = mix( uGrassBase, uGroundAlt, vGrassPatch );
    // Tips lean cool (blue-green), so a warm low sun lands on them as green-gold, not straw.
    diffuseColor.rgb = base * mix( vec3( 0.82 ), vec3( 0.88, 1.08, 1.2 ), vGrassTip );
  }`)
    }
    material.customProgramCacheKey = () => 'conjure-grass'
    this.mesh = new THREE.InstancedMesh(tuftGeometry(), material, offsets.length)
    const m4 = new THREE.Matrix4()
    offsets.forEach(([x, z], i) => this.mesh.setMatrixAt(i, m4.makeTranslation(x, 0, z)))
    this.mesh.instanceMatrix.needsUpdate = true
    this.mesh.frustumCulled = false
    this.mesh.receiveShadow = true
    this.mesh.castShadow = false
    this.mesh.name = 'grass'
    this.mesh.raycast = () => {}
    this.mesh.visible = false
    void STYLE_UNIFORMS
  }

  /** Grass on (a meadow preset, clear weather) or off (interiors, snow, a dark night floor). */
  setWanted(on: boolean): void {
    this.want = on ? 1 : 0
  }

  setColor(ground: string): void {
    this.uniforms.uGrassBase.value.set(ground)
  }

  /** Circles (world x, z, radius) where no grass grows. */
  setMasks(circles: [number, number, number][]): void {
    const arr = this.uniforms.uGrassMask.value
    // Biggest first, so if there are more than fit, the large flats (a lake, a floor) win.
    const sorted = [...circles].sort((a, b) => b[2] - a[2]).slice(0, GRASS_MASKS)
    for (let i = 0; i < GRASS_MASKS; i++) {
      const c = sorted[i]
      arr[i]!.set(c ? c[0] : 0, c ? c[1] : 0, c ? c[2] : 0, 0)
    }
  }

  tick(dt: number, cam: THREE.Vector3): void {
    this.amount += (this.want - this.amount) * Math.min(1, dt * 2.5)
    this.uniforms.uGrassHeight.value = this.amount
    this.mesh.visible = this.amount > 0.02
    // Whole grid steps only, so each tuft keeps its world spot.
    this.mesh.position.set(Math.round(cam.x / STEP) * STEP, 0, Math.round(cam.z / STEP) * STEP)
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}

const FLAT = /\b(water|lake|pond|sea|ocean|pool|river|stream|floor|rug|carpet|road|street|path|shore|beach|sand|plaza|patio|deck|platform|stage|island)\b/

interface MaskEntity { kind: string, tags: string[], pos: [number, number, number], rotY: number, props: { length?: number, width?: number, scale?: number } }

/** Where grass must not grow: flat surfaces (water, floors, roads, rugs, sand) as world circles. */
export function grassCircles(entities: MaskEntity[], defaults: (e: MaskEntity) => { length?: number, width?: number, footprint: number }): [number, number, number][] {
  const out: [number, number, number][] = []
  for (const e of entities) {
    if (e.pos[1] > 1.5) continue
    if (!FLAT.test(`${e.kind} ${e.tags.join(' ')}`)) continue
    const d = defaults(e)
    const s = e.props.scale ?? 1
    const len = (e.props.length ?? d.length ?? 0) * s
    const wid = (e.props.width ?? d.width ?? 0) * s
    const isIsland = e.kind === 'island' || e.tags.includes('island')
    if (isIsland) {
      out.push([e.pos[0], e.pos[2], 100 * s])
      continue
    }
    const long = len > wid * 2.5 && wid > 0
    if (long) {
      // A ribbon (road, river): a chain of circles along its local z.
      const r = wid * 0.62 + 0.5
      const n = Math.min(40, Math.ceil(len / (r * 1.2)))
      const sx = Math.sin(e.rotY)
      const cz = Math.cos(e.rotY)
      for (let i = 0; i <= n; i++) {
        const t = (i / n - 0.5) * len
        out.push([e.pos[0] + sx * t, e.pos[2] + cz * t, r])
      }
      continue
    }
    const shore = /shore|beach/.test(`${e.kind} ${e.tags.join(' ')}`) ? 4 : 0
    const r = Math.max(Math.hypot(len, wid) / 2 * (e.kind === 'water' ? 0.75 : 0.72), d.footprint * s, 0.5) + shore
    out.push([e.pos[0], e.pos[2], r])
  }
  return out
}

/** The masks that matter now: the circles nearest the player's grass disc. */
export function nearMasks(all: [number, number, number][], x: number, z: number): [number, number, number][] {
  return all
    .map(c => ({ c, d: Math.hypot(c[0] - x, c[1] - z) - c[2] }))
    .filter(o => o.d < RADIUS + 6)
    .sort((a, b) => a.d - b.d)
    .slice(0, GRASS_MASKS)
    .map(o => o.c)
}
