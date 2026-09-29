const assert = require('node:assert/strict')
const { join } = require('node:path')
const { readFile } = require('node:fs/promises')
const { dialog } = require('electron')
const { continuousCaseWorkflow } = require('./continuous-case-desktop.cjs')

async function clinicalWorkflow(window, { evaluate, waitFor, capture, artifacts }) {
  const wait = (expression) => waitFor(window, expression)
  const setInput = (selector, value) =>
    evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    input.value = ${JSON.stringify(value)}
    if (input.setSelectionRange) input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  const click = (selector) =>
    evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const navigate = async (path, testId) => {
    await evaluate(`location.hash = ${JSON.stringify('#' + path)}`)
    await wait(`Boolean(document.querySelector('[data-testid="${testId}"]'))`)
  }
  await navigate('/clinical-settings', 'clinical-settings-page')
  for (const name of ['测试医生甲', '测试医生乙']) {
    await click('[data-testid="dictionary-add"]')
    await wait(`Boolean(document.querySelector('input[data-testid="dictionary-name"]'))`)
    await setInput('input[data-testid="dictionary-name"]', name)
    await click('[data-testid="dictionary-submit"]')
    await wait(
      `Array.from(document.querySelectorAll('.el-table__body td')).some(cell => cell.textContent.includes(${JSON.stringify(name)}))`
    )
  }
  await evaluate(
    `Array.from(document.querySelectorAll('.el-tabs__item')).find(item => item.textContent === '就诊分类').click()`
  )
  await click('[data-testid="dictionary-add"]')
  await setInput('input[data-testid="dictionary-name"]', '肝脏')
  await click('[data-testid="dictionary-submit"]')
  await wait(
    `Array.from(document.querySelectorAll('.el-table__body td')).some(cell => cell.textContent.includes('肝脏'))`
  )
  const dict = await evaluate(`window.emrDesktop.clinical('dictionaries', null)`)
  assert.equal(dict.success, true)
  assert.equal(dict.data.doctors.length, 2)
  await capture(window, 'clinical-dictionaries')

  await navigate('/patients', 'patients-page')
  await click('[aria-label="关闭医生与分类标签"]')
  await wait(`!document.querySelector('[aria-label="关闭医生与分类标签"]')`)
  assert.equal(await evaluate(`location.hash`), '#/patients')
  assert.equal(
    await evaluate(`document.querySelector('header').getBoundingClientRect().height`),
    60
  )
  await click('[data-testid="new-case"]')
  await wait(`Boolean(document.querySelector('input[data-testid="patient-name"]'))`)
  await capture(window, 'record-new-case')
  // 首次字段校验失败后补全资料仍能保存，不能保留一个已结束的保存 Promise。
  await click('[data-testid="save-record"]')
  await wait(`document.querySelector('.el-message--error')?.textContent.includes('姓名')`)
  await setInput('input[data-testid="patient-name"]', '桌面流程测试')
  await setInput('input[data-testid="patient-phone"]', '13900000001')
  await setInput('input[aria-label="年龄"]', '36')
  await evaluate(
    `document.querySelector('[aria-label="婚否"]').closest('.el-select').querySelector('.el-select__wrapper').click()`
  )
  await wait(
    `Array.from(document.querySelectorAll('.el-select-dropdown__item')).some(item => item.textContent === '是')`
  )
  await evaluate(
    `Array.from(document.querySelectorAll('.el-select-dropdown__item')).find(item => item.textContent === '是').click()`
  )
  assert.equal(await evaluate(`Boolean(document.querySelector('.el-dialog'))`), false)
  assert.equal(
    (
      await evaluate(
        `window.emrDesktop.clinical('patients', {keyword:'',doctorId:'',categoryId:'',page:1,pageSize:20})`
      )
    ).data.total,
    0
  )
  await wait(`Boolean(document.querySelector('textarea[data-field="narrative"]'))`)
  await setInput(
    'textarea[data-field="narrative"]',
    '本段仅用于软件验证。\n第一位医生的首次就诊记录。'
  )
  await setInput('textarea[data-field="mechanism"]', '待医生填写')
  await setInput('textarea[data-field="diagnosis"]', '测试记录，不作诊断用途')
  await setInput('textarea[data-field="prescription"]', '仅验证处方文字保存，不包含用药建议。')
  await evaluate(
    `document.querySelector('[aria-label="本次就诊分类"]').closest('.el-select').querySelector('.el-select__wrapper').click()`
  )
  await wait(
    `Array.from(document.querySelectorAll('.el-select-dropdown__item')).some(item => item.textContent === '肝脏')`
  )
  await evaluate(
    `Array.from(document.querySelectorAll('.el-select-dropdown__item')).find(item => item.textContent === '肝脏').click()`
  )
  await click('[data-testid="record-document"] h2')
  // 首次保存回填身份期间继续输入，不得被结果或地址切换覆盖。
  await evaluate(`(() => {
    document.querySelector('[data-testid="save-record"]').click()
    queueMicrotask(() => {
      const input = document.querySelector('textarea[data-field="narrative"]')
      input.value += '\\n保存期间继续输入。'
      input.dispatchEvent(new Event('input', {bubbles:true}))
    })
  })()`)
  await wait(
    `document.querySelector('[data-testid="record-save-state"]')?.textContent === '已保存'`
  )
  await wait(`!location.hash.endsWith('/new')`)
  const patientId = await evaluate(`location.hash.split('/').pop()`)
  const visits = await evaluate(
    `window.emrDesktop.clinical('visits', {patientId:${JSON.stringify(patientId)}, page:1, pageSize:20})`
  )
  const firstId = visits.data.items[0].id
  const first = await evaluate(`window.emrDesktop.clinical('visit', ${JSON.stringify(firstId)})`)
  assert.ok(first.data.body.narrative.includes('首次就诊记录'))
  assert.ok(first.data.body.narrative.endsWith('保存期间继续输入。'))
  assert.deepEqual(first.data.categoryIds, [dict.data.categories[0].id])
  assert.equal(first.data.patient.age, '36')
  assert.equal(first.data.patient.maritalStatus, '是')
  assert.deepEqual(
    await evaluate(`(() => {
      const actions = document.querySelector('[data-testid="case-actions"]')
      const back = actions.querySelector('[data-testid="back-to-patients"]')
      return {
        backIcon: back.classList.contains('is-circle') && !back.classList.contains('el-button--primary') && Boolean(back.querySelector('svg')) && back.textContent.trim() === '',
        backName: back.getAttribute('aria-label'),
        noPatient: !actions.textContent.includes('桌面流程测试') && !actions.textContent.includes('13900000001') && !actions.querySelector('input'),
        actions: Array.from(actions.querySelectorAll('button')).slice(1).map(el => el.textContent.trim()),
        noPicker: !document.querySelector('[aria-label="选择已有患者"]')
      }
    })()`),
    {
      backIcon: true,
      backName: '返回病例列表',
      noPatient: true,
      actions: ['新增复诊', '附件', '导出 PDF'],
      noPicker: true
    }
  )
  assert.equal(
    await evaluate(`(() => {
      const section = document.querySelector('section[aria-label="处方"]')
      const label = section.querySelector('label').getBoundingClientRect()
      const action = section.querySelector('[data-testid="pick-prescription"]').getBoundingClientRect()
      return Math.abs(label.top + label.height / 2 - action.top - action.height / 2) < 2 && action.left > label.right && !document.querySelector('[data-testid="record-toolbar"] [data-testid="pick-prescription"]')
    })()`),
    true
  )
  await capture(window, 'record-editor')
  const shortHeight = await evaluate(
    `document.querySelector('textarea[data-field="narrative"]').getBoundingClientRect().height`
  )

  // 刷新必须先提交仍在防抖中的输入，不能卸载后丢失草稿。
  const longText =
    Array.from(
      { length: 24 },
      (_, i) => `软件验证第${i + 1}行：中文标点、英文 ABC 与换行均须保留。`
    ).join('\n') + '\n最后一行 END-临床测试'
  await evaluate(`(() => {
    const input = document.querySelector('textarea[data-field="narrative"]')
    input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}))
    input.value = ${JSON.stringify(longText)}
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true, data:'临床测试'}))
    input.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertCompositionText', isComposing:false}))
  })()`)
  await click('[aria-label="刷新页面"]')
  await wait(
    `document.querySelector('textarea[data-field="narrative"]')?.value === ${JSON.stringify(longText)} && document.querySelector('[data-testid="record-save-state"]')?.textContent === '已保存'`
  )
  const texts = await evaluate(
    `Array.from(document.querySelectorAll('textarea[data-field="narrative"]')).map(el => el.value).join('')`
  )
  assert.equal(texts, longText)
  assert.equal(
    await evaluate(`document.querySelectorAll('[data-testid="record-document"]').length`),
    1
  )
  assert.equal(
    await evaluate(`document.querySelectorAll('textarea[data-field="prescription"]').length`),
    1
  )
  assert.ok(
    await evaluate(
      `document.querySelector('textarea[data-field="narrative"]').getBoundingClientRect().height > ${shortHeight + 300}`
    )
  )
  assert.equal(
    await evaluate(
      `(() => {const el = document.querySelector('textarea[data-field="narrative"]'); return el.scrollHeight <= el.clientHeight + 1})()`
    ),
    true
  )
  await evaluate(`document.getElementById('app-main').scrollTo({top:600})`)
  await wait(
    `Math.abs(document.querySelector('[data-testid="record-toolbar"]').getBoundingClientRect().top - document.getElementById('app-header').getBoundingClientRect().bottom) < 2`
  )
  await capture(window, 'record-editor-scrolled')
  // 顶部留白属于不透明的 Header，不能命中滚动到其背后的文档。
  const headerCoverage = await evaluate(`(() => {
    const header = document.getElementById('app-header'), rect = header.getBoundingClientRect()
    const hit = document.elementFromPoint(rect.right - 250, rect.bottom - 3)
    return { covered: header.contains(hit), background: getComputedStyle(header).backgroundColor, hit: hit?.outerHTML.slice(0,200), top: rect.top, bottom: rect.bottom }
  })()`)
  assert.equal(headerCoverage.covered, true, JSON.stringify(headerCoverage))
  assert.notEqual(headerCoverage.background, 'rgba(0, 0, 0, 0)')

  const pdfPath = join(artifacts, 'clinical-visit.pdf')
  const originalDialog = dialog.showSaveDialog
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: pdfPath })
  try {
    await click('[data-testid="export-record"]')
    await wait(
      `document.querySelector('[data-testid="confirm-export-record"]')?.disabled === false`
    )
    await click('[data-testid="confirm-export-record"]')
    await wait(`document.body.innerText.includes('PDF 已导出')`)
  } finally {
    dialog.showSaveDialog = originalDialog
  }
  const bytes = await readFile(pdfPath)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.ok(bytes.byteLength > 1000)

  await continuousCaseWorkflow(window, {
    evaluate,
    waitFor,
    capture,
    artifacts,
    patientId,
    firstId,
    longText,
    dict
  })
  return { patientId, firstId, longText }
}

module.exports = { clinicalWorkflow }
