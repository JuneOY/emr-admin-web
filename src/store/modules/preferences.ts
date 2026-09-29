import { defineStore } from 'pinia'
import { ref } from 'vue'
import { LanguageEnum } from '@/enums/appEnum'
import type { AppRouteRecord } from '@/types/router'

export const usePreferencesStore = defineStore(
  'preferences',
  () => {
    const language = ref(LanguageEnum.ZH)
    const searchHistory = ref<AppRouteRecord[]>([])
    const setSearchHistory = (list: AppRouteRecord[]) => {
      searchHistory.value = list
    }
    return { language, searchHistory, setSearchHistory }
  },
  { persist: true }
)
