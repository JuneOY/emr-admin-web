import type { App } from 'vue'
import { createPinia } from 'pinia'
import { createPersistedState } from 'pinia-plugin-persistedstate'

export const store = createPinia()
// 这里只保存界面偏好，临床资料由本地业务层持久化。
store.use(createPersistedState({ key: (id) => 'emr-ui-v1-' + id, storage: localStorage }))
export function initStore(app: App): void {
  app.use(store)
}
