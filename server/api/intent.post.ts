/**
 * POST /api/intent { text, state, ctx } → { ops, dropped, ms, model }. `state` is the trimmed scene from
 * `trimScene` (entities' kind/tags/pos/props/group plus learned kinds, no log); `ctx` is the gaze snapshot
 * taken when the player started typing or speaking. `?model=sonnet` swaps the model.
 */
import type { Scene } from '#shared/world/context'
import type { OpContext } from '#shared/world/types'
import { interpret } from '../utils/intent'

interface Body {
  text?: string
  state?: Partial<Scene>
  ctx?: Partial<OpContext>
}

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) throw createError({ statusCode: 400, statusMessage: 'text is required' })
  const config = useRuntimeConfig(event)
  if (!process.env.AI_GATEWAY_API_KEY && config.aiGatewayApiKey) process.env.AI_GATEWAY_API_KEY = config.aiGatewayApiKey
  if (!process.env.AI_GATEWAY_API_KEY) throw createError({ statusCode: 500, statusMessage: 'AI_GATEWAY_API_KEY is not set' })

  const c = body.ctx ?? {}
  const ctx: OpContext = {
    gaze: c.gaze?.point ? c.gaze : { point: [0, 0, -10] },
    player: c.player?.pos ? c.player : { pos: [0, 1.6, 0], yaw: 0 },
    seed: typeof c.seed === 'number' ? c.seed : 1
  }
  const model = getQuery(event).model
  const res = await interpret({ text, scene: body.state, ctx, model: typeof model === 'string' ? model : undefined })
  console.info(`[intent] ${res.model} ${res.ms}ms ops=${res.ops.length} dropped=${res.dropped.length}${res.error ? ` error=${res.error}` : ''} “${text.slice(0, 80)}”`)
  return { ops: res.ops, dropped: res.dropped, ms: res.ms, model: res.model, error: res.error }
})
