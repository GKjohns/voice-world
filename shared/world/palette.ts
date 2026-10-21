/**
 * The curated palette ("Painted Toy World", internal_docs/20261017_gauntlet/art_direction.md §3.2) and
 * `stylize`, which snaps any colour a model or a builder picks onto it. Pure: no three.js, unit-tested.
 *
 * 9 hue families × 4 values (deep / base / light / pale) + 6 neutrals = 42 swatches, tuned in OKLCH so
 * equal steps look equal. `stylize` clamps chroma and lightness (no candy, no pure black or white), finds
 * the nearest swatch in OKLab and blends 75% toward it: the model's intent survives, off-key colours don't.
 */

export type PaletteRole = 'surface' | 'glow' | 'terrain' | 'skin'

interface Lch { l: number, c: number, h: number }

// Hue angle (OKLCH degrees), chroma scale and a lightness offset per family: yellow lives high, purple low.
const FAMILIES: Record<string, { h: number, c: number, dl: number }> = {
  red: { h: 27, c: 1.12, dl: 0 },
  orange: { h: 52, c: 1.05, dl: 0.06 },
  yellow: { h: 92, c: 1.05, dl: 0.2 },
  green: { h: 138, c: 0.9, dl: 0.02 },
  teal: { h: 190, c: 0.8, dl: 0.02 },
  blue: { h: 248, c: 0.95, dl: -0.02 },
  purple: { h: 302, c: 0.9, dl: -0.04 },
  pink: { h: 352, c: 0.85, dl: 0.06 },
  brown: { h: 58, c: 0.55, dl: -0.1 }
}
// deep / base / light / pale: lightness and chroma (base chroma ~0.11, never candy).
const VALUES: Record<string, { l: number, c: number }> = {
  deep: { l: 0.4, c: 0.09 },
  base: { l: 0.58, c: 0.12 },
  light: { l: 0.74, c: 0.1 },
  pale: { l: 0.87, c: 0.055 }
}
const NEUTRALS: Record<string, Lch> = {
  'warm white': { l: 0.95, c: 0.014, h: 85 },
  'cream': { l: 0.9, c: 0.04, h: 88 },
  'warm grey': { l: 0.66, c: 0.016, h: 70 },
  'cool grey': { l: 0.6, c: 0.018, h: 255 },
  'charcoal': { l: 0.34, c: 0.014, h: 275 },
  'near black': { l: 0.25, c: 0.012, h: 290 }
}

export interface Swatch { name: string, hex: string, lab: [number, number, number] }

export const PALETTE: Swatch[] = (() => {
  const out: Swatch[] = []
  for (const [fam, f] of Object.entries(FAMILIES)) {
    for (const [val, v] of Object.entries(VALUES)) {
      const l = Math.min(0.93, Math.max(0.2, v.l + f.dl * (val === 'pale' ? 0.3 : 1)))
      const lch = { l, c: v.c * f.c, h: f.h }
      const name = val === 'base' ? fam : `${val} ${fam}`
      out.push({ name, hex: rgbToHex(oklabToRgb(lchToLab(lch))), lab: lchToLab(lch) })
    }
  }
  for (const [name, lch] of Object.entries(NEUTRALS)) out.push({ name, hex: rgbToHex(oklabToRgb(lchToLab(lch))), lab: lchToLab(lch) })
  return out
})()

const BY_NAME = new Map(PALETTE.map(s => [s.name, s]))

/** A palette colour by name ("red", "light teal", "cream"), or undefined. */
export function swatch(name: string): string | undefined {
  return BY_NAME.get(name.trim().toLowerCase())?.hex
}

/** Palette names for prompts: the model picks names, the engine owns the hexes. */
export const PALETTE_NAMES = PALETTE.map(s => s.name)

const cache = new Map<string, string>()

/**
 * Snap a colour onto the palette. `role`: 'glow' keeps vivid chroma (lights may be bright); 'terrain'
 * is 15% calmer so the ground never out-shouts props; 'skin' blends only halfway (people keep their range).
 * Accepts #rgb / #rrggbb / palette names; anything unparseable comes back unchanged.
 */
export function stylize(color: string, role: PaletteRole = 'surface', mass = 0, metal = false): string {
  // Gen loop 7: `mass` (0..1) is the part's share of the object's volume. Big masses get a higher
  // lightness floor, so a "black" boiler or roof stays a deep, light-catching slate instead of a hole.
  // `metal`: the material preset darkens diffuse (metalness 0.55), so a dark metal gets a higher floor still.
  const mb = Math.round(Math.min(1, Math.max(0, mass)) * 20) / 20
  const key = `${role}|${color}|${mb}|${metal ? 1 : 0}`
  const hit = cache.get(key)
  if (hit) return hit
  const named = swatch(color)
  const rgb = parseHex(named ?? color)
  if (!rgb) return color
  const lch = labToLch(rgbToOklab(rgb))
  const maxC = role === 'glow' ? 0.3 : role === 'terrain' ? 0.12 : 0.16
  lch.c = Math.min(lch.c, maxC)
  if (role !== 'glow') lch.l = Math.min(0.93, Math.max(0.2, lch.l))
  const lab = lchToLab(lch)
  let best = PALETTE[0]!
  let bd = Infinity
  for (const s of PALETTE) {
    const d = (s.lab[0] - lab[0]) ** 2 * 0.4 + (s.lab[1] - lab[1]) ** 2 + (s.lab[2] - lab[2]) ** 2
    if (d < bd) {
      bd = d
      best = s
    }
  }
  const k = role === 'glow' ? 0.35 : role === 'skin' ? 0.45 : 0.75
  const out: [number, number, number] = [
    lab[0] + (best.lab[0] - lab[0]) * k,
    lab[1] + (best.lab[1] - lab[1]) * k,
    lab[2] + (best.lab[2] - lab[2]) * k
  ]
  if (role === 'terrain') {
    out[1] *= 0.85
    out[2] *= 0.85
  }
  if (role !== 'glow') darkFloor(out, lch, mb, metal)
  const hex = rgbToHex(oklabToRgb(out))
  if (cache.size > 4000) cache.clear()
  cache.set(key, hex)
  return hex
}

/**
 * Gen loop 7 (BotW / Ghibli darks): painted "black" iron is a deep slate that still takes light. Lift
 * lightness to a floor that rises with the part's volume share (0.27 for trim, up to 0.42 for the main
 * mass), and give near-greys a little chroma: achromatic darks lean blue-slate (they pick up the sky),
 * tinted ones keep their own hue (a warm charcoal stays warm).
 */
function darkFloor(out: [number, number, number], src: Lch, mass: number, metal: boolean): void {
  const t = Math.min(1, Math.max(0, (mass - 0.04) / 0.21))
  const k = metal ? 1.3 : 1
  const floor = (0.27 + 0.15 * t * t * (3 - 2 * t)) * k
  const lch = labToLch(out)
  if (lch.l >= Math.max(0.5, floor)) return
  lch.l = Math.max(lch.l, floor)
  if (lch.c < 0.035) {
    lch.h = src.c < 0.02 ? 252 : src.h
    lch.c = Math.max(lch.c, 0.03 * (1 - Math.max(0, lch.l / k - 0.42) / 0.08))
  }
  const lab = lchToLab(lch)
  out[0] = lab[0]
  out[1] = lab[1]
  out[2] = lab[2]
}

// ---------- colour math (sRGB ↔ OKLab, Björn Ottosson) ----------

function parseHex(s: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim())
  if (!m) return null
  let h = m[1]!
  if (h.length === 3) h = h.split('').map(ch => ch + ch).join('')
  const n = parseInt(h, 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map(v => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function toSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055
}

export function rgbToOklab(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb.map(toLinear) as [number, number, number]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ]
}

export function oklabToRgb(lab: [number, number, number]): [number, number, number] {
  const [L, a, b] = lab
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ]
}

function lchToLab(c: Lch): [number, number, number] {
  const h = (c.h * Math.PI) / 180
  return [c.l, c.c * Math.cos(h), c.c * Math.sin(h)]
}

function labToLch(lab: [number, number, number]): Lch {
  return { l: lab[0], c: Math.hypot(lab[1], lab[2]), h: ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360 }
}
