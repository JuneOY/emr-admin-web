import { computed } from 'vue'
import { useSettingStore } from '@/store/modules/setting'
import { headerBarConfig } from '@/config/modules/headerBar'

export function useHeaderBar() {
  const settings = useSettingStore()
  return {
    shouldShowMenuButton: computed(
      () => headerBarConfig.menuButton.enabled && settings.showMenuButton
    ),
    shouldShowRefreshButton: computed(
      () => headerBarConfig.refreshButton.enabled && settings.showRefreshButton
    ),
    shouldShowBreadcrumb: computed(() => headerBarConfig.breadcrumb.enabled && settings.showCrumbs),
    shouldShowGlobalSearch: computed(() => headerBarConfig.globalSearch.enabled),
    shouldShowSettings: computed(() => headerBarConfig.settings.enabled),
    shouldShowThemeToggle: computed(() => headerBarConfig.themeToggle.enabled)
  }
}
