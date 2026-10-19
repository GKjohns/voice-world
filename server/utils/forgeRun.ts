/**
 * The forge's program runner. A model writes a tiny JS program against the primitive API (box, tube,
 * lathe…, conjure-progressive's `code` approach); it runs HERE, on the server, in `node:vm`, and only the
 * plain part data it produced leaves. The client never executes model code.
 *
 * The sandbox:
 * - a fresh context per run whose global has a null prototype (no `this.constructor` route back to the
 *   host realm) and with string code generation and wasm turned off (no eval / new Function inside);
 * - the API is defined INSIDE the context, so no host function object is reachable from model code;
 * - results come out as one JSON string (copied field by field, arrays truncated), then are cleaned
 *   strictly (`programParts`);
 * - a hard timeout per run (catches `for(;;)`) and a part cap enforced inside;
 * - a lexical deny-list: no async, promises, reflection or dynamic import words at all (a geometry
 *   program never needs them; this also keeps microtasks, which escape the vm timeout, out entirely);
 * - Math.random is a seeded PRNG, so re-running a growing prefix yields the same parts.
 * Not covered: memory (a program can still allocate a large array before the timeout); runs are short.
 */
import vm from 'node:vm'
import { HQ_MAX_PARTS, programParts } from '../../shared/world/forge.ts'
import type { Part } from '../../shared/world/ops.ts'

const PRELUDE = `'use strict';
const __out = [];
let __err = null;
const __cap = __CAP__;
const __v = (a, n) => Array.isArray(a) ? a.slice(0, n).map(x => Array.isArray(x) ? x.slice(0, 3) : x) : a;
function part(p) {
  if (__out.length >= __cap) throw new Error('part cap reached');
  if (!p || typeof p !== 'object') return p;
  __out.push({ shape: p.shape, size: __v(p.size, 3), at: __v(p.at, 3), rot: __v(p.rot, 3), color: typeof p.color === 'string' ? p.color.slice(0, 32) : p.color,
    slot: p.slot, material: p.material, mirror: p.mirror, glow: p.glow, points: __v(p.points, 16), radii: Array.isArray(p.radii) ? p.radii.slice(0, 16) : p.radii,
    profile: __v(p.profile, 32), outline: __v(p.outline, 32), depth: p.depth });
  return p;
}
// Gen loop 4: compact options. A flag string (or an object's f field): m mirror, p/t/g slot primary/trim/glow,
// z lay along z, x lay along x, W wood, M metal, G glass, S stone, A matte. Fewer output tokens per part.
const __flags = (f, o) => {
  if (typeof f !== 'string') return o;
  for (const c of f.slice(0, 12)) {
    if (c === 'm') o.mirror = true;
    else if (c === 'p') o.slot = 'primary';
    else if (c === 't') o.slot = 'trim';
    else if (c === 'g') o.slot = 'glow';
    else if (c === 'z' && !o.rot) o.rot = [Math.PI / 2, 0, 0];
    else if (c === 'x' && !o.rot) o.rot = [0, 0, Math.PI / 2];
    else if (c === 'W') o.material = 'wood';
    else if (c === 'M') o.material = 'metal';
    else if (c === 'G') o.material = 'glass';
    else if (c === 'S') o.material = 'stone';
    else if (c === 'A') o.material = 'matte';
  }
  return o;
};
const __o = o => typeof o === 'string' ? __flags(o, {}) : (o && typeof o === 'object') ? __flags(o.f, Object.assign({}, o)) : {};
const __mk = s => (size, at, color, o) => part(Object.assign({}, __o(o), { shape: s, size, at, color }));
const box = __mk('box'), sphere = __mk('sphere'), cylinder = __mk('cylinder'), cone = __mk('cone'), capsule = __mk('capsule'), torus = __mk('torus');
const tube = (points, radii, color, o) => part(Object.assign({}, __o(o), { shape: 'tube', points, radii, color }));
const lathe = (profile, at, color, o) => part(Object.assign({}, __o(o), { shape: 'lathe', profile, at, color }));
const extrude = (outline, depth, at, color, o) => part(Object.assign({}, __o(o), { shape: 'extrude', outline, depth, at, color }));
const PI = Math.PI;
{ let __s = 1234567; Math.random = () => { __s = (__s * 16807) % 2147483647; return (__s - 1) / 2147483646; }; }
`

export interface RunResult {
  ok: boolean
  /** Raw part records (uncleaned) in call order. */
  raw: unknown[]
  /** The program threw (it still produced the parts before the throw) or failed to run at all. */
  error?: string
  /** It did not even compile (an unfinished prefix while streaming). */
  syntax?: boolean
  timedOut?: boolean
}

/** Remove markdown fences and our own trailer lines; keep the program text. */
export function stripProgram(text: string): string {
  return text.split('\n').filter(l => !/^\s*```/.test(l)).join('\n')
}

const DENY = /\b(async|await|Promise|then|import|require|process|eval|Function|constructor|prototype|__proto__|globalThis|Reflect|Proxy|Symbol|WebAssembly|Atomics|SharedArrayBuffer|setTimeout|setInterval|queueMicrotask|__out|__err|__cap)\b/

/** Run one program in a fresh sandbox. Never throws. */
export function runProgram(code: string, opts: { timeoutMs?: number, cap?: number } = {}): RunResult {
  const banned = stripProgram(code).replace(/\/\/.*$/gm, '').match(DENY)
  if (banned) return { ok: false, raw: [], error: `not allowed in a forge program: ${banned[1]}` }
  const cap = Math.max(1, Math.min(HQ_MAX_PARTS, opts.cap ?? HQ_MAX_PARTS))
  const src = `${PRELUDE.replace('__CAP__', String(cap))}
try { (function () {
${stripProgram(code)}
})(); } catch (e) { __err = String((e && e.message) || e).slice(0, 200); }
(() => { try { return JSON.stringify({ parts: __out, err: __err }); } catch (e) { return JSON.stringify({ parts: [], err: 'unserialisable parts' }); } })()`
  let script: vm.Script
  try {
    script = new vm.Script(src, { filename: 'forge-program.js' })
  } catch (err) {
    return { ok: false, raw: [], error: String((err as Error).message).slice(0, 200), syntax: true }
  }
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } })
  let out: unknown
  try {
    out = script.runInContext(ctx, { timeout: opts.timeoutMs ?? 50, breakOnSigint: false })
  } catch (err) {
    const msg = String((err as Error)?.message ?? err)
    return { ok: false, raw: [], error: msg.slice(0, 200), timedOut: /timed out/i.test(msg) }
  }
  if (typeof out !== 'string' || out.length > 2_000_000) return { ok: false, raw: [], error: 'no result' }
  try {
    const res = JSON.parse(out) as { parts?: unknown, err?: unknown }
    const raw = Array.isArray(res.parts) ? res.parts : []
    const error = typeof res.err === 'string' ? res.err : undefined
    // Hitting the part cap is a finished object, not a failure: keep the first HQ_MAX_PARTS.
    return { ok: !error || error === 'part cap reached', raw, error }
  } catch {
    return { ok: false, raw: [], error: 'unreadable result' }
  }
}

/** Run a program and return clean, mirror-expanded parts. */
export function programToParts(code: string, opts: { timeoutMs?: number, cap?: number } = {}): { parts: Part[], run: RunResult } {
  const run = runProgram(code, opts)
  return { parts: programParts(run.raw, opts.cap ?? HQ_MAX_PARTS), run }
}

/**
 * The streaming side: feed it text deltas as the model writes; every time a line closes, the program so
 * far is re-run and only the NEW clean parts come back (the server-side version of progressive's
 * `streamCode`). Prefixes that don't compile yet (a loop still open) are skipped until they do.
 */
export function streamRunner(opts: { timeoutMs?: number, cap?: number } = {}) {
  let text = ''
  let shown = 0
  let ranTo = 0
  const step = (src: string): Part[] => {
    const { parts } = programToParts(src, opts)
    if (parts.length <= shown) return []
    const fresh = parts.slice(shown)
    shown = parts.length
    return fresh
  }
  return {
    push(delta: string): Part[] {
      text += delta
      const nl = text.lastIndexOf('\n')
      if (nl <= ranTo) return []
      ranTo = nl
      return step(text.slice(0, nl))
    },
    /** The end of the stream: run the whole program once more. */
    end(): Part[] {
      return step(text)
    },
    text: () => text,
    count: () => shown
  }
}
