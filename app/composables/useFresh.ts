/**
 * The Fresh switch (shared/world/fresh.ts has what it changes). `?fresh=1` / `?fresh=0` in the URL wins
 * when present (so a recording tool can open http://localhost:3091/?fresh=1); otherwise the last in-app
 * choice, remembered in localStorage. Off by default.
 */
import { shallowRef } from 'vue'
import { parseFreshParam } from '#shared/world/fresh'

const KEY = 'voice-world.fresh'
const fresh = shallowRef(false)
let loaded = false

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  const fromUrl = parseFreshParam(new URLSearchParams(window.location.search).get('fresh'))
  if (fromUrl !== undefined) {
    fresh.value = fromUrl
  } else {
    try {
      fresh.value = localStorage.getItem(KEY) === '1'
    } catch {
      // storage blocked: stays off
    }
  }
  ;(window as unknown as { __fresh?: () => boolean }).__fresh = () => fresh.value
}

function setFresh(on: boolean) {
  fresh.value = on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // not persisted; fine
  }
}

export function useFresh() {
  load()
  return { fresh, setFresh }
}
