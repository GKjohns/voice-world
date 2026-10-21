/**
 * The endless ground (art_direction.md §3.7): a toon-lit plane with big, soft two-tone patches in world
 * space (the preset's ground colour and a neighbouring swatch) plus a fine mottling, so it reads as painted
 * meadow or floor rather than a flat slab. No textures. One material, one program.
 */
import * as THREE from 'three'
import { styleShader } from './toon'

export const GROUND_UNIFORMS = {
  uGroundAlt: { value: new THREE.Color('#7f8a52') },
  uGroundPatch: { value: 0.55 } // how strong the patches are (interiors calmer)
}

/**
 * Gen loop 7 (art_direction_botw.md): painted meadow variation, shared by the ground and the grass so the
 * blades carry the patch they grow in. `cjMeadow(p, k)` is a colour multiplier at world xz `p`: big warm
 * ochre swaths (where the sun "lands"), cooler blue-green hollows and a few long, soft brush strokes laid
 * along the wind. `k` scales it (the preset's groundPatch; interiors are calm). Needs a `float gNoise(vec2)`.
 */
export const MEADOW_GLSL = /* glsl */`
vec3 cjMeadow( vec2 p, float k ) {
  float warm = smoothstep( 0.52, 0.7, gNoise( p * 0.05 + vec2( 3.1, -7.4 ) ) * 0.7 + gNoise( p * 0.13 ) * 0.3 );
  float cool = smoothstep( 0.58, 0.76, gNoise( p * 0.062 + vec2( -11.0, 5.3 ) ) * 0.7 + gNoise( p * 0.15 + 2.0 ) * 0.3 );
  // Strokes: noise stretched 6:1 along the wind (grass.ts gust direction), light dabs and darker drags.
  vec2 w = vec2( 0.85, 0.53 );
  vec2 q = vec2( dot( p, w ) * 0.09, dot( p, vec2( -w.y, w.x ) ) * 0.55 );
  float st = gNoise( q + 19.0 ) * 0.7 + gNoise( q * 2.3 - 4.0 ) * 0.3;
  vec3 m = mix( vec3( 1.0 ), vec3( 1.1, 1.05, 0.8 ), warm * 0.8 );
  m *= mix( vec3( 1.0 ), vec3( 0.84, 0.95, 1.04 ), cool * ( 1.0 - warm ) * 0.85 );
  m *= 1.0 + 0.08 * smoothstep( 0.6, 0.7, st ) - 0.07 * ( 1.0 - smoothstep( 0.3, 0.4, st ) );
  return mix( vec3( 1.0 ), m, k );
}
`

/**
 * Gen loop 7: a low orange sun times a green meadow reads olive-straw. Divide part of the sun's hue
 * (luminance 1) back out of the direct light, for the ground and grass only (their own programs), so the
 * meadow stays green-gold while every prop keeps the full warm light. `k` is how much (0..1).
 */
export function sunFixGlsl(k: string): string {
  return /* glsl */`#include <lights_fragment_end>
  #if NUM_DIR_LIGHTS > 0
  {
    vec3 cjSc = directionalLights[ 0 ].color;
    vec3 cjSunHue = cjSc / max( dot( cjSc, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 );
    reflectedLight.directDiffuse /= mix( vec3( 1.0 ), cjSunHue * uCjLitHue, ${k} );
  }
  #endif`
}

export function groundMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x6f7d4f, roughness: 1, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    styleShader(sh)
    Object.assign(sh.uniforms, GROUND_UNIFORMS)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <lights_fragment_end>', sunFixGlsl('0.4 * min( 1.0, uGroundPatch * 1.8 )'))
      .replace('#include <common>', /* glsl */`#include <common>
varying vec2 vGroundXZ;
uniform vec3 uGroundAlt;
uniform float uGroundPatch;
float gHash( vec2 p ) { p = fract( p * vec2( 127.1, 311.7 ) ); p += dot( p, p + 34.5 ); return fract( p.x * p.y ); }
float gNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1, 0 ) ), u.x ), mix( gHash( i + vec2( 0, 1 ) ), gHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}
${MEADOW_GLSL}`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
  {
    float big = gNoise( vGroundXZ * 0.035 ) * 0.65 + gNoise( vGroundXZ * 0.09 + 7.0 ) * 0.35;
    float patchK = smoothstep( 0.46, 0.6, big ) * uGroundPatch;
    diffuseColor.rgb = mix( diffuseColor.rgb, uGroundAlt, patchK );
    float fine = gNoise( vGroundXZ * 0.9 ) - 0.5;
    diffuseColor.rgb *= 1.0 + fine * 0.07 * uGroundPatch;
    diffuseColor.rgb *= cjMeadow( vGroundXZ, min( 1.0, uGroundPatch * 1.8 ) );
  }`)
  }
  m.customProgramCacheKey = () => 'voice-world-ground'
  return m
}
