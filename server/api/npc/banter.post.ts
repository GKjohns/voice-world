/**
 * POST /api/npc/banter { kind, speakers, scene, event?, playerName?, visitor? } → { lines, ms, costUsd }
 * People talking among themselves: gut reactions to a wish ("Did you SEE that?!"), neighbours passing the
 * time, or someone chiming in on a conversation they overheard. One cheap Haiku call, JSON in text. The
 * client rate-limits it (only when you're within earshot). Always answers (no lines on failure).
 */
import type { BanterRequest, BanterSpeaker } from '../../utils/npc'
import { generateBanter } from '../../utils/npc'
import { ensureKey } from '../../utils/npcKey'

export default defineEventHandler(async (event) => {
  ensureKey(event)
  const body = await readBody<Partial<BanterRequest>>(event)
  const kind = body?.kind === 'wish' || body?.kind === 'chime' ? body.kind : 'idle'
  const speakers = (Array.isArray(body?.speakers) ? body.speakers : []).filter((s): s is BanterSpeaker => !!s && typeof s.persona?.name === 'string').slice(0, 4).map(s => ({
    id: String(s.id),
    persona: { name: s.persona.name, age: Number(s.persona.age) || 30, occupation: String(s.persona.occupation ?? ''), personality: String(s.persona.personality ?? ''), speech: String(s.persona.speech ?? ''), ties: Array.isArray(s.persona.ties) ? s.persona.ties.slice(0, 3).map(String) : [] },
    doing: String(s.doing ?? 'standing about').slice(0, 80),
    recent: Array.isArray(s.recent) ? s.recent.slice(-4).map(r => String(r).slice(0, 200)) : []
  }))
  if (!speakers.length) throw createError({ statusCode: 400, statusMessage: 'speakers are required' })
  const req: BanterRequest = { kind, speakers, scene: String(body?.scene ?? '').slice(0, 1200), event: body?.event ? String(body.event).slice(0, 300) : undefined, playerName: body?.playerName ? String(body.playerName).slice(0, 32) : undefined, visitor: body?.visitor ? String(body.visitor).slice(0, 40) : undefined }
  const res = await generateBanter(req)
  console.info(`[npc] banter ${kind} ${speakers.map(s => s.persona.name).join('+')} ${res.ms} ms $${res.costUsd.toFixed(5)} · ${res.lines.length} lines${res.error ? ` error=${res.error}` : ''}`)
  return res
})
