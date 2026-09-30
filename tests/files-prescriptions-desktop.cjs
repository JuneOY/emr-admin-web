const assert = require('node:assert/strict')
const { join } = require('node:path')
const { readFile, writeFile, rm } = require('node:fs/promises')
const { dialog } = require('electron')

async function filesPrescriptionsWorkflow(
  window,
  { evaluate, waitFor, capture, artifacts, temporaryDirectory, patientId, firstId }
) {
  const wait = (expression) => waitFor(window, expression)
  const click = (selector) =>
    evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible').click()`
    )
  const setInput = (selector, value) =>
    evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    input.value = ${JSON.stringify(value)}
    input.dispatchEvent(new Event('input', {bubbles:true}))
  })()`)
  const button = (selector, label) =>
    evaluate(
      `Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible' && el.textContent.trim() === ${JSON.stringify(label)}).click()`
    )
  await evaluate(`location.hash = '#/prescriptions'`)
  await wait(`Boolean(document.querySelector('[data-testid="prescriptions-page"]'))`)
  await click('[data-testid="new-prescription"]')
  await wait(`Boolean(document.querySelector('input[data-testid="prescription-name"]'))`)
  await setInput('input[data-testid="prescription-name"]', '处方复用验证')
  await setInput('input[data-testid="drug-name-0"]', '合成测试药品，无临床用途')
  await setInput('textarea[data-testid="prescription-usage"]', '软件测试内容，请由医生填写实际用法')
  await click('[data-testid="prescription-submit"]')
  await wait(
    `document.querySelector('[data-testid="prescription-table"] .el-table__body')?.textContent.includes('处方复用验证')`
  )
  const query = { keyword: '', kind: '', activeOnly: true, page: 1, pageSize: 20 }
  const result = await evaluate(
    `window.emrDesktop.clinical('prescriptions', ${JSON.stringify(query)})`
  )
  assert.equal(result.success, true)
  const prescription = result.data.items[0]
  await capture(window, 'prescription-library')
  await button('[data-testid="prescription-table"] .el-table__body button', '编辑')
  await wait(
    `document.querySelector('input[data-testid="prescription-name"]')?.value === '处方复用验证'`
  )
  await capture(window, 'prescription-edit')
  await button('.el-dialog button', '取消')
  await wait(`!document.querySelector('input[data-testid="prescription-name"]')`)

  await evaluate(`location.hash = '#/patients/${patientId}'`)
  await wait(
    `Boolean(document.querySelector('[data-testid="record-document"]:last-child textarea[data-field="prescription"]'))`
  )
  await setInput(
    '[data-testid="record-document"]:last-child textarea[data-field="prescription"]',
    '保留医生原先录入的文字。'
  )
  await click('[data-testid="record-document"]:last-child [data-testid="pick-prescription"]')
  await wait(
    `document.querySelector('.el-dialog [data-testid="prescription-table"] .el-table__body')?.textContent.includes('处方复用验证')`
  )
  await button('.el-dialog [data-testid="prescription-table"] .el-table__body button', '选择')
  await wait(
    `document.querySelector('[data-testid="prescription-preview"]')?.textContent.includes('合成测试药品')`
  )
  await click('[data-testid="prescription-apply"]')
  await wait(
    `document.querySelector('[data-testid="record-document"]:last-child textarea[data-field="prescription"]')?.value.includes('处方复用验证') && document.querySelector('[data-testid="record-save-state"]')?.textContent === '已保存'`
  )
  const visits = (
    await evaluate(
      `window.emrDesktop.clinical('visits', {patientId:'${patientId}',page:1,pageSize:20})`
    )
  ).data.items
  const visitId = visits[0].id
  const prescriptionCopy = (await evaluate(`window.emrDesktop.clinical('visit', '${visitId}')`))
    .data.body.prescription
  assert.ok(prescriptionCopy.startsWith('保留医生原先录入的文字。\n\n'))
  const { createdAt: _created, updatedAt: _updated, ...savedInput } = prescription
  void [_created, _updated]
  const changed = await evaluate(
    `window.emrDesktop.clinical('savePrescription', ${JSON.stringify({ ...savedInput, name: '库内已更名', active: false })})`
  )
  assert.equal(changed.success, true)
  assert.equal(
    (await evaluate(`window.emrDesktop.clinical('visit', '${visitId}')`)).data.body.prescription,
    prescriptionCopy
  )

  // 合成测试图通过浏览器画布生成，不接触真实患者图像。
  const image = await evaluate(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 900; canvas.height = 1200
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,900,1200)
    ctx.fillStyle = '#21382e'; ctx.font = '42px sans-serif'; ctx.fillText('附件导出测试', 80, 120)
    ctx.font = '24px sans-serif'; ctx.fillText('合成图片，不含真实患者信息', 80, 190)
    ctx.strokeStyle = '#a0afa7'; ctx.lineWidth = 2
    for (let y = 300; y < 1100; y += 80) {ctx.beginPath();ctx.moveTo(80,y);ctx.lineTo(820,y);ctx.stroke()}
    return canvas.toDataURL('image/png').split(',')[1]
  })()`)
  const sourceImage = join(temporaryDirectory, '合成舌苔测试.png')
  const sourcePdf = join(temporaryDirectory, '检查报告测试.pdf')
  await writeFile(sourceImage, Buffer.from(image, 'base64'))
  await writeFile(sourcePdf, await readFile(join(artifacts, 'clinical-visit.pdf')))
  const originalOpen = dialog.showOpenDialog,
    originalSave = dialog.showSaveDialog
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourceImage, sourcePdf] })
    await click('[data-testid="visit-attachments"]')
    await wait(`Boolean(document.querySelector('[data-testid="attachment-import"]'))`)
    await click('[data-testid="attachment-import"]')
    await wait(
      `document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('合成舌苔测试.png')`
    )
    const attachments = (await evaluate(`window.emrDesktop.clinical('attachments', '${visitId}')`))
      .data
    assert.equal(attachments.length, 2)
    assert.deepEqual(
      (await evaluate(`window.emrDesktop.clinical('attachments', '${firstId}')`)).data,
      []
    )
    await click('[data-testid="attachment-import"]')
    await wait(`document.body.innerText.includes('跳过 2 个重复文件')`)
    assert.equal(
      (await evaluate(`window.emrDesktop.clinical('attachments', '${visitId}')`)).data.length,
      2
    )
    // 在抽屉选择初诊上传，归属必须是初诊 ID；切回复诊仍能看到原来的文件。
    await button('.el-drawer .el-radio-button', '初诊')
    await wait(
      `document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('本次就诊暂无附件')`
    )
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourceImage] })
    await click('[data-testid="attachment-import"]')
    await wait(
      `document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('合成舌苔测试.png')`
    )
    assert.equal(
      (await evaluate(`window.emrDesktop.clinical('attachments', '${firstId}')`)).data.length,
      1
    )
    await button('.el-drawer .el-radio-button', '复诊')
    await wait(
      `document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('检查报告测试.pdf')`
    )
    await evaluate(
      `document.querySelector('.el-drawer [aria-label="就诊单据"]').closest('.el-select').querySelector('.el-select__wrapper').click()`
    )
    await wait(
      `Array.from(document.querySelectorAll('.el-select-dropdown__item')).some(el => el.textContent.includes('第 1 次复诊') && getComputedStyle(el).visibility === 'visible')`
    )
    await evaluate(
      `Array.from(document.querySelectorAll('.el-select-dropdown__item')).find(el => el.textContent.includes('第 1 次复诊') && getComputedStyle(el).visibility === 'visible').click()`
    )
    await wait(
      `document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('本次就诊暂无附件')`
    )
    await evaluate(
      `document.querySelector('.el-drawer [aria-label="就诊单据"]').closest('.el-select').querySelector('.el-select__wrapper').click()`
    )
    await evaluate(
      `Array.from(document.querySelectorAll('.el-select-dropdown__item')).find(el => el.textContent.includes('第 2 次复诊') && getComputedStyle(el).visibility === 'visible').click()`
    )
    await wait(
      `document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('检查报告测试.pdf')`
    )
    await wait(
      `(() => { const rect = document.querySelector('.el-drawer').getBoundingClientRect(); return rect.left >= 0 && rect.right <= window.innerWidth + 1 && rect.width >= 700 && rect.top >= 0 })()`
    )
    await rm(sourceImage)
    await rm(sourcePdf)
    await capture(window, 'visit-attachments')

    await button('[data-testid="attachment-table"] button', '合成舌苔测试.png')
    await wait(
      `document.querySelector('[data-testid="attachment-image-preview"]')?.naturalWidth === 900`
    )
    await capture(window, 'attachment-image-preview')
    await click('.el-dialog__headerbtn')
    await wait(`!document.querySelector('[data-testid="attachment-image-preview"]')`)
    await button('[data-testid="attachment-table"] button', '检查报告测试.pdf')
    await wait(
      `document.querySelector('[data-testid="attachment-pdf-preview"]')?.checkVisibility({ visibilityProperty: true, opacityProperty: true })`
    )
    // 内置 PDF 阅读器在独立渲染层绘制，iframe 出现后留出首次绘制时间再截图。
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await capture(window, 'attachment-pdf-preview')
    await click('.el-dialog__headerbtn')
    await wait(`!document.querySelector('[data-testid="attachment-pdf-preview"]')`)

    const output = join(temporaryDirectory, '导出原件.png')
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output })
    await button('[data-testid="attachment-table"] .el-table__row:first-child button', '导出原件')
    await wait(`document.body.innerText.includes('附件原件已导出')`)
    assert.deepEqual(await readFile(output), Buffer.from(image, 'base64'))
    await click('.el-drawer__close-btn')
    await wait(
      `!document.querySelector('.el-drawer') || getComputedStyle(document.querySelector('.el-drawer').parentElement).display === 'none'`
    )
    await evaluate(`document.getElementById('app-main').scrollTo({top:0})`)
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: join(artifacts, 'clinical-with-image.pdf')
    })
    await click('[data-testid="export-record"]')
    await wait(`Boolean(document.querySelector('[data-testid="export-images"] input'))`)
    assert.equal(
      await evaluate(`document.querySelectorAll('[data-testid="export-images"] input').length`),
      1
    )
    await click('[data-testid="export-images"] input')
    await click('[data-testid="confirm-export-record"]')
    await wait(`document.body.innerText.includes('PDF 已导出')`)
    assert.equal(
      (await readFile(join(artifacts, 'clinical-with-image.pdf'))).subarray(0, 5).toString(),
      '%PDF-'
    )

    // 错误页不接受内部文件操作，跨就诊图片不能混入 PDF。
    const forged = await evaluate(
      `window.emrDesktop.clinical('readAttachment', '${attachments[0].id}')`
    )
    assert.equal(forged.success, false)
    const wrongVisit = await evaluate(
      `window.emrDesktop.exportVisitPdf({visitId:'${firstId}',imageIds:['${attachments[0].id}']})`
    )
    assert.equal(wrongVisit.success, false)
    const wrongType = await evaluate(
      `window.emrDesktop.exportVisitPdf({visitId:'${visitId}',imageIds:['${attachments.find((item) => item.mediaType === 'application/pdf').id}']})`
    )
    assert.equal(wrongType.success, false)

    await click('[data-testid="visit-attachments"]')
    await wait(
      `document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('合成舌苔测试.png')`
    )
    await button('[data-testid="attachment-table"] .el-table__row:first-child button', '移除')
    await wait(`Boolean(document.querySelector('.el-message-box'))`)
    await button('.el-message-box button', '取消')
    await wait(`!document.querySelector('.el-message-box')`)
    assert.equal(
      (await evaluate(`window.emrDesktop.clinical('attachments', '${visitId}')`)).data.length,
      2
    )
    await button('[data-testid="attachment-table"] .el-table__row:first-child button', '移除')
    await wait(`Boolean(document.querySelector('.el-message-box'))`)
    await button('.el-message-box button', '移除')
    await wait(
      `!document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('合成舌苔测试.png')`
    )
    await click('.el-drawer__close-btn')
    assert.equal(
      (await evaluate(`window.emrDesktop.clinical('attachments', '${visitId}')`)).data.length,
      1
    )
  } finally {
    dialog.showOpenDialog = originalOpen
    dialog.showSaveDialog = originalSave
  }
  return { visitId, prescriptionCopy }
}

module.exports = { filesPrescriptionsWorkflow }
