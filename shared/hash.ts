/** 0..1 from an id and a salt (FNV-1a, lightly mixed): the same person always gets the same pick. */
export function hash01(id: string, salt: string): number {
  let h = 2166136261
  for (const ch of id + salt) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296
}
