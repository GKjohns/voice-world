/**
 * "Painted Toy World" shading, installed once for every material in the app (art_direction.md §3.1, §3.3).
 *
 * Instead of swapping every MeshStandardMaterial for a MeshToonMaterial (hundreds of call sites, the
 * recolour/glow code that reads `.emissive`/`.roughness`, people, forge output), the standard material's
 * own shader chunks are patched globally before anything compiles:
 * - direct light falls in soft bands (shade / mid / lit) instead of a smooth Lambert gradient;
 * - a thin rim of the sky's horizon colour catches every silhouette;
 * - fog is height-aware (valleys fill, peaks stay) and hue-shifted (warm near, the cool sky colour far).
 * The extra uniforms are shared objects, attached in one `Material.prototype.onBeforeCompile`, so every
 * material reads the live values and no program variant is added (the hook is the same function for all;
 * three keys programs on its source). Light count is untouched (perf/lights.ts), so warm-up stays valid.
 */
import * as THREE from 'three'

/** Live values every material reads. The renderer sets them from the atmosphere preset. */
export const STYLE_UNIFORMS = {
  uCjToon: { value: 1 }, // 0 = plain Lambert, 1 = full bands
  uCjRim: { value: 0.35 },
  uCjRimColor: { value: new THREE.Color('#ffd9b0') },
  uCjFogWarm: { value: new THREE.Color('#e8c39a') },
  uCjFogHeight: { value: 0.045 }, // 1/m: how fast fog thins with height above the base
  uCjFogBase: { value: 0 },
  uCjTime: { value: 0 }
}

/** Attach the shared uniforms to a compiling shader. Materials with their own onBeforeCompile call this. */
export function styleShader(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, STYLE_UNIFORMS)
}

const BAND = /* glsl */`
uniform float uCjToon;
uniform float uCjRim;
uniform vec3 uCjRimColor;
// Soft three-band ramp on N·L: shade (0) / mid (~0.5) / lit (1). Bands overlap a little so the edges
// stay soft (LinearFilter, not Nearest, in toon terms); a quarter of the smooth term keeps round forms round.
float cjBand( float x ) {
  float b = 0.48 * smoothstep( -0.02, 0.1, x ) + 0.52 * smoothstep( 0.34, 0.5, x );
  return mix( saturate( x ), mix( saturate( x ), b, 0.78 ), uCjToon );
}
`

const PATCHED = ['lights_pars_begin', 'lights_physical_pars_fragment', 'lights_fragment_end', 'fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment']

export function installStyle(): void {
  // Always patch from three's pristine chunks (kept on globalThis), so a hot reload of this module
  // re-applies the current patch instead of stacking a second copy on top of the first.
  const g = globalThis as { __cjChunks?: Record<string, string> }
  const C = THREE.ShaderChunk as unknown as Record<string, string>
  g.__cjChunks ??= Object.fromEntries(PATCHED.map(k => [k, C[k]!]))
  for (const k of PATCHED) C[k] = g.__cjChunks[k]!

  // Shared declarations live with the light uniforms (included by every lit material).
  C.lights_pars_begin = BAND + C.lights_pars_begin

  // Banded direct light.
  const direct = 'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = dotNL * directLight.color;'
  if (!C.lights_physical_pars_fragment!.includes(direct)) console.warn('[style] physical direct-light chunk changed; toon bands off')
  C.lights_physical_pars_fragment = C.lights_physical_pars_fragment!.replace(direct,
    'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );\n\n\tvec3 irradiance = cjBand( dot( geometryNormal, directLight.direction ) ) * directLight.color;')

  // The sky fill bands too (softly), or round forms would keep a smooth gradient on their shaded side.
  const hemi = 'float hemiDiffuseWeight = 0.5 * dotNL + 0.5;'
  if (!C.lights_pars_begin!.includes(hemi)) console.warn('[style] hemisphere chunk changed; fill bands off')
  C.lights_pars_begin = C.lights_pars_begin!.replace(hemi,
    'float hemiDiffuseWeight = 0.5 * dotNL + 0.5;\n\t\themiDiffuseWeight = mix( hemiDiffuseWeight, 0.22 + 0.78 * smoothstep( 0.28, 0.62, hemiDiffuseWeight ), 0.55 * uCjToon );')

  // Rim: the sky's horizon colour on grazing angles, a little brighter on the shaded side.
  C.lights_fragment_end = C.lights_fragment_end + /* glsl */`
  {
    float cjNV = saturate( dot( geometryNormal, geometryViewDir ) );
    // Not on up-facing surfaces (ground, grass, roofs seen at a grazing angle): silhouettes only.
    float cjUp = dot( geometryNormal, normalize( viewMatrix[ 1 ].xyz ) );
    float cjRim = pow( 1.0 - cjNV, 3.0 ) * uCjRim * ( 1.0 - smoothstep( 0.35, 0.85, cjUp ) );
    reflectedLight.indirectDiffuse += uCjRimColor * cjRim * ( 0.35 + 0.65 * material.diffuseColor );
  }
`

  // Height + hue-shifted fog. World position from the view-space position (works for meshes, points and
  // sprites alike: every fog-capable shader has mvPosition when fog_vertex runs).
  C.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying float vFogDepth;\n\tvarying vec3 vCjFogWorld;\n#endif\n'
  C.fog_vertex = '#ifdef USE_FOG\n\tvFogDepth = - mvPosition.z;\n\tvCjFogWorld = transpose( mat3( viewMatrix ) ) * ( mvPosition.xyz - viewMatrix[ 3 ].xyz );\n#endif\n'
  C.fog_pars_fragment = /* glsl */`
#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vCjFogWorld;
  uniform vec3 uCjFogWarm;
  uniform float uCjFogHeight;
  uniform float uCjFogBase;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif
`
  C.fog_fragment = /* glsl */`
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
    vec3 cjFogC = fogColor;
  #else
    float cjT = smoothstep( fogNear, fogFar, vFogDepth );
    // Ease in: the near field stays crisp, the haze builds toward the horizon.
    float fogFactor = cjT * cjT * ( 1.6 - 0.6 * cjT );
    // Height falloff, except while a teleport has pulled the fog in to metres (then it veils everything).
    float cjOpen = smoothstep( 12.0, 40.0, fogFar );
    float cjH = exp( - max( vCjFogWorld.y - uCjFogBase, 0.0 ) * uCjFogHeight );
    fogFactor *= mix( 1.0, mix( 0.35, 1.0, cjH ), cjOpen );
    // Warm near, the horizon (sky) colour far. A material without the hook reads 0 here: plain fog.
    float cjHasWarm = step( 0.001, dot( uCjFogWarm, vec3( 1.0 ) ) );
    vec3 cjFogC = mix( fogColor, mix( uCjFogWarm, fogColor, smoothstep( fogNear * 0.3, fogFar * 0.6, vFogDepth ) ), cjHasWarm );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, cjFogC, fogFactor );
#endif
`

  // Every material gets the shared uniforms (ShaderMaterials too: extra uniforms are harmless).
  THREE.Material.prototype.onBeforeCompile = function cjStyleHook(shader: THREE.WebGLProgramParametersWithUniforms): void {
    styleShader(shader)
  }
}

installStyle()
