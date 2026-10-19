/**
 * Incremental op scanner (Loop 1): feed it streamed model text, get back each element of the FIRST JSON
 * array the moment its object closes. Works for the intent envelope (`{"ops":[{…},{…}]}`) and the
 * Director's bare array (`[{…},{…}]`), ignores prose or code fences around them, and is string/escape
 * aware so a `}` inside a `say` text never closes an op early. Plain module (the bench imports it).
 */
export function opScanner() {
  let buf = ''
  let depth = 0
  /** Depth just inside the ops array (-1 until the first `[` is seen). */
  let base = -1
  let done = false
  let inStr = false
  let esc = false
  let elemStart = -1
  const closed: unknown[] = []
  // partials(): which element it is reading, where its parts array starts, how many parts it has handed out.
  let pElem = -1
  let pFrom = -1
  let pSeen = 0
  let pKind: string | undefined

  return {
    /** Push a chunk; returns the ops that closed in it (already JSON.parsed; unparseable ones are skipped). */
    push(chunk: string): unknown[] {
      const out: unknown[] = []
      if (done) {
        buf += chunk
        return out
      }
      for (const ch of chunk) {
        buf += ch
        if (inStr) {
          if (esc) esc = false
          else if (ch === '\\') esc = true
          else if (ch === '"') inStr = false
          continue
        }
        if (ch === '"') {
          inStr = true
          continue
        }
        if (ch === '[' || ch === '{') {
          if (base < 0 && ch === '[') {
            depth++
            base = depth
            continue
          }
          if (base >= 0 && depth === base && ch === '{') elemStart = buf.length - 1
          depth++
        } else if (ch === ']' || ch === '}') {
          depth--
          if (base >= 0 && depth === base && ch === '}' && elemStart >= 0) {
            try {
              const v = JSON.parse(buf.slice(elemStart)) as unknown
              out.push(v)
              closed.push(v)
            } catch {
              // a malformed element: the end-of-stream recovery may still find it
            }
            elemStart = -1
          } else if (base >= 0 && depth < base) {
            done = true // the ops array closed; anything after is the envelope's tail
          }
        }
      }
      return out
    },
    /**
     * Gen loop 1: the parts of a `define` that is still open, each the moment its object closed. Call after
     * each push; returns only the parts new since the last call (and the define's kind, once it has been
     * written). Empty when no define is open or its `parts` array hasn't started.
     */
    partials(): { kind?: string, parts: unknown[] } {
      if (done || elemStart < 0) return { parts: [] }
      if (elemStart !== pElem) {
        pElem = elemStart
        pSeen = 0
        pFrom = -1
      }
      const s = buf.slice(elemStart)
      if (pFrom < 0) {
        const m = /"parts"\s*:\s*\[/.exec(s)
        if (!m || !/"op"\s*:\s*"define"/.test(s.slice(0, m.index))) return { parts: [] }
        pFrom = m.index + m[0].length
        pKind = /"kind"\s*:\s*"([^"]+)"/.exec(s.slice(0, m.index))?.[1]
      }
      const out: unknown[] = []
      let d = 0
      let str = false
      let e = false
      let start = -1
      let n = 0
      for (let i = pFrom; i < s.length; i++) {
        const ch = s[i]!
        if (str) {
          if (e) e = false
          else if (ch === '\\') e = true
          else if (ch === '"') str = false
          continue
        }
        if (ch === '"') str = true
        else if (ch === '{' || ch === '[') {
          if (d === 0 && ch === '{') start = i
          d++
        } else if (ch === '}' || ch === ']') {
          d--
          if (d < 0) break // the parts array closed
          if (d === 0 && ch === '}' && start >= 0) {
            if (n++ >= pSeen) {
              try {
                out.push(JSON.parse(s.slice(start, i + 1)) as unknown)
              } catch {
                // a malformed part: the define's own validation decides
              }
            }
            start = -1
          }
        }
      }
      pSeen = Math.max(pSeen, n)
      return { kind: pKind, parts: out }
    },
    /** Every op that closed so far, and the whole text (for the end-of-stream recovery). */
    closed,
    text: () => buf
  }
}

/**
 * Recover the full answer from text that may be wrapped in prose or fences: the outermost `{…}` or `[…]`.
 * Returns undefined when nothing parses.
 */
export function parseLooseJson(text: string): unknown {
  const tries: [number, number][] = []
  const o = text.indexOf('{')
  const a = text.indexOf('[')
  if (o >= 0) tries.push([o, text.lastIndexOf('}')])
  if (a >= 0) tries.push([a, text.lastIndexOf(']')])
  tries.sort((x, y) => x[0] - y[0])
  for (const [s, e] of tries) {
    if (s < 0 || e <= s) continue
    try {
      return JSON.parse(text.slice(s, e + 1)) as unknown
    } catch {
      // try the next shape
    }
  }
  return undefined
}
