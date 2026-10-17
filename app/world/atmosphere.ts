/**
 * Time-of-day presets. Colours are tuned for ACES tone mapping; the renderer tweens between presets so
 * "make it night" reads as the light going down rather than a cut.
 */
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
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  ground: string
  grid: number // grid opacity; 0 hides it
  env: number // RoomEnvironment strength, for glass and metal
  exposure: number
  stars: number // 0..1 starfield opacity
  moon: number // 0..1 moon disc + halo
  sunGlow: number // 0..1 a soft sun disc and halo low on the horizon (in the sunPos direction)
  glowColor: string // the sun/moon halo tint
}

export const ATMOSPHERES: Record<TimeOfDay, AtmospherePreset> = {
  dawn: {
    skyTop: '#5d6f9e', skyHorizon: '#f0b9a0', fog: '#c9a9a6', fogNear: 25, fogFar: 170,
    sun: '#ffc2a0', sunIntensity: 1.8, sunPos: [40, 12, -30], hemiSky: '#c4cff0', hemiGround: '#4a3f3a', hemiIntensity: 0.9,
    ground: '#5a6650', grid: 0.12, env: 0.25, exposure: 1, stars: 0.15, moon: 0, sunGlow: 0.6, glowColor: '#ffc9a0'
  },
  day: {
    skyTop: '#4f8fd6', skyHorizon: '#bcd8ef', fog: '#b9d4ee', fogNear: 45, fogFar: 240,
    sun: '#fff1d6', sunIntensity: 2.8, sunPos: [25, 50, 15], hemiSky: '#cfe4ff', hemiGround: '#5a5040', hemiIntensity: 1.1,
    ground: '#6f8a55', grid: 0, env: 0.35, exposure: 1, stars: 0, moon: 0, sunGlow: 0.25, glowColor: '#fff6e0'
  },
  golden: {
    skyTop: '#6a7fb0', skyHorizon: '#f6b775', fog: '#e9b88b', fogNear: 18, fogFar: 140,
    sun: '#ffb36b', sunIntensity: 2.6, sunPos: [-45, 10, -55], hemiSky: '#ffd6b0', hemiGround: '#4a3a28', hemiIntensity: 0.8,
    ground: '#55623d', grid: 0, env: 0.3, exposure: 1.05, stars: 0, moon: 0, sunGlow: 1, glowColor: '#ffc27a'
  },
  dusk: {
    skyTop: '#1d2742', skyHorizon: '#6a6a8e', fog: '#3b4260', fogNear: 22, fogFar: 150,
    sun: '#ffb07a', sunIntensity: 2.0, sunPos: [-30, 16, 30], hemiSky: '#a9bdf0', hemiGround: '#3a3328', hemiIntensity: 1.0,
    ground: '#323a49', grid: 0.32, env: 0.2, exposure: 1.1, stars: 0.35, moon: 0, sunGlow: 0.35, glowColor: '#ff9a6a'
  },
  night: {
    // Moonlight from ahead-right and above (the moon sits where sunPos points), so night reads blue, not black.
    skyTop: '#050a1a', skyHorizon: '#1f2a4e', fog: '#10162c', fogNear: 16, fogFar: 110,
    sun: '#9fb2ff', sunIntensity: 0.6, sunPos: [30, 38, -45], hemiSky: '#5a6cb0', hemiGround: '#181a26', hemiIntensity: 0.45,
    ground: '#1d2232', grid: 0.1, env: 0.1, exposure: 1.15, stars: 1, moon: 1, sunGlow: 0, glowColor: '#c8d4ff'
  },
  interior: {
    // Warm and dim: a low amber fill (the "room" light) and almost no sun; the lamps do the real work.
    skyTop: '#1a120c', skyHorizon: '#2a1c12', fog: '#1e150e', fogNear: 14, fogFar: 60,
    sun: '#ffc890', sunIntensity: 0.25, sunPos: [6, 30, 10], hemiSky: '#ffcf9a', hemiGround: '#4a3020', hemiIntensity: 0.85,
    ground: '#2e2117', grid: 0, env: 0.3, exposure: 1.2, stars: 0, moon: 0, sunGlow: 0, glowColor: '#ffc890'
  }
}
