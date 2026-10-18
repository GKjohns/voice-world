/**
 * Gauntlet loop 1 (track B): the creative sky. "Turn the sky purple and give it two moons" is honoured on
 * top of whatever time-of-day preset (and weather grade) is showing: custom zenith and horizon colours, the
 * fog leaning toward the horizon tint so the ground meets the sky, and a moon count. Pure colour math over
 * the preset; the renderer applies the result and places the extra moons.
 */
import * as THREE from 'three'
import type { Atmosphere } from '#shared/world/types'
import type { AtmospherePreset } from '../atmosphere'

const tmp = new THREE.Color()

function mix(a: string, b: string, k: number): string {
  return `#${tmp.set(a).lerp(new THREE.Color(b), k).getHexString()}`
}

/** Keep the preset's brightness (night stays dark) but take the asked hue: scale the tint to the preset's luminance. */
function tinted(base: string, tint: string, k: number): string {
  const b = new THREE.Color(base)
  const t = new THREE.Color(tint)
  const lb = 0.2126 * b.r + 0.7152 * b.g + 0.0722 * b.b
  const lt = Math.max(1e-3, 0.2126 * t.r + 0.7152 * t.g + 0.0722 * t.b)
  // Bright presets show the tint as asked; dark ones keep it deep but unmistakably that colour.
  const target = t.multiplyScalar(Math.min(1.4, Math.max(0.35, lb / lt)))
  return `#${b.lerp(target, k).getHexString()}`
}

/** The preset with the world's custom sky folded in. Returns the same object when nothing is custom. */
export function customizeSky(a: AtmospherePreset, at: Atmosphere | undefined): AtmospherePreset {
  if (!at || (!at.sky && !at.horizon && at.moons === undefined)) return a
  const out = { ...a }
  if (at.sky) out.skyTop = tinted(a.skyTop, at.sky, 0.9)
  const hz = at.horizon ?? (at.sky ? mix(at.sky, a.skyHorizon, 0.45) : undefined)
  if (hz) {
    out.skyHorizon = tinted(a.skyHorizon, hz, 0.85)
    out.fog = tinted(a.fog, hz, 0.6)
    out.hemiSky = mix(a.hemiSky, hz, 0.3)
  }
  // Moons hang in any sky that's dim enough to see them; "no moon" hides it even at night.
  if (at.moons !== undefined) out.moon = at.moons > 0 ? Math.max(a.moon, 0.85) : 0
  return out
}

/** Where moon `i` of `n` sits, as an offset from the first one's sky direction: spread apart, never stacked. */
export function moonSpot(i: number, base: THREE.Vector3): { dir: THREE.Vector3, scale: number, tint: string } {
  if (i === 0) return { dir: base.clone(), scale: 1, tint: '#e8eeff' }
  const az = Math.atan2(base.x, base.z) + (i === 1 ? 0.42 : 0.75)
  const el = Math.asin(Math.max(-1, Math.min(1, base.y))) + (i === 1 ? 0.07 : -0.05)
  const c = Math.cos(el)
  return { dir: new THREE.Vector3(Math.sin(az) * c, Math.sin(el), Math.cos(az) * c), scale: i === 1 ? 0.7 : 0.5, tint: i === 1 ? '#f4e6ff' : '#cfe3ff' }
}
