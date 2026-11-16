import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { test, type TestContext } from 'node:test'
import { ClinicalRepository } from '../backend/storage/clinical-repository'
import { CLINICAL_METHODS, EMPTY_PATIENT, EMPTY_RECORD, type Visit } from '../shared/clinical'
import { parseVisitDelete } from '../shared/clinical-validation'

const query = { keyword: '', doctorId: '', categoryId: '', page: 1, pageSize: 20 }
const deletion = (visit: Visit) => ({ id: visit.id, revision: visit.revision })
const imageBytes = Buffer.from('89504e470d0a1a0a00000000', 'hex')

async function fixture(context: TestContext) {
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'emr-visit-delete-'))
  const dataDirectory = join(directory, '资料库')
  let repo = new ClinicalRepository(dataDirectory)
  context.after(async () => {
    repo.close()
    assert.equal(dirname(directory), temporaryRoot)
    assert.ok(directory.startsWith(join(temporaryRoot, 'emr-visit-delete-')))
    await rm(directory, { recursive: true, force: true })
  })
  const doctor = repo.execute('saveDictionary', {
    id: null,
    revision: 0,
    kind: 'doctor',
    name: '复诊测试医生',
    active: true
  })
  const category = repo.execute('saveDictionary', {
    id: null,
    revision: 0,
    kind: 'category',
    name: '仅中间复诊分类',
    active: true
  })
  const first = repo.execute('createCase', {
    patientId: null,
    doctorId: doctor.id,
    date: '2026-10-01',
    kind: '初诊',
    categoryIds: [],
    patient: { ...EMPTY_PATIENT, name: '单删复诊测试患者', age: '30' },
    body: { ...EMPTY_RECORD, narrative: '保留初诊', prescription: '初诊处方' }
  })
  const middle = repo.execute('createCase', {
    patientId: first.patientId,
    doctorId: doctor.id,
    date: '2026-10-02',
    kind: '复诊',
    categoryIds: [category.id],
    patient: first.patient,
    body: { ...EMPTY_RECORD, narrative: '待删除中间复诊', prescription: '中间处方' }
  })
  const last = repo.execute('createCase', {
    patientId: first.patientId,
    doctorId: doctor.id,
    date: '2026-10-03',
    kind: '复诊',
    categoryIds: [],
    patient: first.patient,
    body: { ...EMPTY_RECORD, narrative: '保留末次复诊', prescription: '末次处方' }
  })
  const source = join(directory, '同一图片.png')
  await writeFile(source, imageBytes)
  const attachments = []
  for (const visit of [first, middle, last]) {
    const result = await repo.attachments.import({ visitId: visit.id, kind: '检查单' }, [source])
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
    source,
    first,
    middle,
    last,
    attachments,
    doctor,
    category
  }
}

test('单次删除仅接收合法就诊 ID 和正整数版本，并注册到受限白名单', () => {
  const valid = { id: '00000000-0000-4000-8000-000000000001', revision: 2 }
  assert.ok(CLINICAL_METHODS.includes('deleteVisit'))
  assert.deepEqual(parseVisitDelete(valid), valid)
  for (const invalid of [
    null,
    valid.id,
    {},
    { ...valid, id: '../private' },
    { ...valid, revision: 0 },
    { ...valid, revision: 1.5 },
    { ...valid, revision: '2' },
    { ...valid, path: 'C:\\private' },
    { ...valid, kind: '复诊' }
  ]) {
    assert.throws(() => parseVisitDelete(invalid))
  }
})

test('单删中间复诊只移除本次分类和附件，初诊、末次复诊与患者资料保持独立', async (context) => {
  const f = await fixture(context)
  const patient = f.repo.execute('patient', f.first.patientId)
  assert.equal(f.repo.execute('patients', { ...query, categoryId: f.category.id }).total, 1)
  assert.deepEqual(f.repo.execute('deleteVisit', deletion(f.middle)), { pendingAttachments: true })
  assert.throws(() => f.repo.execute('visit', f.middle.id), /不存在/)
  assert.equal(
    f.repo.db
      .prepare('SELECT COUNT(*) AS n FROM visit_categories WHERE visit_id = ?')
      .get(f.middle.id)?.n,
    0
  )
  assert.equal(
    f.repo.db.prepare('SELECT COUNT(*) AS n FROM attachments WHERE visit_id = ?').get(f.middle.id)
      ?.n,
    0
  )
  assert.equal(f.repo.execute('patients', { ...query, categoryId: f.category.id }).total, 0)
  assert.deepEqual(f.repo.execute('visit', f.first.id), f.first)
  assert.deepEqual(f.repo.execute('visit', f.last.id), f.last)
  const current = f.repo.execute('patient', patient.id)
  assert.deepEqual({ ...current, updatedAt: patient.updatedAt }, patient)
  assert.ok(current.updatedAt >= patient.updatedAt)
  const list = f.repo.execute('patients', query).items[0]
  assert.equal(list.visitCount, 2)
  assert.equal(list.latestVisitDate, f.last.date)
  assert.equal(list.latestDoctorName, f.doctor.name)
  assert.deepEqual(f.repo.db.prepare('PRAGMA foreign_key_check').all(), [])
  const reopened = f.reopen()
  await reopened.attachments.cleanup()
  assert.equal(reopened.attachments.hasPendingCleanup(), false)
  assert.deepEqual(
    (await readdir(join(f.dataDirectory, 'attachments'))).sort(),
    [f.attachments[0].id, f.attachments[2].id].sort()
  )
  for (const attachment of [f.attachments[0], f.attachments[2]])
    assert.deepEqual((await reopened.attachments.read(attachment.id)).bytes, imageBytes)
  assert.deepEqual(await readFile(f.source), imageBytes)
  assert.deepEqual(reopened.execute('dictionaries', null), {
    doctors: [f.doctor],
    categories: [f.category]
  })
  assert.deepEqual(
    reopened.execute('caseVisits', { patientId: patient.id, page: 1, pageSize: 20 }).items,
    [f.first, f.last]
  )
})

test('删除末次复诊后最近就诊逐次回退到初诊，仍可继续同一医生的复诊', async (context) => {
  const f = await fixture(context)
  f.repo.execute('deleteVisit', deletion(f.last))
  assert.equal(f.repo.execute('patients', query).items[0].latestVisitDate, f.middle.date)
  f.repo.execute('deleteVisit', deletion(f.middle))
  assert.equal(f.repo.execute('patients', query).items[0].latestVisitDate, f.first.date)
  assert.equal(f.repo.execute('patients', query).items[0].visitCount, 1)
  const next = f.repo.execute('createVisit', {
    patientId: f.first.patientId,
    doctorId: f.doctor.id,
    date: '2026-10-09',
    kind: '复诊'
  })
  assert.deepEqual(next.body, EMPTY_RECORD)
  assert.deepEqual(f.repo.execute('deleteVisit', deletion(next)), { pendingAttachments: false })
  assert.deepEqual(f.reopen().execute('visit', f.first.id), f.first)
})

test('初诊、过期版本、重复删除均被拒绝，旧保存也不能重新生成已删除复诊', async (context) => {
  const f = await fixture(context)
  assert.throws(() => f.repo.execute('deleteVisit', deletion(f.first)), /初诊不能单独删除/)
  const { id, revision, date, kind, patient, body, categoryIds } = f.middle
  const payload = { id, revision, date, kind, patient, body, categoryIds }
  const updated = f.repo.execute('saveVisit', {
    ...payload,
    body: { ...body, diagnosis: '新修改' }
  })
  assert.throws(() => f.repo.execute('deleteVisit', deletion(f.middle)), /其他页面更新/)
  assert.deepEqual(f.repo.execute('visit', f.middle.id), updated)
  assert.equal(f.repo.attachments.hasPendingCleanup(), false)
  f.repo.execute('deleteVisit', deletion(updated))
  assert.throws(() => f.repo.execute('deleteVisit', deletion(updated)), /不存在/)
  assert.throws(
    () => f.repo.execute('saveVisit', { ...payload, revision: updated.revision }),
    /不存在/
  )
  assert.deepEqual(f.repo.execute('visit', f.first.id), f.first)
  assert.deepEqual(f.repo.execute('visit', f.last.id), f.last)
})

test('复诊删除事务失败时记录、患者更新时间、分类、附件及清理队列全部回滚', async (context) => {
  const f = await fixture(context)
  const patient = f.repo.execute('patient', f.first.patientId)
  f.repo.db.exec(
    "CREATE TRIGGER prevent_visit_delete BEFORE DELETE ON visits BEGIN SELECT RAISE(ABORT, '测试复诊删除失败'); END"
  )
  assert.throws(() => f.repo.execute('deleteVisit', deletion(f.middle)), /测试复诊删除失败/)
  assert.deepEqual(f.repo.execute('visit', f.middle.id), f.middle)
  assert.deepEqual(f.repo.execute('patient', patient.id), patient)
  assert.equal(f.repo.execute('patients', { ...query, categoryId: f.category.id }).total, 1)
  assert.equal(f.repo.attachments.hasPendingCleanup(), false)
  assert.deepEqual((await f.repo.attachments.read(f.attachments[1].id)).bytes, imageBytes)
  assert.deepEqual(f.reopen().execute('visit', f.middle.id), f.middle)
})
