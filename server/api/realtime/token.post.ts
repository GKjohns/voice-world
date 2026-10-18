/**
 * POST /api/realtime/token → `{ token, url, expiresAt?, tools }` (the SDK's RealtimeSetupResponse).
 *
 * `AbstractRealtimeSession.connect()` POSTs `{ sessionConfig }` here and connects with what comes back, so
 * `api.token` on the client is this path. `tools` must come from HERE: connect() overwrites
 * `sessionConfig.tools` with this list before the opening `session-update`. Two tools, `build({ request })` and `teleport({ world, brief })`.
 * Ported from camera_shy's token route, minus auth/analytics (local toy, no deploy).
 */
import { gateway } from '@ai-sdk/gateway'
import { VOICE_MODELS } from '../../utils/aiModels'
import { realtimeTools } from '../../utils/realtimeTools'
import { ensureKey } from '../../utils/gatewayKey'

export default defineEventHandler(async (event) => {
  ensureKey(event)

  try {
    const [{ token, url, expiresAt }, tools] = await Promise.all([
      gateway.experimental_realtime.getToken({ model: VOICE_MODELS.voice }),
      realtimeTools()
    ])
    return { token, url, ...(expiresAt != null && { expiresAt }), tools }
  } catch (error) {
    throw createError({
      statusCode: 502,
      statusMessage: 'Could not mint a realtime token',
      message: error instanceof Error ? error.message : String(error)
    })
  }
})
