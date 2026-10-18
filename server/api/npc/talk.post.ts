/**
 * POST /api/npc/talk { persona, memory, scene, doing, utterance } → text/plain, streamed as written:
 * the spoken line first (the client captions and voices it while the rest arrives), then a `>>` line of
 * JSON actions (shared/npc/reply.ts). Closing the request aborts the model call. A failed call ends the
 * stream with a `>> {"error": …}` line so the client can say something in character instead.
 */
import type { TalkRequest } from '../../utils/npc'
import { streamTalk } from '../../utils/npc'
import { ensureKey } from '../../utils/gatewayKey'

export default defineEventHandler(async (event) => {
  ensureKey(event)
  const body = await readBody<Partial<TalkRequest>>(event)
  if (!body?.persona || typeof body.persona.name !== 'string') throw createError({ statusCode: 400, statusMessage: 'persona is required' })
  if (typeof body.utterance !== 'string' || !body.utterance.trim()) throw createError({ statusCode: 400, statusMessage: 'utterance is required' })
  const req: TalkRequest = {
    persona: body.persona,
    memory: { summary: body.memory?.summary ?? '', turns: body.memory?.turns ?? [], events: body.memory?.events ?? [], facts: body.memory?.facts ?? [], met: body.memory?.met ?? 0 },
    scene: typeof body.scene === 'string' ? body.scene : '',
    doing: typeof body.doing === 'string' ? body.doing : 'standing about',
    utterance: body.utterance,
    playerName: typeof body.playerName === 'string' && body.playerName.trim() ? body.playerName.trim().slice(0, 32) : undefined
  }
  const ctrl = new AbortController()
  event.node.req.on('close', () => ctrl.abort())
  setResponseHeaders(event, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' })
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const ev of streamTalk(req, ctrl.signal)) {
        try {
          if (ev.t === 'text') controller.enqueue(enc.encode(ev.delta))
          else {
            console.info(`[npc] ${req.persona.name} talk first ${ev.firstMs ?? '-'} ms · done ${ev.ms} ms · $${ev.costUsd.toFixed(5)}${ev.error ? ` error=${ev.error}` : ''} “${req.utterance.slice(0, 60)}”`)
            if (ev.error) controller.enqueue(enc.encode(`\n>> ${JSON.stringify({ do: [], error: ev.error })}`))
          }
        } catch {
          break
        }
      }
      try {
        controller.close()
      } catch {
        // already closed
      }
    },
    cancel() {
      ctrl.abort()
    }
  })
})
