<script setup lang="ts">
/**
 * A person's words, floating by their head: their name, then the line as it's being written (three soft
 * dots while they think). Follows them on screen every frame; pinned to the screen edge when they're off
 * to the side; gone a moment after they finish. Same type and glow as the genie's captions, but warm
 * parchment instead of gold, so the two voices never read as one.
 */
const npc = useNpc()
const world = useWorld()
const el = useTemplateRef<HTMLDivElement>('el')
const pos = ref({ x: 0, y: 0, on: false, edge: false })
let raf = 0

function place() {
  raf = requestAnimationFrame(place)
  const b = npc.bubble.value
  const r = world.renderer()
  if (!b || !r) return
  const head = npc.headOf(b.id)
  if (!head) {
    pos.value = { ...pos.value, on: false }
    return
  }
  const s = r.toScreen([head[0], head[1] + 0.12, head[2]])
  const w = window.innerWidth
  const h = window.innerHeight
  const box = el.value?.getBoundingClientRect()
  const bw = (box?.width ?? 280) / 2
  const bh = box?.height ?? 80
  // Behind you or off screen: hold it at the nearest edge, low, so you know who's talking.
  const edge = !s.visible
  const x = edge ? (s.x < w / 2 ? bw + 16 : w - bw - 16) : Math.min(w - bw - 12, Math.max(bw + 12, s.x))
  const y = edge ? h * 0.55 : Math.min(h - bh - 140, Math.max(12, s.y - bh - 6))
  pos.value = { x, y, on: true, edge }
}

onMounted(() => {
  raf = requestAnimationFrame(place)
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <Transition
    enter-from-class="opacity-0 translate-y-1 blur-sm"
    leave-to-class="opacity-0 -translate-y-1 blur-sm"
    enter-active-class="transition duration-300"
    leave-active-class="transition duration-700"
  >
    <div
      v-if="npc.bubble.value && pos.on"
      ref="el"
      class="pointer-events-none absolute top-0 left-0 w-max max-w-[min(26rem,80vw)] rounded-2xl bg-black/30 px-4 pt-1.5 pb-2 text-center ring-1 ring-white/10 backdrop-blur-sm"
      :style="{ transform: `translate(${pos.x}px, ${pos.y}px) translateX(-50%)` }"
      data-npc-bubble
      :data-npc-id="npc.bubble.value.id"
    >
      <p class="hud-glow mb-0.5 text-[0.7rem] font-medium tracking-[0.2em] text-amber-100/55 uppercase">
        {{ npc.bubble.value.name }}<span
          v-if="pos.edge"
          class="tracking-normal normal-case"
        > (behind you)</span>
      </p>
      <p
        v-if="npc.bubble.value.thinking"
        class="hud-glow font-display text-2xl text-orange-50/80"
      >
        <span class="inline-block animate-pulse">·</span><span class="inline-block animate-pulse [animation-delay:150ms]">·</span><span class="inline-block animate-pulse [animation-delay:300ms]">·</span>
      </p>
      <p
        v-else
        class="hud-glow font-display text-lg leading-snug text-orange-50 sm:text-xl"
        data-npc-line
      >
        {{ npc.bubble.value.text }}
      </p>
    </div>
  </Transition>
</template>
