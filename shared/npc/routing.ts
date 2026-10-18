/**
 * Who a sentence is for: the genie (it changes the world) or a person standing in it (they answer).
 * One rule for typed text and for voice. In order:
 *
 *   1. Said to the genie by name ("genie, make it night") → the genie.
 *   2. Said to a person by name ("Mara, what's out there?", "hey Tomas") → that person (if they can hear: ≤ 30 m).
 *   3. A world command ("make it night", "put a tree there", "give her a dog", "take me to…") → the genie,
 *      even mid-conversation: the genie's verbs are imperatives that reshape the world.
 *   4. You're looking at someone ≤ 8 m away (even mid-conversation with someone else), or a conversation
 *      is open (they're ≤ 6 m, or ≤ 15 m if they're following you), or someone stands within 3 m, or someone is following you → that person. Everything conversational ("what's your name?", "follow me", "wave!",
 *      "tell me about the lake") goes to them.
 *      Said to someone in focus, everyday idioms that start with a genie verb stay with them ("fill me in",
 *      "make yourself at home", "put your rod down", "take me to your favourite spot": a walk, never a
 *      teleport). A wish wrapped in talk ("Let me show you something. Make the table glow.") is split: the
 *      wish to the genie, the rest to the person once it's granted.
 *   5. Nobody in focus: a question about someone ("what's Mara up to?") goes to a neighbour; a greeting
 *      or a hail, or a "your" question, with someone ≤ 15 m away (≤ 8 m for "your") → the nearest one (the one you face first).
 *   6. Otherwise → the genie.
 *
 * A name is addressed only at the start ("Mara, …") or as a tail vocative after a comma ("…, Mara?");
 * "what do you think of Mara?" is about her. The genie's name is matched fuzzily for voice ("Jeannie").
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
  = | { to: 'genie', text: string, why: string, rest?: { id: string, text: string } }
    | { to: 'npc', id: string, text: string, why: string }
/** A wish with talk around it: after the genie grants `text`, the person in focus hears `rest` (and reacts to what really happened). */
export type GenieRoute = Extract<Route, { to: 'genie' }>

export const HEAR_RANGE = 30
export const CONVERSE_RANGE = 6
export const GAZE_RANGE = 8
export const NEAR_RANGE = 3
export const HAIL_RANGE = 15
/** Someone following you is in the conversation even a little way behind. */
export const FOLLOW_RANGE = 15

/**
 * The genie's name, and how voice transcription mishears it ("Jeannie. May." for "Genie, make it night").
 * A person who really is called Gene or Jean wins over the fuzzy forms (see `genieWord`).
 */
const GENIE_NAMES = String.raw`genie'?s?|djinni?|jinni?|jinn|spirit|jeannie|jeanie|jeany|jeanne|jeani|jenie|jini|jinny|geenie|genii|gene|jean`
const FUZZY = new Set(['jeannie', 'jeanie', 'jeany', 'jeanne', 'jeani', 'jenie', 'jini', 'jinny', 'geenie', 'genii', 'gene', 'jean'])
const GENIE = new RegExp(String.raw`^\s*(?:(?:hey|hi|oh|o|ok|okay|yo)[,\s]+)?(${GENIE_NAMES})(?=$|[\s,.!?:;-])[\s,.!?:;-]*`, 'i')
const GENIE_TAIL = new RegExp(String.raw`[\s,]+(${GENIE_NAMES})[\s.!?]*$`, 'i')
/** Just the genie's name ("Genie.", "hey Jeannie"): the rest of the wish is still coming. */
export function isGenieHail(text: string): boolean {
  const m = GENIE.exec(text)
  return !!m && !text.slice(m[0].length).trim()
}

/** Imperatives that reshape the world. Conversational verbs (tell, show, come, follow, wave, sit) are not here. */
const COMMAND = /^\s*(?:(?:please|now|and|ok(?:ay)?|alright|so|then|also)[,\s]+)*(?:(?:can|could|would|will) you\s+)?(?:make|put|place|add|spawn|build|create|conjure|summon|raise|plant|grow|remove|delete|erase|destroy|get rid of|undo|clear|reset|start over|start (?:again|fresh)|wipe|(?:a |give me a )?(?:blank slate|new world)|take me|teleport|bring me to|transport|turn (?:the|it|this|that|everything|all|him|her|them|me|your|his|their)\b|paint|colou?r|fill|let it|set (?:the|it)|change (?:the|it|this|that)|move (?:the|that|this|it|them|those)|give (?:her|him|them|it|the|everyone|everybody)\b|light up|shrink|enlarge|scatter|surround|line (?:the|some)|start (?:a |the )?(?:storm|rain|snow)|stop (?:the )?(?:rain|snow|storm)|unmake)\b/i
/** A bare scene or weather wish ("a thunderstorm", "night", "snow"): no verb, still the genie's. */
const WEATHERISH = /^\s*(?:a |an |some )?(?:thunder ?storm|storm|rain|snow|blizzard|aurora|northern lights|night(?:time)?|day(?:time)?|sunset|sunrise|dawn|dusk|fog|meteor shower|eclipse)[\s.!]*$/i
const HAIL = /^\s*(?:hey|hi|hello|hiya|howdy|oi|yo|excuse me|pardon|greetings|good (?:morning|afternoon|evening|day)|you there|hey you|sir|madam|ma'am)\b/i
/**
 * Everyday idioms that start with a genie verb but are said to a person: "fill me in", "make yourself at
 * home", "take me to your favourite spot", "put your rod down". Only when someone is in focus.
 */
const IDIOM = /^\s*(?:(?:please|now|and|ok(?:ay)?|alright|so|then|also|hey)[,\s]+)*(?:(?:can|could|would|will) you\s+)?(?:fill me in|let it (?:go|be|slide|rest)|let me\b|make yourself|make (?:sense|it quick|up your mind|a wish|room)|set the table|change the subject|take (?:your time|a seat|a break|care|it easy|me with you|a look|a guess)|put (?:it|that) (?:this|another) way|put in a good word|turn around|light up your|grow up|paint (?:me )?a picture|make me (?:a |some |an? )?(?:tea|coffee|cup|drink|breakfast|lunch|dinner|sandwich|offer|deal))\b/i
/** A genie verb whose object is the person or the player, not the world ("put your rod down", "take me to your spot"). */
const PERSONAL = /^\s*(?:(?:please|now|and|ok(?:ay)?|alright|so|then|also)[,\s]+)*(?:(?:can|could|would|will) you\s+)?(?:\w+(?: up| down| off| out| in)?)\s+(?:me\s+(?:in|to|around|through)\s+(?:on\s+)?)?(?:your|yours|yourself)\b/i
/** …unless the sentence is plainly magic ("make your hat glow", "turn your house into gold"). */
const MAGIC = /\b(?:into|bigger|smaller|larger|huge|giant|tiny|glow\w*|lava|gold(?:en)?|invisible|disappear|vanish|fly|float|on fire|burn|red|blue|green|purple|pink|orange|yellow|black|white|silver|crystal|ice)\b/i
/** Going somewhere with a person ("take me to your favourite spot", "show me where you fish") is a walk, never a teleport. */
const WALK_WITH = /\b(?:take|bring|show|lead|walk|guide)\s+(?:me|us)\s+(?:to\s+|around\s+|where\s+)?(?:your|yours|his|her|their|where\s+you)\b/i
/** A possessive "your" with nobody in focus: said to whoever's near, not to the genie (who would teleport you to "favorite spot"). */
const SECOND_PERSON = /\b(?:your|yours|yourself)\b/i
/** Words before a name that make it the object of the sentence, not who it's said to ("think of Mara", "know Maeve"). */
const OBJECT_BEFORE = /\b(?:of|to|about|know|knows|meet|met|introduce me to|with|and|for|ask|tell|like|see|seen|find|where's|where is|is|was|than|from|by|at|call|called|named|isn't|thinks|said|says)\s*$/

function words(s: string): string {
  return s.toLowerCase().replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Is `name` addressed in `text`: at the start ("Mara, …", "hey Mara …") or as a tail vocative after a
 * comma ("…, Mara?"). A name inside the sentence ("what do you think of Mara?", "do you know Maeve?",
 * "Mara's boat") is talked about, not talked to.
 */
export function addressed(text: string, name: string): boolean {
  const n = words(name)
  if (!n) return false
  const first = n.split(' ')[0]!
  const names = `(?:${escapeRe(n)}|${escapeRe(first)})`
  const raw = text.toLowerCase().trim()
  const lead = new RegExp(String.raw`^(?:(?:hey|hi|hello|oi|yo|excuse me|ok|okay|so|and|um|uh|thanks|thank you|well)[\s,]+)*${names}(?!'s|’s)(?:$|[\s,.!?:;-])`)
  if (lead.test(raw)) return true
  // A tail vocative: "…, Mara?" / "… right, Mara". Never "…think of Mara?" (no comma, or an object word before it).
  const tail = new RegExp(String.raw`^(.*?)[,—–-]\s*(?:hey\s+)?${names}[\s.!?]*$`)
  const m = tail.exec(raw)
  if (m && !OBJECT_BEFORE.test(words(m[1]!))) return true
  return false
}

/** Is `name` mentioned anywhere in `text` (as a word)? */
function mentioned(text: string, name: string): boolean {
  const first = words(name).split(' ')[0]
  return !!first && new RegExp(String.raw`\b${escapeRe(first)}\b`).test(words(text))
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function isWorldCommand(text: string): boolean {
  return COMMAND.test(text) || WEATHERISH.test(text)
}

/** A world command that, said to a person in front of you, is really just talk ("fill me in", "put your rod down"). */
export function isPersonalIdiom(text: string): boolean {
  if (IDIOM.test(text) || WALK_WITH.test(text)) return true
  return PERSONAL.test(text) && !MAGIC.test(text)
}

/** Sentences, split where a speaker would pause. */
function sentences(t: string): string[] {
  return t.split(/(?<=[.!?])\s+(?=\S)/).map(s => s.trim()).filter(Boolean)
}

/** The genie's word at the start or end, unless a person here is actually called that (Gene, Jean). */
function genieWord(t: string, ctx: RouteContext): RegExpExecArray | null {
  for (const re of [GENIE, GENIE_TAIL]) {
    const m = re.exec(t)
    if (!m) continue
    const w = m[1]!.toLowerCase()
    if (FUZZY.has(w) && ctx.people.some(p => p.dist <= HEAR_RANGE && words(p.name).split(' ')[0] === w)) continue
    return m
  }
  return null
}

export function routeUtterance(text: string, ctx: RouteContext): Route {
  const t = text.trim()
  const g = genieWord(t, ctx)
  if (g) {
    const rest = (g.index === 0 ? t.slice(g[0].length) : t.slice(0, g.index)).trim()
    return { to: 'genie', text: rest || t, why: 'addressed the genie' }
  }

  const byName = ctx.people.filter(p => p.dist <= HEAR_RANGE && addressed(t, p.name)).sort((a, b) => a.dist - b.dist)[0]
  // "Mara, make it night" is still a wish (and the genie hears everything); "Mara, follow me" is for Mara.
  const bare = byName ? t.replace(new RegExp(`^\\W*(?:(?:hey|hi|ok|okay|so)\\s+)?${escapeRe(byName.name)}\\W*`, 'i'), '') : t

  // Who's in focus (the conversation, the one you face, the one beside you, the one walking with you).
  const talking = ctx.talkingTo ? ctx.people.find(p => p.id === ctx.talkingTo && (p.dist <= CONVERSE_RANGE || (p.following && p.dist <= FOLLOW_RANGE))) : undefined
  const gazed = ctx.people.filter(p => p.gazed && p.dist <= GAZE_RANGE).sort((a, b) => a.dist - b.dist)[0]
  const beside = ctx.people.filter(p => p.dist <= NEAR_RANGE).sort((a, b) => a.dist - b.dist)[0]
  const follower = ctx.people.filter(p => p.following && p.dist <= FOLLOW_RANGE).sort((a, b) => a.dist - b.dist)[0]
  // Turning to face someone else and speaking is talking to them (the crosshair on a person beats the open conversation).
  const facing = gazed && gazed.id !== talking?.id ? gazed : undefined
  const inFocus = byName ?? facing ?? talking ?? gazed ?? beside ?? follower
  const whyFocus = byName ? `addressed ${byName.name}` : facing ? `looking at ${facing.name}` : talking ? `mid-conversation with ${talking.name}` : gazed ? `looking at ${gazed.name}` : beside ? `${beside.name} is right beside you` : follower ? `${follower!.name} is walking with you` : ''

  // "Let me show you something. Make the pool table glow like lava.": the wish to the genie, the rest to the person.
  if (inFocus) {
    const parts = sentences(bare)
    if (parts.length > 1) {
      const wish = parts.filter(s => isWorldCommand(s) && !isPersonalIdiom(s))
      const talk = parts.filter(s => !wish.includes(s))
      if (wish.length && talk.length) return { to: 'genie', text: wish.join(' '), why: 'a world command (the rest is for the person)', rest: { id: inFocus.id, text: talk.join(' ') } }
    }
  }

  if (isWorldCommand(bare) && !(inFocus && isPersonalIdiom(bare))) return { to: 'genie', text: bare || t, why: 'a world command' }
  if (inFocus) return { to: 'npc', id: inFocus.id, text: t, why: whyFocus }

  // Nobody in focus. "What's Mara up to?": ask a neighbour (anyone near but her), never the genie.
  const about = ctx.people.find(p => p.dist <= HEAR_RANGE && mentioned(t, p.name))
  const near = ctx.people.filter(p => p.dist <= HAIL_RANGE).sort((a, b) => Number(b.gazed) - Number(a.gazed) || a.dist - b.dist)
  if (about) {
    const other = near.find(p => p.id !== about.id)
    if (other) return { to: 'npc', id: other.id, text: t, why: `asked ${other.name} about ${about.name}` }
    if (about.dist <= HAIL_RANGE) return { to: 'npc', id: about.id, text: t, why: `asked ${about.name} (nobody else near)` }
  }
  if (HAIL.test(t) && near[0]) return { to: 'npc', id: near[0].id, text: t, why: `hailed ${near[0].name}` }
  // "Can you show me your favorite spot?" with someone a few steps off: that "your" is them, not the genie.
  if (SECOND_PERSON.test(t) && near[0] && near[0].dist <= GAZE_RANGE) return { to: 'npc', id: near[0].id, text: t, why: `"your" with ${near[0].name} nearby` }
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
