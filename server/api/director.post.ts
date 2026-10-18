/**
 * POST /api/director { world, brief, player } → NDJSON, one event per line as the recipe streams:
 *   {"t":"op","op":{...},"ms":1720,"i":0}   a Director op (loose; the client runs directorToOp + parseOps)
 *   {"t":"done","ms":7180,"count":28,...}    usage and cost
 *   {"t":"error","ms":...,"error":"..."}
 * Ops are in room coordinates (origin = the player's feet at teleport time), so `player` is only logged.
 * Closing the request (the client aborting: undo, a new teleport) aborts the model call.
 */
import type { Player } from '#shared/world/types'
import { directScene } from '../utils/director'
import { ensureKey } from '../utils/gatewayKey'

interface Body {
  world?: string
  brief?: string
  player?: Partial<Player>
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const world = typeof body?.world === 'string' ? body.world.trim() : ''
  if (!world) throw createError({ statusCode: 400, statusMessage: 'world is required' })
  ensureKey(event)
  const model = getQuery(event).model
  const brief = typeof body.brief === 'string' ? body.brief : undefined

  const ctrl = new AbortController()
  event.node.req.on('close', () => ctrl.abort(new Error('client closed')))
  setResponseHeaders(event, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no' })

  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let first = 0
      for await (const ev of directScene({ world, brief, model: typeof model === 'string' ? model : undefined, signal: ctrl.signal })) {
        if (ev.t === 'op' && !first) first = ev.ms
        if (ev.t === 'done') console.info(`[director] ${ev.model} “${world}” first op ${first} ms · done ${ev.ms} ms · ${ev.count} ops · $${ev.costUsd.toFixed(4)} · cache read ${ev.usage.cacheRead}`)
        if (ev.t === 'error') console.warn(`[director] “${world}” failed after ${ev.ms} ms: ${ev.error}`)
        if (ctrl.signal.aborted) break
        try {
          controller.enqueue(enc.encode(`${JSON.stringify(ev)}\n`))
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
