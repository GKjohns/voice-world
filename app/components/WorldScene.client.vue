<script setup lang="ts">
/**
 * Full-bleed world plus HUD. The renderer is created once on mount and handed to useWorld, which owns
 * the WorldState; the HUD only talks to useWorld.
 */
import { WorldRenderer } from '~/world/renderer'
import { EXAMPLES } from '~/world/examples'
import { useDirector } from '~/composables/useDirector'

const hostEl = useTemplateRef<HTMLDivElement>('host')
const world = useWorld()
const intent = useIntent()
let renderer: WorldRenderer | null = null

onMounted(async () => {
  // Nuxt's client-only wrapper renders a placeholder on the first pass, so the host div lands a tick later.
  await nextTick()
  if (!hostEl.value) return
  renderer = new WorldRenderer(hostEl.value)
  world.attach(renderer)
  world.restore()
  // A handle for the Playwright shoot script (and for poking at the world from devtools).
  const w = window as unknown as Record<string, unknown>
  w.__conjure = {
    run: world.run,
    undo: world.undo,
    clear: world.clear,
    example: (id: string) => {
      const ex = EXAMPLES.find(e => e.id === id)
      if (!ex) throw new Error(`no example ${id}`)
      return world.run({ ops: ex.ops }, ex.label)
    },
    look: (yaw: number, pitch: number, pos?: [number, number]) => renderer?.look(yaw, pitch, pos),
    state: () => world.state.value,
    // Natural language through the real model, with the gaze snapshot taken now (as the text bar does).
    ask: (text: string) => intent.build(text, intent.capture(), 'text'),
    phase: () => intent.phase.value,
    lastEntry: () => world.history.value[world.history.value.length - 1],
    // Teleport mode: the Director's current/last run (status, timings, op count).
    director: () => useDirector().current.value,
    renderer: () => renderer
  }
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
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
  // M mutes the ambient sound bed (Sprint 4).
  if (!e.metaKey && !e.ctrlKey && e.key.toLowerCase() === 'm') renderer?.sound.toggleMute()
}
</script>

<template>
  <div class="fixed inset-0 overflow-hidden bg-[#0c0f16] select-none">
    <div
      ref="host"
      class="absolute inset-0"
    />
    <div class="pointer-events-none absolute top-1/2 left-1/2 size-3.5 -translate-1/2 rounded-full border-[1.5px] border-white/70" />
    <HudStatus />
    <HudLog />
    <HudIntent />
    <HudCamera />
  </div>
</template>
