/**
 * The forge orchestrator (progressive high-quality generation, client side). After a sentence defines a
 * new kind, or asks to make an existing one better, `consider` decides the tier and runs:
 *
 *   library hit ($0) → upgradeKind, done
 *   else studio shot of the draft → ghost + swirl → /api/forge streams refined parts that grow through the
 *   ghost → accepted: upgradeKind (every instance sweeps in) → library save
 *   hero: then Sol polish in the background → gate (parts, floating) → Haiku judge both orders → swap
 *
 * The draft never waits on any of this, failures quietly keep the draft, a budget refusal stops forging
 * for the session, and an undo / remove / redefine of the kind aborts its job (upgradeKind checks the
 * basis too). Model code never reaches the client: only parts.
 */
import { shallowRef, watch } from 'vue'
import { HERO_WORDS, UPGRADE_WORDS, chooseTier, islands } from '#shared/world/forge'
import type { Tier } from '#shared/world/forge'
import type { Op, Part } from '#shared/world/ops'
import { isKitKind } from '#shared/world/kinds'

export interface ForgeRecord {
  kind: string
  tier: Tier
  text: string
  /** ms since the sentence started (performance.now based). */
  t0: number
  proxyMs?: number
  draftMs?: number
  startMs?: number
  firstPartMs?: number
  refinedMs?: number
  polishMs?: number
  outcome?: string
  usd: number
  parts?: number
  library?: boolean
}

interface Job {
  kind: string
  tier: Tier
  ctrl: AbortController
  basis: string
  rec: ForgeRecord
}

const session = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
const jobs = new Map<string, Job>()
const spent = shallowRef(0)
const disabled = shallowRef(false)
const log = shallowRef<ForgeRecord[]>([])
let watching = false

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function publish(rec: ForgeRecord) {
  log.value = [...log.value.filter(r => r !== rec), rec]
  ;(window as unknown as { __forge?: unknown }).__forge = { session, spent: spent.value, disabled: disabled.value, log: log.value, busy: jobs.size }
}

/** Abort jobs whose kind was undone, removed from the world, or redefined. */
function watchWorld() {
  if (watching) return
  watching = true
  const world = useWorld()
  watch(world.state, (s) => {
    for (const job of [...jobs.values()]) {
      const desc = s.kinds[job.kind]
      if (!desc || desc.basis !== job.basis || !s.entities.some(e => e.kind === job.kind)) {
        job.ctrl.abort()
        jobs.delete(job.kind)
        world.renderer()?.endRefine(job.kind, false)
        job.rec.outcome = 'aborted (the kind changed)'
        publish(job.rec)
      }
    }
  })
}

/** The sentence that first defined a kind (its label in the log), for prompts and the library. */
function wishOf(kind: string): string {
  const b = useWorld().state.value.log.find(b => b.ops.some(o => o.op === 'define' && o.kind === kind))
  return (b?.label ?? kind.replace(/_/g, ' ')).replace(/ \(cont\.\)$/, '')
}

/**
 * After a sentence: forge what it defined (count ≤ 3, not kit, not people), or, for "make it better /
 * more detailed", the learned kind it points at. `marks` carries the sentence's timings for the record.
 */
function consider(text: string, ops: Op[], marks: { t0: number, proxyMs?: number, draftAt?: Record<string, number> } = { t0: performance.now() }) {
  if (disabled.value) return
  watchWorld()
  const world = useWorld()
  const s = world.state.value
  const defined = [...new Set(ops.filter(o => o.op === 'define').map(o => (o as { kind: string }).kind))]
  for (const kind of defined) {
    const desc = s.kinds[kind]
    if (!desc?.learned) continue
    const count = s.entities.filter(e => e.kind === kind).length
    const tier = chooseTier({ text, kit: isKitKind(kind), person: kind === 'person', count, quality: desc.quality })
    if (tier) void start(kind, text, tier, marks, marks.draftAt?.[kind])
  }
  if (defined.length || !(UPGRADE_WORDS.test(text) || HERO_WORDS.test(text))) return
  // "Make it more detailed": the gazed thing, else the last batch's kind, if it is a learned kind.
  const ctxEntity = world.state.value.log[world.state.value.log.length - 1]?.ctx.gaze.entity
  const gazed = ctxEntity ? s.entities.find(e => e.id === ctxEntity) : undefined
  const last = s.lastGroup ? s.entities.find(e => e.group === s.lastGroup) : undefined
  const target = [gazed, last, ...[...s.entities].reverse()].find(e => e && s.kinds[e.kind]?.learned)
  if (!target) return
  const desc = s.kinds[target.kind]!
  const count = s.entities.filter(e => e.kind === target.kind).length
  const tier = chooseTier({ text, kit: false, person: false, count, quality: desc.quality })
  if (tier) void start(target.kind, wishOf(target.kind), tier, marks)
}

async function readNdjson(res: Response, onLine: (ev: Record<string, unknown>) => void) {
  const reader = res.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl = buf.indexOf('\n')
    while (nl >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim()) {
        try {
          onLine(JSON.parse(line))
        } catch {
          // a torn line
        }
      }
      nl = buf.indexOf('\n')
    }
  }
}

async function start(kind: string, text: string, tier: Tier, marks: { t0: number, proxyMs?: number }, draftAt?: number) {
  const world = useWorld()
  const existing = jobs.get(kind)
  if (existing) {
    if (existing.tier === 'hero' || tier === 'good') return
    existing.ctrl.abort()
    jobs.delete(kind)
    world.renderer()?.endRefine(kind, false)
  }
  const desc = world.state.value.kinds[kind]
  if (!desc?.parts || !desc.basis) return
  const basis = desc.basis
  const rec: ForgeRecord = { kind, tier, text, t0: marks.t0, proxyMs: marks.proxyMs, draftMs: draftAt !== undefined ? Math.round(draftAt - marks.t0) : undefined, usd: 0 }
  const job: Job = { kind, tier, ctrl: new AbortController(), basis, rec }
  jobs.set(kind, job)
  publish(rec)
  const since = () => Math.round(performance.now() - marks.t0)
  const finish = (outcome: string) => {
    rec.outcome = outcome
    if (jobs.get(kind) === job) jobs.delete(kind)
    publish(rec)
  }
  try {
    // 1. The library: a forged version of this kind (or this wish) from any earlier session, for $0.
    const lib = await fetch(`/api/forge/lib?kind=${encodeURIComponent(kind)}&text=${encodeURIComponent(text)}&tier=${tier}`, { signal: job.ctrl.signal }).then(r => r.json()).catch(() => null) as { hit?: boolean, parts?: Part[], quality?: Tier, code?: string } | null
    if (job.ctrl.signal.aborted) return
    if (lib?.hit && lib.parts?.length) {
      // Let the draft's own arrival finish first, so the upgrade reads as an upgrade.
      await sleep(Math.max(0, 900 - (performance.now() - (draftAt ?? 0))))
      const ok = world.upgradeKind(kind, lib.parts, { basis, quality: lib.quality ?? tier })
      rec.library = true
      rec.refinedMs = since()
      rec.parts = lib.parts.length
      return finish(ok ? 'library hit' : 'library hit, but the kind changed')
    }
    // 2. The draft's studio shot, once its morph has settled (it pops in over ~0.5 s).
    await sleep(Math.max(0, 750 - (performance.now() - (draftAt ?? 0))))
    const r = world.renderer()
    const focus = r?.focusOf(kind)
    if (!r || !focus || job.ctrl.signal.aborted) return finish('no instance to refine')
    const image = await r.studioShot(focus)
    if (job.ctrl.signal.aborted) return
    const draft = world.state.value.kinds[kind]?.parts ?? desc.parts
    rec.startMs = since()
    r.beginRefine(kind)
    const hint = tier === 'hero' ? 'A moment… let me perfect it.' : '…let me perfect it.'
    setTimeout(() => {
      if (jobs.get(kind) === job) world.caption.value = { text: hint, at: Date.now() }
    }, 1400)

    // 3. The refine stream.
    let done: Record<string, unknown> | null = null
    const res = await fetch('/api/forge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, text, tier, draft, image, session }),
      signal: job.ctrl.signal
    })
    if (!res.ok || !res.body) throw new Error(`forge HTTP ${res.status}`)
    await readNdjson(res, (ev) => {
      if (ev.t === 'parts') {
        rec.firstPartMs ??= since()
        world.renderer()?.refineParts(kind, ev.parts as Part[])
      } else if (ev.t === 'done') {
        done = ev
      }
    })
    const d = done as { ok?: boolean, parts?: Part[], code?: string, usd?: number, reason?: string, budget?: boolean } | null
    rec.usd += d?.usd ?? 0
    spent.value += d?.usd ?? 0
    if (d?.budget) disabled.value = true
    if (!d?.ok || !d.parts?.length) {
      world.renderer()?.endRefine(kind, false)
      return finish(`kept the draft (${d?.reason ?? 'no answer'})`)
    }
    // Let the last queued parts grow before the sweep takes over.
    await sleep(350)
    if (job.ctrl.signal.aborted) return
    const ok = world.upgradeKind(kind, d.parts, { basis, quality: tier })
    world.renderer()?.endRefine(kind, ok)
    rec.refinedMs = since()
    rec.parts = d.parts.length
    if (!ok) return finish('refined, but the kind changed')
    void fetch('/api/forge/lib', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text, quality: tier, parts: d.parts, code: d.code, usd: d.usd }) }).catch(() => {})
    if (tier !== 'hero') return finish('refined')
    rec.outcome = 'refined; polishing'
    publish(rec)
    await polish(job, text, d.parts, d.code, since)
  } catch (err) {
    if (job.ctrl.signal.aborted) return
    world.renderer()?.endRefine(kind, false)
    finish(`kept the draft (${(err as Error).message})`)
  }
}

/** Hero only, in the background: Sol rebuilds it; it must pass the gates and win both judge orders. */
async function polish(job: Job, text: string, current: Part[], code: string | undefined, since: () => number) {
  const world = useWorld()
  const { kind, basis, rec } = job
  await sleep(2200) // let the sweep finish before shooting the refined version
  const r = world.renderer()
  const focus = r?.focusOf(kind)
  if (!r || !focus || job.ctrl.signal.aborted) return finish('polish skipped')
  const image = await r.studioShot(focus)
  const p = await fetch('/api/forge/polish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, text, parts: current, code, image, session }),
    signal: job.ctrl.signal
  }).then(res => res.json()).catch(() => null) as { ok?: boolean, parts?: Part[], usd?: number, reason?: string, budget?: boolean } | null
  if (job.ctrl.signal.aborted) return
  rec.usd += p?.usd ?? 0
  spent.value += p?.usd ?? 0
  if (p?.budget) disabled.value = true
  rec.polishMs = since()
  if (!p?.ok || !p.parts || p.parts.length < 4) return finish(`refined; polish failed (${p?.reason ?? 'no answer'})`)
  if (islands(p.parts).floating > islands(current).floating) return finish('refined; polish kept out (more floating parts)')
  const focus2 = r.focusOf(kind)
  if (!focus2) return finish('polish skipped')
  const candidate = r.candidate(p.parts)
  await sleep(200) // its programs compile in the background meanwhile
  const [a, b] = [await r.studioShot(focus2), await r.studioShot(focus2, candidate)]
  if (!a || !b) return finish('refined; polish not judged (no renders)')
  const j = await fetch('/api/forge/judge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, current: a, polish: b, session }) })
    .then(res => res.json()).catch(() => null) as { polishWins?: boolean, why?: string, usd?: number } | null
  rec.usd += j?.usd ?? 0
  spent.value += j?.usd ?? 0
  rec.polishMs = since()
  if (job.ctrl.signal.aborted) return
  if (!j?.polishWins) return finish(`refined; polish lost the judge (${j?.why ?? '?'})`)
  const ok = world.upgradeKind(kind, p.parts, { basis, quality: 'hero' })
  if (ok) void fetch('/api/forge/lib', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text, quality: 'hero', parts: p.parts, usd: rec.usd }) }).catch(() => {})
  rec.parts = p.parts.length
  return finish(ok ? `polished (${j.why})` : 'polished, but the kind changed')

  function finish(outcome: string) {
    rec.outcome = outcome
    if (jobs.get(kind) === job) jobs.delete(kind)
    publish(rec)
  }
}

/**
 * Forge one learned kind at the good tier whatever its count (Gauntlet loop 1: the Director's signature
 * prop for a place, often several instances: every one sweeps into the refined look). Same library, spend
 * caps and abort rules as `consider`.
 */
function forgeKind(kind: string, text: string) {
  if (disabled.value) return
  watchWorld()
  const desc = useWorld().state.value.kinds[kind]
  if (!desc?.learned || (desc.quality && desc.quality !== 'draft')) return
  void start(kind, text, 'good', { t0: performance.now() })
}

/** "Start over": every in-flight refine stops (the library on the server keeps what it already forged). */
function cancelAll() {
  const r = useWorld().renderer()
  for (const job of [...jobs.values()]) {
    job.ctrl.abort()
    jobs.delete(job.kind)
    r?.endRefine(job.kind, false)
    job.rec.outcome = 'aborted (world reset)'
    publish(job.rec)
  }
}

export function useForge() {
  return { session, spent, disabled, log, consider, forgeKind, cancelAll, busy: () => jobs.size }
}
