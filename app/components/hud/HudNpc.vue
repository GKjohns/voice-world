<script setup lang="ts">
/**
 * A person's words, floating by their head: their name, then the line as it's being written (three soft
 * dots while they think). Follows them on screen every frame; pinned to the screen edge when they're off
 * to the side; gone a moment after they finish. Same type and glow as the genie's captions, but warm
 * parchment instead of gold, so the two voices never read as one.
 *
 * `side`: the second channel, for people talking among themselves (banter, a shout after a wish, someone
 * chiming in): smaller and dimmer, so it never fights the conversation you're in.
 */
const props = defineProps<{ side?: boolean }>()
const npc = useNpc()
const current = computed(() => (props.side ? npc.sideBubble.value : npc.bubble.value))
const world = useWorld()
const el = useTemplateRef<HTMLDivElement>('el')
const pos = ref({ x: 0, y: 0, on: false, edge: false })
let raf = 0

function place() {
  raf = requestAnimationFrame(place)
  const b = current.value
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
  let y = edge ? h * (props.side ? 0.42 : 0.55) : Math.min(h - bh - 140, Math.max(12, s.y - bh - 6))
  // The side channel never sits on the conversation's bubble: hop above it (or below if there's no room).
  if (props.side) {
    const main = document.querySelector('[data-npc-bubble="main"]')?.getBoundingClientRect()
    if (main && main.width && Math.abs(x - (main.left + main.width / 2)) < bw + main.width / 2 + 8 && y < main.bottom + 8 && y + bh > main.top - 8)
      y = main.top - bh - 10 > 8 ? main.top - bh - 10 : main.bottom + 10
  }
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
      v-if="current && pos.on"
      ref="el"
      class="pointer-events-none absolute top-0 left-0 w-max rounded-2xl px-4 pt-1.5 pb-2 text-center ring-1 backdrop-blur-sm"
      :class="props.side ? 'max-w-[min(20rem,70vw)] bg-black/20 ring-white/5' : 'max-w-[min(26rem,80vw)] bg-black/30 ring-white/10'"
      :style="{ transform: `translate(${pos.x}px, ${pos.y}px) translateX(-50%)` }"
      :data-npc-bubble="props.side ? 'side' : 'main'"
      :data-npc-id="current.id"
    >
      <p class="hud-glow mb-0.5 text-[0.7rem] font-medium tracking-[0.2em] text-amber-100/55 uppercase">
        {{ current.name }}<span
          v-if="pos.edge"
          class="tracking-normal normal-case"
        > (behind you)</span>
      </p>
      <p
        v-if="current.thinking"
        class="hud-glow font-display text-2xl text-orange-50/80"
      >
        <span class="inline-block animate-pulse">·</span><span class="inline-block animate-pulse [animation-delay:150ms]">·</span><span class="inline-block animate-pulse [animation-delay:300ms]">·</span>
      </p>
      <p
        v-else
        class="hud-glow font-display leading-snug"
        :class="props.side ? 'text-base text-orange-50/85 sm:text-lg' : 'text-lg text-orange-50 sm:text-xl'"
        :data-npc-line="props.side ? 'side' : 'main'"
      >
        {{ current.text }}
      </p>
    </div>
  </Transition>
</template>
