const assert = require('node:assert/strict')

async function prescriptionInsertionWorkflow(
  window,
  { evaluate, waitFor, capture, firstId, otherId, prescription }
) {
  const wait = (expression) => waitFor(window, expression)
  const record = `[data-record-id="${firstId}"]`
  const field = `${record} textarea[data-field="prescription"]`
  const input = `document.querySelector(${JSON.stringify(field)})`
  const trigger = `document.querySelector('${record} [data-testid="pick-prescription"]')`
  const menu = `Array.from(document.querySelectorAll('[role="menu"]')).find(el => el.getAttribute('aria-labelledby') === ${trigger}.id)`
  const otherBefore = (await evaluate(`window.emrDesktop.clinical('visit', '${otherId}')`)).data
    .body.prescription
  const firstBefore = (await evaluate(`window.emrDesktop.clinical('visit', '${firstId}')`)).data
    .body.prescription
  const saved = () =>
    wait(`document.querySelector('[data-testid="record-save-state"]')?.textContent === '已保存'`)
  const value = () => evaluate(`${input}.value`)
  const select = async (start, end = start) => {
    await evaluate(`(() => {
      const el = ${input}
      el.focus()
      el.setSelectionRange(${start}, ${end})
      el.dispatchEvent(new Event('select', {bubbles:true}))
    })()`)
  }
  const setValue = async (text) => {
    await evaluate(`(() => {
      const el = ${input}
      el.focus()
      el.value = ${JSON.stringify(text)}
      el.dispatchEvent(new Event('input', {bubbles:true}))
    })()`)
  }
  const open = async () => {
    await wait(`!${trigger}.disabled`)
    // 模拟真实鼠标从 textarea 移到按钮，必须覆盖失焦排版后打开弹窗的路径。
    await evaluate(`${trigger}.focus()`)
    await saved()
    await evaluate(`${trigger}.click()`)
    await wait(`Boolean(${menu}) && ${menu}.getClientRects().length > 0`)
    await evaluate(`${menu}.querySelector('[data-testid="use-library-prescription"]').click()`)
    await wait(
      `document.querySelector('.el-dialog [data-testid="prescription-table"] .el-table__body')?.textContent.includes(${JSON.stringify(prescription.name)})`
    )
  }
  const apply = async () => {
    await evaluate(
      `Array.from(document.querySelectorAll('.el-dialog [data-testid="prescription-table"] .el-table__body button')).find(el => el.textContent.trim() === '选择').click()`
    )
    await wait(`Boolean(document.querySelector('[data-testid="prescription-preview"]'))`)
    assert.equal(
      await evaluate(
        `document.querySelector('[data-testid="prescription-preview"]').textContent.includes(${JSON.stringify(prescription.name)})`
      ),
      false
    )
    await evaluate(`document.querySelector('[data-testid="prescription-apply"]').click()`)
    await wait(`document.activeElement === ${input}`)
    await saved()
    const text = await value()
    assert.equal(text.includes(prescription.name), false)
    assert.equal(
      (await evaluate(`window.emrDesktop.clinical('visit', '${firstId}')`)).data.body.prescription,
      text
    )
    assert.equal(
      (await evaluate(`window.emrDesktop.clinical('visit', '${otherId}')`)).data.body.prescription,
      otherBefore
    )
    return text
  }

  // 手写段落中间插入，弹窗搜索焦点不能把插入位置移到处方尾部。
  await setValue('前段保留\n\n后段保留')
  await select('前段保留\n\n'.length)
  await open()
  let inserted = await apply()
  assert.ok(inserted.startsWith('前段保留\n\n合成测试药品1'))
  assert.ok(inserted.endsWith('\n\n后段保留'))
  assert.deepEqual(
    inserted
      .split('\n')
      .filter((line) => line.includes('合成测试药品'))
      .map((line) => line.split('    ').length),
    [4, 2]
  )
  assert.ok(
    inserted
      .slice(0, await evaluate(`${input}.selectionStart`))
      .endsWith(`用法：${prescription.usage}`)
  )

  // 选区替换只移除选中的正文；打开后取消不改变文本和选区。
  await setValue('前文\n\n待替换内容\n\n后文')
  await select('前文\n\n'.length, '前文\n\n待替换内容'.length)
  await open()
  await evaluate(
    `Array.from(document.querySelectorAll('.el-dialog__headerbtn')).find(el => el.getClientRects().length).click()`
  )
  await wait(`document.activeElement === ${input}`)
  assert.equal(await value(), '前文\n\n待替换内容\n\n后文')
  assert.equal(await evaluate(`${input}.selectionStart`), '前文\n\n'.length)
  assert.equal(await evaluate(`${input}.selectionEnd`), '前文\n\n待替换内容'.length)
  await open()
  inserted = await apply()
  assert.equal(inserted.includes('待替换内容'), false)
  assert.ok(inserted.startsWith('前文\n\n合成测试药品1'))
  assert.ok(inserted.endsWith('\n\n后文'))

  // 旧一项一行内容在失焦时变为四项一行，光标仍须位于原药5之前。
  const old = Array.from({ length: 6 }, (_, index) => `原药${index + 1}  测试量`).join('\n')
  await setValue(old)
  await select(old.indexOf('原药5'))
  await open()
  inserted = await apply()
  const firstRow = inserted.split('\n')[0]
  assert.equal(firstRow, '原药1  测试量    原药2  测试量    原药3  测试量    原药4  测试量')
  assert.ok(inserted.indexOf('原药4') < inserted.indexOf('合成测试药品1'))
  assert.ok(inserted.indexOf('合成测试药品6') < inserted.indexOf('原药5'))
  assert.ok(inserted.endsWith('原药5  测试量    原药6  测试量'))

  // 连续引用使用刚恢复的光标，仍插在原药5之前。
  await open()
  inserted = await apply()
  assert.equal(inserted.split('合成测试药品1').length - 1, 2)
  assert.ok(inserted.lastIndexOf('合成测试药品6') < inserted.indexOf('原药5'))
  await evaluate(`${input}.scrollIntoView({block:'center'})`)
  await capture(window, 'prescription-caret-insertion')
  await evaluate(`document.querySelector('[aria-label="刷新页面"]').click()`)
  await wait(`Boolean(${input}) && ${input}.value === ${JSON.stringify(inserted)}`)

  // 还原本用例修改的合成记录，后续附件与窗口重开继续复用原场景。
  await setValue(firstBefore)
  await evaluate(`${input}.blur()`)
  await saved()
}

module.exports = { prescriptionInsertionWorkflow }
