<template>
  <section class="w-full" aria-label="工作台" data-testid="workspace-page">
    <div v-loading="desktop.loading" class="divide-y divide-[var(--art-card-border)]">
      <div class="flex flex-wrap items-center justify-between gap-4 pb-4">
        <dl class="grid gap-3 text-sm leading-6 md:grid-cols-[7rem_minmax(0,1fr)]">
          <dt class="text-g-600">资料库名称</dt>
          <dd class="text-g-900" data-testid="workspace-name-display">{{
            desktop.settings.workspaceName
          }}</dd>
        </dl>
        <ElButton type="primary" @click="router.push('/settings')">本地设置</ElButton>
      </div>
      <div class="grid gap-3 py-4 md:grid-cols-[7rem_minmax(0,1fr)_auto] md:items-center">
        <h2 class="text-sm font-normal text-g-600">资料存放位置</h2>
        <p class="min-w-0 text-sm leading-6 break-all text-g-600">{{
          desktop.info?.dataDirectory ||
          (desktop.loading ? '正在读取本地目录…' : isDesktop ? '尚未读取' : '在桌面版中查看')
        }}</p>
        <ElButton v-if="isDesktop" :disabled="!desktop.info" @click="openDirectory"
          >打开目录</ElButton
        >
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
  import { useDesktopStore } from '@/store/modules/desktop'
  import { desktopService, isDesktop } from '@/services/desktop'
  const desktop = useDesktopStore()
  const router = useRouter()
  onMounted(desktop.load)
  const openDirectory = async () => {
    try {
      await desktopService.openDataDirectory()
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '无法打开目录')
    }
  }
</script>
