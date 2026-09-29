import type { DesktopResult, LocalSettings } from '@shared/desktop'
import type { DataOperation } from '@shared/data-management'

export const isDesktop = Boolean(window.emrDesktop)

export function bridge() {
  if (!window.emrDesktop) throw new Error('当前为网页预览，请在桌面应用中使用本地功能')
  return window.emrDesktop
}

export async function unwrap<T>(request: Promise<DesktopResult<T>>): Promise<T> {
  const result = await request
  if (!result.success) throw new Error(result.message)
  return result.data
}

export const desktopService = {
  manageLocalData: (operation: DataOperation) => unwrap(bridge().manageLocalData(operation)),
  getApplicationInfo: () => unwrap(bridge().getApplicationInfo()),
  getSettings: () => unwrap(bridge().getSettings()),
  saveSettings: (settings: LocalSettings) => unwrap(bridge().saveSettings(settings)),
  openDataDirectory: () => unwrap(bridge().openDataDirectory())
}
