import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { ApplicationService } from '../backend/services/application-service'
import { DEFAULT_SETTINGS } from '../shared/desktop'

async function createService(context: TestContext) {
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'emr-test-'))
  context.after(async () => {
    // 仅删除本测试创建的临时目录，不能接受外部提供的删除路径。
    assert.equal(dirname(directory), temporaryRoot)
    assert.ok(directory.startsWith(join(temporaryRoot, 'emr-test-')))
    await rm(directory, { recursive: true, force: true })
  })
  const service = new ApplicationService(join(directory, '中文资料库'), '0.1.0')
  await service.initialize()
  return service
}

test('空库启动和重复初始化使用默认设置，附件目录可用', async (context) => {
  const service = await createService(context)
  await service.initialize()
  assert.deepEqual(await service.settings.read(), DEFAULT_SETTINGS)
  assert.ok((await stat(service.info.attachmentsDirectory)).isDirectory())
  assert.deepEqual(await readdir(service.info.dataDirectory), ['attachments'])
  assert.throws(() => new ApplicationService('relative/path', '0.1.0'), /绝对路径/)
})

test('真实写入后重新创建服务，设置仍可读回', async (context) => {
  const service = await createService(context)
  const settings = { workspaceName: '诊所甲', confirmBeforeExit: true }
  assert.deepEqual(await service.settings.save(settings), settings)
  const reopened = new ApplicationService(service.info.dataDirectory, '0.1.1')
  await reopened.initialize()
  assert.deepEqual(await reopened.settings.read(), settings)
  assert.equal(reopened.info.version, '0.1.1')
  assert.deepEqual(JSON.parse(await readFile(service.settings.filePath, 'utf8')), {
    version: 1,
    settings
  })
})

test('并发保存按调用顺序串行完成，读操作等待保存，临时文件清理完整', async (context) => {
  const service = await createService(context)
  const writes = Array.from({ length: 20 }, (_, index) =>
    service.settings.save({
      workspaceName: `资料库${index}`,
      confirmBeforeExit: false
    })
  )
  const latest = await service.settings.read()
  await Promise.all(writes)
  assert.equal(latest.workspaceName, '资料库19')
  assert.deepEqual((await readdir(service.info.dataDirectory)).sort(), [
    'attachments',
    'settings.json'
  ])
})

test('非法输入不覆盖已保存设置，也不阻断后续合法保存', async (context) => {
  const service = await createService(context)
  await service.settings.save(DEFAULT_SETTINGS)
  const original = await readFile(service.settings.filePath, 'utf8')
  await assert.rejects(service.settings.save({ ...DEFAULT_SETTINGS, workspaceName: '' }), /名称/)
  assert.equal(await readFile(service.settings.filePath, 'utf8'), original)
  await service.settings.save({ ...DEFAULT_SETTINGS, workspaceName: '修改成功' })
  assert.equal((await service.settings.read()).workspaceName, '修改成功')
})

test('损坏和未来版本的设置不会被读取或保存操作覆盖', async (context) => {
  const service = await createService(context)
  for (const content of [
    '{broken',
    'null',
    JSON.stringify({ version: 2, settings: DEFAULT_SETTINGS }),
    JSON.stringify({ version: 1, settings: {} })
  ]) {
    await writeFile(service.settings.filePath, content)
    await assert.rejects(service.settings.read())
    await assert.rejects(service.settings.save(DEFAULT_SETTINGS))
    assert.equal(await readFile(service.settings.filePath, 'utf8'), content)
    assert.deepEqual((await readdir(service.info.dataDirectory)).sort(), [
      'attachments',
      'settings.json'
    ])
  }
  await writeFile(
    service.settings.filePath,
    JSON.stringify({ version: 1, settings: DEFAULT_SETTINGS })
  )
  await service.settings.save({ ...DEFAULT_SETTINGS, workspaceName: '修复后可继续' })
  assert.equal((await service.settings.read()).workspaceName, '修复后可继续')
})
