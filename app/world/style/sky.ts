/**
 * The painted sky dome (art_direction.md §3.3): a gradient, a warm horizon band toward the sun, a big flat
 * sun disc with a soft ring, and puffy two-tone clouds painted in the same shader (layered value noise,
 * lit on the sun side). One draw call, no textures. It follows the camera, so you never reach its edge.
 * The bottom melts into the fog colour so the ground's far edge meets the sky with no seam, and `veil`
 * drowns it in fog while a teleport summons the next place.
 */
import * as THREE from 'three'

const VERT = 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }'

const FRAG = /* glsl */`
uniform vec3 top;
uniform vec3 horizon;
uniform vec3 fogColor;
uniform float veil;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform float sunDisc;
uniform float sunGlow;
uniform vec3 glowColor;
uniform vec3 cloudLit;
uniform vec3 cloudShade;
uniform float cloudCover;
uniform float time;
varying vec3 vDir;

float hash( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float vnoise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( hash( i + vec2( 0.0, 1.0 ) ), hash( i + vec2( 1.0, 1.0 ) ), u.x ), u.y );
}
float fbm( vec2 p ) {
  float a = 0.5; float s = 0.0;
  for ( int i = 0; i < 4; i ++ ) { s += a * vnoise( p ); p = p * 2.03 + vec2( 17.1, 9.2 ); a *= 0.5; }
  return s;
}

void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  vec3 c = mix( horizon, top, pow( clamp( h, 0.0, 1.0 ), 0.5 ) );
  vec3 sd = normalize( sunDir );
  float toward = max( dot( normalize( vec3( d.x, 0.0, d.z ) + 1e-5 ), normalize( vec3( sd.x, 0.0, sd.z ) + 1e-5 ) ), 0.0 );
  // A warm band on the horizon on the sun's side (golden, dusk, dawn).
  c += glowColor * sunGlow * pow( 1.0 - clamp( h, 0.0, 1.0 ), 5.0 ) * ( 0.25 + 0.75 * toward * toward );

  // Clouds: noise on a plane above you, thresholded into soft graphic puffs, lit on the side toward the sun.
  if ( cloudCover > 0.01 ) {
    vec2 uv = d.xz / ( max( h, 0.0 ) + 0.14 ) * 0.9 + vec2( time * 0.006, time * 0.002 );
    float n = fbm( uv );
    float thr = 0.8 - cloudCover * 0.5;
    // Crisp, graphic edges: about a pixel and a half of softening whatever the noise scale.
    float w = max( fwidth( n ) * 1.5, 0.012 );
    float m = smoothstep( thr - w, thr + w, n ) * smoothstep( 0.0, 0.1, h );
    float n2 = fbm( uv + sd.xz * 0.22 );
    float lit = smoothstep( -0.03, 0.05, n - n2 );
    float core = smoothstep( thr + 0.05, thr + 0.3, n );
    vec3 cc = mix( cloudShade, cloudLit, clamp( 0.3 + 0.7 * lit - 0.25 * core, 0.0, 1.0 ) );
    // Far clouds sink into the horizon haze.
    cc = mix( cc, horizon, 1.0 - smoothstep( 0.02, 0.35, h ) );
    c = mix( c, cc, m * 0.96 );
  }

  // The sun: a flat disc with a soft ring (drawn over clouds, so it can peek through).
  float sdot = dot( d, sd );
  float disc = smoothstep( 0.9984, 0.9988, sdot );
  float ring = pow( max( sdot, 0.0 ), 300.0 ) * 0.5 + pow( max( sdot, 0.0 ), 24.0 ) * 0.18;
  c += sunColor * sunDisc * ( disc * 1.6 + ring );

  c = mix( fogColor, c, smoothstep( -0.03, 0.12, h ) );
  c = mix( c, fogColor, veil );
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export function skyUniforms() {
  return {
    top: { value: new THREE.Color() },
    horizon: { value: new THREE.Color() },
    fogColor: { value: new THREE.Color() },
    veil: { value: 0 },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color() },
    sunDisc: { value: 0 },
    sunGlow: { value: 0 },
    glowColor: { value: new THREE.Color() },
    cloudLit: { value: new THREE.Color() },
    cloudShade: { value: new THREE.Color() },
    cloudCover: { value: 0 },
    time: { value: 0 }
  }
}
export type SkyUniforms = ReturnType<typeof skyUniforms>

export function skyDome(uniforms: SkyUniforms): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(500, 48, 24),
    new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms, vertexShader: VERT, fragmentShader: FRAG })
  )
  m.renderOrder = -1
  return m
}
