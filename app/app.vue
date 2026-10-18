<script setup lang="ts">
useHead({
  meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
  htmlAttrs: { lang: 'en', class: 'dark' }
})
useSeoMeta({ title: 'Voice World', description: 'Speak a world into existence.' })
</script>

<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>
