const assert = require('node:assert/strict')
const { join } = require('node:path')
const { mkdir, readFile, readdir, writeFile } = require('node:fs/promises')
const { dialog } = require('electron')
const XLSX = require('xlsx')

async function exportsWorkflow(window, { evaluate, waitFor, temporaryDirectory, artifacts }) {
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
  const directory = join(temporaryDirectory, '批量导出结果')
  await mkdir(directory)
  const { doctors } = await call('dictionaries', null)
  const input = {
    patientId: null,
    doctorId: doctors.find((item) => item.active).id,
    date: '2026-11-16',
    kind: '初诊',
    categoryIds: [],
    patient: {
      name: '批量导出测试甲',
      phone: '',
      sex: '未填',
      birthDate: '',
      address: '',
      occupation: '',
      ethnicity: '',
      maritalStatus: '',
      age: ''
    },
    body: { narrative: '合成导出记录', mechanism: '', diagnosis: '', prescription: '测试处方' }
  }
  const first = await call('createCase', input)
  await call('createVisit', {
    patientId: first.patientId,
    doctorId: input.doctorId,
    date: '2026-11-17',
    kind: '复诊'
  })
  const second = await call('createCase', {
    ...input,
    patient: { ...input.patient, name: '批量导出测试乙' }
  })
  const image = join(temporaryDirectory, '批量测试图片.png')
  const imageData = await evaluate(`(() => {
    const canvas = document.createElement('canvas'); canvas.width = 40; canvas.height = 40
    const context = canvas.getContext('2d'); context.fillStyle = '#ffffff'
    context.fillRect(0, 0, 40, 40)
    return canvas.toDataURL('image/png').split(',')[1]
  })()`)
  await writeFile(image, Buffer.from(imageData, 'base64'))
  const originalOpen = dialog.showOpenDialog
  const originalSave = dialog.showSaveDialog
  let releasePicker
  try {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [image, join(artifacts, 'clinical-visit.pdf')]
    })
    const imported = await evaluate(
      `window.emrDesktop.importAttachments({visitId:'${first.id}',kind:'检查单'})`
    )
    assert.equal(imported.success, true, imported.message)
    assert.equal(imported.data.added.length, 2)

    await evaluate(`location.hash = '#/patients'`)
    await wait(`Boolean(document.querySelector('input[data-testid="patient-search"]'))`)
    await evaluate(`(() => {
      const input = document.querySelector('input[data-testid="patient-search"]')
      input.value = '批量导出测试'
      input.dispatchEvent(new Event('input', {bubbles:true}))
    })()`)
    await wait(`document.querySelectorAll('.el-table__body .el-table__row').length === 2`)
    assert.equal(
      await evaluate(`document.querySelector('[data-testid="batch-export-cases"]').disabled`),
      true
    )
    await click('.el-table__header-wrapper input[type="checkbox"]')
    await wait(`!document.querySelector('[data-testid="batch-export-cases"]').disabled`)

    // 原生目录选择尚未结束时，删除病例与另一项导出均须被阻止。
    dialog.showOpenDialog = () =>
      new Promise((resolvePicker) => {
        releasePicker = resolvePicker
      })
    await click('[data-testid="batch-export-cases"]')
    await wait(`document.querySelector('[data-testid="batch-export-cases"]').disabled`)
    assert.ok(releasePicker)
    assert.equal(
      await evaluate(
        `Array.from(document.querySelectorAll('.el-table__body [data-testid="delete-case"]')).every(el => el.disabled)`
      ),
      true
    )
    const busy = await evaluate('window.emrDesktop.exportPrescriptions()')
    assert.equal(busy.success, false)
    assert.match(busy.message, /正在导出/)
    releasePicker({ canceled: true, filePaths: [] })
    await wait(`!document.querySelector('[data-testid="batch-export-cases"]').disabled`)
    assert.deepEqual(await readdir(directory), [])

    await evaluate(`(() => {
      window.exportTestProgress = []
      window.stopExportTestProgress = window.emrDesktop.onCaseExportProgress(value => window.exportTestProgress.push(value))
    })()`)
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] })
    await click('[data-testid="batch-export-cases"]')
    await wait(
      `!document.querySelector('[data-testid="batch-export-cases"]').disabled && document.body.innerText.includes('已导出 3 份病历')`
    )
    const names = await readdir(directory)
    assert.equal(names.length, 3, '两位患者的三次就诊各导出一份 PDF，不单独复制 PDF 附件')
    const originals = new Map()
    for (const name of names) {
      assert.ok(name.endsWith('.pdf'))
      const bytes = await readFile(join(directory, name))
      assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
      originals.set(name, bytes)
      if (name.includes('批量导出测试甲') && name.includes('初诊'))
        assert.equal(
          (bytes.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length,
          2,
          '图片随所属就诊附页'
        )
    }
    assert.ok(names.some((name) => name.includes('复诊')))
    const progress = await evaluate('window.exportTestProgress')
    assert.equal(progress[0].completed, 0)
    assert.equal(progress.at(-1).completed, 3)
    assert.ok(progress.every((item) => item.total === 3))
    await evaluate('window.stopExportTestProgress()')
    const repeated = await evaluate(
      `window.emrDesktop.exportCases({patientIds:['${first.patientId}']})`
    )
    assert.equal(repeated.success, true, repeated.message)
    assert.equal(repeated.data.exported, 2)
    assert.equal(repeated.data.failed, 0)
    const repeatedNames = await readdir(directory)
    assert.equal(repeatedNames.length, 5)
    assert.equal(repeatedNames.filter((name) => name.endsWith(' (2).pdf')).length, 2)
    for (const [name, bytes] of originals)
      assert.deepEqual(await readFile(join(directory, name)), bytes)
    assert.equal(
      await evaluate('window.exportTestProgress.length'),
      progress.length,
      '取消订阅后不再回调'
    )

    await evaluate(`location.hash = '#/prescriptions'`)
    await wait(`Boolean(document.querySelector('[data-testid="export-prescriptions"]'))`)
    const output = join(directory, '处方库.xlsx')
    dialog.showSaveDialog = async () => ({ canceled: true })
    const canceled = await evaluate('window.emrDesktop.exportPrescriptions()')
    assert.deepEqual(canceled, { success: true, data: null })
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: output })
    await click('[data-testid="export-prescriptions"]')
    await wait(
      `!document.querySelector('[data-testid="export-prescriptions"]').disabled && document.body.innerText.includes('已导出处方 1 张')`
    )
    const book = XLSX.read(await readFile(output), { type: 'buffer' })
    assert.deepEqual(book.SheetNames, ['处方库', '处方明细'])
    const library = XLSX.utils.sheet_to_json(book.Sheets['处方库'])
    assert.equal(library.length, 1)
    assert.equal(library[0]['处方名称'], '库内已更名')
    assert.equal(library[0]['状态'], '已停用', '停用处方仍须导出')
    assert.equal(XLSX.utils.sheet_to_json(book.Sheets['处方明细']).length, 6)
    assert.equal((await call('visit', first.id)).body.narrative, input.body.narrative)
    assert.equal((await call('patient', second.patientId)).name, '批量导出测试乙')
  } finally {
    dialog.showOpenDialog = originalOpen
    dialog.showSaveDialog = originalSave
    await evaluate(`(() => {
      window.stopExportTestProgress?.()
      delete window.stopExportTestProgress
      delete window.exportTestProgress
    })()`)
  }
}

module.exports = { exportsWorkflow }
