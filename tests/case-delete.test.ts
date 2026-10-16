import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test, type TestContext } from 'node:test'
import { ClinicalRepository } from '../backend/storage/clinical-repository'
import { EMPTY_PATIENT, EMPTY_RECORD, type CaseDelete } from '../shared/clinical'
import { parseCaseDelete } from '../shared/clinical-validation'
import type { Attachment } from '../shared/attachments'

const query = { keyword: '', doctorId: '', categoryId: '', page: 1, pageSize: 20 }
const imageBytes = Buffer.from('89504e470d0a1a0a00000000', 'hex')

function deletion(repo: ClinicalRepository, patientId: string): CaseDelete {
  const row = repo.execute('patients', query).items.find((item) => item.id === patientId)!
  return { patientId, revision: row.revision, updatedAt: row.updatedAt, visitCount: row.visitCount }
}

async function fixture(context: TestContext) {
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'emr-delete-'))
  const dataDirectory = join(directory, '资料库')
  let repo = new ClinicalRepository(dataDirectory)
  context.after(async () => {
    repo.close()
    assert.equal(dirname(directory), temporaryRoot)
    assert.ok(directory.startsWith(join(temporaryRoot, 'emr-delete-')))
    await rm(directory, { recursive: true, force: true })
  })
  const doctor = repo.execute('saveDictionary', {
    id: null,
    revision: 0,
    kind: 'doctor',
    name: '测试医生',
    active: true
  })
  const category = repo.execute('saveDictionary', {
    id: null,
    revision: 0,
    kind: 'category',
    name: '测试分类',
    active: true
  })
  const createCase = (name: string) =>
    repo.execute('createCase', {
      patientId: null,
      doctorId: doctor.id,
      date: '2026-10-09',
      kind: '初诊',
      patient: { ...EMPTY_PATIENT, name, age: '30' },
      body: { ...EMPTY_RECORD, narrative: '合成病情', prescription: '测试处方内容' },
      categoryIds: [category.id]
    })
  const first = createCase('待删除患者'),
    other = createCase('保留患者')
  const followup = repo.execute('createVisit', {
    patientId: first.patientId,
    doctorId: doctor.id,
    date: '2026-10-10',
    kind: '复诊'
  })
  const image = join(directory, '检查.png')
  await writeFile(image, imageBytes)
  const attachments: Attachment[] = []
  for (const visit of [first, followup, other]) {
    const result = await repo.attachments.import({ visitId: visit.id, kind: '检查单' }, [image])
    attachments.push(result.added[0])
  }
  return {
    get repo() {
      return repo
    },
    reopen() {
      repo.close()
      repo = new ClinicalRepository(dataDirectory)
      return repo
    },
    dataDirectory,
    image,
    first,
    followup,
    other,
    doctor,
    category,
    attachments
  }
}

test('删除参数必须包含合法病例编号、版本、更新时间和就诊数量，拒绝任意路径', () => {
  const valid: CaseDelete = {
    patientId: '00000000-0000-4000-8000-000000000001',
    revision: 1,
    updatedAt: '2026-10-09T01:00:00.000Z',
    visitCount: 2
  }
  assert.deepEqual(parseCaseDelete(valid), valid)
  for (const input of [
    null,
    valid.patientId,
    { ...valid, path: 'C:\\private' },
    { ...valid, patientId: '../other' },
    { ...valid, revision: 0 },
    { ...valid, visitCount: -1 },
    { ...valid, visitCount: 1.5 },
    { ...valid, updatedAt: '2026-02-30T01:00:00.000Z' }
  ]) {
    assert.throws(() => parseCaseDelete(input))
  }
})

test('删除整份病例清除全部就诊、分类关联和附件，重开后保持删除，其他患者和共享配置不变', async (context) => {
  const f = await fixture(context)
  const prescription = f.repo.execute('savePrescription', {
    id: null,
    revision: 0,
    name: '共享处方',
    kind: '中药饮片',
    items: [{ name: '合成测试药品', amount: '', unit: '', usage: '' }],
    usage: '',
    notes: '',
    active: true
  })
  assert.deepEqual(f.repo.execute('deleteCase', deletion(f.repo, f.first.patientId)), {
    pendingAttachments: true
  })
  assert.throws(() => f.repo.execute('patient', f.first.patientId), /不存在/)
  for (const visit of [f.first, f.followup]) {
    assert.throws(() => f.repo.execute('visit', visit.id), /不存在/)
    assert.equal(
      f.repo.db
        .prepare('SELECT COUNT(*) AS n FROM visit_categories WHERE visit_id = ?')
        .get(visit.id)?.n,
      0
    )
    assert.equal(
      f.repo.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE visit_id = ?').get(visit.id)
        ?.n,
      0
    )
  }
  assert.deepEqual(f.repo.db.prepare('PRAGMA foreign_key_check').all(), [])
  assert.deepEqual(
    f.repo
      .execute('patients', { ...query, categoryId: f.category.id })
      .items.map((item) => item.id),
    [f.other.patientId]
  )
  const reopened = f.reopen()
  assert.equal(reopened.attachments.hasPendingCleanup(), true)
  await reopened.attachments.cleanup()
  assert.equal(reopened.attachments.hasPendingCleanup(), false)
  assert.deepEqual(await readdir(join(f.dataDirectory, 'attachments')), [f.attachments[2].id])
  assert.deepEqual((await reopened.attachments.read(f.attachments[2].id)).bytes, imageBytes)
  assert.deepEqual(await readFile(f.image), imageBytes)
  assert.deepEqual(reopened.execute('visit', f.other.id), f.other)
  assert.deepEqual(reopened.execute('dictionaries', null), {
    doctors: [f.doctor],
    categories: [f.category]
  })
  assert.equal(reopened.execute('prescription', prescription.id).name, '共享处方')
  assert.equal(reopened.execute('patients', query).total, 1)
})

test('删除失败时整个事务回滚，病例、关联关系及附件均保留', async (context) => {
  const f = await fixture(context)
  f.repo.db.exec(
    "CREATE TRIGGER prevent_case_delete BEFORE DELETE ON patients BEGIN SELECT RAISE(ABORT, '测试删除失败'); END"
  )
  assert.throws(
    () => f.repo.execute('deleteCase', deletion(f.repo, f.first.patientId)),
    /测试删除失败/
  )
  assert.deepEqual(f.repo.execute('visit', f.first.id), f.first)
  assert.deepEqual(f.repo.execute('visit', f.followup.id), f.followup)
  assert.equal(f.repo.attachments.hasPendingCleanup(), false)
  assert.equal(f.repo.attachments.list(f.first.id).length, 1)
  assert.deepEqual((await f.repo.attachments.read(f.attachments[0].id)).bytes, imageBytes)
  assert.deepEqual(f.repo.db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('患者版本、内容时间或就诊数变化后拒绝过期删除，不删除后续新增就诊', async (context) => {
  const f = await fixture(context)
  const input = deletion(f.repo, f.first.patientId)
  for (const stale of [
    { ...input, revision: input.revision + 1 },
    { ...input, updatedAt: '2020-01-01T00:00:00.000Z' },
    { ...input, visitCount: input.visitCount - 1 }
  ]) {
    assert.throws(() => f.repo.execute('deleteCase', stale), /病例已更新/)
  }
  const added = f.repo.execute('createVisit', {
    patientId: f.first.patientId,
    doctorId: f.doctor.id,
    date: '2026-10-11',
    kind: '复诊'
  })
  assert.throws(() => f.repo.execute('deleteCase', input), /病例已更新/)
  assert.equal(f.repo.execute('visit', added.id).id, added.id)
  assert.equal(f.repo.attachments.hasPendingCleanup(), false)
})

test('v2 数据库升级保留病例和附件，没有就诊的患者也可以删除', async (context) => {
  const f = await fixture(context)
  f.repo.db.exec('DROP TABLE attachment_cleanup; PRAGMA user_version = 2')
  const repo = f.reopen()
  assert.equal(repo.db.prepare('PRAGMA user_version').get()?.user_version, 3)
  assert.deepEqual(repo.execute('visit', f.first.id), f.first)
  assert.deepEqual((await repo.attachments.read(f.attachments[0].id)).bytes, imageBytes)
  const patient = repo.execute('savePatient', {
    ...EMPTY_PATIENT,
    id: null,
    revision: 0,
    name: '未就诊患者'
  })
  assert.deepEqual(repo.execute('deleteCase', deletion(repo, patient.id)), {
    pendingAttachments: false
  })
  assert.throws(() => repo.execute('patient', patient.id), /不存在/)
  assert.equal(f.reopen().execute('patients', query).total, 2)
})

test('文件暂不可删除时保留队列，恢复后继续清理，不能误删活跃附件', async (context) => {
  const f = await fixture(context)
  // 通过同名目录模拟附件文件占用/异常，清理流程不能递归删除该目录。
  f.repo.execute('deleteCase', deletion(f.repo, f.first.patientId))
  const path = join(f.dataDirectory, 'attachments', f.attachments[0].id)
  await rm(path)
  await mkdir(path)
  await f.repo.attachments.cleanup()
  assert.equal(f.repo.attachments.hasPendingCleanup(), true)
  assert.deepEqual(await readdir(path), [])
  await rmdir(path)
  await f.reopen().attachments.cleanup()
  assert.equal(f.repo.attachments.hasPendingCleanup(), false)
  f.repo.db.prepare('INSERT INTO attachment_cleanup(id) VALUES(?)').run(f.attachments[2].id)
  await f.repo.attachments.cleanup()
  assert.deepEqual((await f.repo.attachments.read(f.attachments[2].id)).bytes, imageBytes)
})
