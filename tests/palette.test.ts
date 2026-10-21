/**
 * Art direction S1: the curated palette and `stylize` (shared/world/palette.ts).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PALETTE, PALETTE_NAMES, rgbToOklab, stylize, swatch } from '../shared/world/palette.ts'

const lab = (hex: string) => rgbToOklab([parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255])
const chroma = (hex: string) => Math.hypot(lab(hex)[1], lab(hex)[2])

test('42 swatches, all valid hexes, named', () => {
  assert.equal(PALETTE.length, 42)
  for (const s of PALETTE) assert.match(s.hex, /^#[0-9a-f]{6}$/)
  assert.ok(PALETTE_NAMES.includes('red') && PALETTE_NAMES.includes('pale teal') && PALETTE_NAMES.includes('cream'))
})

test('stylize clamps pure black, pure white and candy colours', () => {
  assert.ok(lab(stylize('#000000'))[0] >= 0.19, 'no pure black')
  assert.ok(lab(stylize('#ffffff'))[0] <= 0.95, 'no pure white')
  assert.ok(chroma(stylize('#ff00ff')) < chroma('#ff00ff') * 0.6, 'magenta is tamed')
  assert.ok(chroma(stylize('#00ff00')) <= 0.17, 'neon green is tamed')
})

test('stylize keeps the asked-for hue family', () => {
  const r = lab(stylize('#ff0000'))
  assert.ok(r[1] > 0.08 && Math.abs(r[2]) < r[1], 'red stays red')
  const b = lab(stylize('#1060ff'))
  assert.ok(b[2] < -0.06, 'blue stays blue')
})

test('glow keeps vivid colour, terrain is calmer, names resolve', () => {
  assert.ok(chroma(stylize('#ff3b0a', 'glow')) > chroma(stylize('#ff3b0a')))
  assert.ok(chroma(stylize('#5f8a46', 'terrain')) <= chroma(stylize('#5f8a46')))
  assert.equal(stylize('red'), stylize(swatch('red')!))
  assert.equal(stylize('not a colour'), 'not a colour')
})

test('stylize is idempotent-ish: snapping twice barely moves', () => {
  for (const hex of ['#c0392b', '#3f6f8f', '#8a6a48', '#f1c27d']) {
    const a = lab(stylize(hex))
    const b = lab(stylize(stylize(hex)))
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.03, hex)
  }
})

test('gen loop 7: big near-black masses become a deep, light-catching slate', () => {
  const small = lab(stylize('#111111'))
  const big = lab(stylize('#111111', 'surface', 0.4))
  assert.ok(small[0] >= 0.26, `trim floor ${small[0]}`)
  assert.ok(big[0] >= 0.41, `main-mass floor ${big[0]}`)
  assert.ok(big[2] < -0.01, 'achromatic dark leans blue-slate')
  const warm = labToLch(lab(stylize('#3a2418', 'surface', 0.4)))
  assert.ok(warm.h > 20 && warm.h < 100, 'a warm dark keeps its hue')
  assert.equal(stylize('#c03020', 'surface', 0.4), stylize('#c03020'), 'mid values are untouched')
})

function labToLch(l: [number, number, number]) {
  return { l: l[0], c: Math.hypot(l[1], l[2]), h: ((Math.atan2(l[2], l[1]) * 180) / Math.PI + 360) % 360 }
}
