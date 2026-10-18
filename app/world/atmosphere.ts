/**
 * Time-of-day presets, retuned for the "Painted Toy World" look (art_direction.md §3.3): Neutral tone
 * mapping, toon bands, a painted sky with clouds and a sun disc, warm-near / cool-far height fog, a rim of
 * horizon light and one colour grade per preset. The renderer tweens between presets so "make it night"
 * reads as the light going down rather than a cut.
 */
import * as THREE from 'three'
import type { TimeOfDay } from '#shared/world/ops'

export interface AtmospherePreset {
  skyTop: string
  skyHorizon: string
  fog: string
  fogNear: number
  fogFar: number
  sun: string
  sunIntensity: number
  sunPos: [number, number, number] // direction the light comes from, relative to the player
  hemiSky: string // also the shade tint: shadows take this colour, never black
  hemiGround: string
  hemiIntensity: number
  ground: string
  grid: number // "dream canvas" line opacity in the empty first-run world; 0 hides it
  env: number // RoomEnvironment strength, for glass and metal
  exposure: number
  stars: number // 0..1 starfield opacity
  moon: number // 0..1 moon disc + halo
  sunGlow: number // 0..1 the warm horizon band on the sun's side
  glowColor: string // the horizon band and moon halo tint
  // ---- Painted Toy World ----
  groundAlt: string // the second ground swatch for the big soft patches
  groundPatch: number // patch strength (0 = flat colour)
  rim: number // horizon-coloured rim light on silhouettes
  fogWarm: string // near fog leans warm, far fog takes `fog` (the sky's horizon)
  fogHeight: number // 1/m: how fast the fog thins with height (valleys fill, peaks stay)
  sunDisc: number // 0..1 the flat sun disc in the sky
  cloudLit: string
  cloudShade: string
  cloudCover: number // 0..1
  toon: number // 0..1 band strength
  gradeShadow: string // post: darks lift toward this
  gradeHighlight: string // post: lights multiply toward this
  gradeSat: number // post: saturation
}

export const ATMOSPHERES: Record<TimeOfDay, AtmospherePreset> = {
  dawn: {
    skyTop: '#6c80c4', skyHorizon: '#ffc9b4', fog: '#e6c0c0', fogNear: 30, fogFar: 190,
    sun: '#ffd0ae', sunIntensity: 2.0, sunPos: [40, 14, -30], hemiSky: '#b9c2f0', hemiGround: '#6a5650', hemiIntensity: 1.05,
    ground: '#668f62', grid: 0, env: 0.25, exposure: 1, stars: 0.1, moon: 0, sunGlow: 0.7, glowColor: '#ffb48e',
    groundAlt: '#789a66', groundPatch: 0.55, rim: 0.45, fogWarm: '#f3cdb2', fogHeight: 0.04, sunDisc: 0.9,
    cloudLit: '#ffe2d4', cloudShade: '#a99ac4', cloudCover: 0.5, toon: 1,
    gradeShadow: '#4a3a72', gradeHighlight: '#fff0e6', gradeSat: 1.06
  },
  day: {
    skyTop: '#3f86df', skyHorizon: '#cfe6f6', fog: '#c4def2', fogNear: 50, fogFar: 260,
    sun: '#fff4e0', sunIntensity: 2.35, sunPos: [28, 52, 22], hemiSky: '#b4cdf5', hemiGround: '#7a6a4c', hemiIntensity: 1.15,
    ground: '#5f874e', grid: 0, env: 0.35, exposure: 1, stars: 0, moon: 0, sunGlow: 0.15, glowColor: '#fff2d8',
    groundAlt: '#729552', groundPatch: 0.6, rim: 0.3, fogWarm: '#e9ecdc', fogHeight: 0.03, sunDisc: 0.8,
    cloudLit: '#ffffff', cloudShade: '#b2c3e0', cloudCover: 0.48, toon: 1,
    gradeShadow: '#2f3f78', gradeHighlight: '#fff8ec', gradeSat: 1.08
  },
  golden: {
    skyTop: '#5876bf', skyHorizon: '#ffc583', fog: '#f2c79a', fogNear: 24, fogFar: 170,
    sun: '#ffb463', sunIntensity: 2.6, sunPos: [-45, 14, -40], hemiSky: '#c9b6e0', hemiGround: '#6a4c34', hemiIntensity: 0.95,
    ground: '#5c8650', grid: 0, env: 0.3, exposure: 1.02, stars: 0, moon: 0, sunGlow: 1, glowColor: '#ffaa5e',
    groundAlt: '#6e8c4e', groundPatch: 0.55, rim: 0.6, fogWarm: '#ffcf96', fogHeight: 0.04, sunDisc: 1,
    cloudLit: '#ffd7a4', cloudShade: '#b48a9e', cloudCover: 0.5, toon: 1,
    gradeShadow: '#4a3070', gradeHighlight: '#ffe8cc', gradeSat: 1.1
  },
  dusk: {
    // The starting world: a soft sunset, the sun just down on the left, a rose horizon under deep blue.
    skyTop: '#2f3f7e', skyHorizon: '#f4a98a', fog: '#d39a98', fogNear: 26, fogFar: 170,
    sun: '#ffc6a0', sunIntensity: 1.95, sunPos: [-40, 12, -18], hemiSky: '#a3a6e6', hemiGround: '#5a5048', hemiIntensity: 1.2,
    ground: '#5f8560', grid: 0.1, env: 0.22, exposure: 1.02, stars: 0.2, moon: 0, sunGlow: 0.85, glowColor: '#ff9c78',
    groundAlt: '#708d62', groundPatch: 0.55, rim: 0.55, fogWarm: '#e8a99c', fogHeight: 0.045, sunDisc: 0.7,
    cloudLit: '#ffbfa2', cloudShade: '#7f74ac', cloudCover: 0.45, toon: 1,
    gradeShadow: '#3c2f6a', gradeHighlight: '#ffe2cc', gradeSat: 1.08
  },
  night: {
    // Moonlight from ahead-right and above (the moon sits where sunPos points): indigo and readable, never black.
    skyTop: '#0a1029', skyHorizon: '#2b3a6c', fog: '#1d274c', fogNear: 18, fogFar: 130,
    sun: '#a9bcff', sunIntensity: 0.9, sunPos: [30, 38, -45], hemiSky: '#6474c8', hemiGround: '#2a3050', hemiIntensity: 0.9,
    ground: '#2f3f4d', grid: 0, env: 0.12, exposure: 1.1, stars: 1, moon: 1, sunGlow: 0.15, glowColor: '#9fb2ff',
    groundAlt: '#36495a', groundPatch: 0.45, rim: 0.32, fogWarm: '#2e3564', fogHeight: 0.035, sunDisc: 0,
    cloudLit: '#56679e', cloudShade: '#232a52', cloudCover: 0.28, toon: 1,
    gradeShadow: '#1e2a6a', gradeHighlight: '#e6ecff', gradeSat: 0.98
  },
  interior: {
    // Warm and dim: a low amber fill (the "room" light) and almost no sun; the lamps do the real work.
    skyTop: '#2a1d16', skyHorizon: '#3d2a1e', fog: '#2c1f17', fogNear: 16, fogFar: 70,
    sun: '#ffc890', sunIntensity: 0.3, sunPos: [6, 30, 10], hemiSky: '#ffd2a0', hemiGround: '#5a3c2a', hemiIntensity: 1.0,
    ground: '#4a3626', grid: 0, env: 0.3, exposure: 1.15, stars: 0, moon: 0, sunGlow: 0, glowColor: '#ffc890',
    groundAlt: '#54402e', groundPatch: 0.2, rim: 0.2, fogWarm: '#3e2c1e', fogHeight: 0, sunDisc: 0,
    cloudLit: '#3d2a1e', cloudShade: '#2a1d16', cloudCover: 0, toon: 0.85,
    gradeShadow: '#3a2418', gradeHighlight: '#fff0dc', gradeSat: 1.05
  }
}

/** Blend two presets (colours in linear light, numbers and the sun direction linearly). */
export function lerpPreset(a: AtmospherePreset, b: AtmospherePreset, k: number): AtmospherePreset {
  const out = { ...b } as Record<string, unknown>
  const A = a as unknown as Record<string, unknown>
  const B = b as unknown as Record<string, unknown>
  for (const key of Object.keys(b)) {
    const x = A[key]
    const y = B[key]
    if (typeof x === 'number' && typeof y === 'number') out[key] = x + (y - x) * k
    else if (typeof x === 'string' && typeof y === 'string' && x.startsWith('#') && y.startsWith('#')) out[key] = '#' + new THREE.Color(x).lerp(new THREE.Color(y), k).getHexString()
    else if (Array.isArray(x) && Array.isArray(y)) out[key] = (y as number[]).map((v, i) => (x[i] as number) + (v - (x[i] as number)) * k)
    else out[key] = k < 0.5 && x !== undefined ? x : y
  }
  return out as unknown as AtmospherePreset
}
