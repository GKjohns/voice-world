/**
 * Teleport mode on the client. When a batch contains a `teleport`, the renderer fogs the old place out
 * (keeping a patch of floor under you) and this streams the Director's recipe from /api/director. Each op
 * is converted (`directorToOp`), validated (`parseOps`, inside `extendLastBatch`) and appended to the
 * teleport's own batch the moment it arrives, so:
 *   - the place assembles while the model is still writing (the renderer staggers arrivals outward),
 *   - "undo" removes the whole place in one step (it's one batch),
 *   - save / reload replays the built scene from the log without calling the model again.
 * If you say something else mid-build, your sentence becomes the last batch and the rest of the recipe
 * continues in a follow-on batch ("pool hall (cont.)") with the teleport's context. Undoing the teleport
 * (or teleporting again, clearing, loading) stops the stream.
 */
import { shallowRef } from 'vue'
import { directorToOp } from '#shared/world/ops'
import type { BatchResult } from '#shared/world/state'
import type { Batch, Effects } from '#shared/world/types'
import { readNdjson } from '~/utils/ndjson'
import { useWorld } from './useWorld'
import { useForge } from './useForge'

export interface DirectorRun {
  world: string
  brief?: string
  status: 'building' | 'done' | 'error' | 'stopped'
  /** performance.now() when the request went out, when the first op landed, when the stream ended. */
  t0: number
  firstOpAt?: number
  doneAt?: number
  ops: number
  dropped: number
  costUsd?: number
  error?: string
}

type DirectorEvent
  = | { t: 'op', op: unknown, ms: number, i: number }
    | { t: 'done', ms: number, count: number, costUsd: number }
    | { t: 'error', ms: number, error: string }

const current = shallowRef<DirectorRun | null>(null)
let ctrl: AbortController | null = null
/** The teleport batch (identified by its timestamp: ids are reused after an undo) and where ops go now. */
let origin: { at: number } | null = null
let target: { id: string, at: number } | null = null

function patch(p: Partial<DirectorRun>) {
  if (current.value) current.value = { ...current.value, ...p }
}

/** Stop streaming. `lift` also clears the teleport fog (not when a new teleport is about to reuse it). */
function stop(status: DirectorRun['status'] = 'stopped', lift = true) {
  if (ctrl) {
    ctrl.abort()
    ctrl = null
    if (current.value?.status === 'building') patch({ status, doneAt: performance.now() })
  }
  origin = null
  target = null
  if (lift) useWorld().renderer()?.endReveal()
}

function abort() {
  stop('stopped', true)
}

/** Called by useWorld.run after every batch: start on a teleport, stop if the teleport was undone. */
function afterRun(res: BatchResult) {
  if (res.effects.teleport && res.batch) {
    void start(res.effects.teleport, res.batch)
    return
  }
  if (ctrl && origin && !useWorld().state.value.log.some(b => b.at === origin!.at)) stop('stopped', true)
}

function apply(raw: unknown): BatchResult | null {
  if (!target || !origin) return null
  const world = useWorld()
  let out = world.extend(target.id, target.at, [raw])
  if (!out) {
    const s = world.state.value
    const tele = s.log.find(b => b.at === origin!.at)
    if (!tele) {
      stop('stopped', true)
      return null
    }
    // Someone spoke mid-build: carry on in a follow-on batch with the teleport's room frame.
    out = world.run([raw], `${current.value?.world ?? 'place'} (cont.)`, tele.ctx)
    if (out.batch) target = { id: out.batch.id, at: out.batch.at }
  }
  return out
}

async function start(tp: NonNullable<Effects['teleport']>, batch: Batch) {
  stop('stopped', false)
  const world = useWorld()
  const mine = new AbortController()
  ctrl = mine
  origin = { at: batch.at }
  target = { id: batch.id, at: batch.at }
  const t0 = performance.now()
  current.value = { world: tp.world, brief: tp.brief, status: 'building', t0, ops: 0, dropped: 0 }
  world.caption.value = { text: `Taking you to ${tp.world}…`, at: Date.now() }

  const fail = (error: string) => {
    if (ctrl !== mine) return
    console.warn(`[director] ${tp.world}: ${error}`)
    patch({ status: 'error', error, doneAt: performance.now() })
    world.caption.value = { text: `Couldn't build ${tp.world}: ${error}`, at: Date.now() }
    ctrl = null
    world.renderer()?.endReveal()
  }

  let res: Response
  try {
    res = await fetch('/api/director', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ world: tp.world, brief: tp.brief, player: batch.ctx.player, ...(batch.ctx.fresh ? { fresh: true } : {}) }),
      signal: mine.signal
    })
  } catch (err) {
    if (!mine.signal.aborted) fail((err as Error).message)
    return
  }
  if (!res.ok || !res.body) {
    fail(`HTTP ${res.status}`)
    return
  }

  // Gauntlet loop 1: the place's signature thing (the define marked hero, else the first define) is forged
  // into a high-quality version once the build is done: one refine per teleport, under the forge's spend caps.
  let hero: string | null = null
  let heroMarked = false
  const handle = (ev: DirectorEvent) => {
    if (ctrl !== mine) return
    if (ev.t === 'op') {
      const op = directorToOp(ev.op) as { op?: string, kind?: string, hero?: boolean }
      const out = apply(op)
      if (!out) return
      const def = out.ops.find(o => o.op === 'define') as { kind: string, hero?: boolean } | undefined
      if (def && (!hero || (def.hero && !heroMarked))) {
        hero = def.kind
        heroMarked = !!def.hero
      }
      const run = current.value!
      patch({ ops: run.ops + out.ops.length, dropped: run.dropped + out.dropped.length, firstOpAt: run.firstOpAt ?? performance.now() })
    } else if (ev.t === 'done') {
      const run = current.value!
      const doneAt = performance.now()
      patch({ status: 'done', doneAt, costUsd: ev.costUsd })
      console.info(`[director] ${tp.world}: first op ${Math.round((run.firstOpAt ?? doneAt) - t0)} ms · done ${Math.round(doneAt - t0)} ms · ${run.ops} ops (${run.dropped} dropped) · $${ev.costUsd.toFixed(4)}`)
      ctrl = null
      origin = null
      target = null
      world.renderer()?.endReveal()
      const kind = hero
      if (kind) {
        setTimeout(() => {
          const s = useWorld().state.value
          if (s.place === tp.world && s.entities.some(e => e.kind === kind)) useForge().forgeKind(kind, `${tp.world}: ${kind.replace(/_/g, ' ')}`)
        }, 1200)
      }
    } else {
      fail(ev.error)
    }
  }
  try {
    await readNdjson<DirectorEvent>(res, handle, 'director')
  } catch (err) {
    if (!mine.signal.aborted) fail((err as Error).message)
    return
  }
  // The stream closed without a done/error line.
  if (ctrl === mine) fail('the stream ended early')
}

export function useDirector() {
  return { current, afterRun, abort, start }
}
