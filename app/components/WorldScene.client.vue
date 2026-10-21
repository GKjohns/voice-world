<script setup lang="ts">
/**
 * Full-bleed world plus HUD. The renderer is created once on mount and handed to useWorld, which owns
 * the WorldState; the HUD only talks to useWorld.
 */
import { WorldRenderer } from '~/world/renderer'
import { EXAMPLES } from '~/world/examples'
import { useDirector } from '~/composables/useDirector'
import { VIEW_KEY } from '~/composables/useWorld'
import type { Part } from '#shared/world/ops'

const hostEl = useTemplateRef<HTMLDivElement>('host')
const world = useWorld()
const intent = useIntent()
let renderer: WorldRenderer | null = null

// The view survives a reload or a hot re-mount like the world does. Without it a re-mount came back at
// the constructor's default (yaw 0, pitch -0.12) while the restored world kept you tiny on the dock.
function saveView() {
  if (!renderer) return
  const p = renderer.camera.position
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ yaw: renderer.yaw, pitch: renderer.pitch, x: p.x, z: p.z }))
  } catch {
    // Storage blocked: you just start from the default view.
  }
}
function restoreView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as { yaw: number, pitch: number, x: number, z: number } | null
    if (v && [v.yaw, v.pitch, v.x, v.z].every(Number.isFinite) && world.state.value.entities.length) renderer?.look(v.yaw, v.pitch, [v.x, v.z])
  } catch {
    // Nothing saved, or unreadable: keep the default view.
  }
}

onMounted(async () => {
  // Nuxt's client-only wrapper renders a placeholder on the first pass, so the host div lands a tick later.
  await nextTick()
  if (!hostEl.value) return
  renderer = new WorldRenderer(hostEl.value)
  world.attach(renderer)
  useNpc().attach(renderer)
  world.restore()
  restoreView()
  // A handle for the Playwright shoot script (and for poking at the world from devtools).
  const w = window as unknown as Record<string, unknown>
  w.__voiceWorld = {
    run: world.run,
    undo: world.undo,
    clear: world.clear,
    reset: world.reset,
    example: (id: string) => {
      const ex = EXAMPLES.find(e => e.id === id)
      if (!ex) throw new Error(`no example ${id}`)
      return world.run({ ops: ex.ops }, ex.label)
    },
    look: (yaw: number, pitch: number, pos?: [number, number]) => renderer?.look(yaw, pitch, pos),
    state: () => world.state.value,
    // Natural language through the real model, with the gaze snapshot taken now (as the text bar does).
    ask: (text: string) => intent.build(text, intent.capture(), 'text'),
    // Through the router (a person you face answers; world commands go to the genie), as the text field does.
    say: (text: string) => useNpc().say(text, intent.capture(), 'text'),
    phase: () => intent.phase.value,
    lastEntry: () => world.history.value[world.history.value.length - 1],
    // Teleport mode: the Director's current/last run (status, timings, op count).
    director: () => useDirector().current.value,
    renderer: () => renderer,
    // Gen loop 9: replay a saved forged design (gauntlet `<id>_parts.json`) as an upgrade, for free look/framing checks.
    upgrade: (kind: string, parts: Part[], basis: string, quality: 'good' | 'hero' = 'good') => world.upgradeKind(kind, parts, { basis, quality })
  }
  window.addEventListener('keydown', onKey)
  window.addEventListener('pagehide', saveView)
})

onBeforeUnmount(() => {
  saveView()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pagehide', saveView)
  useNpc().detach()
  world.detach()
  renderer?.dispose()
  renderer = null
})

function onKey(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault()
    world.undo()
  }
  // M (mute) lives in HudPresence: a leading M may be the first letter of "make…".
}
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-[#0c0f16] select-none">
    <div
      ref="host"
      class="absolute inset-0"
    />
    <div class="pointer-events-none absolute top-1/2 left-1/2 size-2.5 -translate-1/2 rounded-full border border-white/45 shadow-[0_0_6px_rgba(0,0,0,0.35)]" />
    <HudLayer />
  </div>
</template>
