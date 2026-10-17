/**
 * The op brain on the client: a sentence plus the gaze snapshot taken when the player STARTED typing or
 * speaking (the deictic rule: "there" is where you were looking when you said it) → /api/intent → the
 * same `useWorld().run` path the console uses. `build(request, ctx)` is the one entry point; the text bar,
 * the browser mic and (Sprint 3) the realtime `build` tool all call it.
 */
import { shallowRef } from 'vue'
import { trimScene } from '#shared/world/context'
import type { DroppedOp, Op } from '#shared/world/ops'
import type { OpContext } from '#shared/world/types'

export type IntentPhase = 'idle' | 'listening' | 'thinking' | 'building'

export interface IntentOutcome {
  ok: boolean
  /** One line for a voice to confirm with: "spawned 9 pine · said “A little grove for you.”". */
  summary: string
  say?: string
  ops: Op[]
  dropped: DroppedOp[]
  model?: string
  ms: number
  error?: string
}

interface IntentResponse { ops: Op[], dropped: DroppedOp[], ms: number, model: string, error?: string }

const phase = shallowRef<IntentPhase>('idle')
const inflight = shallowRef(0)
const interim = shallowRef('')
const error = shallowRef('')
const model = shallowRef<'haiku' | 'sonnet'>('haiku')
const micSupported = shallowRef(false)
const micOn = shallowRef(false)
/** The sentences in flight, so the HUD can show what's being built while the pill says thinking. */
const pendingText = shallowRef<string[]>([])
let buildingTimer: ReturnType<typeof setTimeout> | undefined
let pending: OpContext | null = null
let recognition: SpeechRecognitionLike | null = null

function setPhase(p: IntentPhase) {
  clearTimeout(buildingTimer)
  phase.value = p
  if (p === 'building') {
    // Arrivals stagger for about a second; then the pill settles back.
    buildingTimer = setTimeout(() => {
      phase.value = inflight.value ? 'thinking' : recognition ? 'listening' : 'idle'
    }, 1400)
  }
}

/** Freeze where the player is looking now, and show the ghost there at once (no model needed). */
function capture(): OpContext {
  const world = useWorld()
  const ctx = world.snapshot()
  world.renderer()?.showGhost(ctx.gaze.point, 1.6, 2600)
  return ctx
}

/** The text bar calls this on the first keystroke of a sentence; `take` hands the snapshot to `build`. */
function beginTyping() {
  if (!pending) pending = capture()
}
function cancelTyping() {
  pending = null
}
function takeSnapshot(): OpContext {
  const ctx = pending ?? capture()
  pending = null
  return ctx
}

function summarize(spawned: string[], modified: number, removed: number, other: string[]): string {
  const kinds = new Map<string, number>()
  for (const id of spawned) {
    const k = id.split('#')[0]!
    kinds.set(k, (kinds.get(k) ?? 0) + 1)
  }
  const bits: string[] = []
  if (kinds.size) bits.push(`spawned ${[...kinds].map(([k, n]) => `${n} ${k}`).join(', ')}`)
  if (modified) bits.push(`changed ${modified}`)
  if (removed) bits.push(`removed ${removed}`)
  bits.push(...other)
  return bits.join(' · ') || 'nothing changed'
}

/**
 * One request → ops → the world. `ctx` must be the snapshot from when the request STARTED (typing, mic
 * speech-start, or the realtime session's speech-started). Never throws; resolves with a one-line outcome.
 */
async function build(request: string, ctx: OpContext, source: 'text' | 'voice' = 'text'): Promise<IntentOutcome> {
  const text = request.trim()
  if (!text) return { ok: false, summary: 'empty request', ops: [], dropped: [], ms: 0, error: 'empty request' }
  const world = useWorld()
  error.value = ''
  inflight.value++
  pendingText.value = [...pendingText.value, text]
  setPhase('thinking')
  const done = () => {
    const i = pendingText.value.indexOf(text)
    pendingText.value = pendingText.value.filter((_, j) => j !== i)
  }
  const started = performance.now()
  let res: IntentResponse
  try {
    res = await $fetch<IntentResponse>('/api/intent', {
      method: 'POST',
      query: model.value === 'haiku' ? undefined : { model: model.value },
      body: { text, state: trimScene(world.state.value), ctx }
    })
  } catch (err) {
    inflight.value--
    done()
    const msg = (err as { statusMessage?: string, message?: string }).statusMessage ?? (err as Error).message
    error.value = `Couldn't reach the builder: ${msg}`
    setPhase(recognition ? 'listening' : 'idle')
    return { ok: false, summary: error.value, ops: [], dropped: [], ms: Math.round(performance.now() - started), error: msg }
  }
  inflight.value--
  done()
  if (res.error && !res.ops.length) {
    error.value = `The builder stumbled: ${res.error}`
    world.run({ ops: [] }, text, ctx, { source, model: res.model, ms: res.ms, dropped: res.dropped, error: res.error })
    setPhase(recognition ? 'listening' : 'idle')
    return { ok: false, summary: error.value, ops: [], dropped: res.dropped, model: res.model, ms: res.ms, error: res.error }
  }
  const out = world.run({ ops: res.ops }, text, ctx, { source, model: res.model, ms: res.ms, dropped: res.dropped })
  const fx = out.effects
  const other: string[] = []
  if (fx.atmosphere) other.push(`light → ${out.state.atmosphere.time}`)
  if (fx.teleport) other.push(`teleport → ${fx.teleport.world}`)
  if (fx.redefined.length) other.push(`learned ${fx.redefined.join(', ')}`)
  if (out.ops.some(o => o.op === 'undo')) other.push('undid the last change')
  const say = fx.say.join(' ') || undefined
  const changed = fx.spawned.length + fx.modified.length + fx.removed.length > 0 || other.length > 0
  setPhase(changed ? 'building' : recognition ? 'listening' : 'idle')
  return {
    ok: changed,
    summary: summarize(fx.spawned, fx.modified.length, fx.removed.length, other) + (fx.notes.length && !changed ? ` (${fx.notes[0]})` : ''),
    say,
    ops: out.ops,
    dropped: [...res.dropped, ...out.dropped],
    model: res.model,
    ms: res.ms
  }
}

// ---------- the browser mic (V2 fallback; Sprint 3 replaces it with realtime voice) ----------

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onspeechstart: (() => void) | null
  onresult: ((e: { resultIndex: number, results: ArrayLike<{ isFinal: boolean, 0: { transcript: string } }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function recognizer(): (new () => SpeechRecognitionLike) | undefined {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined
}

function detectMic() {
  micSupported.value = typeof window !== 'undefined' && !!recognizer()
}

function startMic() {
  const Ctor = recognizer()
  if (!Ctor || recognition) return
  const rec = new Ctor()
  rec.lang = 'en-US'
  rec.continuous = true
  rec.interimResults = true
  let speechCtx: OpContext | null = null
  rec.onspeechstart = () => {
    // The deictic moment: freeze the gaze as soon as the voice starts, not when the sentence ends.
    speechCtx = capture()
  }
  rec.onresult = (e) => {
    let partial = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!
      const said = r[0].transcript
      if (r.isFinal) {
        interim.value = ''
        const ctx = speechCtx ?? capture()
        speechCtx = null
        void build(said, ctx, 'voice')
      } else {
        // Chrome fires onspeechstart once per session; a new utterance's first partial re-arms the snapshot.
        if (!speechCtx) speechCtx = capture()
        partial += said
      }
    }
    if (partial) interim.value = partial
  }
  rec.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') error.value = `Mic: ${e.error}`
  }
  rec.onend = () => {
    recognition = null
    micOn.value = false
    interim.value = ''
    if (phase.value === 'listening') setPhase('idle')
  }
  recognition = rec
  micOn.value = true
  error.value = ''
  setPhase('listening')
  rec.start()
}

function stopMic() {
  recognition?.stop()
  recognition = null
  micOn.value = false
  interim.value = ''
  if (phase.value === 'listening') setPhase('idle')
}

function toggleMic() {
  if (recognition) stopMic()
  else startMic()
}

export function useIntent() {
  return {
    phase, inflight, interim, error, model, micSupported, micOn, pendingText,
    build, beginTyping, cancelTyping, takeSnapshot, capture,
    detectMic, startMic, stopMic, toggleMic
  }
}
