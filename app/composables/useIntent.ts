/**
 * The op brain on the client: a sentence plus the gaze snapshot taken when the player STARTED typing or
 * speaking (the deictic rule: "there" is where you were looking when you said it) → /api/intent → the
 * same `useWorld().run` path the console uses. `build(request, ctx)` is the one entry point; the text bar,
 * the browser mic and (Sprint 3) the realtime `build` tool all call it.
 */
import { shallowRef } from 'vue'
import { trimScene } from '#shared/world/context'
import { honestSay } from '#shared/world/honesty'
import type { DroppedOp, Op, Part } from '#shared/world/ops'
import type { BatchResult } from '#shared/world/state'
import type { OpContext } from '#shared/world/types'
import { readNdjson } from '~/utils/ndjson'

export type IntentPhase = 'idle' | 'listening' | 'thinking' | 'building'

export interface IntentOutcome {
  ok: boolean
  /** One line for a voice to confirm with: "spawned 9 pine · said “A little grove for you.”". */
  summary: string
  say?: string
  ops: Op[]
  dropped: DroppedOp[]
  /** Why ops did nothing ("modify: nothing matches …"), for an honest spoken answer. */
  notes: string[]
  model?: string
  /** Server-side model time to the first op and to the end of the answer. */
  firstOpMs?: number
  /** Client time from the request to the first op applied in the world. */
  firstAppliedMs?: number
  ms: number
  error?: string
}

type IntentEvent
  = | { t: 'op', op: Op, ms: number, i: number }
    | { t: 'part', kind: string, part: Part, ms: number }
    | { t: 'drop', dropped: DroppedOp }
    | { t: 'done', ms: number, model: string, count: number, firstOpMs?: number, error?: string }

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

/**
 * Freeze where the player is looking now, show the ghost there at once (no model needed), and start the
 * "world listens" glow: motes gather there while you type or talk, until something lands.
 */
function capture(): OpContext {
  const world = useWorld()
  const ctx = world.snapshot()
  const r = world.renderer()
  r?.showGhost(ctx.gaze.point, 1.6, 2600)
  r?.anticipate(ctx.gaze.point)
  return ctx
}

/** Let the glow go, unless another sentence is being typed or is still in flight. */
function release() {
  if (pending || inflight.value) return
  useWorld().renderer()?.anticipate(null)
}

/** The text bar calls this on the first keystroke of a sentence; `take` hands the snapshot to `build`. */
function beginTyping() {
  if (!pending) pending = capture()
}
function cancelTyping() {
  pending = null
  release()
}
function takeSnapshot(): OpContext {
  const ctx = pending ?? capture()
  pending = null
  return ctx
}

/** The scene for the builder, with people where they really are now (they walk; their entity spot is where they were born). */
function liveScene() {
  const scene = trimScene(useWorld().state.value)
  const npc = useNpc()
  scene.entities = scene.entities.map(e => (e.kind === 'person' ? { ...e, pos: npc.posOf(e.id) ?? e.pos } : e))
  return scene
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
 * One request → ops → the world, streamed: each op is applied the moment the server sees its JSON object
 * close, so the first one lands before the model has finished. All of a sentence's ops share ONE batch
 * (the first world-changing op opens it with `run`, the rest join it with `extend`, the way the Director
 * fills a teleport), so one "undo" still takes back the whole sentence. `ctx` must be the snapshot from
 * when the request STARTED (typing, mic speech-start, or the realtime session's speech-started).
 * Never throws; resolves with an honest one-line outcome once the answer has ended.
 */
async function build(request: string, ctx: OpContext, source: 'text' | 'voice' = 'text'): Promise<IntentOutcome> {
  const text = request.trim()
  if (!text) return { ok: false, summary: 'empty request', ops: [], dropped: [], notes: [], ms: 0, error: 'empty request' }
  const world = useWorld()
  error.value = ''
  inflight.value++
  pendingText.value = [...pendingText.value, text]
  setPhase('thinking')
  let settled = false
  const done = () => {
    if (settled) return
    settled = true
    inflight.value--
    const i = pendingText.value.indexOf(text)
    pendingText.value = pendingText.value.filter((_, j) => j !== i)
  }
  const started = performance.now()
  // Gen loop 1: no fixed-timer "forming" silhouette. The soft glow below is the only cue until real data
  // (an op, or the first streamed part of a new design) arrives.
  /** Kinds whose draft parts streamed in before their define closed (the renderer's overlays to clear). */
  const streaming = new Set<string>()
  // The glow holds (or starts, for a voice wish whose speech-start glow already let go) until something lands.
  world.renderer()?.anticipate(ctx.gaze.point)

  // What this sentence did, summed over every run/extend.
  const spawned = new Set<string>()
  const modified = new Set<string>()
  const removed = new Set<string>()
  const other: string[] = []
  const notes: string[] = []
  const says: string[] = []
  const applied: Op[] = []
  const dropped: DroppedOp[] = []
  /** The sentence's batch once a world-changing op opened it; the history entries this sentence wrote. */
  let target: { id: string, at: number } | null = null
  const entries: number[] = []
  /** `say` ops that arrive before anything opened a batch (says come last, so this is rare). */
  let held: Op[] = []
  let firstAppliedMs: number | undefined
  /** The forge's timings: something stands there (proxy), and each kind's draft define landed. */
  let proxyMs: number | undefined
  const draftAt: Record<string, number> = {}

  const absorb = (out: BatchResult) => {
    const fx = out.effects
    fx.spawned.forEach(id => spawned.add(id))
    fx.modified.forEach(id => modified.add(id))
    fx.removed.forEach(id => removed.add(id))
    if (fx.atmosphere && !other.some(o => o.startsWith('light'))) other.push(`light → ${out.state.atmosphere.time}`)
    if (fx.teleport) other.push(`teleport → ${fx.teleport.world}`)
    if (fx.redefined.length) other.push(`learned ${fx.redefined.join(', ')}`)
    // Loop 2 (sky): what really happened in the air and the weather, so the genie's reply can only claim that.
    for (const f of fx.facts ?? []) if (!other.includes(f)) other.push(f)
    if (out.ops.some(o => o.op === 'undo')) other.push('undid the last change')
    if (fx.reset) other.push('started over: the world is blank')
    if (fx.goto) other.push('the player was carried there')
    notes.push(...fx.notes)
    says.push(...fx.say)
    applied.push(...out.ops)
  }
  const open = (ops: Op[], label: string) => {
    const out = world.run(ops, label, ctx, { source })
    const entry = world.history.value[world.history.value.length - 1]
    if (entry) entries.push(entry.n)
    if (out.batch) target = { id: out.batch.id, at: out.batch.at }
    else if (out.effects.reset) target = null
    absorb(out)
  }
  const apply = (op: Op) => {
    // Spawn before define: a not-yet-designed kind's spawn holds the spot (a labelled blob, motes swirling
    // round it) and is not an arrival yet; its define is.
    const fresh = op.op === 'spawn' && !world.state.value.kinds[op.kind]
    if (op.op === 'spawn') proxyMs ??= Math.round(performance.now() - started)
    if (op.op === 'say' && !target && !entries.length) {
      held.push(op)
      return
    }
    // Undo, reset and teleport never join a batch (extendLastBatch drops them): they always run on their own.
    const out = target && op.op !== 'undo' && op.op !== 'reset' && op.op !== 'teleport' && op.op !== 'goto' ? world.extend(target.id, target.at, [op]) : null
    if (out) {
      absorb(out)
    } else if (op.op === 'say') {
      // A say with no batch to join (the sentence changed nothing, or the batch is no longer last): caption
      // it, through the same honesty filter as a batch's lines (Loop 3, #7: this path used to fib).
      const changedSoFar = spawned.size + modified.size + removed.size > 0 || other.length > 0
      says.push(honestSay(op.text, applied, world.state.value, changedSoFar))
      applied.push(op)
      world.caption.value = { text: says.join(' '), at: Date.now() }
    } else {
      open([...held, op], target || entries.length ? `${text} (cont.)` : text)
      held = []
    }
    if (op.op === 'define') draftAt[op.kind] ??= performance.now()
    // Gen loop 1: a kind nobody has designed yet starts its refine now, in parallel with the draft.
    if (fresh && world.state.value.entities.some(e => e.kind === op.kind)) useForge().early(op.kind, text, op.count ?? 1, started)
    if (spawned.size + modified.size + removed.size || other.length) {
      firstAppliedMs ??= Math.round(performance.now() - started)
      setPhase('building')
    }
  }

  let end: Extract<IntentEvent, { t: 'done' }> | undefined
  let netError: string | undefined
  try {
    const res = await fetch(`/api/intent${model.value === 'haiku' ? '' : `?model=${model.value}`}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, state: liveScene(), ctx })
    })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`)
    await readNdjson<IntentEvent>(res, (ev) => {
      if (ev.t === 'part') {
        // One part of a new design, before its define closes: it grows in where the spawn stands.
        if (world.state.value.entities.some(e => e.kind === ev.kind) && !world.state.value.kinds[ev.kind]?.learned) {
          streaming.add(ev.kind)
          draftAt[ev.kind] ??= performance.now()
          world.renderer()?.draftPart(ev.kind, ev.part)
        }
      } else if (ev.t === 'op') apply(ev.op)
      else if (ev.t === 'drop') dropped.push(ev.dropped)
      else end = ev
    }, 'intent')
  } catch (err) {
    netError = (err as Error).message
  }
  done()
  // A design that streamed parts but whose define never landed: show what the spot really holds.
  for (const k of streaming) world.renderer()?.endDraft(k)
  if (held.length) open(held, text)
  release()
  const ms = end?.ms ?? Math.round(performance.now() - started)
  const failure = netError ?? end?.error ?? (end ? undefined : 'the stream ended early')
  if (!entries.length) {
    // Nothing applied: still log the sentence so the HUD shows what went wrong.
    world.run({ ops: [] }, text, ctx, { source, model: end?.model, ms, dropped, error: failure })
    const msg = netError ? `Couldn't reach the builder: ${netError}` : failure ? `The builder stumbled: ${failure}` : 'nothing changed'
    if (failure) error.value = msg
    setPhase(recognition ? 'listening' : 'idle')
    return { ok: false, summary: msg, ops: [], dropped, notes, model: end?.model, ms, error: failure }
  }
  // Stamp the model, latency and server-side drops onto this sentence's log entries.
  world.history.value = world.history.value.map(h => !entries.includes(h.n)
    ? h
    : { ...h, model: end?.model, ms, error: failure, ...(h.n === entries[0] ? { dropped: [...dropped, ...h.dropped] } : {}) })

  const changed = spawned.size + modified.size + removed.size > 0 || other.length > 0
  // The high-quality pass: never awaited, so the draft and the reply never wait on it.
  if (changed) useForge().consider(text, applied, { t0: started, proxyMs, draftAt })
  // A blob that held a kind's spot until its define landed is not worth mentioning.
  const definedNow = new Set(applied.filter(o => o.op === 'define').map(o => (o as { kind: string }).kind))
  for (let i = notes.length - 1; i >= 0; i--) {
    const m = notes[i]!.match(/^unknown kind "([^"]+)"/)
    if (m && definedNow.has(m[1]!)) notes.splice(i, 1)
  }
  if (!changed && phase.value !== 'building') setPhase(recognition ? 'listening' : 'idle')
  // A late batch (held says, or a restore) can land after the last op: never leave the pill stuck on thinking.
  if (phase.value === 'thinking' && !inflight.value) setPhase(changed ? 'building' : recognition ? 'listening' : 'idle')
  const why = [...notes.filter(n => !n.startsWith('undid')), ...dropped.map(d => `dropped an op: ${d.reason}`)]
  return {
    ok: changed,
    summary: summarize([...spawned], [...modified].filter(id => !spawned.has(id)).length, removed.size, other) + (why.length ? ` (${why.slice(0, 2).join('; ')})` : ''),
    say: says.join(' ') || undefined,
    ops: applied,
    dropped,
    notes,
    model: end?.model,
    firstOpMs: end?.firstOpMs,
    firstAppliedMs,
    ms,
    error: failure
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
        void useNpc().say(said, ctx, 'voice')
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
    build, beginTyping, cancelTyping, takeSnapshot, capture, release,
    detectMic, startMic, stopMic, toggleMic
  }
}
