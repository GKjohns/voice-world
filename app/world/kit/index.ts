// The kit registry: kind → builder. Descriptors (tags, footprint, defaults) live in shared/world/kinds.ts.
import { blob } from './blob'
import { house, tower } from './buildings'
import { car, storefront } from './city'
import { chair, table } from './furniture'
import type { Build } from './helpers'
import { bar_counter, bookshelf, ceiling, cue_rack, fireplace, floor, hanging_lamp, jukebox, neon_sign, pool_table, potted_plant, rug, sofa, stool, wall, windowPane } from './interior'
import { dust_motes, embers, fireflies } from './life'
import { bush, oak, pine, rock } from './nature'
import { boat, campfire, dock, reeds, shore, tent, water } from './outdoor'
import { bird, lantern } from './sky'
import { bench, fence, lamp, road } from './street'
import { canyon, cliff, giant_moon, hill, island, mountain, mountain_range, planet, river, volcano, waterfall } from './terrain'

export const KIT_BUILDERS: Record<string, Build> = {
  house, tower, pine, oak, rock, bush, road, lamp, bench, fence, table, chair,
  floor, wall, ceiling, window: windowPane, rug, pool_table, hanging_lamp, bar_counter, stool, jukebox, neon_sign, sofa, bookshelf, fireplace, cue_rack, potted_plant,
  water, shore, dock, boat, campfire, tent, reeds,
  storefront, car,
  fireflies, dust_motes, embers,
  lantern, bird,
  mountain, mountain_range, hill, cliff, volcano, waterfall, river, island, canyon, giant_moon, planet
}

/** Kinds whose build reads props.color (particles have no slotted meshes), so a colour change rebuilds them. */
export const BUILD_READS_COLOR = new Set(['fireflies', 'dust_motes', 'embers'])
export { blob }
export type { Build }
