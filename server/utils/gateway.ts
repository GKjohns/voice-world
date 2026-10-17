/**
 * Bounded structured calls through the Vercel AI Gateway (the picnic-panic `callStructured` pattern):
 * the stable digest rides in its own user content part with an Anthropic ephemeral cache breakpoint,
 * `instructions:` stays short, every call has a hard deadline, and nothing ever throws.
 */
import { generateText, NoObjectGeneratedError, Output } from 'ai'
import type { z } from 'zod'
import { costUsd } from './aiModels.ts'
import type { Usage } from './aiModels.ts'

export type Reasoning = 'none' | 'minimal' | 'low' | 'medium' | 'high'

export interface CallResult<T> {
  output?: T
  error?: string
  usage: Usage
  latencyMs: number
  costUsd: number
  finishReason?: string
  /** The envelope failed validation but the raw text was JSON: per-op parsing can still keep the good ops. */
  salvaged?: boolean
}

class DeadlineError extends Error {
  override name = 'TimeoutError'
}

async function bounded<T>(run: (signal: AbortSignal) => Promise<T>, ms: number, outer?: AbortSignal): Promise<T> {
  const ctrl = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const onOuter = () => ctrl.abort(outer?.reason ?? new DOMException('Aborted', 'AbortError'))
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DeadlineError(`no answer in ${ms} ms`)
      ctrl.abort(err)
      reject(err)
    }, ms)
    if (outer?.aborted) onOuter()
    else outer?.addEventListener('abort', onOuter, { once: true })
  })
  try {
    return await Promise.race([run(ctrl.signal), stop])
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onOuter)
  }
}

function usageOf(u: { inputTokens?: number, outputTokens?: number, inputTokenDetails?: { cacheReadTokens?: number, cacheWriteTokens?: number } } | undefined): Usage {
  return {
    input: u?.inputTokens ?? 0,
    output: u?.outputTokens ?? 0,
    cacheRead: u?.inputTokenDetails?.cacheReadTokens ?? 0,
    cacheWrite: u?.inputTokenDetails?.cacheWriteTokens ?? 0
  }
}

/** Structured output from a language model. Never throws. */
export async function callStructured<T>(opts: {
  model: string
  role: string
  digest: string
  prompt: string
  schema: z.ZodType<T>
  reasoning?: Reasoning
  signal?: AbortSignal
  maxOutputTokens?: number
  timeoutMs?: number
}): Promise<CallResult<T>> {
  const started = Date.now()
  const anthropic = opts.model.startsWith('anthropic/')
  try {
    const r = await bounded(signal => generateText({
      model: opts.model,
      instructions: opts.role,
      messages: [{
        role: 'user',
        content: [
          // Identical every call: cache it (explicit breakpoint; the gateway's 'auto' would put it at the end).
          { type: 'text', text: opts.digest, ...(anthropic ? { providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } } : {}) },
          { type: 'text', text: opts.prompt }
        ]
      }],
      output: Output.object({ schema: opts.schema }),
      maxOutputTokens: opts.maxOutputTokens ?? 3000,
      abortSignal: signal,
      maxRetries: 1,
      ...(anthropic ? { providerOptions: { gateway: { order: ['anthropic'] } } } : {}),
      ...(opts.reasoning ? { reasoning: opts.reasoning } : {})
    }), opts.timeoutMs ?? 30_000, opts.signal)
    const usage = usageOf(r.usage)
    return { output: r.output as T, usage, latencyMs: Date.now() - started, costUsd: costUsd(opts.model, usage), finishReason: r.finishReason }
  } catch (err) {
    const usage = NoObjectGeneratedError.isInstance(err) ? usageOf(err.usage) : { input: 0, output: 0 }
    if (NoObjectGeneratedError.isInstance(err) && err.text && err.finishReason !== 'length') {
      try {
        return { output: JSON.parse(err.text) as T, salvaged: true, usage, latencyMs: Date.now() - started, costUsd: costUsd(opts.model, usage), finishReason: err.finishReason }
      } catch {
        // not JSON at all: fall through to the error
      }
    }
    const why = NoObjectGeneratedError.isInstance(err)
      ? (err.finishReason === 'length' ? 'truncated at the output cap' : `unparseable answer: ${err.message.slice(0, 200)}`)
      : (err as Error).message.slice(0, 300)
    return { error: why, usage, latencyMs: Date.now() - started, costUsd: costUsd(opts.model, usage) }
  }
}
