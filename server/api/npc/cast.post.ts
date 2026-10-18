/**
 * POST /api/npc/cast { seeds: [{ id, name, role?, persona?, gender }], scene, residents? } → { cast, ms, costUsd }
 * One call for a whole group spawned together, before their personas: different jobs, spread ages and
 * temperaments, and 2–6 ties between them (siblings, rivals, friends) that both sides agree on. Each
 * person's persona call then gets their entry. Always answers (an empty cast on failure).
 */
import type { PersonSeed } from '#shared/npc/persona'
import { generateCast } from '../../utils/npc'
import { ensureKey } from '../../utils/gatewayKey'

export default defineEventHandler(async (event) => {
  ensureKey(event)
  const body = await readBody<{ seeds?: (PersonSeed & { gender?: string })[], scene?: string, residents?: string[] }>(event)
  const seeds = (Array.isArray(body?.seeds) ? body.seeds : []).filter(s => s && typeof s.id === 'string' && typeof s.name === 'string').slice(0, 24)
    .map(s => ({ id: s.id, name: s.name!.slice(0, 32), role: typeof s.role === 'string' ? s.role.slice(0, 32) : undefined, persona: typeof s.persona === 'string' ? s.persona.slice(0, 160) : undefined, gender: s.gender === 'f' ? 'f' as const : 'm' as const }))
  if (seeds.length < 2) return { cast: [], ms: 0, costUsd: 0 }
  const residents = Array.isArray(body?.residents) ? body.residents.filter(r => typeof r === 'string').map(r => r.slice(0, 120)).slice(0, 12) : []
  const res = await generateCast(seeds, typeof body?.scene === 'string' ? body.scene : '', residents)
  console.info(`[npc] cast of ${seeds.length} ${res.ms} ms $${res.costUsd.toFixed(5)}: ${res.cast.map(c => `${c.name} ${c.age} ${c.occupation}`).join(', ')}${res.error ? ` error=${res.error}` : ''}`)
  return res
})
