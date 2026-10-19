/**
 * Gen loop 2: the size of a new thing (its largest dimension, in m), decided once at its spawn, before
 * either model draws a part. A small table of diorama-scale sizes (big things are kept to what fits a view
 * from "over there"), adjectives on top; the intent model's own `size` is the fallback for anything else.
 */
const SIZES: [string, number][] = [
  ['locomotive|train|tram', 9], ['ship|galleon|boat|yacht', 8], ['rocket|airplane|plane|jet', 8],
  ['bus|truck|tractor|tank', 6], ['car|wagon|carriage|cart', 4.5],
  ['castle|cathedral|palace', 16], ['pagoda|temple|tower|lighthouse|windmill|skyscraper', 11],
  ['house|cottage|cabin|hut|barn|shop|church', 7],
  ['triceratops|dinosaur|rex|stegosaurus|brontosaurus|mammoth|elephant', 6], ['giraffe', 5],
  ['horse|camel|cow|bear|moose|unicorn', 2.6], ['dog|cat|fox|wolf|sheep|goat|pig|deer', 1.2],
  ['robot|statue|golem', 3], ['tree', 6], ['telescope|easel|lamp|lantern_post|scarecrow', 1.9],
  ['flytrap|flower|plant|cactus|mushroom|fern', 1.4], ['chair|stool|barrel|chest|crate', 1], ['table|bench|desk', 1.6]
]

// Whole words of the snake_case kind ("scarecrow" is not a car), plural allowed.
const TABLE: [RegExp, number][] = SIZES.map(([w, n]) => [new RegExp(`(^|_)(${w})s?($|_)`), n])

const ADJ: [RegExp, number][] = [
  [/\b(giant|huge|enormous|colossal|massive|gigantic)\b/, 2.2], [/\b(big|large|tall)\b/, 1.4],
  [/\b(tiny|miniature)\b/, 0.35], [/\b(little|small|mini)\b/, 0.6]
]

export function targetSize(kind: string, text: string, hint?: number): number {
  const k = kind.toLowerCase()
  const t = text.toLowerCase()
  const row = TABLE.find(([re]) => re.test(k))
  if (!row) return Math.max(0.3, Math.min(40, hint ?? 2.5))
  const adj = ADJ.find(([re]) => re.test(t))?.[1] ?? 1
  return Math.round(row[1] * adj * 10) / 10
}
