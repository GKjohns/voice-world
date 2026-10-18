/**
 * Forge spend guardrails and the cross-session library, both plain files under `.data/forge/` (ported
 * from conjure-progressive's scene ledger, `scene/llm.mjs`). Every forge model call is appended to
 * `ledger.jsonl`; before a call, `canSpend` refuses once the forge total would pass FORGE_CAP or the
 * session's spend would pass SESSION_CAP. The library keeps forged parts (never code that has to run)
 * keyed by the normalised kind, with a wish index beside it, so a repeat wish costs $0.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { QUALITY_RANK, cleanParts, libKey, spendDecision } from '../../shared/world/forge.ts'
import type { Quality } from '../../shared/world/forge.ts'
import type { Part } from '../../shared/world/ops.ts'

export const FORGE_CAP = 12
export const SESSION_CAP = 1.5
/** What a call may cost at most, checked before it starts. */
export const FORGE_ESTIMATE = { good: 0.06, hero: 0.13, polish: 0.05, judge: 0.002 } as const

const DIR = resolve(process.cwd(), '.data/forge')
const LEDGER = resolve(DIR, 'ledger.jsonl')
const LIB = resolve(DIR, 'lib')

function ensure(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

export interface LedgerEntry {
  at?: string
  session: string
  stage: 'ref' | 'refine' | 'polish' | 'judge'
  model: string
  usd: number
  ms: number
  kind?: string
  ok?: boolean
  in?: number
  out?: number
}

/** Totals from the ledger: everything, and one session's share. */
export function forgeTotals(session?: string): { total: number, session: number, calls: number } {
  if (!existsSync(LEDGER)) return { total: 0, session: 0, calls: 0 }
  let total = 0
  let mine = 0
  let calls = 0
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line) continue
    try {
      const e = JSON.parse(line) as LedgerEntry
      const usd = Number(e.usd) || 0
      total += usd
      calls++
      if (session && e.session === session) mine += usd
    } catch {
      // a torn line: skip it
    }
  }
  return { total, session: mine, calls }
}

export function forgeRecord(entry: LedgerEntry): void {
  try {
    ensure(DIR)
    appendFileSync(LEDGER, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)
  } catch (err) {
    console.warn('[forge] ledger write failed', err)
  }
}

export function forgeCanSpend(session: string, estimate: number): { ok: true } | { ok: false, why: string } {
  const t = forgeTotals(session)
  return spendDecision({ total: t.total, session: t.session, estimate, cap: FORGE_CAP, sessionCap: SESSION_CAP })
}

// ---------- the library ----------

export interface LibEntry {
  kind: string
  text: string
  quality: Exclude<Quality, 'draft'>
  parts: Part[]
  code?: string
  model?: string
  usd?: number
  savedAt?: string
}

const file = (key: string) => resolve(LIB, `${key.replace(/[^\w]/g, '_').slice(0, 80)}.json`)
const INDEX = () => resolve(LIB, '_wishes.json')

function readJson<T>(path: string): T | null {
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null
  } catch {
    return null
  }
}

/** A stored forged kind, by its kind name first, then by the wish's words. Parts are re-cleaned on read. */
export function libGet(kind: string, text = ''): LibEntry | null {
  const keys = [libKey(kind)]
  const viaWish = text ? readJson<Record<string, string>>(INDEX())?.[libKey(text)] : undefined
  if (viaWish && !keys.includes(viaWish)) keys.push(viaWish)
  for (const k of keys) {
    const e = readJson<LibEntry>(file(k))
    if (!e) continue
    const parts = cleanParts(e.parts)
    if (parts.length >= 3 && (e.quality === 'good' || e.quality === 'hero')) return { ...e, parts }
  }
  return null
}

/** Save a forged kind unless a better one is already stored. */
export function libPut(entry: LibEntry): { saved: boolean, key: string } {
  const key = libKey(entry.kind)
  const parts = cleanParts(entry.parts)
  if (parts.length < 3 || (entry.quality !== 'good' && entry.quality !== 'hero')) return { saved: false, key }
  const old = readJson<LibEntry>(file(key))
  if (old && QUALITY_RANK[old.quality] > QUALITY_RANK[entry.quality]) return { saved: false, key }
  try {
    ensure(LIB)
    writeFileSync(file(key), JSON.stringify({ ...entry, kind: entry.kind, parts, code: entry.code?.slice(0, 40_000), savedAt: new Date().toISOString() }))
    if (entry.text) {
      const idx = readJson<Record<string, string>>(INDEX()) ?? {}
      idx[libKey(entry.text)] = key
      writeFileSync(INDEX(), JSON.stringify(idx))
    }
    return { saved: true, key }
  } catch (err) {
    console.warn('[forge] library write failed', err)
    return { saved: false, key }
  }
}
