import { defineStore } from 'pinia'
import { ref } from 'vue'
import { menuRoutes, HOME_PAGE_PATH } from '@/router/routes/navigation'

export const useMenuStore = defineStore('menuStore', () => {
  const menuList = ref(menuRoutes)
  const menuWidth = ref('')
  const getHomePath = () => HOME_PAGE_PATH
  return { menuList, menuWidth, getHomePath }
})
