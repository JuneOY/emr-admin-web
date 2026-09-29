import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)
const electronDirectory = dirname(require.resolve('electron/package.json'))
let executable
try {
  // 只读文件检查，不能 require('electron')，避免缺少运行文件时触发自动下载。
  const binaryName = (await readFile(join(electronDirectory, 'path.txt'), 'utf8')).trim()
  executable = join(electronDirectory, 'dist', binaryName)
  await access(executable)
  await access(join(root, 'out/renderer/index.html'))
  await access(join(root, 'out/preload/index.cjs'))
} catch {
  console.error(
    '缺少 Electron 运行文件或构建产物。请先完成用户侧 Electron 下载，再运行 pnpm build。'
  )
  process.exit(1)
}

const temporaryRoot = resolve(tmpdir())
const directory = await mkdtemp(join(temporaryRoot, 'emr-desktop-smoke-'))
const cleanup = async () => {
  if (
    dirname(directory) !== temporaryRoot ||
    !directory.startsWith(join(temporaryRoot, 'emr-desktop-smoke-'))
  ) {
    throw new Error('拒绝清理非测试目录')
  }
  await rm(directory, { recursive: true, force: true, maxRetries: 6, retryDelay: 500 })
}
const artifacts = join(root, 'work/verification')
await mkdir(artifacts, { recursive: true })
try {
  const environment = { ...process.env }
  delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(executable, [join(root, 'tests/desktop-smoke.cjs'), directory, artifacts], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true
  })
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 180000)
  try {
    const code = await new Promise((resolveCode, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolveCode(code))
    })
    if (timedOut) throw new Error('桌面冒烟超过 180 秒，请检查日志')
    if (code !== 0) throw new Error(`桌面冒烟未通过，退出码 ${code}`)
    // Electron 提前正常退出也会返回 0，必须收到最后一个断言之后写入的完成标记。
    const result = JSON.parse(await readFile(join(directory, 'desktop-smoke-result.json'), 'utf8'))
    if (result.status !== 'passed') throw new Error('桌面冒烟没有完成全部断言')
    console.log(
      `Electron ${result.electronVersion} 桌面冒烟通过：真实窗口、沙箱隔离、受限 IPC、页面保存、文件持久化、重开、刷新和路由。`
    )
  } finally {
    clearTimeout(timer)
  }
} finally {
  await cleanup()
}
