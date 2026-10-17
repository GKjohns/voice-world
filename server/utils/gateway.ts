/**
 * Streamed JSON-in-text op calls through the Vercel AI Gateway (Loop 1). No structured output: Anthropic
 * refuses the op schema (too many optionals) and the gateway then falls back to Bedrock tool mode, which
 * adds ~2k prompt tokens and delivers everything in one burst at the end. Instead the model writes plain
 * JSON text, pinned to Anthropic with `only` (`order` alone loses to the gateway's session affinity), and
 * `opScanner` hands over each op the moment its object closes.
 *
 * The stable digest rides in its own user content part with an Anthropic ephemeral cache breakpoint,
 * `instructions:` stays short, every call has a hard deadline, and nothing ever throws.
 */
import { streamText } from 'ai'
import { costUsd } from './aiModels.ts'
import type { Usage } from './aiModels.ts'
import { opScanner, parseLooseJson } from './opStream.ts'

export type Reasoning = 'none' | 'minimal' | 'low' | 'medium' | 'high'

export type OpStreamEvent
  = | { t: 'op', op: unknown, ms: number, i: number }
    | { t: 'done', ms: number, count: number, usage: Usage, costUsd: number, finishReason?: string, provider?: string, error?: string, recovered?: boolean }

/** Pull the ops out of a whole answer: an `{ ops }` envelope (maybe with ops stringified) or a bare array. */
function opsOf(raw: unknown): unknown[] | undefined {
  if (Array.isArray(raw)) return raw
  if (raw && typeof raw === 'object') {
    const ops = (raw as { ops?: unknown }).ops
    if (Array.isArray(ops)) return ops
    if (typeof ops === 'string') {
      const inner = parseLooseJson(ops)
      if (Array.isArray(inner)) return inner
    }
    if ('op' in raw) return [raw]
  }
  return undefined
}

/**
 * Stream ops from a language model. Yields `op` events as each object closes, then exactly one `done`
 * (with `error` set on failure). If the stream's ops couldn't be scanned (stringified envelope, odd
 * wrapping), the end-of-stream parse recovers any ops the scanner missed and yields them before `done`.
 */
export async function* streamOps(opts: {
  model: string
  role: string
  digest: string
  prompt: string
  reasoning?: Reasoning
  signal?: AbortSignal
  maxOutputTokens?: number
  timeoutMs?: number
}): AsyncGenerator<OpStreamEvent> {
  const started = Date.now()
  const anthropic = opts.model.startsWith('anthropic/')
  const ctrl = new AbortController()
  const onOuter = () => ctrl.abort(opts.signal?.reason ?? new DOMException('Aborted', 'AbortError'))
  if (opts.signal?.aborted) onOuter()
  else opts.signal?.addEventListener('abort', onOuter, { once: true })
  const deadline = opts.timeoutMs ?? 30_000
  const timer = setTimeout(() => ctrl.abort(new Error(`no answer in ${deadline} ms`)), deadline)
  let count = 0
  let streamError: string | undefined
  const scan = opScanner()
  try {
    const r = streamText({
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
      maxOutputTokens: opts.maxOutputTokens ?? 3000,
      abortSignal: ctrl.signal,
      maxRetries: 1,
      ...(anthropic ? { providerOptions: { gateway: { only: ['anthropic'] } } } : {}),
      ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
      onError: ({ error }) => {
        streamError = ((error as Error)?.message ?? String(error)).slice(0, 300)
      }
    })
    for await (const delta of r.textStream) {
      for (const op of scan.push(delta)) yield { t: 'op', op, ms: Date.now() - started, i: count++ }
    }
    // Recovery: ops the scanner never saw (a stringified envelope, a malformed element it skipped).
    let recovered = false
    const whole = opsOf(parseLooseJson(scan.text()))
    if (whole && whole.length > count) {
      for (const op of whole.slice(count)) yield { t: 'op', op, ms: Date.now() - started, i: count++ }
      recovered = true
    }
    let usage: Usage = { input: 0, output: 0 }
    let finishReason: string | undefined
    let provider: string | undefined
    try {
      const u = await r.usage
      usage = { input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0, cacheRead: u?.inputTokenDetails?.cacheReadTokens ?? 0, cacheWrite: u?.inputTokenDetails?.cacheWriteTokens ?? 0 }
      finishReason = await r.finishReason
      const pm = await r.providerMetadata as { gateway?: { routing?: { finalProvider?: string } } } | undefined
      provider = pm?.gateway?.routing?.finalProvider
    } catch {
      // usage is best-effort
    }
    const error = streamError ?? (count ? undefined : finishReason === 'length' ? 'truncated at the output cap' : `unparseable answer: ${scan.text().slice(0, 160)}`)
    yield { t: 'done', ms: Date.now() - started, count, usage, costUsd: costUsd(opts.model, usage), finishReason, provider, error, recovered }
  } catch (err) {
    const why = ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason.message : ((err as Error)?.message ?? String(err))
    yield { t: 'done', ms: Date.now() - started, count, usage: { input: 0, output: 0 }, costUsd: 0, error: why.slice(0, 300) }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuter)
  }
}
