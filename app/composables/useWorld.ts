/**
 * The app's one world: the pure WorldState, the renderer it drives, and the HUD's history of batches.
 * Everything that changes the world goes through `run`, so the dev console and the model brain
 * (useIntent) share one path: snapshot the gaze → applyBatch → renderer.sync → save.
 */
import { shallowRef } from 'vue'
import { applyBatch, createWorld, diffStates, exportWorld, extendLastBatch, importWorld } from '#shared/world/state'
import type { DroppedOp, Op } from '#shared/world/ops'
import type { Effects, OpContext, WorldState } from '#shared/world/types'
import type { GazeInfo, WorldRenderer } from '~/world/renderer'
import { setGazeOverride } from '~/world/look'
import { useDirector } from './useDirector'

const STORAGE_KEY = 'conjure:world:v1'

export interface HistoryEntry {
  n: number
  label: string
  ops: Op[]
  dropped: DroppedOp[]
  notes: string[]
  say: string[]
  batchId?: string
  spawned: number
  modified: number
  removed: number
  undone: boolean
  /** Who wrote the ops: the console, typed text or the mic. Model runs also carry the model and its latency. */
  source?: RunMeta['source']
  model?: string
  ms?: number
  error?: string
}

export interface RunMeta {
  source?: 'console' | 'text' | 'voice'
  model?: string
  ms?: number
  /** Ops the server already dropped (the client re-parse only sees the survivors). */
  dropped?: DroppedOp[]
  error?: string
}

const state = shallowRef<WorldState>(createWorld())
const history = shallowRef<HistoryEntry[]>([])
const gaze = shallowRef<GazeInfo>({ kind: 'ground', dist: 0 })
const caption = shallowRef<{ text: string, at: number } | null>(null)
let renderer: WorldRenderer | null = null
let counter = 0

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(exportWorld(state.value)))
  } catch {
    // Storage full or blocked: the world still works, it just won't survive a reload.
  }
}

function snapshot(): OpContext {
  const g = renderer?.gaze()
  return {
    gaze: g ? { point: g.point, entity: g.entity, dist: g.dist } : { point: [0, 0, -10] },
    player: renderer?.player() ?? { pos: [0, 1.6, 0], yaw: 0 },
    seed: Math.floor(Math.random() * 2 ** 31)
  }
}

function commit(next: WorldState, effects: Effects) {
  state.value = next
  renderer?.sync(next, effects)
  if (effects.say.length) caption.value = { text: effects.say.join(' '), at: Date.now() }
  save()
}

/** Apply one batch (one sentence's worth of ops). Accepts `{ ops }`, an array or a single op. */
function run(raw: unknown, label = 'ops', ctx: OpContext = snapshot(), meta: RunMeta = {}) {
  if (renderer && ctx.gaze.point) renderer.showGhost(ctx.gaze.point)
  const before = state.value
  const res = applyBatch(before, raw, ctx, label)
  const undos = res.ops.filter(o => o.op === 'undo').length
  let list = history.value
  // Mark undone entries so the log reads honestly; batch ids are reused after an undo, so match newest first.
  for (let i = 0; i < undos; i++) {
    const popped = before.log[before.log.length - 1 - i]
    const idx = popped ? findLastIndex(list, h => h.batchId === popped.id && !h.undone) : -1
    if (idx >= 0) list = list.map((h, j) => j === idx ? { ...h, undone: true } : h)
  }
  const entry: HistoryEntry = {
    n: ++counter,
    label,
    ops: res.ops,
    dropped: [...(meta.dropped ?? []), ...res.dropped],
    notes: res.effects.notes,
    say: res.effects.say,
    batchId: res.batch?.id,
    spawned: res.effects.spawned.length,
    modified: res.effects.modified.length,
    removed: res.effects.removed.length,
    undone: false,
    source: meta.source,
    model: meta.model,
    ms: meta.ms,
    error: meta.error
  }
  history.value = [...list, entry]
  commit(res.state, res.effects)
  // A teleport starts the Director (it streams the place into this same batch); an undo may cancel one.
  useDirector().afterRun(res)
  return res
}

/**
 * Stream ops into the last batch (the Director filling a teleport). Only if that batch is still the last
 * one (`id` and `at` match); returns null otherwise so the caller can decide (continue in a new batch, or stop).
 */
function extend(batchId: string, at: number, raw: unknown) {
  const s = state.value
  const last = s.log[s.log.length - 1]
  if (!last || last.id !== batchId || last.at !== at) return null
  const res = extendLastBatch(s, raw)
  const idx = findLastIndex(history.value, h => h.batchId === batchId && !h.undone)
  if (idx >= 0) {
    history.value = history.value.map((h, j) => j !== idx
      ? h
      : { ...h, ops: [...h.ops, ...res.ops], dropped: [...h.dropped, ...res.dropped], notes: [...h.notes, ...res.effects.notes], say: [...h.say, ...res.effects.say], spawned: h.spawned + res.effects.spawned.length })
  }
  commit(res.state, res.effects)
  return res
}

function undo() {
  return run([{ op: 'undo' }], 'undo')
}

function clear() {
  useDirector().abort()
  const next = createWorld()
  const fx = diffStates(state.value, next)
  fx.atmosphere = true
  history.value = []
  commit(next, fx)
}

function load(saved: unknown, label = 'loaded world') {
  useDirector().abort()
  const next = importWorld(saved)
  const fx = diffStates(state.value, next)
  fx.atmosphere = true
  history.value = next.log.map(b => ({
    n: ++counter, label: b.label ?? label, ops: b.ops, dropped: b.dropped, notes: [], say: [], batchId: b.id,
    spawned: 0, modified: 0, removed: 0, undone: false
  }))
  commit(next, fx)
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) load(JSON.parse(raw), 'restored')
  } catch (err) {
    console.warn('[conjure] could not restore the saved world', err)
  }
}

function exportFile() {
  const blob = new Blob([JSON.stringify(exportWorld(state.value), null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')
  a.href = URL.createObjectURL(blob)
  a.download = `conjure-world-${stamp}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

async function importFile(file: File) {
  load(JSON.parse(await file.text()), file.name)
}

function attach(r: WorldRenderer) {
  renderer = r
  r.onGaze = (g) => {
    gaze.value = g
  }
  r.sync(state.value, diffStates(createWorld(), state.value))
}

function detach() {
  renderer = null
}

function findLastIndex<T>(list: T[], fn: (x: T) => boolean): number {
  for (let i = list.length - 1; i >= 0; i--) if (fn(list[i]!)) return i
  return -1
}

export function useWorld() {
  // setGazeOverride(ndc | null): cast the gaze (and so snapshot()/capture()) through a screen point, e.g. a pointed finger.
  return { state, history, gaze, caption, run, extend, undo, clear, load, restore, exportFile, importFile, attach, detach, snapshot, setGazeOverride, renderer: () => renderer }
}
