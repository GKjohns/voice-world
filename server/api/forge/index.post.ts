/**
 * POST /api/forge { kind, text, tier: good|hero, draft: Part[], image?: data URL, session } → NDJSON:
 *   {"t":"stage","stage":"ref"|"refine","ms":…}
 *   {"t":"parts","parts":[…],"ms":…}      new plain parts, the moment their program line closed
 *   {"t":"done","ok":true,"parts":[…],"usd":…,"ms":…}   final parts fitted to the draft (ok:false = keep the draft)
 * The model's program runs on the server (forgeRun.ts); only part data is sent. Closing the request aborts.
 */
import { forgeRefine } from '../../utils/forge'
import { bodyKind, bodyParts, bodySession, bodyStr, ensureKey } from '../../utils/forgeHttp'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const kind = bodyKind(body?.kind)
  const text = bodyStr(body?.text, 200)
  const draft = bodyParts(body?.draft)
  if (!kind || !text || !draft.length) throw createError({ statusCode: 400, statusMessage: 'kind, text and draft are required' })
  ensureKey(event)
  const tier = body.tier === 'hero' ? 'hero' : 'good'
  const session = bodySession(body.session)
  const image = typeof body.image === 'string' ? body.image : undefined
  const ctrl = new AbortController()
  event.node.req.on('close', () => ctrl.abort(new Error('client closed')))
  setResponseHeaders(event, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' })
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let parts = 0
      for await (const ev of forgeRefine({ kind, text, tier, draft, image, session, signal: ctrl.signal })) {
        if (ev.t === 'parts') parts += ev.parts.length
        if (ev.t === 'done') console.info(`[forge] ${tier} ${kind} ${ev.ok ? 'ok' : `kept draft (${ev.reason})`} · ${parts} parts · first ${ev.firstPartMs ?? '-'} ms · done ${ev.ms} ms${ev.refMs !== undefined ? ` (ref ${ev.refMs} ms)` : ''} · $${ev.usd.toFixed(4)} · k ${ev.k ?? '-'} · floating ${ev.floating}/${ev.draftFloating} “${text.slice(0, 60)}”`)
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(ev)}\n`))
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
      ctrl.abort(new Error('client cancelled'))
    }
  })
})
