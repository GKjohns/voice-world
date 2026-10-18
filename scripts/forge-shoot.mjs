// Progressive-generation (forge) check: real model wishes in headless Chromium on the real GPU.
// Usage: node scripts/forge-shoot.mjs [--out dir] [--only word] [--smoke]
// For each wish: clear, ask through the real intent model, then watch the forge (window.__forge): shoot the
// draft as the ghost begins and the refined version after its sweep; a rAF tracer logs frame gaps from
// the refine start to 2 s after the swap. Prints proxy / draft / first refined part / refined / polish
// times, $ per object and fps (avg, worst 1 s window, worst gap).
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, resolve } from 'node:path'

const args = process.argv.slice(2)
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d)
const outDir = resolve(opt('--out', resolve(tmpdir(), 'conjure-forge-shots')))
const only = opt('--only', '')
mkdirSync(outDir, { recursive: true })
const WISHES = [
  'a steampunk airship',
  'an intricate carousel',
  'a giant ornate fountain',
  'a vintage motorcycle',
  'a lighthouse made of glass',
  'a treehouse village'
].filter(w => !only || w.includes(only))

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-webgpu'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
  if (m.type() === 'error' || m.text().startsWith('[forge]')) console.log('[browser]', m.type(), m.text().slice(0, 300))
})
page.on('pageerror', (e) => {
  errors.push(e.message)
  console.log('[pageerror]', e.message)
})
await page.goto('http://localhost:3091/', { waitUntil: 'networkidle' })
await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 })
await page.waitForFunction(() => !!globalThis.__kitWarmed, null, { timeout: 60000 }).catch(() => {})
await page.evaluate(() => document.querySelectorAll('[id^="nuxt-devtools"], nuxt-devtools-anchor').forEach(e => e.remove()))
if (args.includes('--smoke')) {
  console.log('smoke ok, errors:', errors.length)
  await browser.close()
  process.exit(0)
}
// The frame tracer: every rAF gap, stamped.
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
const wait = ms => page.waitForTimeout(ms)
const fps = async (from, to) => page.evaluate(([a, b]) => {
  const f = window.__frames.filter(([t]) => t >= a && t <= b)
  if (f.length < 2) return null
  const gaps = f.map(x => x[1])
  const span = (f[f.length - 1][0] - f[0][0]) / 1000
  let min1 = Infinity
  for (let s = a; s + 1000 <= b; s += 250) min1 = Math.min(min1, f.filter(([t]) => t >= s && t < s + 1000).length)
  return { avg: Math.round(f.length / span), min1: min1 === Infinity ? null : min1, gap: Math.round(Math.max(...gaps)) }
}, [from, to])

const results = []
for (const [i, wish] of WISHES.entries()) {
  const slug = wish.replace(/\W+/g, '_').replace(/^_|_$/g, '')
  await page.evaluate(() => {
    window.__conjure.clear()
    window.__conjure.run([{ op: 'atmosphere', time: 'day' }], 'day')
    window.__conjure.look(0, -0.22, [0, 0])
  })
  await wait(1500)
  const n0 = await page.evaluate(() => window.__forge?.log?.length ?? 0)
  const t0 = await page.evaluate(() => performance.now())
  const out = await page.evaluate(w => window.__conjure.ask(w).then(o => ({ summary: o.summary, model: o.model, ms: o.ms, ops: o.ops.map(x => x.op === 'spawn' ? `spawn ${x.kind}×${x.count ?? 1}` : x.op === 'define' ? `define ${x.kind}(${x.parts.length})` : x.op) })), wish)
  console.log(`\n[${i + 1}] “${wish}” → ${out.summary} · ${out.ops.join(', ')} · ${out.ms} ms`)
  // Did a forge start?
  const started = await page.waitForFunction(n => (window.__forge?.log?.length ?? 0) > n, n0, { timeout: 4000 }).then(() => true).catch(() => false)
  if (!started) {
    console.log('  no forge (kit, crowd, teleport or no define)')
    await page.screenshot({ path: resolve(outDir, `${String(i + 1).padStart(2, '0')}_${slug}_noforge.png`) })
    results.push({ wish, forged: false, summary: out.summary })
    continue
  }
  await page.waitForFunction(n => window.__forge.log[n]?.startMs !== undefined || window.__forge.log[n]?.outcome, n0, { timeout: 15000 }).catch(() => {})
  await wait(250)
  const draftShot = resolve(outDir, `${String(i + 1).padStart(2, '0')}_${slug}_a_draft.png`)
  await page.screenshot({ path: draftShot })
  const tStart = await page.evaluate(() => performance.now())
  // The refine ends (refined, kept draft, or library).
  await page.waitForFunction(n => !!window.__forge.log[n]?.outcome, n0, { timeout: 90000 }).catch(() => {})
  const midRec = await page.evaluate(n => window.__forge.log[n], n0)
  await wait(SWEEP_WAIT())
  const tSwap = await page.evaluate(() => performance.now())
  const refinedShot = resolve(outDir, `${String(i + 1).padStart(2, '0')}_${slug}_b_refined.png`)
  await page.screenshot({ path: refinedShot })
  const swapFps = await fps(tStart, tSwap)
  let rec = midRec
  let polishShot
  if (midRec?.outcome === 'refined; polishing') {
    await page.waitForFunction(n => window.__forge.log[n]?.outcome !== 'refined; polishing', n0, { timeout: 180000 }).catch(() => {})
    await wait(2600)
    rec = await page.evaluate(n => window.__forge.log[n], n0)
    if (/^polished/.test(rec.outcome)) {
      polishShot = resolve(outDir, `${String(i + 1).padStart(2, '0')}_${slug}_c_polished.png`)
      await page.screenshot({ path: polishShot })
    }
  }
  const all = await fps(t0, await page.evaluate(() => performance.now()))
  const row = { wish, kind: rec.kind, tier: rec.tier, outcome: rec.outcome, proxyMs: rec.proxyMs, draftMs: rec.draftMs, startMs: rec.startMs, firstPartMs: rec.firstPartMs, refinedMs: rec.refinedMs, polishMs: rec.polishMs, usd: +rec.usd.toFixed(4), parts: rec.parts, library: !!rec.library, swapFps, allFps: all, shots: [draftShot, refinedShot, polishShot].filter(Boolean).map(p => basename(p)) }
  results.push(row)
  console.log(' ', JSON.stringify(row))
}
function SWEEP_WAIT() {
  return 2600
}
const status = await page.evaluate(s => fetch(`/api/forge/status?session=${s}`).then(r => r.json()), await page.evaluate(() => window.__forge?.session))
console.log('\nforge spend this session', JSON.stringify(status), 'page errors', errors.length)
writeFileSync(resolve(outDir, 'results.json'), JSON.stringify({ results, status, errors }, null, 1))
await browser.close()
