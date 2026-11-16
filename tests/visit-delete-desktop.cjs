const assert = require('node:assert/strict')
const { join } = require('node:path')
const { readFile, writeFile } = require('node:fs/promises')
const { dialog } = require('electron')

async function visitDeleteWorkflow(
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
  const record = (id) => `[data-record-id="${id}"]`
  const field = (id, name) => `${record(id)} textarea[data-field="${name}"]`
  const deleteButton = (id) => `${record(id)} [data-testid="delete-followup"]`
  const setCode = (id, name, value) => `{
    const input = document.querySelector(${JSON.stringify(field(id, name))})
    input.value = ${JSON.stringify(value)}
    input.dispatchEvent(new Event('input', {bubbles:true}))
  }`
  const confirm = async (label) => {
    await wait(`Boolean(document.querySelector('.el-message-box'))`)
    await evaluate(
      `Array.from(document.querySelectorAll('.el-message-box button')).findLast(el => el.getClientRects().length && getComputedStyle(el).visibility === 'visible' && el.textContent.trim() === ${JSON.stringify(label)}).click()`
    )
    await wait(`!document.querySelector('.el-message-box')`)
  }
  const saved = () =>
    wait(`document.querySelector('[data-testid="record-save-state"]')?.textContent === '已保存'`)
  const dictionaries = await call('dictionaries', null)
  const doctor = dictionaries.doctors.find((item) => item.active)
  const input = {
    patientId: null,
    doctorId: doctor.id,
    date: '2026-10-01',
    kind: '初诊',
    categoryIds: [],
    patient: {
      name: '单删复诊桌面测试',
      phone: '',
      sex: '未填',
      birthDate: '',
      address: '',
      occupation: '',
      ethnicity: '',
      maritalStatus: '',
      age: ''
    },
    body: { narrative: '初诊保留正文', mechanism: '', diagnosis: '', prescription: '初诊合成处方' }
  }
  const first = await call('createCase', input)
  const middle = await call('createCase', {
    ...input,
    patientId: first.patientId,
    date: '2026-10-02',
    kind: '复诊',
    body: { ...input.body, narrative: '中间复诊', prescription: '中间合成处方' }
  })
  const last = await call('createCase', {
    ...input,
    patientId: first.patientId,
    date: '2026-10-03',
    kind: '复诊',
    body: { ...input.body, narrative: '最后复诊', prescription: '最后合成处方' }
  })
  const visits = () => call('caseVisits', { patientId: first.patientId, page: 1, pageSize: 100 })
  const image = join(temporaryDirectory, '单删复诊图片.png')
  const imageBytes = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  await writeFile(image, imageBytes)
  const originalDialog = dialog.showOpenDialog
  const attachments = []
  try {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] })
    for (const visit of [first, middle, last]) {
      const result = await evaluate(
        `window.emrDesktop.importAttachments(${JSON.stringify({ visitId: visit.id, kind: '检查单' })})`
      )
      assert.equal(result.success, true, result.message)
      attachments.push(result.data.added[0])
    }
  } finally {
    dialog.showOpenDialog = originalDialog
  }
  await evaluate(`location.hash = '#/patients/${first.patientId}'`)
  await wait(`document.querySelectorAll('[data-testid="record-document"]').length === 3`)
  assert.equal(
    await evaluate(`Boolean(document.querySelector(${JSON.stringify(deleteButton(first.id))}))`),
    false
  )
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-testid="delete-followup"]').length`),
    2
  )
  const rejected = await evaluate(
    `window.emrDesktop.clinical('deleteVisit', ${JSON.stringify({ id: first.id, revision: first.revision })})`
  )
  assert.equal(rejected.success, false)
  assert.ok(rejected.message.includes('初诊不能单独删除'))

  await click(deleteButton(middle.id))
  await wait(`document.querySelector('.el-message-box')?.textContent.includes('2026-10-02')`)
  const message = await evaluate(`document.querySelector('.el-message-box').textContent`)
  assert.ok(message.includes(input.patient.name) && message.includes('记录及其附件'))
  await confirm('取消')
  assert.deepEqual((await visits()).items, [first, middle, last])
  assert.equal((await call('attachments', middle.id)).length, 1)

  // 与删除同一时刻产生的其他单据输入不能被重载覆盖，确认期间也不自动提交。
  await evaluate(`(() => {
    ${setCode(first.id, 'mechanism', '初诊尚未保存的补充')}
    ${setCode(last.id, 'prescription', '末次尚未保存处方')}
    window.retainedRecordEditor = document.querySelector(${JSON.stringify(record(last.id))})
    document.querySelector(${JSON.stringify(deleteButton(middle.id))}).click()
  })()`)
  await wait(`Boolean(document.querySelector('.el-message-box'))`)
  await new Promise((resolveWait) => setTimeout(resolveWait, 1100))
  assert.equal((await call('visit', first.id)).body.mechanism, '')
  assert.equal((await call('visit', last.id)).body.prescription, last.body.prescription)
  await capture(window, 'followup-delete-confirm')
  await confirm('删除本次复诊')
  await wait(`document.querySelectorAll('[data-testid="record-document"]').length === 2`)
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(record(last.id))}) === window.retainedRecordEditor`
    ),
    true
  )
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(field(last.id, 'prescription'))}).value`
    ),
    '末次尚未保存处方'
  )
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(field(first.id, 'mechanism'))}).value`),
    '初诊尚未保存的补充'
  )
  await saved()
  assert.deepEqual(
    (await visits()).items.map((item) => item.id),
    [first.id, last.id]
  )
  assert.equal((await call('visit', last.id)).body.prescription, '末次尚未保存处方')
  await assert.rejects(readFile(join(options.dataDirectory, 'attachments', attachments[1].id)), {
    code: 'ENOENT'
  })
  assert.deepEqual(
    await readFile(join(options.dataDirectory, 'attachments', attachments[0].id)),
    imageBytes
  )
  assert.deepEqual(
    await readFile(join(options.dataDirectory, 'attachments', attachments[2].id)),
    imageBytes
  )

  // 中间复诊删除后，上次处方应直接来自仍保留的初诊。
  const trigger = `${record(last.id)} [data-testid="pick-prescription"]`
  const menu = `Array.from(document.querySelectorAll('[role="menu"]')).find(el => el.getAttribute('aria-labelledby') === document.querySelector(${JSON.stringify(trigger)}).id)`
  await click(trigger)
  await wait(
    `document.querySelector(${JSON.stringify(trigger)}).getAttribute('aria-expanded') === 'true' && Boolean(${menu})`
  )
  await evaluate(`${menu}.querySelector('[data-testid="use-previous-prescription"]').click()`)
  await confirm('替换处方')
  await saved()
  assert.equal((await call('visit', last.id)).body.prescription, first.body.prescription)
  assert.equal((await call('visit', first.id)).body.prescription, first.body.prescription)

  // 未保存复诊可直接删除，不生成数据库空记录，刷新也不能再次追加草稿。
  await evaluate(`location.hash = '#/patients/${first.patientId}?visit=new'`)
  await wait(`Boolean(document.querySelector('[data-record-id="new"]'))`)
  await evaluate(`(() => {
    ${setCode('new', 'narrative', '待丢弃的未入库草稿')}
    ${setCode(first.id, 'diagnosis', '删除草稿时保留的初诊输入')}
    document.querySelector(${JSON.stringify(deleteButton('new'))}).click()
  })()`)
  await wait(`document.querySelector('.el-message-box')?.textContent.includes('草稿')`)
  await confirm('删除本次复诊')
  await wait(
    `!document.querySelector('[data-record-id="new"]') && !location.hash.includes('visit=new')`
  )
  assert.equal((await visits()).total, 2)
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(field(first.id, 'diagnosis'))}).value`),
    '删除草稿时保留的初诊输入'
  )
  await saved()
  await click('[aria-label="刷新页面"]')
  await wait(
    `document.querySelectorAll('[data-testid="record-document"]').length === 2 && !document.querySelector('[data-record-id="new"]')`
  )

  // 过期页面删除失败时，当前输入原样保留，不能把错误放进病例正文。
  await evaluate(`(() => {
    ${setCode(last.id, 'narrative', '删除失败仍保留的本地输入')}
    document.querySelector(${JSON.stringify(deleteButton(last.id))}).click()
  })()`)
  await wait(`Boolean(document.querySelector('.el-message-box'))`)
  const current = await call('visit', last.id)
  const { id, revision, date, kind, patient, body, categoryIds } = current
  await call('saveVisit', {
    id,
    revision,
    date,
    kind,
    patient,
    body: { ...body, narrative: '外部更新内容' },
    categoryIds
  })
  await confirm('删除本次复诊')
  await wait(
    `Array.from(document.querySelectorAll('.el-message--error')).some(el => el.textContent.includes('其他页面更新'))`
  )
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(field(last.id, 'narrative'))}).value`),
    '删除失败仍保留的本地输入'
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-testid="patient-detail"]').textContent.includes('其他页面更新')`
    ),
    false
  )
  assert.equal((await visits()).total, 2)
  await click('[data-testid="back-to-patients"]')
  await wait(`document.querySelector('.el-message-box')?.textContent.includes('离开病历')`)
  await confirm('放弃修改')
  await wait(`Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  await evaluate(`location.hash = '#/patients/${first.patientId}'`)
  await wait(
    `document.querySelector(${JSON.stringify(field(last.id, 'narrative'))})?.value === '外部更新内容'`
  )
  await click(deleteButton(last.id))
  await confirm('删除本次复诊')
  await wait(`document.querySelectorAll('[data-testid="record-document"]').length === 1`)
  await wait(
    `document.querySelector('[data-testid="latest-visit-summary"]')?.textContent.includes('初诊 · 2026-10-01')`
  )
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-testid="delete-followup"]').length`),
    0
  )
  assert.equal((await visits()).total, 1)
  await assert.rejects(readFile(join(options.dataDirectory, 'attachments', attachments[2].id)), {
    code: 'ENOENT'
  })

  // 附件与导出默认回到剩余初诊，不残留已删除复诊或图片。
  await click('[data-testid="visit-attachments"]')
  await wait(
    `document.querySelector('[data-testid="attachment-table"]')?.textContent.includes('单删复诊图片.png')`
  )
  const drawer = `document.querySelector('[data-testid="attachment-import"]').closest('.el-drawer')`
  assert.ok((await evaluate(`${drawer}.textContent`)).includes('2026-10-01 · 初诊'))
  assert.equal(
    await evaluate(`${drawer}.querySelector('input[type="radio"][value="复诊"]').disabled`),
    true
  )
  await evaluate(`${drawer}.querySelector('.el-drawer__close-btn').click()`)
  await wait(
    `!${drawer}.getClientRects().length || getComputedStyle(${drawer}).visibility === 'hidden'`
  )
  await click('[data-testid="export-record"]')
  await wait(
    `document.querySelector('[data-testid="export-images"]')?.textContent.includes('单删复诊图片.png')`
  )
  const exportPanel = `document.querySelector('[data-testid="export-images"]').closest('.el-dialog')`
  assert.equal(
    await evaluate(`${exportPanel}.querySelector('input[type="radio"][value="复诊"]').disabled`),
    true
  )
  assert.ok((await evaluate(`${exportPanel}.textContent`)).includes('2026-10-01 · 初诊'))
  await evaluate(
    `Array.from(${exportPanel}.querySelectorAll('button')).find(el => el.textContent.trim() === '取消').click()`
  )
  await capture(window, 'followup-delete-result')
  await click('[aria-label="刷新页面"]')
  await wait(`document.querySelectorAll('[data-testid="record-document"]').length === 1`)
  assert.equal((await visits()).items[0].body.diagnosis, '删除草稿时保留的初诊输入')

  await click('[data-testid="back-to-patients"]')
  await wait(`Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  const row = (
    await call('patients', {
      keyword: input.patient.name,
      doctorId: '',
      categoryId: '',
      page: 1,
      pageSize: 20
    })
  ).items[0]
  assert.equal(row.visitCount, 1)
  assert.equal(row.latestVisitDate, first.date)
  await call('deleteCase', {
    patientId: row.id,
    revision: row.revision,
    updatedAt: row.updatedAt,
    visitCount: row.visitCount
  })
}

module.exports = { visitDeleteWorkflow }
