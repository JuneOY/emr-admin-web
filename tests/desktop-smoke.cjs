const assert = require('node:assert/strict')
const { join, resolve } = require('node:path')
const { mkdir, writeFile } = require('node:fs/promises')
const { app, BrowserWindow, session } = require('electron')
const { require: requireTypeScript } = require('tsx/cjs/api')
const { createDesktopWindow } = requireTypeScript('../electron/main/application.ts', __filename)
const { clinicalWorkflow } = require('./clinical-desktop.cjs')
const { filesPrescriptionsWorkflow } = require('./files-prescriptions-desktop.cjs')
const { continuousPdfWorkflow } = require('./pdf-desktop.cjs')
const { dataManagementWorkflow } = require('./data-management-desktop.cjs')
const { DataLocationRepository } = requireTypeScript(
  '../backend/storage/data-location.ts',
  __filename
)

const root = resolve(__dirname, '..')
const temporaryDirectory = process.argv[2]
const artifacts = process.argv[3]
assert.ok(temporaryDirectory && artifacts, '测试目录由运行脚本提供')
app.setPath('userData', join(temporaryDirectory, 'runtime'))
app.setName('emr-desktop-smoke')
// 允许测试关闭全部窗口后重新创建窗口，进程只在全部断言结束后退出。
app.on('window-all-closed', () => {})

const errors = []
const readyWindows = new WeakMap()
app.on('browser-window-created', (_event, window) => {
  readyWindows.set(
    window,
    new Promise((resolveReady) => window.once('ready-to-show', resolveReady))
  )
})
app.on('web-contents-created', (_event, contents) => {
  contents.on('preload-error', (_event, _path, error) => errors.push(String(error)))
  contents.on('console-message', (details) => {
    if (details.level === 'error') errors.push(details.message)
  })
  contents.on('render-process-gone', (_event, details) =>
    errors.push(`渲染进程退出：${details.reason}`)
  )
})

async function evaluatePage(window, expression) {
  try {
    return await window.webContents.executeJavaScript(expression)
  } catch (cause) {
    throw new Error(`页面脚本执行失败：${expression}`, { cause })
  }
}

async function waitFor(window, expression) {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (await evaluatePage(window, expression)) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`等待页面状态超时：${expression}`)
}

async function capture(window, name) {
  // 页面加载完成不代表合成器已有画面，隐藏窗口需先等首次绘制与后续帧。
  await readyWindows.get(window)
  await window.webContents
    .executeJavaScript(`document.fonts.ready.then(() => new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
  })).then(() => Promise.all(document.getAnimations()
    .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
    .map(animation => animation.finished.catch(() => {})))).then(() => true)`)
  const screenshot = await window.webContents.capturePage(undefined, {
    stayHidden: true,
    stayAwake: true
  })
  assert.equal(screenshot.isEmpty(), false)
  await writeFile(join(artifacts, name + '.png'), screenshot.toPNG())
}

async function run() {
  await app.whenReady()
  await mkdir(artifacts, { recursive: true })
  const options = {
    dataDirectory: join(temporaryDirectory, '中文资料库'),
    profileDirectory: join(temporaryDirectory, 'runtime'),
    version: '0.1.0',
    entryFile: join(root, 'out/renderer/index.html'),
    preloadFile: join(root, 'out/preload/index.cjs'),
    clinicalWorkerFile: join(root, 'out/main/clinical-worker.js'),
    show: false,
    session: session.fromPartition('emr-smoke')
  }
  let window = await createDesktopWindow(options)
  const evaluate = (expression) => evaluatePage(window, expression)
  await waitFor(window, `Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  // 已有用户的旧默认绿色应迁移，其他界面偏好和自选颜色必须保留。
  await evaluate(`(() => {
    const key = 'emr-ui-v1-settingStore'
    const state = JSON.parse(localStorage.getItem(key) || '{}')
    localStorage.setItem(key, JSON.stringify({...state, systemThemeColor:'#276B5F', menuOpen:false}))
  })()`)
  await new Promise((resolveLoad) => {
    window.webContents.once('did-finish-load', resolveLoad)
    window.webContents.reload()
  })
  await waitFor(window, `Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  assert.equal(
    await evaluate(
      `getComputedStyle(document.documentElement).getPropertyValue('--el-color-primary').trim().toLowerCase()`
    ),
    '#3b82f6'
  )
  assert.equal(
    await evaluate(`JSON.parse(localStorage.getItem('emr-ui-v1-settingStore')).menuOpen`),
    false
  )
  await evaluate(`(() => {
    if (document.querySelector('.menu-left-close')) document.querySelector('[aria-label="展开或收起菜单"]').click()
  })()`)
  await waitFor(window, `Boolean(document.querySelector('.menu-left-open'))`)
  const clinical = await clinicalWorkflow(window, { evaluate, waitFor, capture, artifacts })
  await continuousPdfWorkflow({ evaluate, artifacts, ...clinical })
  const files = await filesPrescriptionsWorkflow(window, {
    evaluate,
    waitFor,
    capture,
    artifacts,
    temporaryDirectory,
    ...clinical
  })
  await evaluate(`location.hash = '#/workspace'`)
  await waitFor(window, `Boolean(document.querySelector('[data-testid="workspace-page"]'))`)
  await waitFor(window, `document.body.innerText.includes('中文资料库')`)
  assert.deepEqual(
    await evaluate(
      `({ require: typeof window.require, process: typeof window.process, bridge: Object.keys(window.emrDesktop).sort() })`
    ),
    {
      require: 'undefined',
      process: 'undefined',
      bridge: [
        'clinical',
        'exportAttachment',
        'exportVisitPdf',
        'getApplicationInfo',
        'getSettings',
        'importAttachments',
        'manageLocalData',
        'openDataDirectory',
        'readAttachment',
        'removeAttachment',
        'saveSettings'
      ]
    }
  )
  const settings = await evaluate('window.emrDesktop.getSettings()')
  assert.deepEqual(settings, {
    success: true,
    data: { workspaceName: '门诊病历', confirmBeforeExit: false }
  })
  const info = await evaluate('window.emrDesktop.getApplicationInfo()')
  assert.equal(info.success, true)
  assert.equal(info.data.dataDirectory, options.dataDirectory)
  const invalid = await evaluate(
    `window.emrDesktop.saveSettings({ workspaceName: '', confirmBeforeExit: false })`
  )
  assert.equal(invalid.success, false)
  assert.match(invalid.message, /名称/)
  await capture(window, 'workspace')

  // 通过真实页面输入和按钮提交验证 Vue、preload、IPC 和文件存储的完整链路。
  await evaluate(
    `Array.from(document.querySelectorAll('button')).find(button => button.textContent.trim() === '本地设置').click()`
  )
  await waitFor(window, `Boolean(document.querySelector('[data-testid="settings-page"]'))`)
  await waitFor(
    window,
    `document.querySelector('input[data-testid="workspace-name"]')?.disabled === false`
  )
  await evaluate(`(() => {
    const input = document.querySelector('input[data-testid="workspace-name"]')
    input.value = '桌面测试资料库'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await evaluate(`document.querySelector('[data-testid="save-settings"]').click()`)
  await waitFor(window, `document.body.innerText.includes('已保存到当前电脑')`)
  assert.equal(
    (await evaluate('window.emrDesktop.getSettings()')).data.workspaceName,
    '桌面测试资料库'
  )
  await capture(window, 'settings')

  await evaluate(`document.querySelector('[aria-label="界面设置"]').click()`)
  await waitFor(window, `Boolean(document.querySelector('.el-drawer'))`)
  const appearance = await evaluate('document.body.innerText')
  assert.equal(appearance.includes('全局水印'), false)
  assert.equal(appearance.includes('显示快速入口'), false)
  await capture(window, 'appearance')
  await evaluate(`document.querySelector('[aria-label="关闭界面设置"]').click()`)
  await waitFor(
    window,
    `getComputedStyle(document.querySelector('.setting-modal')).display === 'none'`
  )
  if (!(await evaluate(`document.documentElement.classList.contains('dark')`))) {
    await evaluate(`document.querySelector('[aria-label="切换主题"]').click()`)
  }
  await waitFor(window, `document.documentElement.classList.contains('dark')`)
  await capture(window, 'settings-dark')
  await evaluate(`document.querySelector('[aria-label="切换主题"]').click()`)
  await waitFor(window, `!document.documentElement.classList.contains('dark')`)
  window.setSize(1000, 700)
  await capture(window, 'settings-compact')

  // 第二个窗口即使加载相同文件和 preload，也不应拥有主窗口的本地操作权限。
  const foreign = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: options.preloadFile,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      session: options.session
    }
  })
  await foreign.loadFile(options.entryFile)
  const refused = await foreign.webContents.executeJavaScript('window.emrDesktop.getSettings()')
  assert.equal(refused.success, false)
  assert.match(refused.message, /无权/)
  const refusedClinical = await foreign.webContents.executeJavaScript(
    "window.emrDesktop.clinical('dictionaries', null)"
  )
  assert.equal(refusedClinical.success, false)
  assert.match(refusedClinical.message, /无权/)
  const refusedManagement = await foreign.webContents.executeJavaScript(
    "window.emrDesktop.manageLocalData('backup')"
  )
  assert.equal(refusedManagement.success, false)
  assert.match(refusedManagement.message, /无权/)
  foreign.destroy()

  window.destroy()
  window = await createDesktopWindow(options)
  await waitFor(window, `Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  const persistedVisit = await evaluate(
    `window.emrDesktop.clinical('visit', ${JSON.stringify(clinical.firstId)})`
  )
  assert.equal(persistedVisit.success, true)
  assert.equal(persistedVisit.data.body.narrative, clinical.longText)
  assert.equal(
    (await evaluate(`window.emrDesktop.clinical('visit', '${files.visitId}')`)).data.body
      .prescription,
    files.prescriptionCopy
  )
  assert.equal(
    (await evaluate(`window.emrDesktop.clinical('attachments', '${files.visitId}')`)).data.length,
    1
  )
  await evaluate(`location.hash = '#/workspace'`)
  await waitFor(
    window,
    `document.querySelector('[data-testid="workspace-name-display"]')?.textContent === '桌面测试资料库'`
  )
  await evaluate(`location.hash = '#/settings'`)
  await waitFor(
    window,
    `document.querySelector('input[data-testid="workspace-name"]')?.value === '桌面测试资料库'`
  )
  const reloaded = new Promise((resolveLoad) =>
    window.webContents.once('did-finish-load', resolveLoad)
  )
  window.webContents.reload()
  await reloaded
  await waitFor(
    window,
    `document.querySelector('input[data-testid="workspace-name"]')?.value === '桌面测试资料库'`
  )
  // 损坏文件使用消息提示，页面正文不显示错误条或重试按钮；修复文件并刷新后恢复。
  const storedSettings = {
    version: 1,
    settings: { workspaceName: '桌面测试资料库', confirmBeforeExit: false }
  }
  await writeFile(join(options.dataDirectory, 'settings.json'), '{broken')
  await evaluate(`document.querySelector('[aria-label="刷新页面"]').click()`)
  await waitFor(
    window,
    `document.querySelector('.el-message--error')?.textContent.includes('本地设置文件损坏')`
  )
  assert.equal(
    await evaluate(
      `document.querySelector('[data-testid="settings-page"]').textContent.includes('本地设置文件损坏')`
    ),
    false
  )
  assert.equal(await evaluate(`Boolean(document.querySelector('.el-alert'))`), false)
  assert.equal(
    await evaluate(
      `Array.from(document.querySelectorAll('button')).some(button => /重试|重新读取/.test(button.textContent))`
    ),
    false
  )
  await writeFile(join(options.dataDirectory, 'settings.json'), JSON.stringify(storedSettings))
  await evaluate(`document.querySelector('[aria-label="刷新页面"]').click()`)
  await waitFor(window, `!document.querySelector('[data-testid="save-settings"]').disabled`)

  await evaluate(`location.hash = '#/missing-page'`)
  await waitFor(window, `Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  assert.equal(
    await evaluate(
      `document.querySelector('.el-message--warning')?.textContent.includes('页面不存在')`
    ),
    true
  )
  const restoredDirectory = await dataManagementWorkflow(window, {
    evaluate,
    waitFor,
    capture,
    temporaryDirectory,
    options,
    clinical,
    files
  })
  window.destroy()
  const rememberedDirectory = await new DataLocationRepository(options.profileDirectory).resolve()
  assert.equal(rememberedDirectory, restoredDirectory)
  window = await createDesktopWindow({ ...options, dataDirectory: rememberedDirectory })
  await waitFor(window, `Boolean(document.querySelector('[data-testid="patients-page"]'))`)
  assert.equal(
    (await evaluate(`window.emrDesktop.clinical('visit', '${clinical.firstId}')`)).data.body
      .narrative,
    clinical.longText
  )
  assert.deepEqual(errors, [], `页面错误：${errors.join('\n')}`)
  window.destroy()
  await writeFile(
    join(temporaryDirectory, 'desktop-smoke-result.json'),
    JSON.stringify({ status: 'passed', electronVersion: process.versions.electron })
  )
}

run()
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error)
    if (errors.length) console.error('渲染错误：', errors)
    app.exit(1)
  })
