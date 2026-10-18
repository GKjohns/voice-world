/**
 * The balanced `{…}` / `[…]` that opens at `start` in model text, as a string (strings and escapes
 * respected), or null if it never closes. Callers parse it themselves, so each can choose its repairs.
 */
export function balancedJson(text: string, start: number): string | null {
  if (start < 0) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth++
    else if ((ch === '}' || ch === ']') && --depth === 0) return text.slice(start, i + 1)
  }
  return null
}
