const assert = require('node:assert/strict')
const { dialog } = require('electron')
const { join } = require('node:path')

async function continuousCaseWorkflow(
  window,
  { evaluate, waitFor, capture, artifacts, patientId, firstId, longText, dict }
) {
  const wait = (expression) => waitFor(window, expression)
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const setInput = (selector, value) =>
    evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    input.value = ${JSON.stringify(value)}
    input.dispatchEvent(new Event('input', {bubbles:true}))
  })()`)
  const field = (id, name) => `[data-record-id="${id}"] textarea[data-field="${name}"]`
  const saved = () =>
    wait(`document.querySelector('[data-testid="record-save-state"]')?.textContent === '已保存'`)
  const visits = async () =>
    (
      await evaluate(
        `window.emrDesktop.clinical('caseVisits', {patientId:'${patientId}',page:1,pageSize:100})`
      )
    ).data.items
  const navigate = async (path, testId) => {
    await evaluate(`location.hash = ${JSON.stringify('#' + path)}`)
    await wait(`Boolean(document.querySelector('[data-testid="${testId}"]'))`)
  }

  // 连续单据不能提供换医生或初复诊类型切换，复诊基本信息只有姓名。
  await click('[data-testid="new-visit"]')
  await wait(`document.querySelectorAll('[data-testid="record-document"]').length === 2`)
  assert.deepEqual(
    await evaluate(
      `Array.from(document.querySelectorAll('[data-testid="record-document"] h2')).map(el => el.textContent.trim())`
    ),
    ['初诊病例', '复诊病例']
  )
  assert.equal(
    await evaluate(
      `Boolean(document.querySelector('aside[aria-label="历次就诊"]') || document.querySelector('[aria-label="接诊医生"]') || document.querySelector('[aria-label="就诊类型"]'))`
    ),
    false
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-record-id="new"] input[data-testid="patient-name"]').value`
    ),
    '桌面流程测试'
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-record-id="new"]').textContent.includes('联系电话') || document.querySelector('[data-record-id="new"]').textContent.includes('婚否')`
    ),
    false
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-record-id="new"] .record-signature').textContent.trim()`
    ),
    '接诊医生：测试医生甲'
  )
  await setInput(field('new', 'narrative'), '同一医生的第一次复诊。')
  await setInput(field(firstId, 'mechanism'), '初诊补充内容与复诊一起保存。')
  await click('[data-testid="save-record"]')
  await saved()
  const second = (await visits())[1]
  assert.equal(second.doctorId, dict.data.doctors[0].id)
  assert.equal(second.kind, '复诊')
  assert.equal(second.body.narrative, '同一医生的第一次复诊。')
  assert.equal((await visits())[0].body.mechanism, '初诊补充内容与复诊一起保存。')
  assert.equal((await visits())[0].body.narrative, longText)
  await capture(window, 'record-followup')
  await click('[aria-label="刷新页面"]')
  await wait(
    `document.querySelectorAll('[data-testid="record-document"]').length === 2 && document.querySelector(${JSON.stringify(field(second.id, 'narrative'))})?.value === '同一医生的第一次复诊。'`
  )

  // 任意历史单据冲突都保留当前输入，用户确认放弃后才允许离开。
  await evaluate(`(async () => {
    const {data:v} = await window.emrDesktop.clinical('visit', '${second.id}')
    await window.emrDesktop.clinical('saveVisit', {id:v.id,revision:v.revision,date:v.date,kind:v.kind,patient:v.patient,body:{...v.body,narrative:'外部更新的复诊'},categoryIds:v.categoryIds})
  })()`)
  await setInput(field(second.id, 'narrative'), '当前页面尚未保存的修改')
  await click('[data-testid="save-record"]')
  await wait(`document.querySelector('.el-message--error')?.textContent.includes('其他页面更新')`)
  assert.equal(
    await evaluate(
      `document.querySelector(${JSON.stringify(field(second.id, 'narrative'))}).value`
    ),
    '当前页面尚未保存的修改'
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-testid="patient-detail"]').textContent.includes('其他页面更新')`
    ),
    false
  )
  await click('[data-testid="back-to-patients"]')
  await wait(`Boolean(document.querySelector('.el-message-box'))`)
  await evaluate(
    `Array.from(document.querySelectorAll('.el-message-box button')).find(el => el.textContent.trim() === '继续编辑').click()`
  )
  await wait(`!document.querySelector('.el-message-box')`)
  assert.equal(
    await evaluate(`Boolean(document.querySelector('[data-testid="patient-detail"]'))`),
    true
  )
  await click('[data-testid="back-to-patients"]')
  await wait(`Boolean(document.querySelector('.el-message-box'))`)
  await evaluate(
    `Array.from(document.querySelectorAll('.el-message-box button')).find(el => el.textContent.trim() === '放弃修改').click()`
  )
  await wait(`Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  await setInput('input[data-testid="patient-search"]', '13900000001')
  await wait(
    `document.querySelector('.el-table__body [data-testid="latest-doctor"]')?.textContent.trim() === '测试医生甲'`
  )
  await capture(window, 'patient-list')

  await click('[data-testid="new-case"]')
  await wait(`Boolean(document.querySelector('input[data-testid="patient-name"]'))`)
  await click('[data-testid="back-to-patients"]')
  await wait(`Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  await click('[data-testid="new-case"]')
  await wait(`Boolean(document.querySelector('input[data-testid="patient-name"]'))`)
  await setInput('input[data-testid="patient-name"]', '桌面流程测试')
  await setInput('input[data-testid="patient-phone"]', '13900000001')
  await click('[data-testid="save-record"]')
  await wait(
    `Array.from(document.querySelectorAll('.el-message--error')).some(el => el.textContent.includes('复诊入口'))`
  )
  await click('[data-testid="back-to-patients"]')
  await wait(`Boolean(document.querySelector('.el-message-box'))`)
  await evaluate(
    `Array.from(document.querySelectorAll('.el-message-box button')).find(el => el.textContent.trim() === '放弃修改').click()`
  )
  await wait(`Boolean(document.querySelector('[data-testid="patients-page"]'))`)

  await wait(`Boolean(document.querySelector('.el-table__body [data-testid="follow-up"]'))`)
  await click('.el-table__body [data-testid="follow-up"]')
  await wait(
    `document.querySelectorAll('[data-testid="record-document"]').length === 3 && document.querySelector('[data-testid="record-save-state"]')?.textContent === '待保存'`
  )
  assert.equal(await evaluate(`location.hash`), '#/patients/' + patientId + '?visit=new')
  await click('[data-testid="back-to-patients"]')
  await wait(`Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  assert.equal((await visits()).length, 2)
  await wait(`Boolean(document.querySelector('.el-table__body [data-testid="follow-up"]'))`)
  await click('.el-table__body [data-testid="follow-up"]')
  await wait(`Boolean(document.querySelector('[data-record-id="new"]'))`)
  await setInput(field('new', 'narrative'), '从病例列表进入第二次复诊。')
  await click('[data-testid="save-record"]')
  await saved()
  await wait(`location.hash === '#/patients/${patientId}'`)
  await click('[aria-label="刷新页面"]')
  await wait(`document.querySelectorAll('[data-testid="record-document"]').length === 3`)
  assert.equal((await visits()).length, 3)
  assert.equal((await visits())[2].body.narrative, '从病例列表进入第二次复诊。')
  await setInput('input[data-testid="patient-phone"]', '13900000002')
  await click('[data-testid="save-record"]')
  await saved()
  assert.equal(
    (await evaluate(`window.emrDesktop.clinical('patient', '${patientId}')`)).data.phone,
    '13900000002'
  )
  assert.equal((await visits())[1].patient.phone, '13900000001')

  await navigate('/clinical-settings', 'clinical-settings-page')
  await wait(
    `Array.from(document.querySelectorAll('.el-table__body tr')).some(el => el.textContent.includes('测试医生甲'))`
  )
  await evaluate(
    `Array.from(document.querySelectorAll('.el-table__body tr')).find(el => el.textContent.includes('测试医生甲')).querySelector('button').click()`
  )
  await wait(`Boolean(document.querySelector('input[data-testid="dictionary-name"]'))`)
  await setInput('input[data-testid="dictionary-name"]', '测试医生甲已更名')
  await click('[data-testid="dictionary-submit"]')
  await wait(`document.querySelector('.el-table__body')?.textContent.includes('测试医生甲已更名')`)
  await navigate('/patients/' + patientId, 'patient-detail')
  const namesMatch = (name) =>
    `document.querySelectorAll('.record-signature').length === 3 && Array.from(document.querySelectorAll('.record-signature')).every(el => el.textContent.includes('${name}')) && document.querySelector('[data-testid="case-doctor"]')?.textContent === '${name}'`
  await wait(namesMatch('测试医生甲已更名'))
  await setInput(field(firstId, 'mechanism'), '医生更名时保留这段输入。')
  await evaluate(`(async () => {
    const {data} = await window.emrDesktop.clinical('dictionaries', null)
    const doctor = data.doctors.find(item => item.id === '${dict.data.doctors[0].id}')
    await window.emrDesktop.clinical('saveDictionary', {...doctor,kind:'doctor',name:'测试医生甲最新名'})
  })()`)
  await evaluate(`window.dispatchEvent(new Event('focus'))`)
  await wait(namesMatch('测试医生甲最新名'))
  assert.equal(
    await evaluate(`document.querySelector(${JSON.stringify(field(firstId, 'mechanism'))}).value`),
    '医生更名时保留这段输入。'
  )
  await click('[data-testid="save-record"]')
  await saved()
  await click('[aria-label="刷新页面"]')
  await wait(namesMatch('测试医生甲最新名'))
  await capture(window, 'record-continuous')

  window.setSize(1000, 700)
  await capture(window, 'record-editor-compact')
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('[data-testid="record-document"]')).every(el => el.scrollWidth <= el.clientWidth + 1)`
    ),
    true
  )
  assert.equal(await evaluate(`document.documentElement.scrollWidth > window.innerWidth`), false)
  await click('[aria-label="切换主题"]')
  await wait(
    `document.documentElement.classList.contains('dark') && !document.documentElement.matches(':active-view-transition')`
  )
  await capture(window, 'record-editor-dark')
  await click('[aria-label="切换主题"]')
  await wait(
    `!document.documentElement.classList.contains('dark') && !document.documentElement.matches(':active-view-transition')`
  )
  window.setSize(1360, 900)

  const originalSave = dialog.showSaveDialog
  dialog.showSaveDialog = async () => ({
    canceled: false,
    filePath: join(artifacts, 'clinical-followup.pdf')
  })
  try {
    await click('[data-testid="export-record"]')
    await wait(
      `document.querySelector('[data-testid="confirm-export-record"]')?.disabled === false`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.el-dialog .el-radio-button.is-active').textContent.trim()`
      ),
      '复诊'
    )
    await click('[data-testid="confirm-export-record"]')
    await wait(`document.body.innerText.includes('PDF 已导出')`)
  } finally {
    dialog.showSaveDialog = originalSave
  }
}

module.exports = { continuousCaseWorkflow }
