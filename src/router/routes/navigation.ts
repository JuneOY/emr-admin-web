import type { AppRouteRecord } from '@/types/router'

export const HOME_PAGE_PATH = '/patients'
export const menuRoutes: AppRouteRecord[] = [
  {
    path: HOME_PAGE_PATH,
    name: 'Patients',
    component: () => import('@/views/patients/index.vue'),
    meta: { title: '病例', icon: 'ri:user-line', isFirstLevel: true, fixedTab: true }
  },
  {
    path: '/patients/:id',
    name: 'PatientDetail',
    component: () => import('@/views/patients/detail.vue'),
    meta: {
      title: '门诊病例',
      isHide: true,
      isHideTab: true,
      activePath: '/patients',
      viewKey: 'case-editor'
    }
  },
  {
    path: '/prescriptions',
    name: 'Prescriptions',
    component: () => import('@/views/prescriptions/index.vue'),
    meta: { title: '处方库', icon: 'Document', isFirstLevel: true }
  },
  {
    path: '/clinical-settings',
    name: 'ClinicalSettings',
    component: () => import('@/views/clinical-settings/index.vue'),
    meta: { title: '医生与分类', icon: 'ri:group-line', isFirstLevel: true }
  },
  {
    path: '/workspace',
    name: 'Workspace',
    component: () => import('@/views/workspace/index.vue'),
    meta: { title: 'menus.workspace', icon: 'ri:home-4-line', isHide: true }
  },
  {
    path: '/settings',
    name: 'LocalSettings',
    component: () => import('@/views/settings/index.vue'),
    meta: { title: 'menus.localSettings', icon: 'ri:settings-line', isFirstLevel: true }
  }
]
