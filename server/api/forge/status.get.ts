/** GET /api/forge/status?session= → forge spend so far (all sessions and this one) and the caps, for the dev HUD. */
import { FORGE_CAP, SESSION_CAP, forgeTotals } from '../../utils/forgeLedger'
import { bodySession } from '../../utils/forgeHttp'

export default defineEventHandler((event) => {
  const t = forgeTotals(bodySession(getQuery(event).session))
  return { total: +t.total.toFixed(4), session: +t.session.toFixed(4), calls: t.calls, cap: FORGE_CAP, sessionCap: SESSION_CAP }
})
