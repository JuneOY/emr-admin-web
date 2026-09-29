import type { HeaderBarFeatureConfig } from '@/types/config'

/** 当前桌面底座支持的顶部功能。 */
export const headerBarConfig: HeaderBarFeatureConfig = {
  menuButton: { enabled: true, description: '展开或收起侧边菜单' },
  refreshButton: { enabled: true, description: '刷新当前页面' },
  breadcrumb: { enabled: true, description: '当前页面路径' },
  globalSearch: { enabled: true, description: '搜索本地菜单' },
  settings: { enabled: true, description: '界面外观设置' },
  themeToggle: { enabled: true, description: '切换明暗主题' }
}
