import { defineStore } from 'pinia'
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { DEFAULT_SETTINGS, type ApplicationInfo, type LocalSettings } from '@shared/desktop'
import { desktopService, isDesktop } from '@/services/desktop'

export const useDesktopStore = defineStore('desktop', () => {
  const info = ref<ApplicationInfo | null>(null)
  const settings = ref<LocalSettings>({ ...DEFAULT_SETTINGS })
  const loading = ref(false)
  const error = ref('')
  let pending: Promise<void> | null = null
  let previewNotified = false

  const load = (): Promise<void> => {
    if (!isDesktop) {
      if (!previewNotified) {
        ElMessage.info('当前为网页预览，本地文件功能请在桌面应用中使用')
        previewNotified = true
      }
      return Promise.resolve()
    }
    if (pending) return pending
    loading.value = true
    error.value = ''
    pending = Promise.all([desktopService.getApplicationInfo(), desktopService.getSettings()])
      .then(([applicationInfo, savedSettings]) => {
        info.value = applicationInfo
        settings.value = savedSettings
      })
      .catch((cause: unknown) => {
        error.value = cause instanceof Error ? cause.message : '读取本地设置失败'
        ElMessage.error({ message: error.value, grouping: true })
      })
      .finally(() => {
        loading.value = false
        pending = null
      })
    return pending
  }

  const save = async (input: LocalSettings): Promise<void> => {
    settings.value = await desktopService.saveSettings(input)
    error.value = ''
  }

  return { info, settings, loading, error, load, save }
})
