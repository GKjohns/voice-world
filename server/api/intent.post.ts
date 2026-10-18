/**
 * POST /api/intent { text, state, ctx } → NDJSON, one event per line as the model writes (Loop 1):
 *   {"t":"op","op":{...},"ms":805,"i":0}      a strict op, the moment its object closed in the stream
 *   {"t":"drop","dropped":{index,raw,reason}}  an op that failed validation
 *   {"t":"done","ms":998,"model":"haiku","count":2,"firstOpMs":805,"error"?:"..."}
 * `state` is the trimmed scene from `trimScene` (entities' kind/tags/pos/props/group plus learned kinds, no
 * log); `ctx` is the gaze snapshot taken when the player started typing or speaking. `?model=sonnet` swaps
 * the model. `ctx.fresh` turns on Fresh mode (shared/world/fresh.ts). Closing the request aborts the model call.
 */
import type { Scene } from '#shared/world/context'
import type { OpContext } from '#shared/world/types'
import { streamIntent } from '../utils/intent'
import { ensureKey } from '../utils/gatewayKey'

interface Body {
  text?: string
  state?: Partial<Scene>
  ctx?: Partial<OpContext>
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text is required' })
  ensureKey(event)

  const c = body.ctx ?? {}
  const ctx: OpContext = {
    gaze: c.gaze?.point ? c.gaze : { point: [0, 0, -10] },
    player: c.player?.pos ? c.player : { pos: [0, 1.6, 0], yaw: 0 },
    seed: typeof c.seed === 'number' ? c.seed : 1,
    ...(c.fresh === true ? { fresh: true } : {})
  }
  const model = getQuery(event).model
  const ctrl = new AbortController()
  event.node.req.on('close', () => ctrl.abort(new Error('client closed')))
  setResponseHeaders(event, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' })

  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let dropped = 0
      for await (const ev of streamIntent({ text, scene: body.state, ctx, model: typeof model === 'string' ? model : undefined, signal: ctrl.signal })) {
        if (ev.t === 'drop') dropped++
        if (ev.t === 'done') console.info(`[intent]${ctx.fresh ? ' fresh' : ''} ${ev.model}${ev.provider && ev.provider !== 'anthropic' ? `@${ev.provider}` : ''} first op ${ev.firstOpMs ?? '-'} ms · done ${ev.ms} ms · ops=${ev.count} dropped=${dropped}${ev.recovered ? ' (recovered)' : ''}${ev.error ? ` error=${ev.error}` : ''} “${text.slice(0, 80)}”`)
        if (ctrl.signal.aborted) break
        try {
          const line = ev.t === 'done'
            ? { t: 'done', ms: ev.ms, model: ev.model, count: ev.count, firstOpMs: ev.firstOpMs, error: ev.error }
            : ev
          controller.enqueue(enc.encode(`${JSON.stringify(line)}\n`))
        } catch {
          break // the client went away
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
