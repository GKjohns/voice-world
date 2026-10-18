/** POST /api/forge/lib { kind, text, quality, parts, code?, usd?, model? } → { saved, key }. Parts are re-cleaned; a better stored entry is kept. */
import { libPut } from '../../utils/forgeLedger'
import { bodyKind, bodyParts, bodyStr } from '../../utils/forgeHttp'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const kind = bodyKind(body?.kind)
  const quality = body?.quality === 'hero' ? 'hero' : body?.quality === 'good' ? 'good' : null
  if (!kind || !quality) throw createError({ statusCode: 400, statusMessage: 'kind and quality are required' })
  return libPut({ kind, text: bodyStr(body.text, 200), quality, parts: bodyParts(body.parts), code: bodyStr(body.code, 40_000) || undefined, usd: typeof body.usd === 'number' ? body.usd : undefined, model: bodyStr(body.model, 60) || undefined })
})
