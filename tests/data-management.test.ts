import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test, type TestContext } from 'node:test'
import { ClinicalRepository } from '../backend/storage/clinical-repository'
import { SettingsRepository } from '../backend/storage/settings-repository'
import { createSnapshot, restoreSnapshot, verifySnapshot } from '../backend/storage/data-snapshot'
import {
  DataLocationRepository,
  INSTALLER_LOCATION_FILE,
  LOCATION_FILE
} from '../backend/storage/data-location'
import { StagedDataDirectory, containsPath, dataPath } from '../backend/storage/data-directories'
import { EMPTY_PATIENT, EMPTY_RECORD } from '../shared/clinical'
import { parseDataOperation } from '../shared/data-management'

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'emr-data-test-'))
  const profile = join(root, '应用配置')
  const source = join(root, '原病例库')
  const snapshot = join(root, '完整备份')
  const target = join(root, '新资料库')
  for (const directory of [profile, source, snapshot, target, join(source, 'attachments')])
    await mkdir(directory)
  const repository = new ClinicalRepository(source)
  const location = new DataLocationRepository(profile)
  const doctor = repository.execute('saveDictionary', {
    id: null,
    kind: 'doctor',
    name: '备份测试医生',
    active: true,
    revision: 0
  })
  const visit = repository.execute('createCase', {
    patientId: null,
    doctorId: doctor.id,
    date: '2026-09-29',
    kind: '初诊',
    categoryIds: [],
    patient: { ...EMPTY_PATIENT, name: '合成患者', phone: '13900000000', age: '30岁' },
    body: { ...EMPTY_RECORD, narrative: '完整备份测试正文', prescription: '仅作软件测试' }
  })
  await new SettingsRepository(source).save({
    workspaceName: '合成资料库',
    confirmBeforeExit: true
  })
  const image = join(root, '合成图片.png')
  const imageBytes = Buffer.from('89504e470d0a1a0a00000000', 'hex')
  await writeFile(image, imageBytes)
  await repository.attachments.import({ visitId: visit.id, kind: '舌苔照' }, [image])
  context.after(async () => {
    repository.close()
    assert.equal(dirname(root), resolve(tmpdir()))
    assert.ok(root.includes('emr-data-test-'))
    await rm(root, { recursive: true, force: true })
  })
  return { root, profile, source, snapshot, target, repository, location, visit, imageBytes }
}

test('首次启动读取安装器的中文 UTF-16 目录，旧库优先，提交指针后不被预设覆盖', async (context) => {
  const f = await fixture(context)
  const preset = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from(`[Storage]\r\nDirectory=${f.target}\r\n`, 'utf16le')
  ])
  await writeFile(join(f.profile, INSTALLER_LOCATION_FILE), preset)
  assert.equal(await f.location.resolve(), f.target)
  await writeFile(join(f.profile, 'clinical.sqlite'), 'legacy')
  assert.equal(await f.location.resolve(), f.profile)
  await f.location.save(f.source)
  assert.equal(await new DataLocationRepository(f.profile).resolve(), f.source)
})

test('目录指针损坏、未来版本或原数据失联时不创建替代空库', async (context) => {
  const f = await fixture(context)
  for (const value of [
    '{broken',
    JSON.stringify({ version: 8, directory: f.source }),
    JSON.stringify({ version: 1, directory: f.target })
  ]) {
    await writeFile(join(f.profile, LOCATION_FILE), value)
    await assert.rejects(f.location.resolve())
    assert.deepEqual(await readdir(f.target), [])
    assert.equal(await readFile(join(f.profile, LOCATION_FILE), 'utf8'), value)
  }
})

test('目录与操作参数拒绝相对路径、磁盘根、网络路径和未知命令', () => {
  for (const value of ['relative', 'C:\\', '\\\\server\\share', 'C:\\data\nother'])
    assert.throws(() => dataPath(value))
  assert.throws(() => parseDataOperation('delete'))
  assert.equal(parseDataOperation('backup'), 'backup')
  assert.equal(containsPath('C:\\data', 'c:\\DATA\\attachments'), true)
  assert.equal(containsPath('C:\\data', 'C:\\database'), false)
})

test('备份读取活跃 WAL 数据并包含设置和附件，恢复后病例完整，原库仍可写', async (context) => {
  const f = await fixture(context)
  await createSnapshot(f.repository.db, f.source, f.snapshot)
  await verifySnapshot(f.snapshot)
  await restoreSnapshot(f.snapshot, f.target)
  const restored = new ClinicalRepository(f.target)
  try {
    assert.equal(restored.execute('visit', f.visit.id).body.narrative, f.visit.body.narrative)
    const attachment = restored.attachments.list(f.visit.id)[0]
    assert.deepEqual((await restored.attachments.read(attachment.id)).bytes, f.imageBytes)
    assert.equal((await new SettingsRepository(f.target).read()).workspaceName, '合成资料库')
    f.repository.execute('saveVisit', {
      id: f.visit.id,
      revision: f.visit.revision,
      date: f.visit.date,
      kind: f.visit.kind,
      patient: f.visit.patient,
      categoryIds: f.visit.categoryIds,
      body: { ...f.visit.body, narrative: '备份之后的新内容' }
    })
    assert.equal(restored.execute('visit', f.visit.id).body.narrative, '完整备份测试正文')
    assert.equal((await readdir(f.target)).includes('emr-backup.json'), false)
  } finally {
    restored.close()
  }
})

test('篡改、缺失附件和越界路径的备份被拒绝，不能覆盖原库', async (context) => {
  const f = await fixture(context)
  await createSnapshot(f.repository.db, f.source, f.snapshot)
  const manifestPath = join(f.snapshot, 'emr-backup.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const attachment = manifest.files.find((file: { name: string }) =>
    file.name.startsWith('attachments/')
  )
  await writeFile(join(f.snapshot, attachment.name), 'tampered')
  await assert.rejects(verifySnapshot(f.snapshot), /变化/)
  await rm(join(f.snapshot, attachment.name))
  await assert.rejects(verifySnapshot(f.snapshot))
  manifest.files[0].name = '../outside'
  await writeFile(manifestPath, JSON.stringify(manifest))
  await assert.rejects(restoreSnapshot(f.snapshot, f.target), /无效路径/)
  assert.deepEqual(await readdir(f.target), [])
  assert.equal(f.repository.execute('visit', f.visit.id).body.narrative, f.visit.body.narrative)
})

test('较新备份格式及重复文件清单在复制前被拒绝', async (context) => {
  const f = await fixture(context)
  await createSnapshot(f.repository.db, f.source, f.snapshot)
  const path = join(f.snapshot, 'emr-backup.json')
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...manifest, version: 2 }))
  await assert.rejects(restoreSnapshot(f.snapshot, f.target), /版本/)
  await writeFile(
    path,
    JSON.stringify({ ...manifest, files: [...manifest.files, manifest.files[0]] })
  )
  await assert.rejects(restoreSnapshot(f.snapshot, f.target), /重复/)
  assert.deepEqual(await readdir(f.target), [])
})

test('目标非空、相同目录及嵌套目录不可迁移；临时目录只在完成后发布', async (context) => {
  const f = await fixture(context)
  await assert.rejects(StagedDataDirectory.create(f.source, [f.source]), /独立/)
  await assert.rejects(
    StagedDataDirectory.create(join(f.source, 'attachments'), [f.source]),
    /独立/
  )
  await writeFile(join(f.target, '保留.txt'), 'user file')
  await assert.rejects(StagedDataDirectory.create(f.target, [f.source]), /不是空/)
  assert.equal(await readFile(join(f.target, '保留.txt'), 'utf8'), 'user file')
  await rm(join(f.target, '保留.txt'))
  const stage = await StagedDataDirectory.create(f.target, [f.source])
  await writeFile(join(stage.staging, '验证.txt'), 'ready')
  assert.deepEqual(await readdir(f.target), [])
  await stage.publish()
  await stage.cleanup()
  assert.equal(await readFile(join(f.target, '验证.txt'), 'utf8'), 'ready')
})

test('准备期间目标出现新文件时终止发布，仅清理自己的临时文件', async (context) => {
  const f = await fixture(context)
  const stage = await StagedDataDirectory.create(f.target, [f.source])
  await writeFile(join(stage.staging, '临时.txt'), 'pending')
  await writeFile(join(f.target, '保留.txt'), 'keep')
  await assert.rejects(stage.publish(), /已有文件/)
  await stage.cleanup()
  assert.equal(await readFile(join(f.target, '保留.txt'), 'utf8'), 'keep')
  assert.equal(
    (await readdir(f.root)).some((name) => name.startsWith('.emr-data-')),
    false
  )
})
