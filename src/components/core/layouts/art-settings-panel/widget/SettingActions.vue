<template>
  <div class="mt-10 border-t border-[var(--default-border)] pt-5">
    <ElButton plain @click="handleResetConfig">恢复默认外观</ElButton>
  </div>
</template>

<script setup lang="ts">
  import { useSettingStore } from '@/store/modules/setting'
  import { SETTING_DEFAULT_CONFIG } from '@/config/setting'
  import { useTheme } from '@/hooks/core/useTheme'

  const settingStore = useSettingStore()
  const { switchThemeStyles } = useTheme()
  const handleResetConfig = async () => {
    settingStore.$patch({ ...SETTING_DEFAULT_CONFIG })
    switchThemeStyles(SETTING_DEFAULT_CONFIG.systemThemeMode)
    await nextTick()
    settingStore.$persist()
    location.reload()
  }
</script>
