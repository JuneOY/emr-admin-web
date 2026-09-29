import type { App } from 'vue'
import { ElMessage } from 'element-plus'

/** 保留诊断日志，界面只使用统一消息提示，不把异常堆栈写进页面。 */
function reportError(message: string, detail: unknown): void {
  console.error(message, detail)
  ElMessage.error({ message, grouping: true })
}

export function setupErrorHandle(app: App): void {
  app.config.errorHandler = (error) => reportError('页面操作失败，请重试', error)
  window.addEventListener('unhandledrejection', (event) => {
    reportError('操作未完成，请重试', event.reason)
  })
  window.addEventListener(
    'error',
    (event: Event) => {
      if (event instanceof ErrorEvent) {
        reportError('页面运行异常，请重新打开', event.error || event.message)
        return
      }
      const element = event.target as HTMLElement | null
      if (element && ['IMG', 'SCRIPT', 'LINK'].includes(element.tagName)) {
        reportError('部分页面资源未能加载，请重新打开', element.tagName)
      }
    },
    true
  )
}
