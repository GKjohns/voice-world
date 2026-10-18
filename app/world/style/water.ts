/**
 * Stylised water (art_direction.md §3.7, Wind Waker): a flat palette colour that turns toward the sky's
 * horizon colour at grazing angles (fresnel), with animated cellular highlight lines drifting across it.
 * No reflections, no refraction targets, no textures: one shared program for every lake, river and sea.
 */
import * as THREE from 'three'
import { styleShader } from './toon'

const PARS = /* glsl */`
varying vec3 vWaterW;
uniform float uCjTime;
vec2 wHash2( vec2 p ) { p = vec2( dot( p, vec2( 127.1, 311.7 ) ), dot( p, vec2( 269.5, 183.3 ) ) ); return fract( sin( p ) * 43758.5453 ); }
// Worley: distance to the nearest and second-nearest feature point.
vec2 wCell( vec2 p, float t ) {
  vec2 i = floor( p ); vec2 f = fract( p );
  float d1 = 8.0; float d2 = 8.0;
  for ( int y = -1; y <= 1; y ++ ) for ( int x = -1; x <= 1; x ++ ) {
    vec2 g = vec2( float( x ), float( y ) );
    vec2 o = wHash2( i + g );
    o = 0.5 + 0.42 * sin( t * 0.7 + 6.2831 * o );
    float d = length( g + o - f );
    if ( d < d1 ) { d2 = d1; d1 = d; } else if ( d < d2 ) { d2 = d; }
  }
  return vec2( d1, d2 );
}
`

/** Patch a standard material's shader into stylised water (adds its own varying and the shared uniforms). */
export function waterPatch(sh: THREE.WebGLProgramParametersWithUniforms): void {
  styleShader(sh)
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWaterW;')
    .replace('#include <project_vertex>', '#include <project_vertex>\nvWaterW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\n' + PARS)
    .replace('#include <emissivemap_fragment>', /* glsl */`#include <emissivemap_fragment>
  {
    float t = uCjTime;
    vec2 a = wCell( vWaterW.xz * 0.32 + vec2( t * 0.05, t * 0.03 ), t );
    vec2 b = wCell( vWaterW.xz * 0.21 - vec2( t * 0.035, t * 0.05 ) + 3.7, t * 0.8 );
    float lines = max( 1.0 - smoothstep( 0.0, 0.03, a.y - a.x ), 0.6 * ( 1.0 - smoothstep( 0.0, 0.035, b.y - b.x ) ) );
    float dist = length( vViewPosition );
    // Broken into drifting fragments (Wind Waker squiggles, not a net), and calm in the distance.
    vec2 bw = vWaterW.xz * 0.12 + vec2( t * 0.03, - t * 0.02 );
    float br = fract( sin( dot( floor( bw ), vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
    vec2 bf = fract( bw ) - 0.5;
    lines *= smoothstep( 0.42, 0.18, length( bf ) ) * step( 0.35, br );
    lines *= 1.0 - smoothstep( 18.0, 55.0, dist );
    float fres = pow( 1.0 - saturate( dot( normal, normalize( vViewPosition ) ) ), 4.0 );
    diffuseColor.rgb *= 0.78;
    totalEmissiveRadiance += uCjRimColor * fres * 0.16 + vec3( 0.85, 0.95, 1.0 ) * lines * 0.3;
  }`)
}

export function waterMaterial(color: THREE.ColorRepresentation, opts: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0, ...opts })
  m.onBeforeCompile = sh => waterPatch(sh)
  m.customProgramCacheKey = () => 'voice-world-water'
  return m
}
