/**
 * What an NPC says back, and what they do about it. The model writes its spoken line first, in plain text
 * (so the first words reach the caption and the voice while it is still writing), then one line that
 * starts with `>>` and a JSON object of actions:
 *
 *   Ha! You're back. Did that storm rattle you too?
 *   >> {"do":[{"act":"wave"},{"act":"walk_to","target":"dock"}],"remember":"the stranger likes storms"}
 *
 * JSON in text, not structured output (Anthropic structured output falls back to Bedrock on big schemas),
 * parsed leniently: a malformed tail costs the actions, never the line. Pure and three-free.
 */
import { firstJsonObject } from './persona.ts'

export const NPC_ACTS = ['walk_to', 'follow', 'stay', 'wave', 'sit', 'stand', 'bow', 'cheer', 'dance', 'point', 'look_at', 'give', 'remember'] as const
export type NpcActName = typeof NPC_ACTS[number]

export type NpcAction
  = | { act: 'walk_to' | 'point' | 'look_at', target: string }
    | { act: 'give', item: string, count?: number }
    | { act: 'remember', fact: string }
    | { act: Exclude<NpcActName, 'walk_to' | 'point' | 'look_at' | 'give' | 'remember'> }

export interface NpcReply {
  say: string
  actions: NpcAction[]
  remember?: string
}

const MARK = '>>'

/**
 * While streaming: the part that is safe to show and speak. Everything before the `>>` line, minus a lone
 * trailing `>` that might be the start of it, and minus stage directions in asterisks or brackets.
 */
export function spokenSoFar(partial: string): string {
  let s = partial
  const i = s.indexOf(MARK)
  if (i >= 0) s = s.slice(0, i)
  else if (s.endsWith('>')) s = s.slice(0, -1)
  return cleanSpoken(s)
}

/** Strip what a voice must never read out: *stage directions*, [brackets], (asides), a leading "Name:" and quotes around the line. */
export function cleanSpoken(s: string): string {
  return s
    .replace(/\*[^*]*\*?/g, ' ')
    .replace(/\[[^\]]*\]?/g, ' ')
    .replace(/^\s*[A-Z][\w .'-]{0,24}:\s+/, '')
    .replace(/^\s*["“]|["”]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trimStart()
}

function action(raw: unknown): NpcAction | null {
  if (!raw || typeof raw !== 'object') return null
  const a = raw as Record<string, unknown>
  const name = String(a.act ?? a.action ?? a.do ?? '').toLowerCase().replace(/[\s-]+/g, '_')
  const target = typeof a.target === 'string' ? a.target.trim().toLowerCase().slice(0, 40) : typeof a.to === 'string' ? a.to.trim().toLowerCase().slice(0, 40) : ''
  switch (name) {
    case 'walk_to': case 'go_to': case 'walk': case 'go':
      return target ? { act: 'walk_to', target } : null
    case 'point': case 'point_at':
      return target ? { act: 'point', target } : { act: 'point', target: 'player' }
    case 'look_at': case 'look':
      return target ? { act: 'look_at', target } : null
    case 'give': case 'offer': case 'hand': {
      const item = typeof a.item === 'string' ? a.item.trim().slice(0, 40) : target
      if (!item) return null
      const count = typeof a.count === 'number' && a.count >= 1 ? Math.min(6, Math.round(a.count)) : undefined
      return count ? { act: 'give', item, count } : { act: 'give', item }
    }
    case 'remember': {
      const fact = typeof a.fact === 'string' ? a.fact.trim() : ''
      return fact ? { act: 'remember', fact: fact.slice(0, 160) } : null
    }
    case 'follow': case 'follow_player': case 'come':
      return { act: 'follow' }
    case 'stay': case 'stop_following': case 'stop': case 'wait':
      return { act: 'stay' }
    case 'wave': case 'sit': case 'stand': case 'bow': case 'cheer': case 'dance':
      return { act: name }
    default:
      return null
  }
}

/** The whole answer → the line and its actions. Never throws. */
export function parseReply(full: string): NpcReply {
  const i = full.indexOf(MARK)
  const say = cleanSpoken(i >= 0 ? full.slice(0, i) : full).trim()
  if (i < 0) return { say, actions: [] }
  const tail = firstJsonObject(full.slice(i + MARK.length))
  if (!tail) return { say, actions: [] }
  const list = Array.isArray(tail.do) ? tail.do : Array.isArray(tail.actions) ? tail.actions : []
  const actions = list.map(action).filter((a): a is NpcAction => !!a).slice(0, 4)
  const remember = typeof tail.remember === 'string' && tail.remember.trim() ? tail.remember.trim().slice(0, 160) : undefined
  return remember ? { say, actions, remember } : { say, actions }
}

/**
 * Where the spoken text can be cut for the voice: the end of the first full sentence (or a long clause),
 * so speech starts while the model is still writing. Returns the index after the cut, or -1.
 */
export function speakableCut(text: string, min = 12): number {
  const re = /[.!?…]+["”']?(\s|$)|[,;:—]\s/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length
    const strong = /[.!?…]/.test(m[0])
    if (end >= min && (strong || end >= 48)) return end
  }
  return -1
}
