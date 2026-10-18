/** POST /api/forge/polish { kind, text, parts, code?, image?, session } → { ok, parts?, code?, usd, ms, reason? } (hero only, background). */
import { forgePolish } from '../../utils/forge'
import { bodyKind, bodyParts, bodySession, bodyStr } from '../../utils/forgeHttp'
import { ensureKey } from '../../utils/gatewayKey'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const kind = bodyKind(body?.kind)
  const text = bodyStr(body?.text, 200)
  const parts = bodyParts(body?.parts)
  if (!kind || !text || !parts.length) throw createError({ statusCode: 400, statusMessage: 'kind, text and parts are required' })
  ensureKey(event)
  const ctrl = new AbortController()
  event.node.req.on('close', () => ctrl.abort(new Error('client closed')))
  const res = await forgePolish({ kind, text, parts, code: bodyStr(body.code, 40_000) || undefined, image: typeof body.image === 'string' ? body.image : undefined, session: bodySession(body.session), signal: ctrl.signal })
  console.info(`[forge] polish ${kind} ${res.ok ? `ok ${res.parts?.length} parts` : `failed (${res.reason})`} · ${res.ms} ms · $${res.usd.toFixed(4)}`)
  return res
})
