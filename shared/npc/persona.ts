/**
 * An NPC's mind, as data: who they are (persona), what their day looks like (routine), what they remember
 * (memory). The persona comes from one cheap model call at spawn, grounded in the scene; until it lands (or
 * if it fails) a seeded fallback built from the role stands in, so a person is alive from the first frame.
 * Pure and three-free: the server route, the client and the tests share it.
 */
import { balancedJson } from '../json.ts'
import { personGender, rolePreset } from './people.ts'
import type { Role } from '../world/ops.ts'

/** Time-of-day slots a routine is written in. The world's time maps onto one or more of them (routine.ts). */
export const DAY_SLOTS = ['dawn', 'morning', 'midday', 'afternoon', 'evening', 'night'] as const
export type DaySlot = typeof DAY_SLOTS[number]

/** What the body does while they're at a routine place. */
export const ACTIVITIES = ['stand', 'sit', 'work', 'fish', 'sweep', 'chat', 'sleep', 'patrol', 'wander', 'read', 'cast', 'tend', 'play', 'serve'] as const
export type Activity = typeof ACTIVITIES[number]

export interface RoutineBlock {
  when: DaySlot
  /** A short phrase for the prompt and the HUD: "mending nets on the dock". */
  doing: string
  /** Where: a kind or tag in the scene ("dock", "house", "tree"), a person's name, or "home" / "wander". */
  place: string
  activity: Activity
}

export interface Persona {
  name: string
  age: number
  occupation: string
  personality: string
  /** How they talk: "slow, dry, few words, calls you 'friend'". */
  speech: string
  backstory: string
  /** A secret or a desire: the thing that makes a second conversation different from the first. */
  secret: string
  voice: 'f' | 'm'
  routine: RoutineBlock[]
  /** Who they are to the others here (from the cast call, so both sides agree): "Ines's older brother". */
  ties?: string[]
  /** True when the model wrote it; false while the seeded stand-in is in use. */
  generated: boolean
}

/** One person's place in a crowd, decided by one cast call for the whole group (varied jobs, shared ties). */
export interface CastEntry {
  id: string
  name: string
  age: number
  occupation: string
  temperament: string
  /** "Ines's older brother", "owes Hugo money", "best friends with Pia". */
  ties: string[]
}

export interface PersonSeed {
  id: string
  role?: string
  name?: string
  /** The genie's hint ("knows everything about this lake"). */
  persona?: string
}

const TEMPLATES: Record<Role, { occupation: string, age: [number, number], personality: string[], speech: string[], backstory: string[], secret: string[], routine: [DaySlot, string, string, Activity][] }> = {
  villager: {
    occupation: 'villager', age: [24, 58],
    personality: ['curious and warm, a little nosy', 'cheerful, easily amazed', 'wary of strangers but kind underneath'],
    speech: ['chatty, asks questions back', 'plain words, the odd local saying', 'quick, laughs at their own jokes'],
    backstory: ['grew up right here and has never left', 'came for a summer and stayed twenty years', 'lost a sibling to a fever years ago'],
    secret: ['wants to see the world beyond the hills', 'is afraid of the dark', 'once saw a light in the sky nobody believed'],
    routine: [['dawn', 'waking slowly at home', 'home', 'stand'], ['morning', 'fetching water', 'water', 'work'], ['midday', 'chatting with neighbours', 'person', 'chat'], ['afternoon', 'tending the garden', 'bush', 'tend'], ['evening', 'sitting on a bench', 'bench', 'sit'], ['night', 'asleep at home', 'home', 'sleep']]
  },
  fisherman: {
    occupation: 'fisherman', age: [40, 70],
    personality: ['patient and dry, notices everything about the water', 'gruff, then generous once you listen', 'superstitious and proud of it'],
    speech: ['slow, few words, calls you "friend"', 'salty, full of weather lore', 'mutters, then tells a long story'],
    backstory: ['has fished these waters for forty years', 'his father built the dock with his own hands', 'once pulled up something he still won\'t name'],
    secret: ['there is a fish he has hunted for thirty years', 'he can no longer see well at distance', 'he talks to the lake when nobody is around'],
    routine: [['dawn', 'casting a line at the end of the dock', 'dock', 'fish'], ['morning', 'fishing from the dock', 'dock', 'fish'], ['midday', 'mending nets by the water', 'water', 'work'], ['afternoon', 'fishing again', 'dock', 'fish'], ['evening', 'by the fire telling stories', 'campfire', 'sit'], ['night', 'asleep at home', 'home', 'sleep']]
  },
  shopkeeper: {
    occupation: 'shopkeeper', age: [30, 60],
    personality: ['brisk and shrewd, secretly sentimental', 'warm, remembers every customer', 'anxious about the books, generous anyway'],
    speech: ['sells while talking, always a deal', 'polite, a touch formal', 'fast and funny, gossip on tap'],
    backstory: ['inherited the shop from an aunt', 'was a sailor before she opened the shop', 'keeps a ledger of everyone who owes him a favour'],
    secret: ['the shop is quietly failing', 'collects strange objects travellers leave behind', 'wants to paint, not sell'],
    routine: [['dawn', 'opening up the shop', 'storefront', 'sweep'], ['morning', 'behind the counter', 'storefront', 'work'], ['midday', 'sweeping the front step', 'storefront', 'sweep'], ['afternoon', 'chatting with customers', 'person', 'chat'], ['evening', 'counting the day\'s coins', 'table', 'work'], ['night', 'asleep upstairs', 'home', 'sleep']]
  },
  child: {
    occupation: 'child', age: [7, 11],
    personality: ['fearless and full of questions', 'shy until something amazing happens', 'mischievous, always running'],
    speech: ['excited, says "whoa" a lot', 'tells you secrets in a whisper', 'asks "why?" after everything'],
    backstory: ['lives with a grandmother at the edge of town', 'wants to be a knight', 'found a strange stone by the water'],
    secret: ['thinks you might be magic', 'is hiding a frog in a pocket', 'is scared of the dragon stories'],
    routine: [['dawn', 'sleeping late', 'home', 'sleep'], ['morning', 'playing by the trees', 'tree', 'wander'], ['midday', 'skipping stones at the water', 'water', 'work'], ['afternoon', 'exploring', 'wander', 'wander'], ['evening', 'watching the sky', 'bench', 'sit'], ['night', 'asleep', 'home', 'sleep']]
  },
  elder: {
    occupation: 'retired', age: [72, 91],
    personality: ['wise, a little cryptic, enjoys being right', 'gentle and forgetful, then suddenly sharp', 'grumpy about the young, fond of them really'],
    speech: ['slow, proverbs, calls you "child"', 'rambling, every story starts long ago', 'few words, each one weighed'],
    backstory: ['was the village healer for fifty years', 'remembers when there was nothing here at all', 'fought in a war nobody else remembers'],
    secret: ['knows who you really are', 'buried something under the oldest tree', 'is not as frail as people think'],
    routine: [['dawn', 'walking slowly with a cane', 'wander', 'wander'], ['morning', 'sitting on a bench watching', 'bench', 'sit'], ['midday', 'resting in the shade of a tree', 'tree', 'stand'], ['afternoon', 'feeding birds', 'bench', 'sit'], ['evening', 'warming by the fire', 'campfire', 'sit'], ['night', 'asleep', 'home', 'sleep']]
  },
  guard: {
    occupation: 'town guard', age: [22, 45],
    personality: ['dutiful, a bit pompous, secretly bored', 'kind under a stern face', 'suspicious of everything, especially magic'],
    speech: ['clipped, formal, "move along"', 'tries to sound tough, cracks', 'by the book, then a sudden joke'],
    backstory: ['has never once had to draw a sword', 'joined to impress someone in town', 'came from the city after a scandal'],
    secret: ['is terrified of the dark woods', 'wants to be a poet', 'saw the genie\'s work and is shaken'],
    routine: [['dawn', 'changing the watch', 'home', 'stand'], ['morning', 'patrolling the road', 'road', 'patrol'], ['midday', 'standing guard', 'house', 'stand'], ['afternoon', 'patrolling', 'wander', 'patrol'], ['evening', 'patrolling the lamps', 'lamp', 'patrol'], ['night', 'keeping watch by the fire', 'campfire', 'stand']]
  },
  wizard: {
    occupation: 'wizard', age: [60, 140],
    personality: ['grandly mysterious, easily offended', 'absent-minded, delighted by small things', 'jealous of the genie\'s power'],
    speech: ['theatrical, riddles, archaic words', 'mumbles spells mid-sentence', 'lectures, then apologises'],
    backstory: ['has studied the sky for a century', 'was once apprentice to the genie', 'came looking for a star that fell here'],
    secret: ['their magic has stopped working', 'knows the genie is lonely', 'is looking for a spell to go home'],
    routine: [['dawn', 'reading the sky', 'wander', 'read'], ['morning', 'studying a book', 'bench', 'read'], ['midday', 'gathering herbs', 'bush', 'tend'], ['afternoon', 'casting small spells', 'tree', 'cast'], ['evening', 'watching the stars', 'wander', 'cast'], ['night', 'stargazing', 'wander', 'read']]
  },
  farmer: {
    occupation: 'farmer', age: [30, 65],
    personality: ['steady and practical, wry humour', 'worried about the weather, always', 'proud of every vegetable'],
    speech: ['plain and slow, talks about the weather', 'friendly, a big laugh', 'grumbles, then shares food'],
    backstory: ['the farm has been in the family six generations', 'lost a whole harvest last year', 'raised a horse from a foal'],
    secret: ['wants to sell up and go to sea', 'talks to the crops', 'owes money to the shopkeeper'],
    routine: [['dawn', 'feeding the animals', 'horse', 'work'], ['morning', 'working the field', 'wander', 'work'], ['midday', 'resting under a tree', 'tree', 'sit'], ['afternoon', 'tending the hedges', 'bush', 'tend'], ['evening', 'walking home', 'home', 'wander'], ['night', 'asleep', 'home', 'sleep']]
  }
}

function hash(id: string, salt: string): number {
  let h = 2166136261
  for (const ch of id + salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}
const pick = <T>(list: T[], id: string, salt: string): T => list[Math.floor(hash(id, salt) * list.length) % list.length]!

/** The seeded stand-in: alive from the first frame, consistent across reloads, and never a model call. */
export function fallbackPersona(seed: PersonSeed): Persona {
  const preset = rolePreset(seed.role)
  const t = TEMPLATES[preset]
  const [a0, a1] = t.age
  return {
    name: seed.name ?? 'Stranger',
    age: Math.round(a0 + hash(seed.id, 'age') * (a1 - a0)),
    occupation: seed.role && seed.role !== preset ? seed.role : t.occupation,
    personality: pick(t.personality, seed.id, 'p'),
    speech: pick(t.speech, seed.id, 's'),
    backstory: seed.persona ? `${seed.persona}; ${pick(t.backstory, seed.id, 'b')}` : pick(t.backstory, seed.id, 'b'),
    secret: pick(t.secret, seed.id, 'x'),
    voice: personGender(seed.id, seed.name),
    routine: t.routine.map(([when, doing, place, activity]) => ({ when, doing, place, activity })),
    generated: false
  }
}

/** The first balanced JSON object in model text (code fences, prose around it and trailing commas tolerated). */
export function firstJsonObject(text: string): Record<string, unknown> | null {
  const body = balancedJson(text, text.indexOf('{'))
  if (!body) return null
  for (const attempt of [body, body.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      const v = JSON.parse(attempt)
      return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null
    } catch {
      // try the next repair
    }
  }
  return null
}

const str = (v: unknown, max: number): string | undefined => typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined

/**
 * A model's persona text → a Persona. Every field is checked on its own and falls back to the seeded
 * stand-in, so a half-good answer still yields a whole person. The routine keeps 3–6 valid blocks.
 */
export function parsePersona(text: string, seed: PersonSeed): Persona {
  const base = fallbackPersona(seed)
  const raw = firstJsonObject(text)
  if (!raw) return base
  const routine: RoutineBlock[] = []
  if (Array.isArray(raw.routine)) {
    for (const r of raw.routine.slice(0, 8)) {
      if (!r || typeof r !== 'object') continue
      const b = r as Record<string, unknown>
      const when = String(b.when ?? '').toLowerCase() as DaySlot
      if (!(DAY_SLOTS as readonly string[]).includes(when)) continue
      const act = String(b.activity ?? 'stand').toLowerCase() as Activity
      routine.push({
        when,
        doing: str(b.doing, 80) ?? 'going about the day',
        place: (str(b.place, 32) ?? 'wander').toLowerCase().replace(/^(the|a|an|some|\d+)[\s_]+/, '').replace(/[\s-]+/g, '_'),
        activity: (ACTIVITIES as readonly string[]).includes(act) ? act : 'stand'
      })
    }
  }
  const age = typeof raw.age === 'number' && raw.age > 0 && raw.age < 400 ? Math.round(raw.age) : base.age
  const voice = raw.voice === 'f' || raw.voice === 'm' ? raw.voice : base.voice
  return {
    // The world named them; the model may not rename them (selectors and memory key on the name).
    name: seed.name ?? str(raw.name, 32) ?? base.name,
    age,
    occupation: str(raw.occupation, 60) ?? base.occupation,
    personality: str(raw.personality, 220) ?? base.personality,
    speech: str(raw.speech, 220) ?? base.speech,
    backstory: str(raw.backstory, 420) ?? base.backstory,
    secret: str(raw.secret, 300) ?? base.secret,
    voice,
    routine: routine.length >= 3 ? routine : base.routine,
    generated: true
  }
}

/** The cast call's text → one entry per seed, matched by name (order as a fallback). Unknown names are dropped. */
export function parseCast(text: string, seeds: PersonSeed[]): CastEntry[] {
  const raw = firstJsonObject(text)
  const list = raw && Array.isArray(raw.cast) ? raw.cast as unknown[] : []
  const out: CastEntry[] = []
  seeds.forEach((seed, i) => {
    const byName = list.find(c => c && typeof c === 'object' && String((c as Record<string, unknown>).name ?? '').toLowerCase() === (seed.name ?? '').toLowerCase())
    const c = (byName ?? list[i]) as Record<string, unknown> | undefined
    if (!c || typeof c !== 'object') return
    const age = typeof c.age === 'number' && c.age > 0 && c.age < 400 ? Math.round(c.age) : 0
    const ties = Array.isArray(c.ties) ? c.ties.filter((t): t is string => typeof t === 'string' && !!t.trim()).map(t => t.trim().slice(0, 80)).slice(0, 3) : []
    out.push({ id: seed.id, name: seed.name ?? str(c.name, 32) ?? '', age, occupation: str(c.occupation, 40) ?? '', temperament: str(c.temperament, 40) ?? '', ties })
  })
  return out
}

// ---------- memory ----------

export interface Turn {
  who: 'player' | 'npc'
  text: string
  at: number
}

export interface Memory {
  /** The rolling summary of everything older than `turns` (kept short so prompts stay small). */
  summary: string
  /** The latest exchanges, oldest first. */
  turns: Turn[]
  /** Things they saw happen in the world: "the stranger wished, and a dragon appeared". Newest last. */
  events: { text: string, at: number }[]
  /** Facts they chose to remember ("the stranger's name is Kyle"). */
  facts: string[]
  met: number
  lastTalkAt: number
}

export const MAX_TURNS = 12
export const KEEP_TURNS = 6
export const MAX_EVENTS = 10
export const MAX_FACTS = 12

export function emptyMemory(): Memory {
  return { summary: '', turns: [], events: [], facts: [], met: 0, lastTalkAt: 0 }
}

/** Add a turn; when the log is over MAX_TURNS, the oldest ones move to `toSummarize` (the caller folds them in). */
export function addTurn(m: Memory, turn: Turn): { memory: Memory, toSummarize: Turn[] } {
  const turns = [...m.turns, turn]
  if (turns.length <= MAX_TURNS) return { memory: { ...m, turns }, toSummarize: [] }
  const cut = turns.length - KEEP_TURNS
  return { memory: { ...m, turns: turns.slice(cut) }, toSummarize: turns.slice(0, cut) }
}

export function addEvent(m: Memory, text: string, at: number): Memory {
  // The same thing seen twice in a row (a storm, then the storm again) is one memory.
  if (m.events[m.events.length - 1]?.text === text) return m
  return { ...m, events: [...m.events, { text: text.slice(0, 200), at }].slice(-MAX_EVENTS) }
}

export function addFact(m: Memory, fact: string): Memory {
  const f = fact.trim().slice(0, 160)
  if (!f || m.facts.some(x => x.toLowerCase() === f.toLowerCase())) return m
  return { ...m, facts: [...m.facts, f].slice(-MAX_FACTS) }
}

/** A cheap, model-free fold for when the summarizer can't be reached: keep the gist of the last lines. */
export function naiveSummary(prev: string, turns: Turn[]): string {
  const lines = turns.map(t => `${t.who === 'player' ? 'They said' : 'I said'}: "${t.text.slice(0, 80)}"`).join(' ')
  return `${prev ? `${prev} ` : ''}${lines}`.slice(-700)
}
