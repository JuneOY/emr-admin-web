import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ArrowDown, Close, More } from '@element-plus/icons-vue'
import { resolveLocalIcon } from '../src/components/core/base/art-svg-icon/local-icons'

test('原 admin 标签的关闭和展开图标不会误用更多操作图标', () => {
  assert.equal(resolveLocalIcon('ri:close-large-fill'), Close)
  assert.equal(resolveLocalIcon('iconamoon:arrow-down-2-thin'), ArrowDown)
  assert.equal(resolveLocalIcon('ri:more-line'), More)
})
