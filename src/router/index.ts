import type { App } from 'vue'
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { menuRoutes, HOME_PAGE_PATH } from './routes/navigation'
import { configureNProgress, setPageTitle } from '@/utils/router'
import { setWorktab } from '@/utils/navigation/worktab'
import { useWorktabStore } from '@/store/modules/worktab'
import { useSettingStore } from '@/store/modules/setting'
import NProgress from 'nprogress'
import { ElMessage } from 'element-plus'

export { HOME_PAGE_PATH } from './routes/navigation'
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: () => import('@/views/index/index.vue'),
      redirect: HOME_PAGE_PATH,
      children: menuRoutes as RouteRecordRaw[]
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: () => {
        ElMessage.warning({ message: '页面不存在，已返回病例列表', grouping: true })
        return HOME_PAGE_PATH
      }
    }
  ]
})

export function initRouter(app: App): void {
  configureNProgress()
  useWorktabStore().validateWorktabs(router)
  router.beforeEach(() => {
    if (useSettingStore().showNprogress) NProgress.start()
  })
  router.afterEach((to, _from, failure) => {
    NProgress.done()
    if (failure) return
    setWorktab(to)
    setPageTitle(to)
    document.getElementById('app-main')?.scrollTo({ top: 0 })
  })
  router.onError(() => {
    NProgress.done()
    ElMessage.error({ message: '页面加载失败，请重试', grouping: true })
  })
  app.use(router)
}
