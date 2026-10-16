const assert = require('node:assert/strict')

async function categoryPatientsWorkflow(window, { evaluate, waitFor, capture, patientId }) {
  const wait = (expression) => waitFor(window, expression)
  const drawer = 'document.querySelector("[data-testid=category-patients]")'
  const checkVisitCount = async () => {
    assert.equal(
      await evaluate(`(() => {
        const headers = Array.from(${drawer}.querySelectorAll('.el-table__header th'))
        const index = headers.findIndex(el => el.textContent.trim() === '就诊次数')
        return ${drawer}.querySelector('.el-table__body .el-table__row')?.children[index]?.textContent.trim()
      })()`),
      '3',
      '分类抽屉应展示患者全部初复诊次数，与病例列表口径一致'
    )
  }
  const open = async () => {
    await evaluate(
      `document.querySelector('[data-testid="clinical-settings-page"] .el-table__body [data-testid="category-view-patients"]').click()`
    )
    await wait(`${drawer}?.querySelector('.el-table__body')?.textContent.includes('桌面流程测试')`)
  }
  const search = async (value) => {
    await evaluate(`(() => {
      const input = document.querySelector('input[data-testid="category-patient-search"]')
      input.value = ${JSON.stringify(value)}
      input.dispatchEvent(new Event('input', {bubbles:true}))
    })()`)
  }
  await evaluate(`location.hash = '#/clinical-settings'`)
  await wait(`Boolean(document.querySelector('[data-testid="clinical-settings-page"]'))`)
  await evaluate(
    `Array.from(document.querySelectorAll('.el-tabs__item')).find(el => el.textContent === '就诊分类').click()`
  )
  await wait(
    `Boolean(document.querySelector('.el-table__body [data-testid="category-view-patients"]'))`
  )
  await open()
  assert.equal(
    await evaluate(`${drawer}.querySelectorAll('.el-table__body .el-table__row').length`),
    1
  )
  const content = await evaluate(`${drawer}.textContent`)
  assert.ok(content.includes('13900000002'))
  assert.ok(content.includes('测试医生甲最新名'))
  await checkVisitCount()
  assert.equal(await evaluate('location.hash'), '#/clinical-settings')
  await capture(window, 'category-patients')

  await search('没有匹配的患者')
  await wait(`${drawer}.textContent.includes('暂无匹配的患者')`)
  await search('13900000002')
  await wait(`${drawer}.querySelector('.el-table__body').textContent.includes('桌面流程测试')`)
  await checkVisitCount()
  window.setSize(1000, 700)
  await capture(window, 'category-patients-compact')
  assert.equal(
    await evaluate(`(() => {
    const el = ${drawer}.closest('.el-drawer'), rect = el.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= innerWidth + 1 && rect.top >= 0 && el.scrollWidth <= el.clientWidth + 1
  })()`),
    true
  )
  await evaluate(`${drawer}.closest('.el-drawer').querySelector('.el-drawer__close-btn').click()`)
  await wait(`!${drawer}`)
  // 关闭期间不保留搜索结果；停用分类仍可查询历史患者。
  await evaluate(
    `Array.from(document.querySelectorAll('[data-testid="clinical-settings-page"] .el-table__body button')).find(el => el.textContent.trim() === '停用').click()`
  )
  await wait(
    `document.querySelector('[data-testid="clinical-settings-page"] .el-table__body').textContent.includes('已停用')`
  )
  await open()
  await checkVisitCount()
  assert.equal(
    await evaluate(`document.querySelector('input[data-testid="category-patient-search"]').value`),
    ''
  )
  await evaluate(
    `${drawer}.querySelector('.el-table__body [data-testid="category-open-patient"]').click()`
  )
  await wait(
    `location.hash === '#/patients/${patientId}' && document.querySelectorAll('[data-testid="record-document"]').length === 3`
  )
  assert.equal(await evaluate(`Boolean(${drawer})`), false)
  window.setSize(1360, 900)
}

module.exports = { categoryPatientsWorkflow }
