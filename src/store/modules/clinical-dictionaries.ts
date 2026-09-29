import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Dictionaries, DictionaryItem, DictionaryKind } from '../../../shared/clinical'

// 仅在内存共享医生与分类；临床数据不进入界面偏好持久化。
export const useClinicalDictionariesStore = defineStore('clinicalDictionaries', () => {
  const dictionaries = ref<Dictionaries>({ doctors: [], categories: [] })
  let version = 0

  function beginLoad(): number {
    return ++version
  }

  function applyLoad(request: number, data: Dictionaries): void {
    if (request === version) dictionaries.value = data
  }

  function applySaved(kind: DictionaryKind, item: DictionaryItem): void {
    // 保存成功后使旧查询失效，不能让迟到响应恢复改名前的数据。
    version++
    const items = kind === 'doctor' ? dictionaries.value.doctors : dictionaries.value.categories
    const index = items.findIndex((entry) => entry.id === item.id)
    if (index < 0) items.push(item)
    else if (items[index].revision <= item.revision) items[index] = item
    items.sort((a, b) => Number(b.active) - Number(a.active))
  }

  function doctorName(doctorId: string, fallback: string): string {
    return dictionaries.value.doctors.find((item) => item.id === doctorId)?.name ?? fallback
  }

  return { dictionaries, beginLoad, applyLoad, applySaved, doctorName }
})
