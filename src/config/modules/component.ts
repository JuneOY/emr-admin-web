import { defineAsyncComponent } from 'vue'

const components = [
  {
    key: 'settings-panel',
    component: defineAsyncComponent(
      () => import('@/components/core/layouts/art-settings-panel/index.vue')
    )
  },
  {
    key: 'global-search',
    component: defineAsyncComponent(
      () => import('@/components/core/layouts/art-global-search/index.vue')
    )
  }
]
export const getEnabledGlobalComponents = () => components
