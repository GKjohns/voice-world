/**
 * POST /api/npc/voice { text, voice, speed? } → audio/mpeg (gateway speech: grok-tts, then tts-1), or 204
 * when no voice could be made (the client falls back to the browser's speechSynthesis).
 */
import { NPC_VOICES, speak } from '../../utils/npc'
import { ensureKey } from '../../utils/npcKey'

const ALL = new Set<string>([...NPC_VOICES.f, ...NPC_VOICES.m])

export default defineEventHandler(async (event) => {
  ensureKey(event)
  const body = await readBody<{ text?: string, voice?: string, speed?: number }>(event)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text is required' })
  const voice = typeof body.voice === 'string' && ALL.has(body.voice) ? body.voice : 'ara'
  const out = await speak(text, voice, typeof body.speed === 'number' ? body.speed : undefined)
  if (!out) {
    setResponseStatus(event, 204)
    return null
  }
  console.info(`[npc] voice ${out.model}/${voice} ${out.ms} ms ${out.audio.length} B “${text.slice(0, 50)}”`)
  setResponseHeaders(event, { 'content-type': out.type, 'cache-control': 'no-store', 'x-tts-model': out.model, 'x-tts-ms': String(out.ms) })
  return out.audio
})
