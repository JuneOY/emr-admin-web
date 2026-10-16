const assert = require('node:assert/strict')
const { join } = require('node:path')
const { readFile, writeFile } = require('node:fs/promises')
const { dialog } = require('electron')

async function caseDeleteWorkflow(
  window,
  { evaluate, waitFor, capture, temporaryDirectory, options }
) {
  const wait = (expression) => waitFor(window, expression)
  const call = async (method, input) => {
    const result = await evaluate(
      `window.emrDesktop.clinical(${JSON.stringify(method)}, ${JSON.stringify(input)})`
    )
    assert.equal(result.success, true, result.message)
    return result.data
  }
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const button = async (label) => {
    await evaluate(
      `Array.from(document.querySelectorAll('.el-message-box button')).findLast(el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible' && el.textContent.trim() === ${JSON.stringify(label)}).click()`
    )
    // Promise 在关闭动画结束前即完成；须等旧弹窗卸载，避免下一次点到旧确认按钮。
    await wait(`!document.querySelector('.el-message-box')`)
  }
  const dictionaries = await call('dictionaries', null)
  const doctor = dictionaries.doctors.find((item) => item.active)
  const input = {
    patientId: null,
    doctorId: doctor.id,
    date: '2026-10-09',
    kind: '初诊',
    categoryIds: [],
    patient: {
      name: '删除验证00',
      phone: '',
      sex: '未填',
      birthDate: '',
      address: '',
      occupation: '',
      ethnicity: '',
      maritalStatus: '',
      age: ''
    },
    body: { narrative: '合成待删除记录', mechanism: '', diagnosis: '', prescription: '合成处方' }
  }
  const first = await call('createCase', input)
  const followup = await call('createVisit', {
    patientId: first.patientId,
    doctorId: doctor.id,
    date: '2026-10-10',
    kind: '复诊'
  })
  const image = join(temporaryDirectory, '删除验证图片.png')
  await writeFile(image, Buffer.from('89504e470d0a1a0a00000000', 'hex'))
  const originalDialog = dialog.showOpenDialog
  let attachment
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] })
    const result = await evaluate(
      `window.emrDesktop.importAttachments(${JSON.stringify({ visitId: followup.id, kind: '检查单' })})`
    )
    assert.equal(result.success, true, result.message)
    attachment = result.data.added[0]
  } finally {
    dialog.showOpenDialog = originalDialog
  }
  const additional = []
  for (let index = 1; index <= 20; index++) {
    additional.push(
      await call('createCase', {
        ...input,
        patient: { ...input.patient, name: `删除验证${String(index).padStart(2, '0')}` }
      })
    )
  }
  await evaluate(`location.hash = '#/patients'`)
  await wait(`Boolean(document.querySelector('input[data-testid="patient-search"]'))`)
  await evaluate(`(() => {
    const input = document.querySelector('input[data-testid="patient-search"]')
    input.value = '删除验证'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await wait(`document.querySelector('.el-pagination__total')?.textContent.includes('21')`)
  await click('.el-pagination .btn-next')
  await wait(
    `document.querySelectorAll('.el-table__body tr').length === 1 && document.querySelector('.el-table__body').textContent.includes('删除验证00')`
  )
  await click('.el-table__body [data-testid="delete-case"]')
  await wait(`Boolean(document.querySelector('.el-message-box'))`)
  const confirmation = await evaluate(`document.querySelector('.el-message-box').textContent`)
  assert.ok(confirmation.includes('删除验证00') && confirmation.includes(first.recordNumber))
  assert.ok(confirmation.includes('全部 2 次就诊') && confirmation.includes('关联附件'))
  await capture(window, 'case-delete-confirm')
  await button('取消')
  await wait(`!document.querySelector('.el-message-box')`)
  assert.equal((await call('patient', first.patientId)).id, first.patientId)
  assert.equal((await call('attachments', followup.id)).length, 1)

  // 确认期间新增的就诊必须阻止旧请求，错误仅显示 message。
  await click('.el-table__body [data-testid="delete-case"]')
  await wait(`Boolean(document.querySelector('.el-message-box'))`)
  await call('createVisit', {
    patientId: first.patientId,
    doctorId: doctor.id,
    date: '2026-10-11',
    kind: '复诊'
  })
  await button('删除整份病例')
  await wait(
    `Array.from(document.querySelectorAll('.el-message--error')).some(el => el.textContent.includes('病例已更新'))`
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-testid="patients-page"]').textContent.includes('病例已更新')`
    ),
    false
  )
  assert.equal((await call('patient', first.patientId)).id, first.patientId)
  // 新就诊使该患者排到首页；回到首页重新确认最新列表。
  await click('.el-pagination .btn-prev')
  await wait(`document.querySelector('.el-table__body tr')?.textContent.includes('删除验证00')`)
  await click('.el-table__body tr [data-testid="delete-case"]')
  await wait(`document.querySelector('.el-message-box')?.textContent.includes('全部 3 次就诊')`)
  await button('删除整份病例')
  await wait(`document.querySelector('.el-pagination__total')?.textContent.includes('20')`)
  assert.equal(
    (await evaluate(`window.emrDesktop.clinical('patient', '${first.patientId}')`)).success,
    false
  )
  assert.equal(
    (await evaluate(`window.emrDesktop.clinical('visit', '${followup.id}')`)).success,
    false
  )
  await assert.rejects(readFile(join(options.dataDirectory, 'attachments', attachment.id)), {
    code: 'ENOENT'
  })
  assert.equal((await call('patient', additional[0].patientId)).id, additional[0].patientId)

  // 再建立一条并从末页删除，确认最后一条消失时自动回到有效页。
  await call('createCase', { ...input, patient: { ...input.patient, name: '删除验证末页' } })
  await click('[aria-label="刷新页面"]')
  await wait(`Boolean(document.querySelector('input[data-testid="patient-search"]'))`)
  await evaluate(
    `(() => { const input = document.querySelector('input[data-testid="patient-search"]'); input.value = '删除验证'; input.dispatchEvent(new Event('input', { bubbles: true })) })()`
  )
  await wait(`document.querySelector('.el-pagination__total')?.textContent.includes('21')`)
  await click('.el-pagination .btn-next')
  await wait(`document.querySelectorAll('.el-table__body tr').length === 1`)
  await click('.el-table__body [data-testid="delete-case"]')
  await wait(`Boolean(document.querySelector('.el-message-box'))`)
  await button('删除整份病例')
  try {
    await wait(
      `document.querySelector('.el-pagination__total')?.textContent.includes('20') && document.querySelector('.el-pager .is-active')?.textContent.trim() === '1'`
    )
  } catch (error) {
    console.error(
      '末页删除诊断',
      await evaluate(`({
      total: document.querySelector('.el-pagination__total')?.textContent,
      page: document.querySelector('.el-pager .is-active')?.textContent,
      keyword: document.querySelector('input[data-testid="patient-search"]')?.value,
      rows: Array.from(document.querySelectorAll('.el-table__body tr')).map(el => el.textContent),
      messages: Array.from(document.querySelectorAll('.el-message')).map(el => el.textContent)
    })`)
    )
    const result = await call('patients', {
      keyword: '删除验证',
      doctorId: '',
      categoryId: '',
      page: 1,
      pageSize: 100
    })
    console.error('筛选查询数量', result.total)
    await capture(window, 'case-delete-failure')
    throw error
  }
  await capture(window, 'case-delete-list')
  const remaining = await call('patients', {
    keyword: '删除验证',
    doctorId: '',
    categoryId: '',
    page: 1,
    pageSize: 100
  })
  for (const row of remaining.items) {
    await call('deleteCase', {
      patientId: row.id,
      revision: row.revision,
      updatedAt: row.updatedAt,
      visitCount: row.visitCount
    })
  }
}

module.exports = { caseDeleteWorkflow }
