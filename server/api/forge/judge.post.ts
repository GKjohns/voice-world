/** POST /api/forge/judge { text, current, polish (data URLs), session } → { polishWins, why, usd, ms } (both A/B orders must agree). */
import { forgeJudge } from '../../utils/forge'
import { bodySession, bodyStr } from '../../utils/forgeHttp'
import { ensureKey } from '../../utils/gatewayKey'

export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event)
  const text = bodyStr(body?.text, 200)
  if (!text || typeof body.current !== 'string' || typeof body.polish !== 'string') throw createError({ statusCode: 400, statusMessage: 'text, current and polish are required' })
  ensureKey(event)
  const res = await forgeJudge({ text, current: body.current, polish: body.polish, session: bodySession(body.session) })
  console.info(`[forge] judge “${text.slice(0, 40)}” polish ${res.polishWins ? 'wins' : 'loses'} (${res.why}) · ${res.ms} ms · $${res.usd.toFixed(4)}`)
  return res
})
