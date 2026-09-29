import type { RouteLocationNormalized } from 'vue-router'
import { useWorktabStore } from '@/store/modules/worktab'
import { useSettingStore } from '@/store/modules/setting'
import { HOME_PAGE_PATH } from '@/router/routes/navigation'

/** 根据本地路由维护工作标签，首页始终保留。 */
export const setWorktab = (to: RouteLocationNormalized): void => {
  const { meta, path, name, params, query } = to
  if (meta.isHideTab || (!useSettingStore().showWorkTab && path !== HOME_PAGE_PATH)) return
  useWorktabStore().openTab({
    title: meta.title as string,
    icon: meta.icon as string,
    path,
    name: name as string,
    keepAlive: Boolean(meta.keepAlive),
    params,
    query,
    fixedTab: Boolean(meta.fixedTab)
  })
}
