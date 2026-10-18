/** Shared bits for the forge routes: reading parts / strings from a body safely. */
import { cleanParts } from '../../shared/world/forge.ts'
import type { Part } from '../../shared/world/ops.ts'

export const bodyStr = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')
export const bodyKind = (v: unknown): string => bodyStr(v, 48).toLowerCase().replace(/[^a-z0-9_]/g, '')
export const bodyParts = (v: unknown): Part[] => cleanParts(v)
export const bodySession = (v: unknown): string => bodyStr(v, 64).replace(/[^\w-]/g, '') || 'anon'
