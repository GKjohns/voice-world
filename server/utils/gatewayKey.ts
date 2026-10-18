import type { H3Event } from 'h3'

/** The gateway key from runtime config into the env (the AI SDK reads AI_GATEWAY_API_KEY), or a 500. */
export function ensureKey(event: H3Event): void {
  const config = useRuntimeConfig(event)
  if (!process.env.AI_GATEWAY_API_KEY && config.aiGatewayApiKey) process.env.AI_GATEWAY_API_KEY = config.aiGatewayApiKey
  if (!process.env.AI_GATEWAY_API_KEY) throw createError({ statusCode: 500, statusMessage: 'AI_GATEWAY_API_KEY is not set' })
}
