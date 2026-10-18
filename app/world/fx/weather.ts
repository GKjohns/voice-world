/**
 * Weather and sky events (Loop 2): rain, snow, a storm with lightning, fog, an aurora, and one-shot events
 * (a lightning strike, a meteor shower, an eclipse). Everything lives around the player and costs a few
 * draw calls: rain and snow are one GPU point cloud each (the shader wraps the drops around the camera and
 * animates them, so nothing is written per frame), the aurora is two curtain ribbons, a bolt is a handful
 * of camera-facing quads.
 *
 * `grade(preset)` folds the weather into the time-of-day preset (a storm dims the sun and greys the sky,
 * snow whitens the ground, a flash lights everything), so the renderer applies one graded preset.
 */
import * as THREE from 'three'
import type { SkyEvent, Vec3, Weather } from '#shared/world/ops'
import type { AtmospherePreset } from '../atmosphere'
import { softDot } from './common'

const BOX = 48 // metres of rain around the camera (x and z)
const TOP = 26 // drops fall from this high
const RAIN_N = 14000
const SNOW_N = 7000
const SNOW_NIGHT = new THREE.Color('#dfe8ff')

interface Blend { cur: number, to: number }

const PRECIP_VERT = `
attribute float aSeed;
uniform float uTime, uFall, uSize, uSway, uBox, uTop, uCount, uMinPx;
uniform vec3 uCam;
varying float vAlpha;
void main() {
  if (aSeed > uCount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  vec3 p = position;
  float fall = uFall * (0.75 + 0.5 * fract(aSeed * 13.7));
  p.y = mod(p.y - uTime * fall, uTop);
  p.x += uSway * sin(uTime * (0.6 + fract(aSeed * 7.3)) + aSeed * 40.0);
  p.z += uSway * cos(uTime * (0.5 + fract(aSeed * 3.1)) + aSeed * 23.0);
  // Wrap the cloud around the camera so it never runs out.
  p.xz = uCam.xz + mod(p.xz - uCam.xz + uBox * 0.5, uBox) - uBox * 0.5;
  p.y += max(0.0, uCam.y - 12.0);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vAlpha = smoothstep(0.5, 2.5, d) * (1.0 - smoothstep(uBox * 0.22, uBox * 0.5, length(p.xz - uCam.xz)));
  float px = uSize * 300.0 / max(d, 0.5);
  // Snow (Loop 3): a flake too far to be bigger than a few pixels reads as a star, so it fades out.
  vAlpha *= smoothstep(uMinPx * 0.5, uMinPx * 1.6, px);
  gl_PointSize = clamp(px, 2.0, 72.0);
  gl_Position = projectionMatrix * mv;
}`

const RAIN_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float x = c.x + c.y * 0.18; // a slight slant in the wind
  float streak = (1.0 - smoothstep(0.015, 0.06, abs(x))) * (1.0 - smoothstep(0.25, 0.5, abs(c.y)));
  float a = streak * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`

const SNOW_FRAG = `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uMap;
varying float vAlpha;
void main() {
  // A soft flake with a brighter core: big and blurry near you, so night snow reads as snow, not stars.
  // A touch taller than wide: a flake caught falling, not a star.
  vec2 q = vec2(0.5 + (gl_PointCoord.x - 0.5) * 1.35, gl_PointCoord.y);
  float m = texture2D(uMap, q).a;
  float core = 1.0 - smoothstep(0.0, 0.3, length(q - 0.5));
  float a = max(m * 0.8, core) * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor * (0.85 + 0.35 * core), a);
}`

// Overcast: a dome of drifting fbm clouds, dark underneath, lit from within by lightning.
const CLOUD_FRAG = `
uniform float uTime, uCover, uFlash;
uniform vec3 uDark, uLight;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  if (d.y < -0.02) discard;
  vec2 uv = d.xz / (d.y + 0.12) * 1.4 + vec2(uTime * 0.012, uTime * 0.005);
  float n = fbm(uv);
  float n2 = fbm(uv * 2.7 - uTime * 0.01);
  float dens = smoothstep(0.62 - 0.45 * uCover, 0.95 - 0.2 * uCover, n + 0.25 * n2);
  vec3 col = mix(uDark, uLight, smoothstep(0.3, 0.9, n2) * 0.7);
  col += uFlash * vec3(0.75, 0.8, 1.0) * (0.4 + 0.9 * n2);
  float a = dens * uCover * smoothstep(-0.02, 0.18, d.y);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const AURORA_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`

// Curtains of light: vertical rays that ripple sideways, green at the hem, violet at the top.
const AURORA_FRAG = `
uniform float uTime, uStrength, uSeed;
varying vec2 vUv;
float hash(float n) { return fract(sin(n) * 43758.5453); }
float noise(float x) { float i = floor(x); float f = fract(x); return mix(hash(i + uSeed), hash(i + 1.0 + uSeed), f * f * (3.0 - 2.0 * f)); }
void main() {
  float x = vUv.x * 9.0 + sin(vUv.x * 5.0 + uTime * 0.11 + uSeed) * 0.8;
  float rays = noise(x * 6.0 + uTime * 0.35) * 0.6 + noise(x * 17.0 - uTime * 0.6) * 0.4;
  float fold = 0.55 + 0.45 * sin(vUv.x * 21.0 + uTime * 0.25 + noise(vUv.x * 4.0) * 3.0);
  float hem = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(0.3, 1.0, vUv.y));
  float ends = smoothstep(0.0, 0.18, vUv.x) * (1.0 - smoothstep(0.82, 1.0, vUv.x));
  float a = pow(rays, 1.6) * fold * hem * ends * uStrength;
  vec3 green = vec3(0.25, 1.0, 0.62);
  vec3 violet = vec3(0.62, 0.32, 1.0);
  vec3 col = mix(green, violet, smoothstep(0.25, 0.85, vUv.y)) * (1.2 + 0.8 * (1.0 - vUv.y));
  gl_FragColor = vec4(col * a, a);
}`

interface Bolt { mesh: THREE.Mesh, glow: THREE.Sprite, born: number, life: number, flicker: number[] }
interface Meteor { from: THREE.Vector3, dir: THREE.Vector3, born: number, life: number, len: number }

export class WeatherFx {
  readonly obj = new THREE.Group()
  /** Called when a strike's thunder should start: distance in metres, delay in ms. */
  onThunder?: (distance: number, delayMs: number) => void
  onStar?: () => void

  private rain: THREE.Points
  private rainU: Record<string, THREE.IUniform>
  private snow: THREE.Points
  private snowU: Record<string, THREE.IUniform>
  private aurora: THREE.Mesh[] = []
  private clouds: THREE.Mesh
  private blend: Record<'rain' | 'storm' | 'snow' | 'aurora', Blend> = { rain: { cur: 0, to: 0 }, storm: { cur: 0, to: 0 }, snow: { cur: 0, to: 0 }, aurora: { cur: 0, to: 0 } }
  private flash = 0
  private bolts: Bolt[] = []
  private meteors: Meteor[] = []
  private meteorMesh: THREE.Mesh
  private meteorPos: Float32Array
  private meteorAlpha: Float32Array
  private meteorUntil = 0
  private nextMeteor = 0
  private eclipse: { start: number, dur: number } | null = null
  private eclipseDisc: THREE.Sprite
  private corona: THREE.Sprite
  private nextStrike = 0
  /** Strikes left in a storm's opening flurry (the gap after them is short). */
  private opening = 0
  private weather: Weather | undefined
  private t = 0

  constructor() {
    const make = (n: number, frag: string, extra: Record<string, THREE.IUniform>, blending: THREE.Blending) => {
      const pos = new Float32Array(n * 3)
      const seed = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        pos.set([(Math.random() - 0.5) * BOX, Math.random() * TOP, (Math.random() - 0.5) * BOX], i * 3)
        seed[i] = i / n
      }
      const geo = new THREE.BufferGeometry()
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
      const uniforms: Record<string, THREE.IUniform> = {
        uTime: { value: 0 }, uFall: { value: 1 }, uSize: { value: 1 }, uSway: { value: 0 }, uBox: { value: BOX }, uTop: { value: TOP },
        uCount: { value: 0 }, uMinPx: { value: 0 }, uCam: { value: new THREE.Vector3() }, uColor: { value: new THREE.Color() }, uOpacity: { value: 0 }, ...extra
      }
      const pts = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms, vertexShader: PRECIP_VERT, fragmentShader: frag, transparent: true, depthWrite: false, blending }))
      pts.frustumCulled = false
      pts.visible = false
      pts.renderOrder = 4
      pts.raycast = () => {}
      return { pts, uniforms }
    }
    const r = make(RAIN_N, RAIN_FRAG, {}, THREE.NormalBlending)
    this.rain = r.pts
    this.rainU = r.uniforms
    this.rainU.uFall!.value = 22
    this.rainU.uSize!.value = 0.55
    ;(this.rainU.uColor!.value as THREE.Color).set('#b8c8e0')
    const s = make(SNOW_N, SNOW_FRAG, { uMap: { value: softDot() } }, THREE.NormalBlending)
    this.snow = s.pts
    this.snowU = s.uniforms
    this.snowU.uFall!.value = 1.3
    this.snowU.uSize!.value = 0.24
    this.snowU.uSway!.value = 0.7
    ;(this.snowU.uColor!.value as THREE.Color).set('#f4f7ff')
    this.obj.add(this.rain, this.snow)

    this.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(440, 48, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uCover: { value: 0 }, uFlash: { value: 0 }, uDark: { value: new THREE.Color() }, uLight: { value: new THREE.Color() } },
        vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: CLOUD_FRAG,
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        fog: false
      })
    )
    this.clouds.renderOrder = -1
    this.clouds.frustumCulled = false
    this.clouds.visible = false
    this.clouds.raycast = () => {}
    this.obj.add(this.clouds)

    // Two curtains, one behind the other, low over the northern horizon of wherever you stand.
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.PlaneGeometry(1, 1, 96, 1)
      const p = geo.attributes.position!
      const R = 330 + i * 70
      for (let k = 0; k < p.count; k++) {
        const u = p.getX(k) + 0.5 // 0..1 along the curtain
        const v = p.getY(k) + 0.5
        const a = -1.25 + u * 2.5 + i * 0.4
        const wob = Math.sin(u * 7 + i) * 22
        p.setXYZ(k, Math.sin(a) * (R + wob), 55 + i * 25 + v * (110 - i * 15), -Math.cos(a) * (R + wob))
      }
      geo.computeBoundingSphere()
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uStrength: { value: 0 }, uSeed: { value: i * 17.3 } },
        vertexShader: AURORA_VERT,
        fragmentShader: AURORA_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        fog: false
      })
      const m = new THREE.Mesh(geo, mat)
      m.frustumCulled = false
      m.visible = false
      m.renderOrder = 0
      m.raycast = () => {}
      this.aurora.push(m)
      this.obj.add(m)
    }

    // Meteors: up to 24 camera-facing streaks in one dynamic mesh.
    const MN = 24
    this.meteorPos = new Float32Array(MN * 4 * 3)
    this.meteorAlpha = new Float32Array(MN * 4)
    const idx: number[] = []
    for (let i = 0; i < MN; i++) idx.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3)
    const mg = new THREE.BufferGeometry()
    mg.setAttribute('position', new THREE.BufferAttribute(this.meteorPos, 3))
    mg.setAttribute('aAlpha', new THREE.BufferAttribute(this.meteorAlpha, 1))
    mg.setIndex(idx)
    this.meteorMesh = new THREE.Mesh(mg, new THREE.ShaderMaterial({
      vertexShader: 'attribute float aAlpha; varying float vA; void main() { vA = aAlpha; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main() { gl_FragColor = vec4(vec3(1.0, 0.95, 0.85) * vA, vA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide
    }))
    this.meteorMesh.frustumCulled = false
    this.meteorMesh.visible = false
    this.meteorMesh.raycast = () => {}
    this.obj.add(this.meteorMesh)

    // Eclipse: a black disc slides over a bright corona.
    this.corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: '#fff3d6', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
    this.corona.scale.setScalar(120)
    this.eclipseDisc = new THREE.Sprite(new THREE.SpriteMaterial({ map: discTexture(), color: '#05060a', transparent: true, opacity: 0, depthWrite: false, fog: false }))
    this.eclipseDisc.scale.setScalar(34)
    this.corona.visible = this.eclipseDisc.visible = false
    this.corona.raycast = () => {}
    this.eclipseDisc.raycast = () => {}
    this.corona.renderOrder = this.eclipseDisc.renderOrder = 0
    this.obj.add(this.corona, this.eclipseDisc)
  }

  /** The persistent weather. It fades in and out over a few seconds. */
  set(w: Weather | undefined): void {
    if (w === this.weather) return
    this.weather = w
    this.blend.rain.to = w === 'rain' ? 1 : 0
    this.blend.storm.to = w === 'storm' ? 1 : 0
    this.blend.snow.to = w === 'snow' ? 1 : 0
    this.blend.aurora.to = w === 'aurora' ? 1 : 0
    // A storm opens with a strike almost at once, then a second soon after (Loop 3: 4–9 s from there).
    if (w === 'storm') {
      this.nextStrike = this.t + 0.7
      this.opening = 1
    }
  }

  /** A one-shot sky event. `at` is where lightning strikes (else somewhere ahead in the distance). */
  event(kind: SkyEvent, cam: THREE.Camera, at?: Vec3): void {
    if (kind === 'lightning') this.strike(cam, at, true)
    else if (kind === 'meteors') {
      this.meteorUntil = this.t + 9
      this.nextMeteor = this.t
    } else if (kind === 'eclipse') {
      this.eclipse = { start: this.t, dur: 11 }
    }
  }

  /** Advance everything; returns true while the grade is changing (the renderer re-applies the preset). */
  tick(dt: number, cam: THREE.Camera, sky: AtmospherePreset): boolean {
    this.t += dt
    const t = this.t
    let changing = false
    for (const b of Object.values(this.blend)) {
      if (Math.abs(b.to - b.cur) > 1e-3) {
        b.cur += (b.to - b.cur) * Math.min(1, dt * (b.to > b.cur ? 0.7 : 0.9))
        if (Math.abs(b.to - b.cur) < 2e-3) b.cur = b.to
        changing = true
      }
    }
    const cp = cam.position
    const rainK = Math.max(this.blend.rain.cur * 0.55, this.blend.storm.cur)
    this.rain.visible = rainK > 0.01
    if (this.rain.visible) {
      this.rainU.uTime!.value = t
      ;(this.rainU.uCam!.value as THREE.Vector3).copy(cp)
      this.rainU.uCount!.value = rainK
      this.rainU.uOpacity!.value = 0.42 + 0.25 * this.blend.storm.cur + 0.4 * this.flash
    }
    this.snow.visible = this.blend.snow.cur > 0.01
    if (this.snow.visible) {
      this.snowU.uTime!.value = t
      ;(this.snowU.uCam!.value as THREE.Vector3).copy(cp)
      this.snowU.uCount!.value = this.blend.snow.cur
      // At night, bigger, brighter, softer flakes and no distant pinpricks (they read as stars).
      const night = 1 - Math.min(1, luminance(sky.skyTop) / 0.12)
      this.snowU.uOpacity!.value = 0.95
      this.snowU.uSize!.value = 0.24 + 0.26 * night
      this.snowU.uMinPx!.value = 2.5 + 7 * night
      ;(this.snowU.uColor!.value as THREE.Color).set('#f4f7ff').lerp(SNOW_NIGHT, night * 0.5)
    }
    // Clouds close over the sky for rain, storm and snow.
    // A snowy night is fully overcast (a starry gap behind falling flakes reads as more stars).
    const snowNight = 1 - Math.min(1, luminance(sky.skyTop) / 0.12)
    const cover = Math.max(this.blend.storm.cur, this.blend.rain.cur * 0.75, this.blend.snow.cur * (0.6 + 0.35 * snowNight))
    this.clouds.visible = cover > 0.01
    if (this.clouds.visible) {
      const u = (this.clouds.material as THREE.ShaderMaterial).uniforms
      u.uTime!.value = t
      u.uCover!.value = cover
      u.uFlash!.value = this.flash
      const fog = new THREE.Color(sky.fog)
      ;(u.uDark!.value as THREE.Color).copy(fog).multiplyScalar(0.55 - 0.2 * this.blend.storm.cur)
      ;(u.uLight!.value as THREE.Color).copy(fog).lerp(new THREE.Color(sky.skyHorizon), 0.5).multiplyScalar(1.15)
      this.clouds.position.copy(cp)
    }
    // The aurora only shows once the sky is dark enough to hold it.
    const dark = 1 - Math.min(1, Math.max(0, (sky.exposure > 0 ? luminance(sky.skyTop) : 0) * 6))
    const auroraK = this.blend.aurora.cur * (0.25 + 0.75 * dark)
    for (const m of this.aurora) {
      m.visible = auroraK > 0.01
      m.position.set(cp.x, 0, cp.z)
      const u = (m.material as THREE.ShaderMaterial).uniforms
      u.uTime!.value = t
      u.uStrength!.value = auroraK * 1.3
    }

    // Storm: a strike every few seconds, somewhere around you.
    if (this.weather === 'storm' && t >= this.nextStrike) {
      this.strike(cam, undefined, false)
      this.nextStrike = t + (this.opening ? 2.6 + Math.random() * 1.2 : 4 + Math.random() * 5)
      this.opening = Math.max(0, this.opening - 1)
    }
    // Flash decays fast; bolts flicker and die.
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 3.2)
      changing = true
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i]!
      const age = t - b.born
      if (age > b.life) {
        this.obj.remove(b.mesh, b.glow)
        b.mesh.traverse((o) => {
          const m = o as THREE.Mesh
          m.geometry.dispose()
          ;(m.material as THREE.Material).dispose()
        })
        b.glow.material.dispose()
        this.bolts.splice(i, 1)
        continue
      }
      const on = b.flicker.some(f => age >= f && age < f + 0.06) || age < 0.09
      const fade = 1 - age / b.life
      ;(b.mesh.material as THREE.MeshBasicMaterial).opacity = on ? 1 : 0.25 * fade
      ;((b.mesh.children[0] as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (on ? 0.35 : 0.08) * fade
      b.glow.material.opacity = (on ? 0.9 : 0.2) * fade
    }

    this.tickMeteors(cam)
    if (this.eclipse) {
      changing = true
      if (t - this.eclipse.start > this.eclipse.dur) {
        this.eclipse = null
        this.corona.visible = this.eclipseDisc.visible = false
      } else {
        const dir = new THREE.Vector3(sky.sunPos[0], Math.max(18, sky.sunPos[1]), sky.sunPos[2]).normalize()
        const k = this.eclipseK()
        const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize()
        const travel = ((t - this.eclipse.start) / this.eclipse.dur - 0.5) * 2 // -1..1 across the sun
        this.corona.visible = this.eclipseDisc.visible = true
        this.corona.position.copy(cp).addScaledVector(dir, 400)
        this.eclipseDisc.position.copy(cp).addScaledVector(dir, 398).addScaledVector(side, travel * 40 * (1 - k * 0.98))
        this.corona.material.opacity = 0.35 + 0.65 * k
        this.eclipseDisc.material.opacity = 0.98
      }
    }
    return changing
  }

  /** How much snow lies (0..1): the renderer folds the meadow grass away under it. */
  snowCover(): number {
    return this.blend.snow.cur
  }

  /** Fold the weather into a time-of-day preset. */
  grade(a: AtmospherePreset): AtmospherePreset {
    const storm = this.blend.storm.cur
    const rain = this.blend.rain.cur
    const snow = this.blend.snow.cur
    const aur = this.blend.aurora.cur
    const ecl = this.eclipseK()
    const f = this.flash
    if (storm + rain + snow + aur + ecl + f < 1e-3) return a
    const out = { ...a }
    const wet = Math.max(storm, rain * 0.55)
    const grey = (hex: string, k: number, dim: number) => {
      const c = new THREE.Color(hex)
      const l = luminance(hex) * dim
      return '#' + c.lerp(new THREE.Color(l, l * 1.02, l * 1.08), k).getHexString()
    }
    for (const key of ['skyTop', 'skyHorizon', 'fog'] as const) out[key] = grey(out[key], wet * 0.85, 0.75)
    out.sunIntensity *= 1 - 0.8 * wet
    out.hemiIntensity *= 1 - 0.3 * wet
    out.fogNear *= 1 - 0.55 * wet
    out.fogFar *= 1 - 0.5 * wet
    out.stars *= 1 - wet
    out.grid *= 1 - wet
    out.moon *= 1 - 0.9 * wet
    out.sunGlow *= 1 - wet
    // Painted Toy World: a storm closes the clouds in and greys them, mutes the rim, the grade and the warm haze.
    out.sunDisc *= 1 - wet
    out.cloudCover = Math.min(0.95, out.cloudCover + 0.55 * wet)
    out.cloudLit = grey(out.cloudLit, wet * 0.8, 0.8)
    out.cloudShade = grey(out.cloudShade, wet * 0.8, 0.55)
    out.fogWarm = grey(out.fogWarm, wet * 0.85, 0.75)
    out.rim *= 1 - 0.5 * wet
    out.gradeSat *= 1 - 0.15 * wet
    // Wet ground: darker and a touch more reflective.
    out.ground = grey(out.ground, wet * 0.3, 0.7)
    out.env += 0.15 * wet
    if (snow > 0) {
      const pale = new THREE.Color('#d9e1ec')
      const night = luminance(a.skyTop) < 0.08
      for (const key of ['skyTop', 'skyHorizon', 'fog'] as const) out[key] = '#' + new THREE.Color(out[key]).lerp(night ? new THREE.Color(out[key]).multiplyScalar(1.6) : pale, snow * 0.45).getHexString()
      out.ground = '#' + new THREE.Color(out.ground).lerp(new THREE.Color(night ? '#8d98ad' : '#e9eef5'), snow * 0.75).getHexString()
      out.fogFar *= 1 - 0.35 * snow
      out.sunIntensity *= 1 - 0.35 * snow
      out.fogWarm = '#' + new THREE.Color(out.fogWarm).lerp(night ? new THREE.Color(out.fog) : pale, snow * 0.6).getHexString()
      out.cloudCover = Math.min(0.95, out.cloudCover + 0.35 * snow)
      out.sunDisc *= 1 - 0.6 * snow
      // Snow light: a night under fresh snow is never pitch dark (a soft fill off the white ground).
      out.hemiIntensity *= 1 + (night ? 0.6 : 0.15) * snow
      out.stars *= 1 - snow
      out.grid *= 1 - snow
    }
    if (aur > 0) {
      out.hemiSky = '#' + new THREE.Color(out.hemiSky).lerp(new THREE.Color('#62e0b0'), aur * 0.3).getHexString()
      out.skyHorizon = '#' + new THREE.Color(out.skyHorizon).lerp(new THREE.Color('#174a44'), aur * 0.35).getHexString()
      out.hemiIntensity *= 1 + 0.25 * aur
    }
    if (ecl > 0) {
      for (const key of ['skyTop', 'skyHorizon', 'fog'] as const) out[key] = '#' + new THREE.Color(out[key]).lerp(new THREE.Color(key === 'skyTop' ? '#070a18' : '#2a2238'), ecl * 0.8).getHexString()
      out.sunIntensity *= 1 - 0.9 * ecl
      out.hemiIntensity *= 1 - 0.6 * ecl
      out.stars = Math.max(out.stars, 0.7 * ecl)
      out.sunGlow *= 1 - ecl
    }
    if (f > 0) {
      const white = new THREE.Color('#dfe4ff')
      for (const key of ['skyTop', 'skyHorizon', 'fog'] as const) out[key] = '#' + new THREE.Color(out[key]).lerp(white, Math.min(1, f) * 0.38).getHexString()
      out.hemiSky = '#' + new THREE.Color(out.hemiSky).lerp(white, Math.min(1, f)).getHexString()
      out.hemiIntensity += 2.4 * f
      out.exposure *= 1 + 0.25 * f
    }
    return out
  }

  dispose(): void {
    this.obj.traverse((o) => {
      const m = o as THREE.Mesh
      m.geometry?.dispose()
      ;(m.material as THREE.Material | undefined)?.dispose?.()
    })
  }

  // ---------- internals ----------

  private eclipseK(): number {
    if (!this.eclipse) return 0
    const u = (this.t - this.eclipse.start) / this.eclipse.dur
    // In over 35%, totality for 30%, out over 35%.
    return u < 0.35 ? smooth(u / 0.35) : u < 0.65 ? 1 : smooth(1 - (u - 0.65) / 0.35)
  }

  /** A jagged bolt from the clouds to the ground, a flash, and thunder after the light. */
  private strike(cam: THREE.Camera, at: Vec3 | undefined, aimed: boolean): void {
    const cp = cam.position
    let x: number
    let z: number
    if (at) {
      // Where you look, but never on top of you: a bolt needs distance to read as a bolt.
      const dx = at[0] - cp.x
      const dz = at[2] - cp.z
      const d = Math.max(1e-3, Math.hypot(dx, dz))
      const k = Math.max(d, 45) / d
      x = cp.x + dx * k
      z = cp.z + dz * k
    } else {
      // Somewhere in front-ish, 60–220 m away, so you see it. A storm's opening strike lands square in view.
      const f = new THREE.Vector3()
      cam.getWorldDirection(f)
      const a = Math.atan2(f.x, f.z) + (Math.random() - 0.5) * (this.opening ? 0.8 : 2.2)
      const d = this.opening ? 70 + Math.random() * 50 : 60 + Math.random() * 160
      x = cp.x + Math.sin(a) * d
      z = cp.z + Math.cos(a) * d
    }
    const top = new THREE.Vector3(x + (Math.random() - 0.5) * 40, 150 + Math.random() * 40, z + (Math.random() - 0.5) * 40)
    const bottom = new THREE.Vector3(x, 0, z)
    const dist = Math.hypot(x - cp.x, z - cp.z)
    const pts = jagged(top, bottom, 7, 0.22)
    const toCam = new THREE.Vector3().subVectors(cp, bottom).setY(0).normalize()
    const quads: THREE.Vector3[][] = [pts]
    // Two or three branches forking off the upper half.
    for (let i = 0; i < 2 + Math.floor(Math.random() * 2); i++) {
      const from = pts[Math.floor(pts.length * (0.15 + Math.random() * 0.4))]!
      const end = from.clone().add(new THREE.Vector3((Math.random() - 0.5) * 60, -30 - Math.random() * 40, (Math.random() - 0.5) * 60))
      quads.push(jagged(from, end, 4, 0.3))
    }
    const width = Math.max(0.35, dist * 0.004)
    const mesh = new THREE.Mesh(ribbon(quads, toCam, width), new THREE.MeshBasicMaterial({ color: '#f4f6ff', transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }))
    mesh.frustumCulled = false
    mesh.raycast = () => {}
    // A violet glow sheath around the white-hot core.
    const sheath = new THREE.Mesh(ribbon(quads, toCam, width * 5), new THREE.MeshBasicMaterial({ color: '#7f86ff', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide }))
    sheath.raycast = () => {}
    sheath.frustumCulled = false
    mesh.add(sheath)
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: '#aab8ff', transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }))
    glow.raycast = () => {}
    glow.position.set(x, 8, z)
    glow.scale.setScalar(30 + dist * 0.15)
    this.obj.add(mesh, glow)
    this.bolts.push({ mesh, glow, born: this.t, life: 0.55, flicker: [0.14, 0.27, 0.36].slice(0, 1 + Math.floor(Math.random() * 3)) })
    this.flash = Math.min(1.4, (aimed ? 1.2 : 0.8) + 0.4 * Math.max(0, 1 - dist / 250))
    // Sound is slow: thunder follows the light (shortened, so it still feels like the same strike).
    this.onThunder?.(dist, Math.min(2600, (dist / 343) * 1000 * 0.6))
  }

  private tickMeteors(cam: THREE.Camera): void {
    const t = this.t
    if (t < this.meteorUntil && t >= this.nextMeteor) {
      // Streaks start high on the dome in front of you and fall across it.
      const f = new THREE.Vector3()
      cam.getWorldDirection(f)
      const a = Math.atan2(f.x, f.z) + (Math.random() - 0.5) * 2
      const elev = 0.5 + Math.random() * 0.5
      const R = 380
      const from = new THREE.Vector3(Math.sin(a) * Math.cos(elev) * R, Math.sin(elev) * R, Math.cos(a) * Math.cos(elev) * R)
      const dir = new THREE.Vector3(Math.cos(a) * (Math.random() < 0.5 ? 1 : -1), -0.55 - Math.random() * 0.3, -Math.sin(a) * 0.4).normalize()
      this.meteors.push({ from, dir, born: t, life: 0.7 + Math.random() * 0.6, len: 40 + Math.random() * 50 })
      this.nextMeteor = t + 0.12 + Math.random() * 0.45
      if (Math.random() < 0.35) this.onStar?.()
    }
    this.meteors = this.meteors.filter(m => t - m.born < m.life)
    this.meteorMesh.visible = this.meteors.length > 0
    if (!this.meteorMesh.visible) return
    const cp = cam.position
    this.meteorPos.fill(0)
    this.meteorAlpha.fill(0)
    const view = new THREE.Vector3()
    this.meteors.slice(0, 24).forEach((m, i) => {
      const u = (t - m.born) / m.life
      const head = m.from.clone().addScaledVector(m.dir, u * 220).add(cp)
      const tail = head.clone().addScaledVector(m.dir, -m.len * Math.min(1, u * 3))
      view.subVectors(cp, head).normalize()
      const side = new THREE.Vector3().crossVectors(m.dir, view).normalize().multiplyScalar(0.9)
      const fade = Math.sin(Math.PI * Math.min(1, u))
      const verts = [head.clone().add(side), head.clone().sub(side), tail.clone().add(side.clone().multiplyScalar(0.2)), tail.clone().sub(side.clone().multiplyScalar(0.2))]
      verts.forEach((v, k) => this.meteorPos.set([v.x, v.y, v.z], (i * 4 + k) * 3))
      this.meteorAlpha.set([fade, fade, 0, 0], i * 4)
    })
    const g = this.meteorMesh.geometry
    g.attributes.position!.needsUpdate = true
    g.attributes.aAlpha!.needsUpdate = true
  }
}

function luminance(hex: string): number {
  const c = new THREE.Color(hex)
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
}

function smooth(x: number): number {
  const t = Math.min(1, Math.max(0, x))
  return t * t * (3 - 2 * t)
}

/** Midpoint displacement: a lightning path from a to b with `depth` levels of jitter. */
function jagged(a: THREE.Vector3, b: THREE.Vector3, depth: number, rough: number): THREE.Vector3[] {
  let pts = [a.clone(), b.clone()]
  let amp = a.distanceTo(b) * rough
  for (let d = 0; d < depth; d++) {
    const next: THREE.Vector3[] = [pts[0]!]
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!
      const q = pts[i]!
      const mid = p.clone().lerp(q, 0.5).add(new THREE.Vector3((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp * 0.3, (Math.random() - 0.5) * amp))
      next.push(mid, q)
    }
    pts = next
    amp *= 0.55
  }
  return pts
}

/** Flat ribbons along polylines, facing `toCam` (horizontal), `width` metres wide, thinning toward their ends. */
function ribbon(lines: THREE.Vector3[][], toCam: THREE.Vector3, width: number): THREE.BufferGeometry {
  const pos: number[] = []
  const idx: number[] = []
  const side = new THREE.Vector3(-toCam.z, 0, toCam.x)
  lines.forEach((pts, li) => {
    const w0 = li === 0 ? width : width * 0.45
    const base = pos.length / 3
    pts.forEach((p, i) => {
      const w = w0 * (1 - 0.6 * (i / (pts.length - 1)) * (li === 0 ? 0.3 : 1))
      pos.push(p.x + side.x * w, p.y, p.z + side.z * w, p.x - side.x * w, p.y, p.z - side.z * w)
      if (i > 0) {
        const k = base + (i - 1) * 2
        idx.push(k, k + 1, k + 2, k + 2, k + 1, k + 3)
      }
    })
  })
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setIndex(idx)
  return g
}

let disc: THREE.Texture | null = null
function discTexture(): THREE.Texture {
  if (disc) return disc
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(64, 64, 52, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath()
  g.arc(64, 64, 64, 0, Math.PI * 2)
  g.fill()
  disc = new THREE.CanvasTexture(c)
  disc.userData.shared = true
  return disc
}
