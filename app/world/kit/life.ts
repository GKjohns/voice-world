// Life (Sprint 4): particle kinds. One small shader drives all three: points wander (fireflies), drift
// (dust motes) or rise and fade into smoke (embers). The renderer calls userData.animate(t) every frame.
import * as THREE from 'three'
import { group, seeded } from './helpers'
import type { Build } from './helpers'

interface Swarm {
  count: number
  box: [number, number, number] // spread x, height, spread z
  y0: number
  size: number
  wander: number
  blink: number
  rise: number // m/s; 0 = no rise
  smoke: number // 0..1 how much it greys out at the top
  opacity: number
  additive: boolean
}

const VERT = `
attribute float aPhase;
uniform float uTime, uSize, uWander, uRise, uHeight, uBlink, uScale;
varying float vAlpha, vH;
void main() {
  vec3 p = position;
  float ph = aPhase * 6.2831;
  p += uWander * vec3(sin(uTime * 0.7 + ph), 0.5 * sin(uTime * 0.9 + ph * 1.7), cos(uTime * 0.6 + ph * 1.3));
  vH = 0.0;
  if (uRise > 0.0) {
    float h = mod(position.y + uTime * uRise * (0.6 + 0.8 * aPhase), uHeight);
    p.y = h;
    vH = h / uHeight;
    p.x += sin(uTime * 1.3 + ph) * 0.25 * vH;
  }
  float blink = mix(1.0, smoothstep(-0.2, 1.0, sin(uTime * (1.2 + aPhase * 1.5) + ph)), uBlink);
  vAlpha = blink * (uRise > 0.0 ? (1.0 - vH) : 1.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = uSize * uScale * (1.0 + vH * 3.0) / max(0.5, -mv.z);
  gl_Position = projectionMatrix * mv;
}`

const FRAG = `
uniform vec3 uColor;
uniform float uOpacity, uSmoke;
varying float vAlpha, vH;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  vec3 c = mix(uColor, vec3(0.55, 0.53, 0.5), clamp(vH * 1.4, 0.0, 1.0) * uSmoke);
  gl_FragColor = vec4(c * (1.0 + 0.6 * (1.0 - uSmoke * vH)), a * vAlpha * uOpacity);
}`

function swarm(s: Swarm, color: string, seed: string): THREE.Group {
  const rand = seeded(seed)
  const pos = new Float32Array(s.count * 3)
  const phase = new Float32Array(s.count)
  for (let i = 0; i < s.count; i++) {
    pos[i * 3] = (rand() - 0.5) * s.box[0]
    pos[i * 3 + 1] = s.y0 + rand() * s.box[1]
    pos[i * 3 + 2] = (rand() - 0.5) * s.box[2]
    phase[i] = rand()
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1))
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, s.y0 + s.box[1] / 2, 0), Math.hypot(s.box[0], s.box[1], s.box[2]))
  const uniforms = {
    uTime: { value: 0 }, uSize: { value: s.size }, uWander: { value: s.wander }, uRise: { value: s.rise }, uHeight: { value: s.box[1] + s.y0 },
    uBlink: { value: s.blink }, uScale: { value: window.innerHeight / 2 }, uColor: { value: new THREE.Color(color) }, uOpacity: { value: s.opacity }, uSmoke: { value: s.smoke }
  }
  const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
    blending: s.additive ? THREE.AdditiveBlending : THREE.NormalBlending
  }))
  pts.frustumCulled = false
  // Points aren't meshes, so the raycaster-based gaze and the slot recolour both leave them alone.
  pts.raycast = () => {}
  const g = group(pts)
  g.userData.animate = (t: number) => {
    uniforms.uTime.value = t
  }
  return g
}

export const fireflies: Build = ({ length = 24, width = 24, color = '#fff1a0' }) =>
  swarm({ count: Math.round(Math.min(260, 40 + length * width * 0.25)), box: [length, 2.6, width], y0: 0.4, size: 0.16, wander: 0.6, blink: 1, rise: 0, smoke: 0, opacity: 1, additive: true }, color, `ff${length}x${width}`)

export const dust_motes: Build = ({ length = 14, width = 14, color = '#ffe2b0' }) =>
  swarm({ count: Math.round(Math.min(300, 60 + length * width * 0.6)), box: [length, 3.2, width], y0: 0.3, size: 0.045, wander: 0.35, blink: 0.3, rise: 0, smoke: 0, opacity: 0.55, additive: true }, color, `dm${length}x${width}`)

export const embers: Build = ({ color = '#ff8a3c' }) =>
  swarm({ count: 70, box: [0.7, 4.5, 0.7], y0: 0.3, size: 0.07, wander: 0.15, blink: 0.4, rise: 0.9, smoke: 1, opacity: 0.9, additive: false }, color, 'embers')
