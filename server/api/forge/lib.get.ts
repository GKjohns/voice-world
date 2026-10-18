/** GET /api/forge/lib?kind=&text=&tier= → { hit: true, parts, quality, code? } | { hit: false }. A hero entry serves a good request, not the reverse. */
import { QUALITY_RANK } from '../../../shared/world/forge.ts'
import { libGet } from '../../utils/forgeLedger'
import { bodyKind, bodyStr } from '../../utils/forgeHttp'

export default defineEventHandler((event) => {
  const q = getQuery(event)
  const kind = bodyKind(q.kind)
  if (!kind) return { hit: false }
  const want = q.tier === 'hero' ? 'hero' : 'good'
  const e = libGet(kind, bodyStr(q.text, 200))
  if (!e || QUALITY_RANK[e.quality] < QUALITY_RANK[want]) return { hit: false }
  return { hit: true, parts: e.parts, quality: e.quality, code: e.code }
})
