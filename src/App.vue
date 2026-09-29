<template>
  <ElConfigProvider size="default" :locale="locale" :z-index="3000">
    <RouterView />
  </ElConfigProvider>
</template>

<script setup lang="ts">
  import zh from 'element-plus/es/locale/lang/zh-cn'
  import en from 'element-plus/es/locale/lang/en'
  import { usePreferencesStore } from '@/store/modules/preferences'
  import { initializeTheme } from '@/hooks/core/useTheme'

  const preferences = usePreferencesStore()
  const locale = computed(() => (preferences.language === 'en' ? en : zh))
  onBeforeMount(initializeTheme)
</script>
