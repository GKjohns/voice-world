/**
 * The genie only claims what happened (Loop 2, #9). The intent model writes its `say` before the engine has
 * run anything, so the kernel checks the line against what the batch actually did and strips any clause
 * that claims motion, weather or a move the world doesn't show ("Night falls, lanterns drift." over static
 * street lamps → "Night falls."). Negated clauses ("It cannot fly… yet.") are honest and always kept.
 * Pure and three-free.
 */
import type { Op } from './ops.ts'
import type { WorldState } from './types.ts'

const NEGATION = /\b(cannot|can't|can ?not|not|no|never|yet|alas|beyond|unless|shall i|would you)\b/i

/** A claim, and how to tell from the batch and the world that it came true. */
interface Claim { words: RegExp, holds: (ops: Op[], state: WorldState) => boolean }

const moving = (ops: Op[], state: WorldState, kinds?: RegExp) => ops.some(o => (o.op === 'spawn' || o.op === 'modify') && o.set?.motion && o.set.motion !== 'none')
  && state.entities.some(e => e.props.motion && e.props.motion !== 'none' && (!kinds || kinds.test(e.props.motion)))
const airborne = (ops: Op[], state: WorldState) => ops.some(o => (o.op === 'spawn' || o.op === 'modify') && o.set?.altitude !== undefined) && state.entities.some(e => e.pos[1] > 1)
const weather = (ops: Op[], state: WorldState, w: RegExp) => ops.some(o => o.op === 'atmosphere' && ((o.weather && w.test(o.weather) && !!state.atmosphere.weather) || (o.event && w.test(o.event))))

const CLAIMS: Claim[] = [
  { words: /\b(fl(y|ies|ying|ew|ight)|soar\w*|wing\w*|circl\w*|orbit\w*|wheel\w*|swoop\w*)\b/i, holds: (o, s) => moving(o, s, /orbit|fly|drift|hover/) },
  { words: /\b(drift\w*|float\w*|bob\w*|hover\w*|ascend\w*|aloft|sail\w*)\b/i, holds: (o, s) => moving(o, s) || airborne(o, s) },
  { words: /\b(gallop\w*|run|runs|running|race[sd]?|racing|stamped\w*|wander\w*|roam\w*|prowl\w*|trot\w*)\b/i, holds: (o, s) => moving(o, s, /gallop|wander|orbit|fly/) },
  { words: /\b(spin\w*|twirl\w*|whirl\w*|sway\w*|danc\w*)\b/i, holds: (o, s) => moving(o, s) },
  { words: /\b(rain\w*|drizzl\w*|pour\w*|downpour)\b/i, holds: (o, s) => weather(o, s, /rain|storm/) },
  { words: /\b(snow\w*|flake\w*|blizzard)\b/i, holds: (o, s) => weather(o, s, /snow/) },
  { words: /\b(thunder\w*|lightning|storm\w*|tempest)\b/i, holds: (o, s) => weather(o, s, /storm|lightning/) },
  { words: /\b(aurora\w*|northern lights)\b/i, holds: (o, s) => weather(o, s, /aurora/) },
  { words: /\b(meteor\w*|shooting stars?|falling stars?)\b/i, holds: (o, s) => weather(o, s, /meteor/) },
  { words: /\beclips\w*\b/i, holds: (o, s) => weather(o, s, /eclipse/) },
  { words: /\b(moved|moves|move)\b/i, holds: o => o.some(x => x.op === 'move') }
]

/**
 * Keep only the honest clauses of `text`. `ops` are the world ops this sentence's batch ran and `state`
 * the world after them. Returns the text unchanged when every claim holds; a short fallback when nothing
 * honest is left (`changed` says whether the batch did anything at all).
 */
export function honestSay(text: string, ops: Op[], state: WorldState, changed: boolean): string {
  // The sentence tried to change the world and nothing happened (nothing matched): a triumphant line is a fib.
  if (!changed && ops.length && !NEGATION.test(text)) return 'Alas, nothing here answers to that.'
  const clauses = text.match(/[^.!?…,;:—]+[.!?…,;:—]*/g) ?? [text]
  const kept = clauses.filter((c) => {
    if (NEGATION.test(c)) return true
    return CLAIMS.every(cl => !cl.words.test(c) || cl.holds(ops, state))
  })
  if (kept.length === clauses.length) return text
  const out = kept.join('').trim().replace(/[,;:—]\s*$/, '.')
  if (out && /[a-z]/i.test(out)) return /[.!?…]$/.test(out) ? out : `${out}.`
  return changed ? 'It is done.' : 'That is beyond me… for now.'
}
