/**
 * POST /api/npc/persona { seed: { id, role?, name?, persona? }, scene } → { persona, ms, costUsd, error? }
 * One cheap Haiku call when a person comes into being: who they are, how they talk, a secret, and a day of
 * 5–6 routine blocks that name real things in the scene. Always answers (a seeded stand-in on failure).
 */
import type { CastEntry, PersonSeed } from '#shared/npc/persona'
import { generatePersona } from '../../utils/npc'
import { ensureKey } from '../../utils/npcKey'

export default defineEventHandler(async (event) => {
  ensureKey(event)
  const body = await readBody<{ seed?: Partial<PersonSeed>, scene?: string, others?: string[], cast?: CastEntry, place?: string }>(event)
  const s = body?.seed
  if (!s || typeof s.id !== 'string') throw createError({ statusCode: 400, statusMessage: 'seed.id is required' })
  const seed: PersonSeed = { id: s.id, role: str(s.role), name: str(s.name), persona: str(s.persona) }
  const others = Array.isArray(body.others) ? body.others.filter(o => typeof o === 'string').map(o => o.slice(0, 120)).slice(0, 14) : []
  const c = body.cast
  const cast: CastEntry | undefined = c && typeof c.occupation === 'string' ? { id: seed.id, name: seed.name ?? String(c.name ?? ''), age: Number(c.age) || 0, occupation: c.occupation.slice(0, 40), temperament: String(c.temperament ?? '').slice(0, 40), ties: Array.isArray(c.ties) ? c.ties.slice(0, 3).map(t => String(t).slice(0, 80)) : [] } : undefined
  const res = await generatePersona(seed, typeof body.scene === 'string' ? body.scene : '', others, undefined, cast, typeof body.place === 'string' ? body.place.slice(0, 40) : '')
  console.info(`[npc] persona ${seed.name ?? seed.id} (${seed.role ?? 'villager'}) ${res.ms} ms $${res.costUsd.toFixed(5)}${res.error ? ` error=${res.error}` : ''}`)
  return { persona: res.persona, ms: res.ms, costUsd: res.costUsd, ...(res.error ? { error: res.error } : {}) }
})

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, 240) : undefined
}
