import assert from 'node:assert/strict'
import { test } from 'node:test'
import { registerPageSaveGuard, saveBeforeRefresh } from '../src/services/page-save-guard'

test('页面刷新等待保存结果，旧组件卸载不能移除新页面的保存保护', async () => {
  let finish: (value: boolean) => void = () => {}
  const oldDispose = registerPageSaveGuard(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  let resolved = false
  const first = saveBeforeRefresh().then((result) => {
    resolved = true
    return result
  })
  await Promise.resolve()
  assert.equal(resolved, false)
  finish(false)
  assert.equal(await first, false)
  const currentDispose = registerPageSaveGuard(async () => false)
  oldDispose()
  assert.equal(await saveBeforeRefresh(), false)
  currentDispose()
  assert.equal(await saveBeforeRefresh(), true)
})
