// The generation gauntlet: the object-generation yardstick for the speed/quality/transition loops.
// For each prompt in internal_docs/20261018_gen_gauntlet/prompts.json, in a FRESH world (new browser context,
// empty storage, ?fresh=1 so nothing comes from the kit or the forge library): type the sentence into the HUD
// field (the real text path), record a video, log a timeline of what was on screen, and take stills.
//
// Usage: node scripts/gen-gauntlet.mjs [--loop loop0] [--only id,id] [--url http://localhost:3091/]
//                                      [--prompts file.json] [--no-video] [--index-only]
// Output: internal_docs/20261018_gen_gauntlet/<loop>/{videos/*.mp4, stills/*.jpg, timings.json, index.html}
//
// Timings are ms from pressing Enter:
//   firstOp     the intent model's first op reaches the client
//   standIn     the new kind's spawn lands (a labelled blob holds the spot; motes swirl round it)
//   draft       the Haiku `define` lands: the first pixels of the actual object (it morphs in over ~0.5 s)
//   refineStart the forge starts: the draft turns into the translucent gold ghost
//   firstPart   the first refined part is grown on screen
//   recognizable  half of the final object's parts are on screen (the program is written biggest-first)
//   swap        the refined object is accepted and the light-band sweep starts
//   settled     the sweep has finished (swap + 1.8 s); for hero, the polish verdict if later (polish swap + 1.8 s)
// Cost: forge $ is exact (per call, from the ledger via window.__forge); intent $ is an estimate (the client never
// sees it); the gateway's account-wide credits are read before and after the run as a cross-check.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const loop = opt('--loop', 'loop0')
const url = opt('--url', 'http://localhost:3091/')
const promptsFile = resolve(ROOT, opt('--prompts', 'internal_docs/20261018_gen_gauntlet/prompts.json'))
const only = opt('--only', '').split(',').map(s => s.trim()).filter(Boolean)
const outDir = resolve(ROOT, 'internal_docs/20261018_gen_gauntlet', loop)
const W = 1280
const H = 720
const SWEEP_MS = 1800 // app/world/renderer.ts SWEEP_MS
const LEAD_S = 2 // seconds of video kept before Enter
const INTENT_USD_EST = 0.003 // Haiku define + spawn, cached digest

if (args.includes('--index-only')) {
  writeIndex(JSON.parse(readFileSync(resolve(outDir, 'timings.json'), 'utf8')))
  console.log(`wrote ${resolve(outDir, 'index.html')}`)
  process.exit(0)
}

const PROMPTS = JSON.parse(readFileSync(promptsFile, 'utf8')).prompts.filter(p => !only.length || only.includes(p.id))
for (const d of ['videos', 'stills', '.raw']) mkdirSync(resolve(outDir, d), { recursive: true })
const hasFfmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()
const video = !args.includes('--no-video')

function gatewayKey() {
  try {
    const m = readFileSync(resolve(ROOT, '.env'), 'utf8').match(/^AI_GATEWAY_API_KEY=(.+)$/m)
    return m?.[1]?.trim().replace(/^["']|["']$/g, '')
  } catch {
    return undefined
  }
}
async function credits() {
  const key = gatewayKey()
  if (!key) return null
  try {
    const r = await fetch('https://ai-gateway.vercel.sh/v1/credits', { headers: { authorization: `Bearer ${key}` } })
    const j = await r.json()
    return { balance: Number(j.balance), used: Number(j.total_used) }
  } catch {
    return null
  }
}
function ledgerTotal() {
  try {
    return readFileSync(resolve(ROOT, '.data/forge/ledger.jsonl'), 'utf8').split('\n').filter(Boolean).reduce((s, l) => {
      try {
        return s + (Number(JSON.parse(l).usd) || 0)
      } catch {
        return s
      }
    }, 0)
  } catch {
    return 0
  }
}

// In the page, before the app boots: tee every model stream into a timeline, sample the renderer each frame
// (what the player actually sees: forming motes, ghost, grown refined parts), and draw a small clock overlay.
// Harness-only: nothing in the product changes.
function instrument() {
  const gg = { t0: null, events: [], samples: [], kind: null }
  window.__gg = gg
  const now = () => performance.now()
  const push = e => gg.events.push({ t: now(), ...e })
  const lines = async (body, on) => {
    const reader = body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const l = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (l) {
          try {
            on(JSON.parse(l))
          } catch { /* partial */ }
        }
      }
    }
  }
  const f0 = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const u = typeof input === 'string' ? input : input.url
    const res = await f0(input, init)
    const path = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
    if (!res.body || !['/api/intent', '/api/forge', '/api/forge/polish', '/api/forge/judge'].includes(path)) return res
    const [a, b] = res.body.tee()
    push({ type: 'req', path })
    if (path === '/api/intent' || path === '/api/forge') {
      lines(b, (ev) => {
        if (path === '/api/intent') {
          if (ev.t === 'op') {
            push({ type: 'op', op: ev.op.op, kind: ev.op.kind, parts: ev.op.parts?.length })
            if (ev.op.op === 'define' && !gg.kind) gg.kind = ev.op.kind
          } else if (ev.t === 'done') {
            push({ type: 'intent_done', ms: ev.ms, firstOpMs: ev.firstOpMs, model: ev.model })
          }
        } else if (ev.t === 'stage') {
          push({ type: 'forge_stage', stage: ev.stage })
        } else if (ev.t === 'parts') {
          push({ type: 'forge_parts', n: ev.parts.length })
        } else if (ev.t === 'done') {
          push({ type: 'forge_done', ok: ev.ok, n: ev.parts?.length, usd: ev.usd, reason: ev.reason, firstPartMs: ev.firstPartMs, ms: ev.ms, refMs: ev.refMs })
        }
      }).catch(() => {})
    } else {
      new Response(b).json().then(j => push({ type: path === '/api/forge/polish' ? 'polish_done' : 'judge_done', ok: j.ok, polishWins: j.polishWins, usd: j.usd, why: j.why ?? j.reason, n: j.parts?.length })).catch(() => {})
    }
    return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers })
  }
  let last = ''
  const tick = () => {
    try {
      const vw = window.__voiceWorld
      const r = vw?.renderer?.()
      if (r && gg.t0 !== null) {
        const job = gg.kind ? r.refining?.get(gg.kind) : null
        const s = { forming: !!r.forming && r.forming.level > 0.02, refining: !!job, added: job?.added ?? 0, queue: job?.queue?.length ?? 0, ghost: job ? Math.round(job.level * 100) / 100 : null }
        const key = JSON.stringify(s)
        if (key !== last) {
          last = key
          gg.samples.push({ t: now(), ...s })
        }
        const el = document.getElementById('__gg_clock')
        if (el) el.textContent = `t+${((now() - gg.t0) / 1000).toFixed(1)}s  ${gg.stage?.() ?? ''}`
      }
    } catch { /* not ready */ }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  gg.stage = () => {
    const ev = gg.events
    const has = t => ev.some(e => e.type === t)
    const lastS = gg.samples[gg.samples.length - 1]
    const fd = ev.find(e => e.type === 'forge_done')
    if (ev.some(e => e.type === 'polish_done') && !ev.some(e => e.type === 'judge_done')) return 'judging polish'
    if (ev.some(e => e.type === 'judge_done')) return 'polish judged'
    if (ev.some(e => e.type === 'req' && e.path === '/api/forge/polish')) return 'refined · polishing (background)'
    if (fd) return now() - fd.t < SWEEP + 400 ? 'swap sweep' : 'settled'
    if (lastS?.refining) return `refining · ${lastS.added} parts on screen`
    if (ev.some(e => e.type === 'op' && e.op === 'define')) return has('intent_done') ? 'draft · forge starting' : 'draft'
    if (ev.some(e => e.type === 'op' && e.op === 'spawn')) return 'stand-in blob'
    return lastS?.forming ? 'thinking · motes' : 'thinking'
  }
  const SWEEP = 1800
}

async function runPrompt(browser, p) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: resolve(outDir, '.raw'), size: { width: W, height: H } } } : {}) })
  const wall0 = Date.now()
  await ctx.addInitScript(instrument)
  const page = await ctx.newPage()
  const errors = []
  page.on('console', m => m.type() === 'error' && errors.push(m.text().slice(0, 300)))
  page.on('pageerror', e => errors.push(`pageerror: ${e.message.slice(0, 300)}`))
  const u = new URL(url)
  u.searchParams.set('fresh', '1')
  await page.goto(u.href, { waitUntil: 'networkidle' })
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 90000 })
  await page.waitForFunction(() => !!globalThis.__kitWarmed, null, { timeout: 60000 }).catch(() => {})
  await page.evaluate(() => {
    document.querySelectorAll('[id^="nuxt-devtools"], nuxt-devtools-anchor').forEach(e => e.remove())
    window.__voiceWorld.look(0, -0.12, [0, 0])
    const d = document.createElement('div')
    d.id = '__gg_clock'
    d.style.cssText = 'position:fixed;left:12px;bottom:10px;z-index:99999;font:600 13px ui-monospace,Menlo,monospace;color:#fff;background:rgba(0,0,0,.55);padding:3px 8px;border-radius:6px;pointer-events:none'
    document.body.appendChild(d)
  })
  const fresh = await page.evaluate(() => window.__fresh?.() ?? null)
  await page.waitForTimeout(1500)
  // Frame tracer for fps.
  await page.evaluate(() => {
    window.__frames = []
    let last = performance.now()
    const tick = (t) => {
      window.__frames.push([t, t - last])
      last = t
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const field = page.locator('input[data-intent-input], [data-intent-input] input').first()
  await page.mouse.move(W / 2, H / 2 - 160)
  await page.keyboard.press('/')
  await field.focus().catch(() => {})
  await page.keyboard.type(p.text, { delay: 12 })
  const enterWall = Date.now()
  await page.evaluate(() => {
    window.__gg.t0 = performance.now()
  })
  await page.keyboard.press('Enter')
  const t0 = await page.evaluate(() => window.__gg.t0)
  const since = () => page.evaluate(t => performance.now() - t, t0)
  const gg = () => page.evaluate(() => ({ events: window.__gg.events, samples: window.__gg.samples, kind: window.__gg.kind }))
  const stills = {}
  const still = async (label) => {
    const file = `${p.id}_${label}.jpg`
    await page.evaluate(() => {
      const el = document.getElementById('__gg_clock')
      if (el) el.style.visibility = 'hidden'
    })
    await page.screenshot({ path: resolve(outDir, 'stills', file), type: 'jpeg', quality: 80 })
    await page.evaluate(() => {
      const el = document.getElementById('__gg_clock')
      if (el) el.style.visibility = 'visible'
    })
    stills[label] = `stills/${file}`
  }

  // Poll: draft still, mid-refine still, then the outcome (and the hero polish verdict).
  const deadline = Date.now() + 240000
  let draftShot = false
  let midShot = false
  let doneAt = null
  for (;;) {
    await page.waitForTimeout(100)
    const s = await page.evaluate(() => {
      const g = window.__gg
      const rec = (window.__forge?.log ?? []).find(r => r.kind === g.kind)
      const last = g.samples[g.samples.length - 1]
      return { define: g.events.find(e => e.type === 'op' && e.op === 'define')?.t, intentDone: g.events.some(e => e.type === 'intent_done'), outcome: rec?.outcome, forged: !!rec, added: last?.added ?? 0, firstPartAt: g.samples.find(x => x.added > 0)?.t }
    })
    const t = await since()
    if (s.define && !draftShot && t > s.define - t0 + 700) {
      draftShot = true
      await still('1_draft')
    }
    if (s.firstPartAt && !midShot && t > s.firstPartAt - t0 + 3000 && !s.outcome) {
      midShot = true
      await still('2_refining')
    }
    if (s.intentDone && !s.define && t > 6000) break // nothing was defined (kit / no forge)
    if (s.intentDone && s.define && !s.forged && t > 15000) break // defined but never forged
    if (s.outcome && s.outcome !== 'refined; polishing') {
      doneAt ??= Date.now()
      if (Date.now() - doneAt > SWEEP_MS + 1200) break
    }
    if (Date.now() > deadline) break
  }
  await still('3_final')
  const tl = await gg()
  const rec = await page.evaluate(k => (window.__forge?.log ?? []).find(r => r.kind === k) ?? null, tl.kind)
  const fpsAll = await page.evaluate((a) => {
    const f = window.__frames.filter(([t]) => t >= a)
    if (f.length < 2) return null
    const span = (f[f.length - 1][0] - f[0][0]) / 1000
    return { avg: Math.round(f.length / span), worstGapMs: Math.round(Math.max(...f.map(x => x[1]))) }
  }, t0)
  const census = await page.evaluate(() => {
    const s = window.__voiceWorld.state()
    return s.entities.map(e => `${e.kind}${s.kinds[e.kind]?.quality ? `(${s.kinds[e.kind].quality})` : ''}`).slice(0, 12)
  })
  const vid = page.video()
  await ctx.close()

  // ---- derive timings ----
  const rel = t => (t === undefined || t === null ? null : Math.round(t - t0))
  const ev = tl.events
  const first = pred => ev.find(pred)?.t
  const finalN = ev.find(e => e.type === 'forge_done' && e.ok)?.n ?? null
  const timings = {
    firstOp: rel(first(e => e.type === 'op')),
    standIn: rel(first(e => e.type === 'op' && e.op === 'spawn' && e.kind === tl.kind)),
    draft: rel(first(e => e.type === 'op' && e.op === 'define')),
    intentDone: rel(first(e => e.type === 'intent_done')),
    refineStart: rel(tl.samples.find(s => s.refining)?.t),
    firstPart: rel(tl.samples.find(s => s.added > 0)?.t),
    recognizable: finalN ? rel(tl.samples.find(s => s.added >= finalN * 0.5)?.t) : null,
    streamEnd: rel(first(e => e.type === 'forge_done')),
    swap: rec?.refinedMs ?? null,
    polishVerdict: rec?.polishMs ?? null
  }
  const polished = /^polished/.test(rec?.outcome ?? '')
  timings.settled = timings.swap !== null ? (polished && timings.polishVerdict ? timings.polishVerdict : timings.swap) + SWEEP_MS : timings.draft !== null ? timings.draft + 520 : null
  const draftParts = ev.find(e => e.type === 'op' && e.op === 'define')?.parts ?? null
  const forgeUsd = rec ? Math.round(rec.usd * 10000) / 10000 : 0
  const intentCalls = ev.filter(e => e.type === 'req' && e.path === '/api/intent').length

  // ---- video: trim to LEAD_S before Enter, mp4 ----
  let videoPath = null
  let videoMB = null
  if (vid) {
    const raw = await vid.path()
    const webm = resolve(outDir, '.raw', `${p.id}.webm`)
    if (existsSync(raw)) renameSync(raw, webm)
    const ss = Math.max(0, (enterWall - wall0) / 1000 - LEAD_S)
    if (hasFfmpeg) {
      const mp4 = resolve(outDir, 'videos', `${p.id}.mp4`)
      try {
        execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', ss.toFixed(2), '-i', webm, '-vf', 'scale=960:-2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4])
        videoPath = `videos/${p.id}.mp4`
        videoMB = Math.round(statSync(mp4).size / 1e5) / 10
        rmSync(webm)
      } catch (e) {
        console.warn('  ffmpeg failed:', e.message)
      }
    }
    if (!videoPath) {
      const dst = resolve(outDir, 'videos', `${p.id}.webm`)
      renameSync(webm, dst)
      videoPath = `videos/${p.id}.webm`
      videoMB = Math.round(statSync(dst).size / 1e5) / 10
    }
  }
  return {
    id: p.id, axis: p.axis, text: p.text, fresh, kind: tl.kind, tier: rec?.tier ?? null, outcome: rec?.outcome ?? (tl.kind ? 'not forged' : 'nothing defined'),
    draftParts, finalParts: rec?.parts ?? null, timings, usd: { forge: forgeUsd, intentEst: Math.round(intentCalls * INTENT_USD_EST * 10000) / 10000, total: Math.round((forgeUsd + intentCalls * INTENT_USD_EST) * 10000) / 10000 },
    fps: fpsAll, census, stills, video: videoPath, videoMB, videoLeadS: LEAD_S, errors: [...new Set(errors)].slice(0, 8),
    timeline: ev.map(e => ({ ...e, t: rel(e.t) })), samples: tl.samples.map(s => ({ ...s, t: rel(s.t) }))
  }
}

const c0 = await credits()
const l0 = ledgerTotal()
const runT0 = Date.now()
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-webgpu', '--autoplay-policy=no-user-gesture-required'] })
const results = []
// `--only` reruns merge into the loop's existing timings.json (same prompt order), keeping the other prompts.
const prior = only.length && existsSync(resolve(outDir, 'timings.json')) ? JSON.parse(readFileSync(resolve(outDir, 'timings.json'), 'utf8')) : null
const ALL_IDS = JSON.parse(readFileSync(promptsFile, 'utf8')).prompts.map(p => p.id)
const mergeResults = () => (prior ? ALL_IDS.map(id => results.find(r => r.id === id) ?? prior.results?.find(r => r.id === id)).filter(Boolean) : results)
for (const [i, p] of PROMPTS.entries()) {
  console.log(`\n[${i + 1}/${PROMPTS.length}] ${p.id}: “${p.text}”`)
  try {
    // One retry: a page that never boots (dev server busy rebuilding) is not a generation result.
    const r = await runPrompt(browser, p).catch((e) => {
      console.log(`  retrying after: ${e.message}`)
      return runPrompt(browser, p)
    })
    results.push(r)
    const t = r.timings
    console.log(`  ${r.kind} ${r.tier ?? '-'} · ${r.outcome} · draft ${t.draft} · refine ${t.refineStart} · first part ${t.firstPart} · recognizable ${t.recognizable} · swap ${t.swap} · settled ${t.settled} ms · parts ${r.draftParts}→${r.finalParts} · $${r.usd.total} · ${r.videoMB} MB`)
  } catch (e) {
    console.log('  failed:', e.message)
    results.push({ id: p.id, axis: p.axis, text: p.text, error: e.message })
  }
  writeFileSync(resolve(outDir, 'timings.json'), JSON.stringify({ ...(prior ?? {}), loop, url, startedAt: prior?.startedAt ?? new Date(runT0).toISOString(), results: mergeResults() }, null, 1))
}
await browser.close()
rmSync(resolve(outDir, '.raw'), { recursive: true, force: true })
await new Promise(r => setTimeout(r, 15000)) // let the gateway's credit counter catch up
const c1 = await credits()
const l1 = ledgerTotal()
const merged = mergeResults()
const out = {
  loop, url, startedAt: prior?.startedAt ?? new Date(runT0).toISOString(), minutes: Math.round((Date.now() - runT0) / 6000) / 10,
  cost: {
    trackedUsd: Math.round(merged.reduce((s, r) => s + (r.usd?.total ?? 0), 0) * 10000) / 10000,
    forgeLedgerDeltaUsd: Math.round((l1 - l0) * 10000) / 10000,
    forgeLedgerTotalUsd: Math.round(l1 * 100) / 100,
    gatewayUsedDeltaUsd: c0 && c1 ? Math.round((c1.used - c0.used) * 10000) / 10000 : null,
    gatewayBalanceUsd: c1?.balance ?? null,
    note: 'gatewayUsedDelta is account-wide (any other use of the account in the window counts too) and can lag a few minutes.',
    ...(prior ? { reruns: [...(prior.cost?.reruns ?? []), { ids: only, at: new Date(runT0).toISOString() }], forgeLedgerDeltaUsd: Math.round(((prior.cost?.forgeLedgerDeltaUsd ?? 0) + (l1 - l0)) * 10000) / 10000, gatewayUsedDeltaUsd: c0 && c1 && prior.cost?.gatewayUsedDeltaUsd !== null ? Math.round(((prior.cost?.gatewayUsedDeltaUsd ?? 0) + (c1.used - c0.used)) * 10000) / 10000 : null } : {})
  },
  results: merged
}
writeFileSync(resolve(outDir, 'timings.json'), JSON.stringify(out, null, 1))
writeIndex(out)
console.log(`\ndone in ${out.minutes} min · tracked $${out.cost.trackedUsd} · forge ledger +$${out.cost.forgeLedgerDeltaUsd} · gateway +$${out.cost.gatewayUsedDeltaUsd} · ${outDir}`)

// ---------- the review page ----------
function writeIndex(data) {
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
  const sec = ms => (ms === null || ms === undefined ? '–' : `${(ms / 1000).toFixed(1)} s`)
  const rows = data.results.filter(r => !r.error)
  const avg = (k) => {
    const v = rows.map(r => r.timings?.[k]).filter(x => typeof x === 'number')
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const KEYS = [['draft', 'draft (first object px)'], ['refineStart', 'ghost starts'], ['firstPart', 'first refined part'], ['recognizable', '50% of final parts'], ['swap', 'swap'], ['settled', 'settled']]
  const cards = data.results.map((r) => {
    if (r.error) return `<article class="card"><h2>${esc(r.id)}</h2><p class="err">${esc(r.error)}</p></article>`
    const t = r.timings
    const media = r.video
      ? `<video src="${esc(r.video)}" controls muted loop playsinline preload="metadata" poster="${esc(r.stills?.['3_final'] ?? '')}"></video>`
      : `<img src="${esc(r.stills?.['3_final'] ?? '')}" alt="">`
    const strip = ['1_draft', '2_refining', '3_final'].filter(k => r.stills?.[k]).map(k => `<a href="${esc(r.stills[k])}"><img src="${esc(r.stills[k])}" alt="${k}" title="${k}"></a>`).join('')
    return `<article class="card">
  <h2>${esc(r.id)} <span class="axis">${esc(r.axis)}</span></h2>
  <p class="said">“${esc(r.text)}”</p>
  ${media}
  <div class="strip">${strip}</div>
  <dl>${KEYS.map(([k, l]) => `<div><dt>${l}</dt><dd>${sec(t[k])}</dd></div>`).join('')}
  <div><dt>parts</dt><dd>${r.draftParts ?? '–'} → ${r.finalParts ?? '–'}</dd></div>
  <div><dt>tier · $</dt><dd>${esc(r.tier ?? '–')} · $${(r.usd?.total ?? 0).toFixed(3)}</dd></div></dl>
  <p class="outcome">${esc(r.kind)} · ${esc(r.outcome)}${r.fps ? ` · ${r.fps.avg} fps, worst gap ${r.fps.worstGapMs} ms` : ''}</p>
  <p class="note">Video starts ${r.videoLeadS ?? 2} s before Enter; the corner clock is the harness overlay.</p>
</article>`
  }).join('\n')
  const table = `<table><thead><tr><th>prompt</th><th>tier</th>${KEYS.map(([, l]) => `<th>${l}</th>`).join('')}<th>parts</th><th>$</th><th>outcome</th></tr></thead><tbody>
${rows.map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.tier ?? '–')}</td>${KEYS.map(([k]) => `<td>${sec(r.timings[k])}</td>`).join('')}<td>${r.draftParts ?? '–'}→${r.finalParts ?? '–'}</td><td>${(r.usd?.total ?? 0).toFixed(3)}</td><td>${esc(r.outcome)}</td></tr>`).join('\n')}
<tr class="avg"><td>mean</td><td></td>${KEYS.map(([k]) => `<td>${sec(avg(k))}</td>`).join('')}<td></td><td>${rows.reduce((s, r) => s + (r.usd?.total ?? 0), 0).toFixed(3)}</td><td></td></tr>
</tbody></table>`
  const c = data.cost
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gen Gauntlet ${esc(data.loop)}</title>
<style>
:root{--bg:#f6f5f2;--fg:#1d1c1a;--muted:#6b6862;--card:#fff;--line:#e3e0da;--accent:#b7791f}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#151514;--fg:#ecebe8;--muted:#9a978f;--card:#1f1f1d;--line:#33322f;--accent:#e0a84a}}
:root[data-theme="dark"]{--bg:#151514;--fg:#ecebe8;--muted:#9a978f;--card:#1f1f1d;--line:#33322f;--accent:#e0a84a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,sans-serif;padding:24px 16px}
main{max-width:1500px;margin:0 auto}h1{margin:0 0 4px;font-size:22px}.sub{color:var(--muted);margin:0 0 18px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}
@media (max-width:480px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px}
.card h2{font-size:16px;margin:0}.axis{font-weight:400;color:var(--muted);font-size:13px}.said{margin:2px 0 8px;color:var(--muted)}
video,.card>img{width:100%;border-radius:6px;background:#000;display:block}
.strip{display:flex;gap:4px;margin-top:6px}.strip img{width:100%;border-radius:4px;display:block}.strip a{flex:1}
dl{display:grid;grid-template-columns:repeat(4,1fr);gap:6px 10px;margin:10px 0 6px}dl div{min-width:0}dt{color:var(--muted);font-size:11px}dd{margin:0;font-weight:600;font-variant-numeric:tabular-nums}
.outcome,.note{color:var(--muted);font-size:12px;margin:2px 0}.err{color:#c0392b}
.tablewrap{overflow-x:auto;margin:22px 0}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}
th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;white-space:nowrap}th{color:var(--muted);font-weight:500}tr.avg td{font-weight:700}
</style></head><body><main>
<h1>Generation gauntlet · ${esc(data.loop)}</h1>
<p class="sub">${esc(data.startedAt ?? '')} · ${rows.length} prompts, each in a fresh world with <code>?fresh=1</code> · times are from pressing Enter${c ? ` · tracked $${c.trackedUsd} (forge ledger +$${c.forgeLedgerDeltaUsd}${c.gatewayUsedDeltaUsd !== null ? `, gateway account +$${c.gatewayUsedDeltaUsd}` : ''})` : ''}</p>
<div class="tablewrap">${table}</div>
<div class="grid">
${cards}
</div>
</main></body></html>`
  writeFileSync(resolve(outDir, 'index.html'), html)
}
