const assert = require('node:assert/strict')
const { join } = require('node:path')
const { mkdir, readFile, readdir, rename, rmdir, writeFile } = require('node:fs/promises')
const { dialog } = require('electron')

async function dataManagementWorkflow(
  window,
  { evaluate, waitFor, capture, temporaryDirectory, options, clinical, files }
) {
  const picker = dialog.showOpenDialog
  const confirmation = dialog.showMessageBox
  const backupParent = join(temporaryDirectory, '备份存放处')
  const migrated = join(temporaryDirectory, '迁移后的病例')
  const restored = join(temporaryDirectory, '恢复后的病例')
  const refused = join(temporaryDirectory, '已有其他文件')
  const failedTarget = join(temporaryDirectory, '模拟切换失败')
  for (const path of [backupParent, migrated, restored, refused, failedTarget]) await mkdir(path)
  let selections = []
  let response = 1
  dialog.showOpenDialog = async () => {
    const next = selections.shift()
    return { canceled: !next, filePaths: next ? [next] : [] }
  }
  dialog.showMessageBox = async () => ({ response, checkboxChecked: false })
  const click = (name) => evaluate(`document.querySelector('[data-testid="${name}"]').click()`)
  const settled = () =>
    waitFor(
      window,
      `!document.querySelector('.el-loading-mask') && !document.querySelector('[data-testid="backup-data"]').disabled`
    )
  const messageContains = (text) =>
    `Array.from(document.querySelectorAll('.el-message--error')).some(el => el.textContent.includes(${JSON.stringify(text)}))`
  try {
    await evaluate(`location.hash = '#/settings'`)
    await waitFor(
      window,
      `Boolean(document.querySelector('[data-testid="backup-data"]')) && !document.querySelector('[data-testid="backup-data"]').disabled`
    )
    const invalid = await evaluate(`window.emrDesktop.manageLocalData('delete')`)
    assert.equal(invalid.success, false)
    await click('backup-data')
    await settled()
    assert.deepEqual(await readdir(backupParent), [])

    let releasePicker
    dialog.showOpenDialog = () =>
      new Promise((resolvePicker) => {
        releasePicker = resolvePicker
      })
    await click('backup-data')
    const deadline = Date.now() + 15000
    while (!releasePicker && Date.now() < deadline)
      await new Promise((resolveWait) => setTimeout(resolveWait, 50))
    assert.ok(releasePicker)
    window.close()
    assert.equal(window.isDestroyed(), false, '资料操作期间不能关闭窗口')
    const busy = await evaluate(`window.emrDesktop.clinical('dictionaries', null)`)
    assert.equal(busy.success, false)
    assert.match(busy.message, /等待完成/)
    releasePicker({ canceled: false, filePaths: [backupParent] })
    await waitFor(
      window,
      `document.querySelector('[data-testid="settings-page"]').textContent.includes('最近备份：')`
    )
    await settled()
    const backup = join(backupParent, (await readdir(backupParent))[0])
    const manifest = JSON.parse(await readFile(join(backup, 'emr-backup.json'), 'utf8'))
    assert.ok(manifest.files.some((file) => file.name.startsWith('attachments/')))
    await capture(window, 'settings-data-backup')
    dialog.showOpenDialog = async () => {
      const next = selections.shift()
      return { canceled: !next, filePaths: next ? [next] : [] }
    }
    const added = await evaluate(
      `window.emrDesktop.clinical('saveDictionary', {id:null, revision:0, kind:'doctor', name:'备份之后新增', active:true})`
    )
    assert.equal(added.success, true)
    const image = (await evaluate(`window.emrDesktop.clinical('attachments', '${files.visitId}')`))
      .data[0]
    const originalImage = await readFile(join(options.dataDirectory, 'attachments', image.id))

    selections = [migrated]
    await click('migrate-data')
    await waitFor(
      window,
      `document.querySelector('[data-testid="data-directory"]')?.textContent === ${JSON.stringify(migrated)}`
    )
    await settled()
    const visit = await evaluate(`window.emrDesktop.clinical('visit', '${clinical.firstId}')`)
    assert.equal(visit.data.body.narrative, clinical.longText)
    assert.deepEqual(await readFile(join(migrated, 'attachments', image.id)), originalImage)
    assert.deepEqual(
      await readFile(join(options.dataDirectory, 'attachments', image.id)),
      originalImage
    )

    await writeFile(join(refused, '必须保留.txt'), 'keep')
    selections = [refused]
    await click('migrate-data')
    await waitFor(window, messageContains('不是空'))
    await settled()
    assert.equal(await readFile(join(refused, '必须保留.txt'), 'utf8'), 'keep')
    assert.equal(
      (await evaluate('window.emrDesktop.getApplicationInfo()')).data.dataDirectory,
      migrated
    )

    // 只在隔离测试配置中模拟指针写入失败，验证新库可读也不能提前丢弃旧服务。
    const pointer = join(options.profileDirectory, 'data-location.json')
    await rename(pointer, pointer + '.test-original')
    await mkdir(pointer)
    try {
      selections = [failedTarget]
      await click('migrate-data')
      await waitFor(window, messageContains('切换目录失败'))
      await settled()
      assert.equal(
        (await evaluate('window.emrDesktop.getApplicationInfo()')).data.dataDirectory,
        migrated
      )
      assert.equal(
        (await evaluate(`window.emrDesktop.clinical('visit', '${clinical.firstId}')`)).success,
        true
      )
    } finally {
      await rmdir(pointer)
      await rename(pointer + '.test-original', pointer)
    }

    response = 0
    selections = [backup, restored]
    await click('restore-data')
    await settled()
    assert.deepEqual(await readdir(restored), [])
    assert.equal(
      (await evaluate('window.emrDesktop.getApplicationInfo()')).data.dataDirectory,
      migrated
    )
    response = 1
    selections = [backup, restored]
    await click('restore-data')
    await waitFor(
      window,
      `document.querySelector('[data-testid="data-directory"]')?.textContent === ${JSON.stringify(restored)}`
    )
    await settled()
    const doctors = (await evaluate(`window.emrDesktop.clinical('dictionaries', null)`)).data
      .doctors
    assert.equal(
      doctors.some((doctor) => doctor.name === '备份之后新增'),
      false
    )
    assert.equal(
      (await evaluate(`window.emrDesktop.clinical('visit', '${clinical.firstId}')`)).data.body
        .narrative,
      clinical.longText
    )
    assert.deepEqual(await readFile(join(restored, 'attachments', image.id)), originalImage)
    assert.deepEqual(await readFile(join(migrated, 'attachments', image.id)), originalImage)
    await capture(window, 'settings-data-restored')
    return restored
  } finally {
    dialog.showOpenDialog = picker
    dialog.showMessageBox = confirmation
  }
}

module.exports = { dataManagementWorkflow }
