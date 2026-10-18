/**
 * Gauntlet loop 1 (track B): walking never goes through solid things, and never gets stuck. Pure 2D math
 * (no three.js) so tests import it: each obstacle is a circle on the ground (a footprint grown by the
 * player's radius). A step that would end inside one keeps only its tangential part (you slide along it);
 * a step taken from inside one (it landed on you) is always allowed if it leads out.
 */
export interface Circle { x: number, z: number, r: number }

export function slideOut(px: number, pz: number, mx: number, mz: number, circles: Circle[]): [number, number] {
  let ox = mx
  let oz = mz
  for (let pass = 0; pass < 2; pass++) {
    for (const c of circles) {
      const dx0 = px - c.x
      const dz0 = pz - c.z
      const dn = Math.hypot(dx0 + ox, dz0 + oz)
      if (dn >= c.r) continue
      const d0 = Math.hypot(dx0, dz0)
      // Already inside (spawned on top of you): any step that leads out is fine.
      if (d0 < c.r - 0.05 && dn > d0) continue
      const ux = d0 > 1e-4 ? dx0 / d0 : 1
      const uz = d0 > 1e-4 ? dz0 / d0 : 0
      const inward = ox * ux + oz * uz
      if (inward < 0) {
        ox -= inward * ux
        oz -= inward * uz
      }
    }
  }
  return [ox, oz]
}
