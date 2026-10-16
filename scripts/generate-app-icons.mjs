import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const script = fileURLToPath(import.meta.url)
const root = resolve(dirname(script), '..')

async function renderIcons() {
  const { app, BrowserWindow } = await import('electron')
  app.setPath('userData', process.argv[2])
  await app.whenReady()
  const window = new BrowserWindow({
    width: 1024,
    height: 1024,
    useContentSize: true,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  const ready = new Promise((resolveReady) => window.once('ready-to-show', resolveReady))
  try {
    const svg = await readFile(join(root, 'public/favicon.svg'), 'utf8')
    const html = `<style>html,body{margin:0;width:100%;height:100%;overflow:hidden}svg{display:block;width:100%;height:100%}</style>${svg}`
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    await ready
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
    })`)
    const image = await window.webContents.capturePage(undefined, {
      stayHidden: true,
      stayAwake: true
    })
    if (image.isEmpty()) throw new Error('Logo 渲染失败')
    await writeFile(
      join(root, 'public/app-icon.png'),
      image.resize({ width: 512, height: 512, quality: 'best' }).toPNG()
    )
    // Windows ICO 包含常用尺寸，避免快捷方式和任务栏缩放时模糊。
    const sizes = [16, 24, 32, 48, 64, 128, 256]
    const images = sizes.map((size) =>
      image.resize({ width: size, height: size, quality: 'best' }).toPNG()
    )
    const header = Buffer.alloc(6 + sizes.length * 16)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(sizes.length, 4)
    let offset = header.length
    for (const [index, size] of sizes.entries()) {
      const entry = 6 + index * 16
      header[entry] = header[entry + 1] = size === 256 ? 0 : size
      header.writeUInt16LE(1, entry + 4)
      header.writeUInt16LE(32, entry + 6)
      header.writeUInt32LE(images[index].length, entry + 8)
      header.writeUInt32LE(offset, entry + 12)
      offset += images[index].length
    }
    await writeFile(join(root, 'public/favicon.ico'), Buffer.concat([header, ...images]))
    console.log('已从当前 Logo 生成窗口 PNG 和 Windows 多尺寸 ICO。')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
}

async function launchRenderer() {
  const require = createRequire(import.meta.url)
  const electronDirectory = dirname(require.resolve('electron/package.json'))
  // 直接读取已安装运行文件，不能通过 require('electron') 触发隐式下载。
  const name = (await readFile(join(electronDirectory, 'path.txt'), 'utf8')).trim()
  const executable = join(electronDirectory, 'dist', name)
  await access(executable)
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'emr-icon-render-'))
  const cleanup = async () => {
    if (
      dirname(directory) !== temporaryRoot ||
      !directory.startsWith(join(temporaryRoot, 'emr-icon-render-'))
    ) {
      throw new Error('拒绝清理非图标渲染目录')
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 500 })
  }
  try {
    const environment = { ...process.env }
    delete environment.ELECTRON_RUN_AS_NODE
    const child = spawn(executable, [script, directory], {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: 'inherit'
    })
    const timer = setTimeout(() => child.kill(), 30000)
    try {
      const code = await new Promise((resolveExit, reject) => {
        child.once('error', reject)
        child.once('exit', resolveExit)
      })
      if (code !== 0) throw new Error(`图标生成失败，退出码 ${code}`)
    } finally {
      clearTimeout(timer)
    }
  } finally {
    await cleanup()
  }
}

// Electron 的 ready 需在主模块加载后触发，不能在模块顶层等待窗口创建。
if (process.versions.electron) {
  void renderIcons().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
} else {
  await launchRenderer()
}
