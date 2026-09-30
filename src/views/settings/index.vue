<template>
  <section class="w-full" aria-label="本地设置" data-testid="settings-page">
    <div class="grid gap-4 pb-5 md:grid-cols-[8rem_minmax(0,1fr)]">
      <div>
        <h2 class="text-sm leading-6 font-medium text-g-900">资料库偏好</h2>
      </div>
      <ElForm
        class="max-w-md"
        label-position="top"
        :disabled="!isDesktop || desktop.loading || saving || Boolean(desktop.error)"
        @submit.prevent="save"
      >
        <ElFormItem label="资料库名称">
          <ElInput
            v-model="form.workspaceName"
            maxlength="40"
            show-word-limit
            data-testid="workspace-name"
          />
        </ElFormItem>
        <ElFormItem label="关闭软件前询问">
          <ElSwitch v-model="form.confirmBeforeExit" aria-label="关闭软件前询问" />
        </ElFormItem>
        <div class="flex flex-wrap items-center gap-4 pt-2">
          <ElButton
            type="primary"
            native-type="submit"
            :loading="saving"
            data-testid="save-settings"
            >保存设置</ElButton
          >
          <span v-if="saved" class="text-sm text-g-600" role="status">已保存到当前电脑</span>
        </div>
      </ElForm>
    </div>

    <div
      class="grid gap-4 border-t border-[var(--art-card-border)] py-5 md:grid-cols-[8rem_minmax(0,1fr)]"
    >
      <div>
        <h2 class="text-sm leading-6 font-medium text-g-900">数据与外观</h2>
      </div>
      <div class="min-w-0">
        <dl class="mb-4 grid grid-cols-[7rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm leading-6">
          <dt class="text-g-600">软件版本</dt><dd>{{ desktop.info?.version || appVersion }}</dd>
          <dt class="text-g-600">本地数据目录</dt
          ><dd class="break-all" data-testid="data-directory">{{
            desktop.info?.dataDirectory || '在桌面版中查看'
          }}</dd>
        </dl>
        <div class="flex flex-wrap gap-3 [&>.el-button]:ml-0">
          <ElButton :disabled="!desktop.info" @click="openDirectory">打开数据目录</ElButton>
          <ElButton
            :disabled="!desktop.info || managing || saving"
            data-testid="migrate-data"
            @click="manageData('migrate')"
            >更改数据目录</ElButton
          >
          <ElButton
            :disabled="!desktop.info || managing || saving"
            data-testid="backup-data"
            @click="manageData('backup')"
            >备份数据</ElButton
          >
          <ElButton
            :disabled="!desktop.info || managing || saving"
            data-testid="restore-data"
            @click="manageData('restore')"
            >从备份恢复</ElButton
          >
          <!-- <ElButton @click="mittBus.emit('openSetting')">调整界面外观</ElButton> -->
        </div>
        <p v-if="lastBackup" class="mt-3 text-sm break-all text-g-600" role="status"
          >最近备份：{{ lastBackup }}</p
        >
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
  import { DEFAULT_SETTINGS, parseSettings } from '@shared/desktop'
  import { useDesktopStore } from '@/store/modules/desktop'
  import { desktopService, isDesktop } from '@/services/desktop'
  // import { mittBus } from '@/utils/sys'
  import { ElLoading } from 'element-plus'
  import type { DataOperation } from '@shared/data-management'
  import { saveBeforeRefresh } from '@/services/page-save-guard'

  const desktop = useDesktopStore()
  const appVersion = __APP_VERSION__
  const form = reactive({ ...DEFAULT_SETTINGS })
  const saving = ref(false)
  const saved = ref(false)
  const managing = ref(false)
  const lastBackup = ref('')
  watch(
    () => desktop.settings,
    (settings) => Object.assign(form, settings),
    { immediate: true }
  )
  watch(form, () => {
    saved.value = false
  })
  onMounted(desktop.load)

  const save = async () => {
    saved.value = false
    saving.value = true
    try {
      await desktop.save(parseSettings(form))
      await nextTick()
      saved.value = true
      ElMessage.success('设置已保存')
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '保存失败，请重试')
    } finally {
      saving.value = false
    }
  }
  const openDirectory = async () => {
    try {
      await desktopService.openDataDirectory()
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '无法打开目录')
    }
  }
  const manageData = async (operation: DataOperation) => {
    if (managing.value) return
    managing.value = true
    let loading: ReturnType<typeof ElLoading.service> | undefined
    try {
      if (!(await saveBeforeRefresh())) return
      await desktop.save(parseSettings(form))
      loading = ElLoading.service({
        lock: true,
        text: {
          migrate: '正在准备迁移病例数据…',
          backup: '正在准备完整备份…',
          restore: '正在校验并恢复备份…'
        }[operation]
      })
      const result = await desktopService.manageLocalData(operation)
      if (!result) return
      if (result.reload) {
        location.reload()
      } else {
        lastBackup.value = result.directory
        ElMessage.success('完整备份已保存')
      }
    } catch (error) {
      ElMessage.error(error instanceof Error ? error.message : '本地资料操作未完成')
    } finally {
      loading?.close()
      managing.value = false
    }
  }
</script>
