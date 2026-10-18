/**
 * Model aliases (same names as picnic-panic's MODEL_ALIASES) and gateway pricing for cost reports.
 * Plain module with no Nitro globals, so the bench imports it too.
 */
import { VOICE_MODEL, VOICE_TRANSCRIBER } from '../../shared/voice.ts'

export const MODELS = {
  haiku: 'anthropic/claude-haiku-5.5',
  sonnet: 'anthropic/claude-sonnet-5.5',
  opus: 'anthropic/claude-opus-5.5'
} as const

export type ModelAlias = keyof typeof MODELS

/**
 * The realtime voice (Sprint 3): ears and mouth only, one `build` tool. Kept out of MODELS so it can never
 * be picked as an op model through `resolveModel` / `?model=`. The ids live in shared/voice.ts because the
 * browser session needs the model id too.
 */
export const VOICE_MODELS = { voice: VOICE_MODEL, transcriber: VOICE_TRANSCRIBER } as const

/** The intent model: Haiku unless asked otherwise. */
export const INTENT_MODEL: ModelAlias = 'haiku'

export function resolveModel(name: string | undefined): { alias: string, id: string } {
  if (name && name in MODELS) return { alias: name, id: MODELS[name as ModelAlias] }
  if (name && name.includes('/')) return { alias: name.split('/').pop() ?? name, id: name }
  return { alias: INTENT_MODEL, id: MODELS[INTENT_MODEL] }
}

/** USD per 1M tokens, from the gateway's /v1/models (base tier), as recorded in picnic-panic 2026-10-11. */
const PRICING: Record<string, { input: number, output: number, cacheRead?: number, cacheWrite?: number }> = {
  'anthropic/claude-opus-5.5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'anthropic/claude-sonnet-5.5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'anthropic/claude-haiku-5.5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  // The forge (progressive generation): Sol polishes heroes; the Gemini image model draws hero references.
  'openai/gpt-6.1-sol': { input: 2, output: 10 },
  'google/gemini-3.1-flash-lite-image': { input: 0.1, output: 0.4 }
}

/** Models the forge uses (conjure-progressive's matrix winners). */
export const FORGE_MODELS = {
  refine: 'anthropic/claude-opus-5.5',
  polish: 'openai/gpt-6.1-sol',
  judge: 'anthropic/claude-haiku-5.5',
  ref: 'google/gemini-3.1-flash-lite-image'
} as const
/** The image model is billed per image on top of its tokens (gateway pricing, 2026-10-17). */
export const REF_IMAGE_USD = 0.034

export interface Usage { input: number, output: number, cacheRead?: number, cacheWrite?: number }

export function costUsd(modelId: string, usage: Usage): number {
  const p = PRICING[modelId]
  if (!p) return 0
  const read = usage.cacheRead ?? 0
  const write = usage.cacheWrite ?? 0
  const plain = Math.max(0, usage.input - read - write)
  return (plain * p.input + read * (p.cacheRead ?? p.input) + write * (p.cacheWrite ?? p.input) + usage.output * p.output) / 1_000_000
}
