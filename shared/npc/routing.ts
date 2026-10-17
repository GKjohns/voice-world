/**
 * Who a sentence is for: the genie (it changes the world) or a person standing in it (they answer).
 * One rule for typed text and for voice. In order:
 *
 *   1. Said to the genie by name ("genie, make it night") → the genie.
 *   2. Said to a person by name ("Mara, what's out there?", "hey Tomas") → that person (if they can hear: ≤ 30 m).
 *   3. A world command ("make it night", "put a tree there", "give her a dog", "take me to…") → the genie,
 *      even mid-conversation: the genie's verbs are imperatives that reshape the world.
 *   4. A conversation is open (they're ≤ 6 m, or ≤ 15 m if they're following you), or you're looking at
 *      someone ≤ 8 m away, or someone stands within 3 m, or someone is following you → that person. Everything conversational ("what's your name?", "follow me", "wave!",
 *      "tell me about the lake") goes to them.
 *   5. A greeting or a hail ("hello", "hey you", "excuse me") with someone ≤ 15 m away → the nearest one
 *      (the one you're looking at first).
 *   6. Otherwise → the genie.
 *
 * Pure and three-free.
 */

export interface RoutePerson {
  id: string
  name: string
  /** Metres from the player. */
  dist: number
  /** The crosshair is on them (or within a couple of degrees). */
  gazed: boolean
  /** Walking with you (they agreed to follow, or the genie told them to). */
  following?: boolean
}

export interface RouteContext {
  people: RoutePerson[]
  /** The person you're mid-conversation with, if any. */
  talkingTo?: string
}

export type Route
  = | { to: 'genie', text: string, why: string }
    | { to: 'npc', id: string, text: string, why: string }

export const HEAR_RANGE = 30
export const CONVERSE_RANGE = 6
export const GAZE_RANGE = 8
export const NEAR_RANGE = 3
export const HAIL_RANGE = 15
/** Someone following you is in the conversation even a little way behind. */
export const FOLLOW_RANGE = 15

const GENIE = /^\s*(?:(?:hey|oh|o|ok|okay)[,\s]+)?(?:genie|djinn|jinn|spirit)\b[\s,.!:;-]*/i
const GENIE_TAIL = /[\s,]+(?:genie|djinn|spirit)[\s.!?]*$/i
/** Imperatives that reshape the world. Conversational verbs (tell, show, come, follow, wave, sit) are not here. */
const COMMAND = /^\s*(?:(?:please|now|and|ok(?:ay)?|alright|so|then|also)[,\s]+)*(?:(?:can|could|would|will) you\s+)?(?:make|put|place|add|spawn|build|create|conjure|summon|raise|plant|grow|remove|delete|erase|destroy|get rid of|undo|clear|take me|teleport|bring me to|transport|turn (?:the|it|this|that|everything|all|him|her|them|me)\b|paint|colou?r|fill|let it|set (?:the|it)|change (?:the|it|this|that)|move (?:the|that|this|it|them|those)|give (?:her|him|them|it|the|everyone|everybody)\b|light up|shrink|enlarge|scatter|surround|line (?:the|some)|start (?:a |the )?(?:storm|rain|snow)|stop (?:the )?(?:rain|snow|storm)|unmake)\b/i
/** A bare scene or weather wish ("a thunderstorm", "night", "snow"): no verb, still the genie's. */
const WEATHERISH = /^\s*(?:a |an |some )?(?:thunder ?storm|storm|rain|snow|blizzard|aurora|northern lights|night(?:time)?|day(?:time)?|sunset|sunrise|dawn|dusk|fog|meteor shower|eclipse)[\s.!]*$/i
const HAIL = /^\s*(?:hey|hi|hello|hiya|howdy|oi|yo|excuse me|pardon|greetings|good (?:morning|afternoon|evening|day)|you there|hey you|sir|madam|ma'am)\b/i

function words(s: string): string {
  return s.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Is `name` addressed in `text`: at the start ("Mara, …", "hey Mara …") or at the end ("…, Mara?")? */
export function addressed(text: string, name: string): boolean {
  const n = words(name)
  if (!n) return false
  const w = words(text)
  const first = n.split(' ')[0]!
  const lead = new RegExp(`^(?:(?:hey|hi|hello|oi|yo|excuse me|ok|okay|so|and|um|uh)\\s+)*(?:${escapeRe(n)}|${escapeRe(first)})\\b`)
  const tail = new RegExp(`\\b(?:${escapeRe(n)}|${escapeRe(first)})$`)
  return lead.test(w) || tail.test(w)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isWorldCommand(text: string): boolean {
  return COMMAND.test(text) || WEATHERISH.test(text)
}

export function routeUtterance(text: string, ctx: RouteContext): Route {
  const t = text.trim()
  if (GENIE.test(t)) return { to: 'genie', text: t.replace(GENIE, '').trim() || t, why: 'addressed the genie' }
  if (GENIE_TAIL.test(t)) return { to: 'genie', text: t.replace(GENIE_TAIL, '').trim() || t, why: 'addressed the genie' }

  const byName = ctx.people.filter(p => p.dist <= HEAR_RANGE && addressed(t, p.name)).sort((a, b) => a.dist - b.dist)[0]
  // "Mara, make it night" is still a wish (and the genie hears everything); "Mara, follow me" is for Mara.
  const bare = byName ? t.replace(new RegExp(`^\\W*(?:(?:hey|hi|ok|okay|so)\\s+)?${escapeRe(byName.name)}\\W*`, 'i'), '') : t
  if (isWorldCommand(bare)) return { to: 'genie', text: bare || t, why: 'a world command' }
  if (byName) return { to: 'npc', id: byName.id, text: t, why: `addressed ${byName.name}` }

  const talking = ctx.talkingTo ? ctx.people.find(p => p.id === ctx.talkingTo && (p.dist <= CONVERSE_RANGE || (p.following && p.dist <= FOLLOW_RANGE))) : undefined
  if (talking) return { to: 'npc', id: talking.id, text: t, why: `mid-conversation with ${talking.name}` }
  const gazed = ctx.people.filter(p => p.gazed && p.dist <= GAZE_RANGE).sort((a, b) => a.dist - b.dist)[0]
  if (gazed) return { to: 'npc', id: gazed.id, text: t, why: `looking at ${gazed.name}` }
  const beside = ctx.people.filter(p => p.dist <= NEAR_RANGE).sort((a, b) => a.dist - b.dist)[0]
  if (beside) return { to: 'npc', id: beside.id, text: t, why: `${beside.name} is right beside you` }
  const follower = ctx.people.filter(p => p.following && p.dist <= FOLLOW_RANGE).sort((a, b) => a.dist - b.dist)[0]
  if (follower) return { to: 'npc', id: follower.id, text: t, why: `${follower.name} is walking with you` }

  if (HAIL.test(t)) {
    const hailed = ctx.people.filter(p => p.dist <= HAIL_RANGE).sort((a, b) => Number(b.gazed) - Number(a.gazed) || a.dist - b.dist)[0]
    if (hailed) return { to: 'npc', id: hailed.id, text: t, why: `hailed ${hailed.name}` }
  }
  return { to: 'genie', text: t, why: 'no one is being spoken to' }
}

/**
 * Speaker bleed guard for voice: the mic hearing a person's own line back. True when most of the heard
 * words are in what they just said (and the heard line isn't tiny).
 */
export function isEcho(heard: string, spoken: string): boolean {
  const h = words(heard).split(' ').filter(w => w.length > 2)
  if (h.length < 3) return false
  const s = new Set(words(spoken).split(' '))
  return h.filter(w => s.has(w)).length / h.length >= 0.7
}
