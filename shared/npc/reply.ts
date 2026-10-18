/**
 * What an NPC says back, and what they do about it. The model writes its spoken line first, in plain text
 * (so the first words reach the caption and the voice while it is still writing), then one line that
 * starts with `>>` and a JSON object of actions:
 *
 *   Ha! You're back. Did that storm rattle you too?
 *   >> {"do":[{"act":"wave"},{"act":"walk_to","target":"dock"}],"remember":"the visitor likes storms"}
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

/** How they feel as they say it: drives the face (brows, eyes, mouth) and the posture. */
export const MOODS = ['happy', 'amused', 'curious', 'afraid', 'annoyed', 'sad', 'calm'] as const
export type Mood = typeof MOODS[number]

const MOOD_ALIASES: Record<string, Mood> = {
  glad: 'happy', joyful: 'happy', delighted: 'happy', excited: 'happy', warm: 'happy', cheerful: 'happy', proud: 'happy',
  funny: 'amused', playful: 'amused', teasing: 'amused', wry: 'amused',
  interested: 'curious', puzzled: 'curious', surprised: 'curious', intrigued: 'curious', confused: 'curious', awed: 'curious', amazed: 'curious',
  scared: 'afraid', nervous: 'afraid', anxious: 'afraid', worried: 'afraid', frightened: 'afraid', terrified: 'afraid', shocked: 'afraid',
  angry: 'annoyed', irritated: 'annoyed', grumpy: 'annoyed', cross: 'annoyed', suspicious: 'annoyed',
  sorrowful: 'sad', wistful: 'sad', lonely: 'sad', tired: 'sad', melancholy: 'sad',
  neutral: 'calm', thoughtful: 'calm', content: 'calm', serene: 'calm'
}

export function toMood(v: unknown): Mood | undefined {
  if (typeof v !== 'string') return undefined
  const w = v.trim().toLowerCase()
  return (MOODS as readonly string[]).includes(w) ? w as Mood : MOOD_ALIASES[w]
}

export interface NpcReply {
  say: string
  actions: NpcAction[]
  remember?: string
  mood?: Mood
}

/** Spoken lines stay spoken-length: past `max` words, cut at the last sentence end that fits (or keep it whole if none does). */
export const MAX_WORDS = 34
export function capSpoken(text: string, max = MAX_WORDS): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= max) return text
  const head = words.slice(0, max).join(' ')
  const m = /^(.*[.!?…])["”']?(?=\s|$)/s.exec(head)
  return m && m[1]!.split(/\s+/).length >= 6 ? m[0] : text
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
  return capSpoken(cleanSpoken(s))
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
  const say = capSpoken(cleanSpoken(i >= 0 ? full.slice(0, i) : full).trim())
  if (i < 0) return { say, actions: [] }
  const tail = firstJsonObject(full.slice(i + MARK.length))
  if (!tail) return { say, actions: [] }
  const list = Array.isArray(tail.do) ? tail.do : Array.isArray(tail.actions) ? tail.actions : []
  const actions = list.map(action).filter((a): a is NpcAction => !!a).slice(0, 4)
  const remember = typeof tail.remember === 'string' && tail.remember.trim() ? tail.remember.trim().slice(0, 160) : undefined
  const mood = toMood(tail.mood)
  return { say, actions, ...(remember ? { remember } : {}), ...(mood ? { mood } : {}) }
}

export interface BanterLine { who: string, line: string, to?: string, mood?: Mood, act?: 'point' | 'look_at' | 'wave' | 'cheer' | 'flinch', target?: string }

/** People talking among themselves: `{"lines":[{who, line, to, mood, act, target}]}` → lines by known speakers only. */
export function parseBanter(text: string, names: string[]): BanterLine[] {
  const raw = firstJsonObject(text)
  const list = raw && Array.isArray(raw.lines) ? raw.lines as unknown[] : []
  const byLower = new Map(names.map(n => [n.toLowerCase(), n]))
  const out: BanterLine[] = []
  for (const r of list.slice(0, 5)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const who = byLower.get(String(o.who ?? '').trim().toLowerCase().split(/[\s,]/)[0]!) ?? byLower.get(String(o.who ?? '').trim().toLowerCase())
    const line = capSpoken(cleanSpoken(typeof o.line === 'string' ? o.line : '').trim(), 24)
    if (!who || !line) continue
    const act = typeof o.act === 'string' && ['point', 'look_at', 'wave', 'cheer', 'flinch'].includes(o.act) ? o.act as BanterLine['act'] : undefined
    const mood = toMood(o.mood)
    out.push({ who, line, ...(typeof o.to === 'string' && o.to.trim() ? { to: o.to.trim().slice(0, 32) } : {}), ...(mood ? { mood } : {}), ...(act ? { act } : {}), ...(typeof o.target === 'string' && o.target.trim() ? { target: o.target.trim().toLowerCase().slice(0, 40) } : {}) })
  }
  return out
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
