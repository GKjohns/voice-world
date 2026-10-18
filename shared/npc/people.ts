/**
 * People in the world language: role words ("a fisherman", "some villagers", "a crowd") become the one
 * `person` kind with a role preset, and every person gets a name at birth. Pure and seeded from the entity
 * id and the sentence's seed, so a replayed world names everyone the same way. Three-free.
 */
import type { Role } from '../world/ops.ts'

/** Gateway speech voices, by gender. The genie is OpenAI realtime `cedar`; people never use it. */
export const NPC_VOICES = { f: ['ara', 'eve', 'una'], m: ['leo', 'rex', 'sal'] } as const

/** Words the intent model (or a person) may use for a person, → the role they imply. */
export const PERSON_WORDS: Record<string, Role | null> = {
  person: null, people: null, human: null, humans: null, npc: null, npcs: null, someone: null, somebody: null, stranger: null,
  man: null, woman: null, men: null, women: null, lady: null, guy: null, crowd: null, townsfolk: null, townsperson: null, local: null, locals: null,
  villager: 'villager', villagers: 'villager', peasant: 'villager', traveler: 'villager', traveller: 'villager',
  fisherman: 'fisherman', fishermen: 'fisherman', fisher: 'fisherman', angler: 'fisherman', sailor: 'fisherman',
  shopkeeper: 'shopkeeper', merchant: 'shopkeeper', vendor: 'shopkeeper', baker: 'shopkeeper', innkeeper: 'shopkeeper', barkeep: 'shopkeeper', bartender: 'shopkeeper',
  child: 'child', children: 'child', kid: 'child', kids: 'child', boy: 'child', girl: 'child',
  elder: 'elder', old_man: 'elder', old_woman: 'elder', grandma: 'elder', grandpa: 'elder', grandmother: 'elder', grandfather: 'elder',
  guard: 'guard', guards: 'guard', soldier: 'guard', knight: 'guard', sentry: 'guard',
  wizard: 'wizard', wizards: 'wizard', mage: 'wizard', witch: 'wizard', sorcerer: 'wizard', sage: 'wizard',
  farmer: 'farmer', farmers: 'farmer', gardener: 'farmer', shepherd: 'farmer'
}

const PRESETS: Record<string, Role> = {
  villager: 'villager', fisherman: 'fisherman', shopkeeper: 'shopkeeper', child: 'child', elder: 'elder', guard: 'guard', wizard: 'wizard', farmer: 'farmer'
}

/** A spawn kind that means a person → the role it implies (null = a person of no particular role). */
export function personWord(kind: string): { role: Role | null } | undefined {
  const k = kind.toLowerCase().trim().replace(/[\s-]+/g, '_')
  return Object.hasOwn(PERSON_WORDS, k) ? { role: PERSON_WORDS[k]! } : undefined
}

/** Any role text → the preset the rig dresses for. "baker" → shopkeeper, "pirate" → villager. */
export function rolePreset(role: string | undefined): Role {
  if (!role) return 'villager'
  const r = role.toLowerCase().trim().replace(/[\s-]+/g, '_')
  return PRESETS[r] ?? PERSON_WORDS[r] ?? (/fish|sail|boat/.test(r) ? 'fisherman' : /shop|sell|merchant|cook|chef|bake|brew|inn/.test(r) ? 'shopkeeper' : /guard|soldier|knight|watch/.test(r) ? 'guard' : /wizard|mage|witch|sorce|magic|priest|monk/.test(r) ? 'wizard' : /farm|garden|herd|shepherd/.test(r) ? 'farmer' : /old|elder|grand/.test(r) ? 'elder' : /child|kid|boy|girl/.test(r) ? 'child' : 'villager')
}

const FEMININE = ['Mara', 'Edith', 'Rosa', 'Ines', 'Wren', 'Hilde', 'Nell', 'Tova', 'Ada', 'Lucia', 'Maeve', 'Odette', 'Pia', 'Greta', 'Juno', 'Sabine', 'Ilse', 'Bea', 'Corin', 'Yara']
const MASCULINE = ['Tomas', 'Bram', 'Elias', 'Oskar', 'Hugo', 'Silas', 'Anselm', 'Teo', 'Rafe', 'Jonah', 'Matthias', 'Ivo', 'Caspar', 'Ezra', 'Lev', 'Pascal', 'Dov', 'Fitz', 'Arlo', 'Gideon']

function hash(...parts: (string | number)[]): number {
  let h = 2166136261
  for (const p of parts) for (const ch of String(p)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  h ^= h >>> 13
  h = Math.imul(h, 0x5bd1e995)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}

/** 'f' or 'm' for a person, seeded from its id; a name the model gave wins when it's on one of the lists. */
export function personGender(id: string, name?: string): 'f' | 'm' {
  if (name) {
    if (FEMININE.includes(name)) return 'f'
    if (MASCULINE.includes(name)) return 'm'
    if (/a$|e$|ie$|y$|elle$/i.test(name) && !/^(jonah|luca|ezra|ilya|sasha)$/i.test(name)) return 'f'
  }
  return hash(id, 'g') < 0.5 ? 'f' : 'm'
}

/** Words that say a person's gender ("two guys", "an old woman"). */
const MALE = /\b(?:guys?|men|man|gentlem[ae]n|boys?|brothers?|lads?|fellows?|dudes?|kings?|fathers?|husbands?|grandpas?|grandfathers?|sons?|uncles?|old_man|monks?|sirs?)\b/i
const FEMALE = /\b(?:women|woman|ladies|lady|girls?|sisters?|gals?|queens?|mothers?|wives|wife|grandmas?|grandmothers?|daughters?|aunts?|old_woman|witch(?:es)?|nuns?|madams?)\b/i

/** 'f' | 'm' when the words say so (and only one way), else undefined. */
export function genderOfWords(text: string): 'f' | 'm' | undefined {
  const m = MALE.test(text)
  const f = FEMALE.test(text)
  return m && !f ? 'm' : f && !m ? 'f' : undefined
}

/** A name nobody else in `taken` has, seeded from the id and the sentence's seed (from the right list when the gender is given). */
export function personName(id: string, seed: number, taken: Set<string>, gender?: 'f' | 'm'): string {
  const g = gender ?? personGender(id)
  const list = g === 'f' ? FEMININE : MASCULINE
  const start = Math.floor(hash(id, seed, 'n') * list.length)
  for (let i = 0; i < list.length; i++) {
    const n = list[(start + i) % list.length]!
    if (!taken.has(n.toLowerCase())) return n
  }
  return `${list[start]} ${String.fromCharCode(65 + Math.floor(hash(id, 'x') * 26))}.`
}

/** The tags a person carries: the kind's, plus their role and their name (so "the fisherman" and "Mara" both select). */
export function personTags(base: string[], role: string | undefined, name: string | undefined): string[] {
  const out = [...base]
  if (role) {
    out.push(role.toLowerCase())
    const preset = rolePreset(role)
    if (preset !== role.toLowerCase()) out.push(preset)
  }
  if (name) out.push(name.toLowerCase().replace(/\s+/g, '_'))
  return [...new Set(out)]
}
