/** POST /api/npc/summary { name, prev, turns } → { summary } (null when the model couldn't be reached). */
import { summarizeMemory } from '../../utils/npc'
import { ensureKey } from '../../utils/gatewayKey'

export default defineEventHandler(async (event) => {
  ensureKey(event)
  const body = await readBody<{ name?: string, prev?: string, turns?: { who: string, text: string }[] }>(event)
  const turns = Array.isArray(body?.turns) ? body.turns.filter(t => t && typeof t.text === 'string').slice(-20) : []
  if (!turns.length) return { summary: body?.prev ?? '' }
  return { summary: await summarizeMemory(String(body.name ?? 'someone'), String(body.prev ?? ''), turns) }
})
