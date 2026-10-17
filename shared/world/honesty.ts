/**
 * The genie only claims what happened (Loop 2, #9). The intent model writes its `say` before the engine has
 * run anything, so the kernel checks the line against what the batch actually did and strips any clause
 * that claims motion, weather or a move the world doesn't show ("Night falls, lanterns drift." over static
 * street lamps → "Night falls."). Negated clauses ("It cannot fly… yet.") are honest and always kept.
 * Pure and three-free.
 */
import type { Op } from './ops.ts'
import type { WorldState } from './types.ts'

const NEGATION = /\b(cannot|can't|can ?not|not|no|never|yet|alas|beyond|unless|nothing)\b/i
/** A genie grants; it never asks. A clause like "Shall I summon one?" is dropped. */
const ASKING = /\b(shall i|should i|may i|want me to|shall we)\b[^.!…]*\?/i
/** A stripped line that starts mid-thought ("and water falls.") is a fragment, not a line. */
const FRAGMENT = /^(and|then|but|or|so|while|as|with|nor|yet|until)\b|^[a-z]/

/** A claim, and how to tell from the batch and the world that it came true. */
interface Claim { words: RegExp, holds: (ops: Op[], state: WorldState) => boolean }

const moving = (ops: Op[], state: WorldState, kinds?: RegExp) => ops.some(o => (o.op === 'spawn' || o.op === 'modify') && o.set?.motion && o.set.motion !== 'none')
  && state.entities.some(e => e.props.motion && e.props.motion !== 'none' && (!kinds || kinds.test(e.props.motion)))
const airborne = (ops: Op[], state: WorldState) => ops.some(o => (o.op === 'spawn' || o.op === 'modify') && o.set?.altitude !== undefined) && state.entities.some(e => e.pos[1] > 1)
const weather = (ops: Op[], state: WorldState, w: RegExp) => ops.some(o => o.op === 'atmosphere' && ((o.weather && w.test(o.weather) && !!state.atmosphere.weather) || (o.event && w.test(o.event))))

const acting = (ops: Op[], act: RegExp) => ops.some(o => (o.op === 'spawn' || o.op === 'modify') && !!o.set?.act && act.test(o.set.act))

const CLAIMS: Claim[] = [
  { words: /\b(fl(y|ies|ying|ew|ight)|soar\w*|wing\w*|circl\w*|orbit\w*|wheel\w*|swoop\w*)\b/i, holds: (o, s) => moving(o, s, /orbit|fly|drift|hover/) },
  { words: /\b(drift\w*|float\w*|bob\w*|hover\w*|ascend\w*|aloft|sail\w*)\b/i, holds: (o, s) => moving(o, s) || airborne(o, s) },
  { words: /\b(gallop\w*|run|runs|running|race[sd]?|racing|stamped\w*|wander\w*|roam\w*|prowl\w*|trot\w*)\b/i, holds: (o, s) => moving(o, s, /gallop|wander|orbit|fly/) },
  { words: /\b(spin\w*|twirl\w*|whirl\w*|sway\w*|danc\w*)\b/i, holds: (o, s) => moving(o, s) || acting(o, /dance/) },
  { words: /\b(rain\w*|drizzl\w*|downpour)\b/i, holds: (o, s) => weather(o, s, /rain|storm/) },
  { words: /\b(snow\w*|flake\w*|blizzard)\b/i, holds: (o, s) => weather(o, s, /snow/) },
  { words: /\b(thunder\w*|lightning|storm\w*|tempest)\b/i, holds: (o, s) => weather(o, s, /storm|lightning/) },
  { words: /\b(aurora\w*|northern lights)\b/i, holds: (o, s) => weather(o, s, /aurora/) },
  { words: /\b(meteor\w*|shooting stars?|falling stars?)\b/i, holds: (o, s) => weather(o, s, /meteor/) },
  { words: /\beclips\w*\b/i, holds: (o, s) => weather(o, s, /eclipse/) },
  { words: /\b(moved|moves|move)\b/i, holds: o => o.some(x => x.op === 'move') }
]

/**
 * Keep only the honest clauses of `text`. `ops` are the world ops this sentence's batch ran and `state`
 * the world after them. Returns the text unchanged when every claim holds. When stripping leaves nothing,
 * or only a fragment ("and water falls."), the whole line is replaced by a clean one built from what the
 * batch really did ("A waterfall."); `changed` says whether it did anything at all.
 */
export function honestSay(text: string, ops: Op[], state: WorldState, changed: boolean): string {
  const world = ops.filter(o => o.op !== 'say')
  const clauses = text.match(/[^.!?…,;:—]+[.!?…,;:—]*/g) ?? [text]
  const asks = clauses.some(c => ASKING.test(c))
  // The sentence changed nothing: a triumphant line is a fib, and an offer ("Shall I…?") is a butler.
  if (!changed && (asks || !NEGATION.test(text))) return noOpLine(world)
  const kept = clauses.filter((c) => {
    if (ASKING.test(c)) return false
    if (NEGATION.test(c)) return true
    return CLAIMS.every(cl => !cl.words.test(c) || cl.holds(world, state))
  })
  if (kept.length === clauses.length) return text
  const out = kept.join('').trim().replace(/[,;:—]\s*$/, '.')
  if (out && /[a-z]/i.test(out) && !FRAGMENT.test(out) && out.split(/\s+/).length >= 2) return /[.!?…]$/.test(out) ? out : `${out}.`
  return changed ? effectLine(world, state) : noOpLine(world)
}

const TIME_LINE: Record<string, string> = { night: 'Night falls.', day: 'Day breaks.', dawn: 'Dawn breaks.', dusk: 'Dusk settles.', golden: 'Golden hour.', interior: 'The lamps are lit.' }
const WEATHER_LINE: Record<string, string> = { rain: 'Rain.', snow: 'Snow.', storm: 'A storm.', fog: 'Fog rolls in.', aurora: 'The aurora.', clear: 'Clear skies.' }
const EVENT_LINE: Record<string, string> = { lightning: 'Lightning!', meteors: 'Falling stars.', eclipse: 'An eclipse.', sunrise: 'The sun rises.' }
const NUMBERS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

function plural(word: string): string {
  if (/(s|x|ch|sh)$/.test(word)) return `${word}es`
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`
  return `${word}s`
}

/** A short true line from what the ops did: "A waterfall.", "Night falls. Nine pines.", "Moved." */
export function effectLine(ops: Op[], state: WorldState): string {
  const bits: string[] = []
  for (const o of ops) {
    if (o.op === 'spawn') {
      if (!state.entities.some(e => e.kind === o.kind)) continue
      const n = o.count ?? 1
      const name = o.kind.replace(/_/g, ' ')
      bits.push(n === 1 ? `${/^[aeiou]/i.test(name) ? 'An' : 'A'} ${name}.` : `${NUMBERS[n] ?? n} ${plural(name)}.`)
    } else if (o.op === 'atmosphere') {
      if (o.time && state.atmosphere.time === o.time) bits.push(TIME_LINE[o.time] ?? 'The light turns.')
      if (o.weather) bits.push(WEATHER_LINE[o.weather] ?? 'The sky turns.')
      if (o.event) bits.push(EVENT_LINE[o.event] ?? 'Behold.')
      if (o.playerScale !== undefined) bits.push(o.playerScale < 1 ? 'You shrink.' : o.playerScale > 1 ? 'You grow.' : 'Yourself again.')
      if (o.fog !== undefined && !o.weather) bits.push(o.fog > 0.2 ? 'The air thickens.' : 'The air clears.')
    } else if (o.op === 'move') bits.push('Moved.')
    else if (o.op === 'remove') bits.push('Gone.')
    else if (o.op === 'undo') bits.push('Unmade.')
    else if (o.op === 'teleport') bits.push('Come.')
  }
  const line = [...new Set(bits)].slice(0, 2).join(' ')
  return line || 'It is done.'
}

/** The sentence changed nothing: say so, in character, without a question. */
export function noOpLine(ops: Op[]): string {
  const o = ops[0]
  if (!o) return 'That is beyond me… for now.'
  if (o.op === 'move') return 'Nothing to move, yet.'
  if (o.op === 'remove') return 'Nothing here to remove.'
  if (o.op === 'modify') return 'Nothing here to change, yet.'
  if (o.op === 'undo') return 'Nothing to undo.'
  return 'Alas, nothing here answers to that.'
}
