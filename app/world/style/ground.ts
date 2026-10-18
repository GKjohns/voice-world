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

export function groundMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: 0x6f7d4f, roughness: 1, metalness: 0 })
  m.onBeforeCompile = (sh) => {
    styleShader(sh)
    Object.assign(sh.uniforms, GROUND_UNIFORMS)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', /* glsl */`#include <common>
varying vec2 vGroundXZ;
uniform vec3 uGroundAlt;
uniform float uGroundPatch;
float gHash( vec2 p ) { p = fract( p * vec2( 127.1, 311.7 ) ); p += dot( p, p + 34.5 ); return fract( p.x * p.y ); }
float gNoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p ); vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( gHash( i ), gHash( i + vec2( 1, 0 ) ), u.x ), mix( gHash( i + vec2( 0, 1 ) ), gHash( i + vec2( 1, 1 ) ), u.x ), u.y );
}`)
      .replace('#include <color_fragment>', /* glsl */`#include <color_fragment>
  {
    float big = gNoise( vGroundXZ * 0.035 ) * 0.65 + gNoise( vGroundXZ * 0.09 + 7.0 ) * 0.35;
    float patchK = smoothstep( 0.46, 0.6, big ) * uGroundPatch;
    diffuseColor.rgb = mix( diffuseColor.rgb, uGroundAlt, patchK );
    float fine = gNoise( vGroundXZ * 0.9 ) - 0.5;
    diffuseColor.rgb *= 1.0 + fine * 0.07 * uGroundPatch;
  }`)
  }
  m.customProgramCacheKey = () => 'conjure-ground'
  return m
}
