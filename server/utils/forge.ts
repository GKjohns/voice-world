/**
 * The forge, server half: prompts and model calls for progressive high-quality generation (ported from
 * conjure-progressive's staged pipeline, `server.mjs` + `lab/approaches.mjs`).
 *
 * - refine: Opus (reasoning none, pinned to Anthropic) looks at a render of the Haiku draft (plus, on the
 *   hero tier, a reference concept image) and streams a better program; each closed line is run in the
 *   sandbox (forgeRun.ts) and only the new plain parts are emitted.
 * - ref: Gemini image model draws an invisible reference concept, cached on disk by the wish's key (Fresh
 *   mode: never read from or written to disk, drawn once per forge job and kept in memory for that job).
 * - polish (hero only, background): Sol (reasoning low) rebuilds the current object toward the reference.
 * - judge: Haiku compares two renders against the reference, in both A/B orders.
 * Every call is checked against the ledger before it starts and recorded after. Nothing here throws.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { generateText, streamText } from 'ai'
import { boundsOf, fitToDraft, isBudgetError, islands, libKey, partsToProgram } from '../../shared/world/forge.ts'
import type { Tier } from '../../shared/world/forge.ts'
import type { Part } from '../../shared/world/ops.ts'
import { STYLE_IMAGE, STYLE_WITH_PALETTE } from '../../shared/world/style.ts'
import { FORGE_MODELS, REF_IMAGE_USD, costUsd } from './aiModels.ts'
import { FORGE_ESTIMATE, forgeCanSpend, forgeRecord } from './forgeLedger.ts'
import { programToParts, streamRunner, stripProgram } from './forgeRun.ts'

const FRAME = `Units are metres. Origin = the object's centre on the ground; y is up; +z is the object's FRONT (it faces the viewer); +x is to the viewer's right. Long things (animals, vehicles, boats) run along z with the head or front at +z.
Real-world scale: a person 1.8 m, a chair seat 0.45 m, a door 2 m, a car 4.5 m long, a horse 2.4 m long, a house 5 m tall.
Every part must touch or overlap another part; the whole thing rests on the ground (lowest point y≈0) unless it flies or hovers.
Colours are "#hex".
${STYLE_WITH_PALETTE}`

const API = `Write the BODY of a JS function. Available functions (each adds one part; o = optional {rot:[x,y,z], mirror:true, slot, material}):
  box(size,at,color,o) sphere(size,at,color,o) cylinder(size,at,color,o) cone(size,at,color,o) capsule(size,at,color,o) torus(size,at,color,o)
     size [w,h,d] bounding box, at = centre. Cylinders/cones/capsules stand along y; rot [1.571,0,0] lays one along z. Torus lies in the x–y plane.
  tube(points, radii, color, o) — smooth swept tapered body through [[x,y,z],...] (2–8 points) with a radius per point. Bodies, necks, tails, legs, horns, branches, pipes, rope.
  lathe(profile, at, color, o) — [[r,y],...] bottom→top turned around y (r=0 closes an end). Towers, vases, domes, columns, bottles, tree crowns.
  extrude(outline, depth, at, color, o) — 2D [[x,y],...] outline with thickness along z. Wings, sails, fins, ears, signs. o.rot [0,1.571,0] = side panel, [-1.571,0,0] = lying flat.
  PI, Math, loops and variables are available. mirror:true adds the x → −x copy: describe the +x side only (legs, wings, eyes, wheels).
Slots: o.slot:'primary' on the main body masses (when the player says "make it red", those parts turn red), 'trim' on accents and secondary colour, 'glow' on things that emit light (lamps, flames, windows, eyes, crystals). o.material: 'wood' | 'metal' | 'glass' | 'stone' | 'matte'.
Use consts for key anchor points so parts line up and joints are shared; loops for repeats (windows, spokes, planks, ribs). Aim for 30–90 parts (a showpiece 90–180); at most 200 after mirroring. More parts are not better: chunky readable masses beat fine detail.
Silhouette over detail: exaggerate what makes it recognisable from 20 m.
Order statements biggest to smallest: main masses first, then limbs and structure, small details last — the player watches each line appear. One statement per line.
Output ONLY the JavaScript body. First line: // name: <snake_case>. No JSON, no code fences, no prose.`

const LIVE = `You are a toy-diorama 3D sculptor who writes tiny JavaScript programs that build charming, instantly recognisable objects for a world that is built by talking.\n${FRAME}\n${API}`
const REFINE = `${LIVE}\nYou are REFINING a first draft. Look at its render, find the most important problems (floating or disconnected parts, wrong proportions, missing signature features, flat single colour) and rewrite the whole program much better. Keep what works: the same kind of thing, its colours and its overall size.`
const REF_NOTE = 'A rough reference concept image of the target is attached. Match its silhouette, proportions, pose, signature features and colours with your shapes (ignore its background and fine texture). It is the goal; do not invent a different design.'
const SPEED = 'SPEED MATTERS: the player watches each line appear, so the line right after the name line must already create the main body mass. Declare at most 2–3 key numbers, all on ONE line, then build immediately (use literal numbers where you can; no palette object, no long block of consts). Order: main masses first, then limbs and structure, small details last. No comments other than the name line.'

const REF_DIR = resolve(process.cwd(), '.data/forge/ref')
const refPrompt = (w: string) => `${STYLE_IMAGE}: ${w}, three-quarter view from the front-right, whole object visible, on plain green ground, plain light blue background, no text.`

export type ForgeEvent
  = | { t: 'stage', stage: 'ref' | 'refine', ms: number }
    | { t: 'parts', parts: Part[], ms: number }
    | { t: 'done', ok: boolean, ms: number, usd: number, parts?: Part[], code?: string, k?: number, floating?: number, draftFloating?: number, reason?: string, budget?: boolean, refMs?: number, firstPartMs?: number }

export interface ForgeRequest {
  kind: string
  text: string
  tier: Tier
  draft: Part[]
  /** Gen loop 2: the target size (largest dimension, m) decided at the spawn. */
  size?: number
  /** A data: URL (PNG) of the draft's studio render, or none. */
  image?: string
  session: string
  signal?: AbortSignal
  /** Fresh mode: see `RefScope`. */
  fresh?: boolean
  job?: string
}

/** Fresh mode skips the disk cache; its one reference per forge job (refine, polish and judge share it) lives in memory. */
export interface RefScope {
  fresh?: boolean
  job?: string
}

type ImagePart = { type: 'file', data: Uint8Array, mediaType: string }
function dataUrlPart(url: string | undefined): ImagePart | null {
  const m = typeof url === 'string' ? url.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/) : null
  if (!m || m[2]!.length > 4_000_000) return null
  return { type: 'file', data: Buffer.from(m[2]!, 'base64'), mediaType: m[1]! }
}

const why = (err: unknown) => String((err as Error)?.message ?? err ?? 'failed').slice(0, 200)
const envelope = (parts: Part[]) => {
  const b = boundsOf(parts)
  if (!b) return ''
  const f = (n: number) => n.toFixed(2)
  return `${f(b.max[0] - b.min[0])} × ${f(b.max[1] - b.min[1])} × ${f(b.max[2] - b.min[2])} m (x ${f(b.min[0])}…${f(b.max[0])}, y ${f(b.min[1])}…${f(b.max[1])}, z ${f(b.min[2])}…${f(b.max[2])})`
}

// ---------- the reference image (hero) ----------

const refInflight = new Map<string, Promise<{ data: Uint8Array, mediaType: string } | null>>()
/** Fresh jobs' references (key `fresh:<job>`), forgotten after 15 minutes. */
const FRESH_REF_MS = 15 * 60_000
const freshRefs = new Map<string, { at: number, job: Promise<{ data: Uint8Array, mediaType: string } | null> }>()

/**
 * The invisible reference concept for a wish: from the disk cache, or drawn once (in-flight de-duped).
 * Fresh mode: never from or to disk; drawn once per forge job and shared by that job's refine, polish and judge.
 */
export async function referenceImage(text: string, session: string, scope: RefScope = {}): Promise<{ data: Uint8Array, mediaType: string, ms: number, cached: boolean } | null> {
  const fresh = !!scope.fresh
  const slug = fresh ? `fresh:${scope.job || `${session}:${Date.now()}:${Math.random()}`}` : libKey(text)
  const file = resolve(REF_DIR, `${libKey(text)}.img`)
  const meta = resolve(REF_DIR, `${libKey(text)}.json`)
  if (fresh) {
    const now = Date.now()
    for (const [k, v] of freshRefs) if (now - v.at > FRESH_REF_MS) freshRefs.delete(k)
  }
  const held = fresh ? freshRefs.get(slug) : undefined
  if (held) {
    const img = await held.job
    return img ? { ...img, ms: 0, cached: false } : null
  }
  if (!fresh && existsSync(file) && existsSync(meta)) {
    try {
      return { data: readFileSync(file), mediaType: (JSON.parse(readFileSync(meta, 'utf8')) as { mediaType: string }).mediaType, ms: 0, cached: true }
    } catch {
      // fall through and redraw
    }
  }
  const t0 = Date.now()
  let job = refInflight.get(slug)
  if (!job) {
    job = (async () => {
      const ok = forgeCanSpend(session, REF_IMAGE_USD + 0.005)
      if (!ok.ok) return null
      try {
        const r = await generateText({
          model: FORGE_MODELS.ref,
          prompt: refPrompt(text),
          maxRetries: 1,
          abortSignal: AbortSignal.timeout(40_000),
          providerOptions: { google: { responseModalities: ['IMAGE'] } }
        })
        const img = r.files.find(f => f.mediaType?.startsWith('image/'))
        const usd = REF_IMAGE_USD + costUsd(FORGE_MODELS.ref, { input: r.usage?.inputTokens ?? 0, output: 0 })
        forgeRecord({ session, stage: 'ref', model: FORGE_MODELS.ref, usd, ms: Date.now() - t0, ok: !!img })
        if (!img) return null
        if (fresh) return { data: img.uint8Array, mediaType: img.mediaType }
        if (!existsSync(REF_DIR)) mkdirSync(REF_DIR, { recursive: true })
        writeFileSync(file, img.uint8Array)
        writeFileSync(meta, JSON.stringify({ mediaType: img.mediaType, text }))
        return { data: img.uint8Array, mediaType: img.mediaType }
      } catch (err) {
        console.warn('[forge] reference image failed:', why(err))
        forgeRecord({ session, stage: 'ref', model: FORGE_MODELS.ref, usd: 0, ms: Date.now() - t0, ok: false })
        return null
      }
    })().finally(() => refInflight.delete(slug))
    refInflight.set(slug, job)
    if (fresh) freshRefs.set(slug, { at: Date.now(), job })
  }
  const img = await job
  return img ? { ...img, ms: Date.now() - t0, cached: false } : null
}

// ---------- refine (good + hero) ----------

/**
 * Draft → refined, streamed. Yields `parts` as each program line closes, then exactly one `done` with the
 * final parts fitted to the draft's bounds. `ok: false` (with a reason) means: keep the draft.
 */
export async function* forgeRefine(req: ForgeRequest): AsyncGenerator<ForgeEvent> {
  const t0 = Date.now()
  const ms = () => Date.now() - t0
  const est = req.tier === 'hero' ? FORGE_ESTIMATE.hero : FORGE_ESTIMATE.good
  const gate = forgeCanSpend(req.session, est)
  if (!gate.ok) {
    yield { t: 'done', ok: false, ms: ms(), usd: 0, reason: gate.why, budget: true }
    return
  }
  let usd = 0
  let refMs: number | undefined
  let ref: Awaited<ReturnType<typeof referenceImage>> = null
  if (req.tier === 'hero') {
    yield { t: 'stage', stage: 'ref', ms: ms() }
    ref = await referenceImage(req.text, req.session, req)
    refMs = ms()
    if (req.signal?.aborted) {
      yield { t: 'done', ok: false, ms: ms(), usd, reason: 'aborted', refMs }
      return
    }
  }
  const draftCheck = islands(req.draft)
  const render = dataUrlPart(req.image)
  const issues = draftCheck.notes.length ? `\nThe engine's structural check found:\n- ${draftCheck.notes.join('\n- ')}` : ''
  // Gen loop 1: the refine starts at the spawn, in parallel with the Haiku draft, so usually there is no
  // draft to show it: it designs from the words at real-world scale, and its parts stream at final size.
  const prompt = req.draft.length
    ? `Make: "${req.text}" (it is a ${req.kind.replace(/_/g, ' ')}).
The draft's envelope is ${envelope(req.draft)}. Keep the same overall size and footprint, resting where the draft rests.
Current program (the draft):
${partsToProgram(req.draft)}

${render ? 'Image 1 is its render (front-right view).' : '(No render available.)'}${ref ? ` Image ${render ? 2 : 1} is the reference target. ${REF_NOTE}` : ''}${issues}
Write the complete improved program. ${SPEED}`
    : `Make: "${req.text}" (it is a ${req.kind.replace(/_/g, ' ')}).
Design it from scratch, resting on the ground.${req.size ? ` Its size is fixed: its largest dimension is ${Math.round(req.size * 10) / 10} m (fill that, don't exceed it).` : ' Real-world scale.'} If it is long (a vehicle, a creature, a telescope tube), its long axis runs along z.${ref ? ` Image 1 is the reference target. ${REF_NOTE}` : ''}
Write the complete program. ${SPEED}`

  yield { t: 'stage', stage: 'refine', ms: ms() }
  const ctrl = new AbortController()
  const onOuter = () => ctrl.abort(new Error('aborted'))
  req.signal?.addEventListener('abort', onOuter, { once: true })
  const timer = setTimeout(() => ctrl.abort(new Error('refine took over 50 s')), 50_000)
  const runner = streamRunner()
  let streamError: string | undefined
  let firstPartMs: number | undefined
  const t1 = Date.now()
  try {
    const r = streamText({
      model: FORGE_MODELS.refine,
      instructions: REFINE,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, ...(render ? [render] : []), ...(ref ? [{ type: 'file' as const, data: ref.data, mediaType: ref.mediaType }] : [])] }],
      maxOutputTokens: 6000,
      reasoning: 'none',
      abortSignal: ctrl.signal,
      maxRetries: 1,
      providerOptions: { gateway: { only: ['anthropic'] } },
      onError: ({ error }) => {
        streamError = why(error)
      }
    })
    for await (const delta of r.textStream) {
      const fresh = runner.push(delta)
      if (fresh.length) {
        firstPartMs ??= ms()
        yield { t: 'parts', parts: fresh, ms: ms() }
      }
    }
    const tail = runner.end()
    if (tail.length) yield { t: 'parts', parts: tail, ms: ms() }
    try {
      const u = await r.usage
      const cost = costUsd(FORGE_MODELS.refine, { input: u?.inputTokens ?? 0, output: u?.outputTokens ?? 0, cacheRead: u?.inputTokenDetails?.cacheReadTokens ?? 0, cacheWrite: u?.inputTokenDetails?.cacheWriteTokens ?? 0 })
      usd += cost
      forgeRecord({ session: req.session, stage: 'refine', model: FORGE_MODELS.refine, usd: cost, ms: Date.now() - t1, kind: req.kind, ok: !streamError, in: u?.inputTokens, out: u?.outputTokens })
    } catch {
      // usage is best-effort; record the estimate so the cap still bites
      usd += est
      forgeRecord({ session: req.session, stage: 'refine', model: FORGE_MODELS.refine, usd: est, ms: Date.now() - t1, kind: req.kind, ok: false })
    }
  } catch (err) {
    streamError = why(ctrl.signal.aborted && ctrl.signal.reason instanceof Error ? ctrl.signal.reason : err)
    // An aborted or failed call may still have been billed: count the estimate.
    usd += est * 0.5
    forgeRecord({ session: req.session, stage: 'refine', model: FORGE_MODELS.refine, usd: est * 0.5, ms: Date.now() - t1, kind: req.kind, ok: false })
  } finally {
    clearTimeout(timer)
    req.signal?.removeEventListener('abort', onOuter)
  }

  const code = stripProgram(runner.text()).trim()
  const { parts, run } = programToParts(code, { timeoutMs: 120 })
  const check = islands(parts)
  const base = { ms: ms(), usd, refMs, firstPartMs, floating: check.floating, draftFloating: draftCheck.floating }
  if (streamError && parts.length < 3) {
    yield { t: 'done', ok: false, ...base, reason: streamError, budget: isBudgetError(streamError) }
    return
  }
  // The accept rule (progressive's gate): it ran, ≥3 parts, and no worse floating than the draft beyond a small fraction.
  const okRun = run.ok || parts.length >= 3
  const floatOk = check.floating <= Math.max(draftCheck.floating, Math.ceil(parts.length * 0.1))
  if (!okRun || parts.length < 3 || !floatOk) {
    yield { t: 'done', ok: false, ...base, reason: !okRun ? `program failed: ${run.error}` : parts.length < 3 ? 'too few parts' : `${check.floating} floating parts: ${check.notes.slice(0, 2).join('; ')}` }
    return
  }
  // No fit to the draft after the fact (Gen loop 1): the parts the player watched stream in are the
  // final parts, so the hand-over is an exchange in place, never a resize jump.
  yield { t: 'done', ok: true, ...base, parts, code, k: 1 }
}

// ---------- polish (hero, background) ----------

export interface PolishRequest {
  kind: string
  text: string
  /** The current (refined) parts and, if the client kept it, the program that made them. */
  parts: Part[]
  code?: string
  image?: string
  session: string
  signal?: AbortSignal
  fresh?: boolean
  job?: string
}

/** Sol rebuilds the current object toward the reference ("the same thing getting better"). Non-streaming. */
export async function forgePolish(req: PolishRequest): Promise<{ ok: boolean, parts?: Part[], code?: string, usd: number, ms: number, reason?: string, budget?: boolean }> {
  const t0 = Date.now()
  const gate = forgeCanSpend(req.session, FORGE_ESTIMATE.polish)
  if (!gate.ok) return { ok: false, usd: 0, ms: 0, reason: gate.why, budget: true }
  const ref = await referenceImage(req.text, req.session, req)
  const render = dataUrlPart(req.image)
  const program = req.code && req.code.length < 30_000 ? req.code : partsToProgram(req.parts)
  try {
    const r = await generateText({
      model: FORGE_MODELS.polish,
      instructions: LIVE,
      reasoning: 'low',
      maxOutputTokens: 32_000,
      maxRetries: 1,
      abortSignal: req.signal ? AbortSignal.any([req.signal, AbortSignal.timeout(170_000)]) : AbortSignal.timeout(170_000),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Make: "${req.text}" (a ${req.kind.replace(/_/g, ' ')}).\nHere is the object the player is looking at (its build below${render ? '; image 1 is its render, front-right view' : ''})${ref ? ` and the reference concept (image ${render ? 2 : 1})` : ''}. Rebuild it as a high-quality version: you may rewrite everything and make your own design decisions about form and detail, but keep the same character: same type, pose, palette and overall proportions and size (envelope ${envelope(req.parts)}), so the player experiences it as the same thing getting better, not a different thing.\nCurrent program:\n${program}` },
          ...(render ? [render] : []),
          ...(ref ? [{ type: 'file' as const, data: ref.data, mediaType: ref.mediaType }] : [])
        ]
      }]
    })
    const usd = costUsd(FORGE_MODELS.polish, { input: r.usage?.inputTokens ?? 0, output: r.usage?.outputTokens ?? 0 })
    forgeRecord({ session: req.session, stage: 'polish', model: FORGE_MODELS.polish, usd, ms: Date.now() - t0, kind: req.kind, ok: true, in: r.usage?.inputTokens, out: r.usage?.outputTokens })
    const code = stripProgram(r.text).trim()
    const { parts, run } = programToParts(code, { timeoutMs: 150 })
    if ((!run.ok && parts.length < 4) || parts.length < 4) return { ok: false, usd, ms: Date.now() - t0, reason: run.error ?? `only ${parts.length} parts` }
    const fit = fitToDraft(parts, req.parts)
    return { ok: true, parts: fit.parts, code, usd, ms: Date.now() - t0 }
  } catch (err) {
    const reason = why(err)
    forgeRecord({ session: req.session, stage: 'polish', model: FORGE_MODELS.polish, usd: FORGE_ESTIMATE.polish * 0.5, ms: Date.now() - t0, kind: req.kind, ok: false })
    return { ok: false, usd: FORGE_ESTIMATE.polish * 0.5, ms: Date.now() - t0, reason, budget: isBudgetError(reason) }
  }
}

// ---------- judge (hero polish gate) ----------

/**
 * Does the polish beat the current build? Haiku compares the two renders against the reference twice,
 * with A/B swapped; the polish wins only if it wins both orders (progressive's rule: one order is noise).
 */
export async function forgeJudge(req: { text: string, current: string, polish: string, session: string, fresh?: boolean, job?: string }): Promise<{ polishWins: boolean, why: string, usd: number, ms: number, error?: string }> {
  const t0 = Date.now()
  const gate = forgeCanSpend(req.session, FORGE_ESTIMATE.judge * 2)
  if (!gate.ok) return { polishWins: false, why: gate.why, usd: 0, ms: 0, error: 'budget' }
  const cur = dataUrlPart(req.current)
  const pol = dataUrlPart(req.polish)
  if (!cur || !pol) return { polishWins: false, why: 'missing renders', usd: 0, ms: 0, error: 'missing renders' }
  const ref = await referenceImage(req.text, req.session, req)
  const ask = async (polishIsA: boolean) => {
    const [a, b] = polishIsA ? [pol, cur] : [cur, pol]
    const r = await generateText({
      model: FORGE_MODELS.judge,
      reasoning: 'none',
      maxOutputTokens: 200,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(30_000),
      providerOptions: { gateway: { only: ['anthropic'] } },
      instructions: 'You judge chunky toy-diorama 3D objects built from simple shapes for a world built by talking. Prefer chunky, readable silhouettes and a cohesive muted palette over detail count. Be decisive.',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `The player wished for: "${req.text}".${ref ? ' First image: the reference concept (the target).' : ''} Then build A, then build B (same camera).` },
          ...(ref ? [{ type: 'file' as const, data: ref.data, mediaType: ref.mediaType }] : []),
          { type: 'text', text: 'A:' }, a, { type: 'text', text: 'B:' }, b,
          { type: 'text', text: 'Which one better matches the wish and the reference, A or B? Answer JSON only: {"pick":"A"|"B","why":"at most 10 words naming what the winner does better; never mention A or B"}' }
        ]
      }]
    })
    const usd = costUsd(FORGE_MODELS.judge, { input: r.usage?.inputTokens ?? 0, output: r.usage?.outputTokens ?? 0 })
    forgeRecord({ session: req.session, stage: 'judge', model: FORGE_MODELS.judge, usd, ms: Date.now() - t0, ok: true })
    const m = r.text.match(/\{[\s\S]*\}/)
    const j = (m ? JSON.parse(m[0]) : {}) as { pick?: string, why?: string }
    const pick = j.pick === 'A' || j.pick === 'B' ? j.pick : null
    return { won: pick ? (pick === 'A') === polishIsA : null, why: String(j.why ?? ''), usd }
  }
  try {
    const runs = await Promise.all([ask(true), ask(false)])
    const usd = runs.reduce((s, r) => s + r.usd, 0)
    const polishWins = runs.every(r => r.won === true)
    return { polishWins, why: (runs.find(r => r.won === polishWins) ?? runs[0]!).why.slice(0, 80), usd, ms: Date.now() - t0 }
  } catch (err) {
    return { polishWins: false, why: 'judge failed', usd: 0, ms: Date.now() - t0, error: why(err) }
  }
}
