/**
 * Warm the Director's structured-output grammar at boot. Anthropic compiles each new schema into a grammar
 * once (~25 s for DirectorOpSchema) and caches it for about a day; without this the first "take me to…"
 * after a cold start would sit in fog for half a minute. One tiny call, a fraction of a cent.
 */
import { directScene } from '../utils/director'

export default defineNitroPlugin(() => {
  const config = useRuntimeConfig()
  if (!process.env.AI_GATEWAY_API_KEY && config.aiGatewayApiKey) process.env.AI_GATEWAY_API_KEY = config.aiGatewayApiKey as string
  if (!process.env.AI_GATEWAY_API_KEY || process.env.CONJURE_NO_WARMUP) return
  void (async () => {
    const started = Date.now()
    for await (const ev of directScene({ world: 'empty grid', brief: 'Warm-up: emit only the atmosphere op and a say.', timeoutMs: 120_000, maxOutputTokens: 120 })) {
      if (ev.t === 'error') console.warn(`[director] warm-up failed after ${ev.ms} ms: ${ev.error}`)
      if (ev.t === 'done' || ev.t === 'error') break
    }
    console.info(`[director] grammar warm in ${Date.now() - started} ms`)
  })()
})
