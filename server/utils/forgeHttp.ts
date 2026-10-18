/** Shared bits for the forge routes: the gateway key, and reading parts / strings from a body safely. */
import type { H3Event } from 'h3'
import { cleanParts } from '../../shared/world/forge.ts'
import type { Part } from '../../shared/world/ops.ts'

export function ensureKey(event: H3Event): void {
  const config = useRuntimeConfig(event)
  if (!process.env.AI_GATEWAY_API_KEY && config.aiGatewayApiKey) process.env.AI_GATEWAY_API_KEY = config.aiGatewayApiKey as string
  if (!process.env.AI_GATEWAY_API_KEY) throw createError({ statusCode: 500, statusMessage: 'AI_GATEWAY_API_KEY is not set' })
}

export const bodyStr = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const bodyKind = (v: unknown): string => bodyStr(v, 48).toLowerCase().replace(/[^a-z0-9_]/g, '')
export const bodyParts = (v: unknown): Part[] => cleanParts(v)
export const bodySession = (v: unknown): string => bodyStr(v, 64).replace(/[^\w-]/g, '') || 'anon'
