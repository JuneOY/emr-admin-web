import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import { ClinicalRepository } from '../backend/storage/clinical-repository'
import {
  EMPTY_PATIENT,
  EMPTY_RECORD,
  type CaseCreate,
  type Visit,
  type VisitSave
} from '../shared/clinical'
import {
  parseCaseCreate,
  parsePatient,
  parseVisitCreate,
  parseVisitSave
} from '../shared/clinical-validation'

async function fixture(context: TestContext) {
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'emr-clinical-'))
  const dataDirectory = join(directory, '中文病例库')
  let repo = new ClinicalRepository(dataDirectory)
  context.after(async () => {
    repo.close()
    assert.equal(dirname(directory), temporaryRoot)
    assert.ok(directory.startsWith(join(temporaryRoot, 'emr-clinical-')))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    get repo() {
      return repo
    },
    dataDirectory,
    reopen: () => {
      repo.close()
      repo = new ClinicalRepository(dataDirectory)
      return repo
    }
  }
}
const patientInput = {
  ...EMPTY_PATIENT,
  name: '测试患者',
  phone: '13800000000',
  birthDate: '1980-02-29',
  id: null,
  revision: 0
}
function draft(visit: Visit): VisitSave {
  return {
    id: visit.id,
    revision: visit.revision,
    date: visit.date,
    kind: visit.kind,
    patient: visit.patient,
    body: visit.body,
    categoryIds: visit.categoryIds
  }
}

test('直接填写病例原子创建患者和完整就诊，失败无半成品，已有患者显式关联', async (context) => {
  const f = await fixture(context),
    repo = f.repo
  const doctor = repo.execute('saveDictionary', {
    kind: 'doctor',
    name: '新病例医生',
    active: true,
    id: null,
    revision: 0
  })
  const category = repo.execute('saveDictionary', {
    kind: 'category',
    name: '肾',
    active: true,
    id: null,
    revision: 0
  })
  const value: CaseCreate = {
    patientId: null,
    doctorId: doctor.id,
    date: '2026-09-29',
    kind: '初诊',
    patient: { ...EMPTY_PATIENT, name: '直接填写患者', phone: '13900000009', age: '40' },
    body: { ...EMPTY_RECORD, narrative: '一起保存的病情', prescription: '一起保存的处方' },
    categoryIds: [category.id]
  }
  assert.throws(() => parseCaseCreate({ ...value, patientId: '' }), /编号/)
  assert.throws(() => parseCaseCreate({ ...value, extra: '禁止额外字段' }), /字段/)
  assert.throws(
    () => parseCaseCreate({ ...value, patient: { ...value.patient, name: '' } }),
    /姓名/
  )
  assert.throws(() => repo.execute('createCase', { ...value, categoryIds: [doctor.id] }), /分类/)
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM patients').get()?.n, 0)
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM visits').get()?.n, 0)
  const first = repo.execute('createCase', value)
  assert.deepEqual(first.body, value.body)
  assert.deepEqual(first.patient, value.patient)
  assert.deepEqual(first.categoryIds, [category.id])
  assert.equal(repo.execute('patient', first.patientId).name, value.patient.name)
  assert.throws(() => repo.execute('createCase', value), /复诊入口/)
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM visits').get()?.n, 1)
  const second = repo.execute('createCase', {
    ...value,
    patientId: first.patientId,
    kind: '复诊',
    patient: { ...value.patient, address: '本次资料快照' },
    body: { ...EMPTY_RECORD, narrative: '复诊记录' }
  })
  assert.equal(second.recordNumber, first.recordNumber)
  assert.equal(second.patientId, first.patientId)
  assert.equal(repo.db.prepare('SELECT COUNT(*) AS n FROM patients').get()?.n, 1)
  assert.equal(repo.execute('patient', first.patientId).address, '本次资料快照')
  assert.deepEqual(f.reopen().execute('visit', first.id), first)
  assert.deepEqual(f.repo.execute('visit', second.id), second)
})

test('同一患者初复诊沿用同一医生，独立快照在重开后保留', async (context) => {
  const f = await fixture(context),
    repo = f.repo
  const patient = repo.execute('savePatient', patientInput)
  const firstDoctor = repo.execute('saveDictionary', {
    kind: 'doctor',
    name: '医生甲',
    id: null,
    revision: 0,
    active: true
  })
  const secondDoctor = repo.execute('saveDictionary', {
    kind: 'doctor',
    name: '医生乙',
    id: null,
    revision: 0,
    active: true
  })
  const first = repo.execute('createVisit', {
    patientId: patient.id,
    doctorId: firstDoctor.id,
    date: '2026-09-28',
    kind: '初诊'
  })
  const saved = repo.execute('saveVisit', {
    ...draft(first),
    body: { ...first.body, narrative: '首次记录\n保留换行', prescription: '测试处方内容' }
  })
  repo.execute('savePatient', {
    ...patientInput,
    id: patient.id,
    revision: patient.revision,
    name: '患者更名',
    address: '新地址'
  })
  repo.execute('saveDictionary', { ...firstDoctor, kind: 'doctor', name: '医生甲更名' })
  assert.throws(
    () =>
      repo.execute('createVisit', {
        patientId: patient.id,
        doctorId: secondDoctor.id,
        date: '2026-09-29',
        kind: '复诊'
      }),
    /初诊医生/
  )
  const second = repo.execute('createVisit', {
    patientId: patient.id,
    doctorId: firstDoctor.id,
    date: '2026-09-29',
    kind: '复诊'
  })
  assert.equal(second.patient.name, '患者更名')
  assert.equal(second.recordNumber, first.recordNumber)
  assert.equal(second.patient.age, '46')
  const reopened = f.reopen()
  assert.deepEqual(reopened.execute('visit', first.id), { ...saved, doctorName: '医生甲更名' })
  assert.equal(saved.patient.name, '测试患者')
  assert.equal(saved.doctorName, '医生甲')
  assert.equal(
    reopened.db.prepare('SELECT doctor_name FROM visits WHERE id = ?').get(first.id)?.doctor_name,
    '医生甲'
  )
  assert.equal(
    reopened
      .execute('visits', { patientId: patient.id, page: 1, pageSize: 20 })
      .items.find((v) => v.id === first.id)?.doctorName,
    '医生甲更名'
  )
  assert.deepEqual(
    reopened
      .execute('visits', { patientId: patient.id, page: 1, pageSize: 20 })
      .items.map((v) => v.id),
    [second.id, first.id]
  )
})

test('患者列表最近医生与最近日期对应，补录旧病例和医生改名不改变接诊归属', async (context) => {
  const f = await fixture(context),
    repo = f.repo
  const patient = repo.execute('savePatient', patientInput)
  const empty = repo.execute('savePatient', { ...patientInput, name: '暂无就诊患者', phone: '' })
  const doctorA = repo.execute('saveDictionary', {
    kind: 'doctor',
    id: null,
    name: '接诊甲',
    active: true,
    revision: 0
  })
  repo.execute('createVisit', {
    patientId: patient.id,
    doctorId: doctorA.id,
    date: '2026-09-29',
    kind: '初诊'
  })
  const older = repo.execute('createVisit', {
    patientId: patient.id,
    doctorId: doctorA.id,
    date: '2026-09-28',
    kind: '复诊'
  })
  const query = { keyword: '', doctorId: '', categoryId: '', page: 1, pageSize: 20 }
  let rows = repo.execute('patients', query).items
  const row = rows.find((item) => item.id === patient.id)!
  assert.equal(row.latestVisitDate, '2026-09-29')
  assert.equal(row.latestDoctorId, doctorA.id)
  assert.equal(row.latestDoctorName, '接诊甲')
  assert.equal(row.visitCount, 2)
  assert.equal(rows.find((item) => item.id === empty.id)?.latestDoctorName, null)
  repo.execute('saveDictionary', { ...doctorA, kind: 'doctor', name: '接诊甲改名', active: false })
  const reopened = f.reopen()
  rows = reopened.execute('patients', query).items
  assert.equal(rows.find((item) => item.id === patient.id)?.latestDoctorName, '接诊甲改名')
  reopened.execute('saveVisit', { ...draft(older), date: '2026-09-30' })
  const current = reopened.execute('patients', query).items.find((item) => item.id === patient.id)!
  assert.equal(current.latestVisitDate, '2026-09-30')
  assert.equal(current.latestDoctorId, doctorA.id)
  assert.equal(current.latestDoctorName, '接诊甲改名')
})

test('病例内修改患者字段同步主索引，只同步改动且不覆盖其他历史快照', async (context) => {
  const { repo } = await fixture(context)
  const p = repo.execute('savePatient', patientInput)
  const doctor = repo.execute('saveDictionary', {
    kind: 'doctor',
    name: '资料同步医生',
    active: true,
    id: null,
    revision: 0
  })
  const first = repo.execute('createVisit', {
    patientId: p.id,
    doctorId: doctor.id,
    date: '2026-09-28',
    kind: '初诊'
  })
  const second = repo.execute('createVisit', {
    patientId: p.id,
    doctorId: doctor.id,
    date: '2026-09-29',
    kind: '复诊'
  })
  repo.execute('saveVisit', {
    ...draft(second),
    patient: { ...second.patient, address: '复诊更新的地址', phone: '13900000020' }
  })
  // 编辑初诊的病情不能把主索引回退为当时的电话和地址。
  const saved = repo.execute('saveVisit', {
    ...draft(first),
    body: { ...first.body, narrative: '仅补充初诊病情' }
  })
  assert.equal(repo.execute('patient', p.id).phone, '13900000020')
  const changed = repo.execute('saveVisit', {
    ...draft(saved),
    patient: { ...saved.patient, occupation: '新的职业', age: '46岁' }
  })
  const current = repo.execute('patient', p.id)
  assert.equal(current.address, '复诊更新的地址')
  assert.equal(current.phone, '13900000020')
  assert.equal(current.occupation, '新的职业')
  assert.equal(repo.execute('visit', second.id).patient.occupation, second.patient.occupation)
  repo.execute('savePatient', { ...patientInput, phone: '13900000030' })
  assert.throws(
    () =>
      repo.execute('saveVisit', {
        ...draft(changed),
        patient: { ...changed.patient, phone: '13900000030' },
        body: { ...changed.body, narrative: '不能半保存' }
      }),
    /复诊入口/
  )
  assert.deepEqual(repo.execute('visit', first.id), changed)
  assert.equal(repo.execute('patient', p.id).phone, '13900000020')
})

test('医生和分类筛选匹配同一患者的就诊，支持电话检索和分页', async (context) => {
  const { repo } = await fixture(context)
  const p = repo.execute('savePatient', patientInput)
  const a = repo.execute('saveDictionary', {
    kind: 'doctor',
    name: '甲',
    id: null,
    revision: 0,
    active: true
  })
  const b = repo.execute('saveDictionary', {
    kind: 'doctor',
    name: '乙',
    id: null,
    revision: 0,
    active: true
  })
  const tag = repo.execute('saveDictionary', {
    kind: 'category',
    name: '肝脏',
    id: null,
    revision: 0,
    active: true
  })
  repo.execute('createVisit', { patientId: p.id, doctorId: a.id, date: '2026-09-28', kind: '初诊' })
  const other = repo.execute('savePatient', { ...patientInput, name: '另一个患者' })
  const v = repo.execute('createVisit', {
    patientId: other.id,
    doctorId: b.id,
    date: '2026-09-29',
    kind: '初诊'
  })
  repo.execute('saveVisit', { ...draft(v), categoryIds: [tag.id] })
  const query = { keyword: '', doctorId: a.id, categoryId: tag.id, page: 1, pageSize: 20 }
  assert.equal(repo.execute('patients', query).total, 0)
  assert.equal(repo.execute('patients', { ...query, doctorId: b.id, keyword: '000000' }).total, 1)
  assert.equal(repo.execute('patients', { ...query, doctorId: b.id, keyword: '%' }).total, 0)
  assert.equal(
    repo.execute('patients', { ...query, doctorId: b.id, page: 2, pageSize: 1 }).items.length,
    0
  )
})

test('重复患者、过期版本及非法分类不会覆盖已有记录', async (context) => {
  const { repo } = await fixture(context)
  const patient = repo.execute('savePatient', patientInput)
  assert.throws(() => repo.execute('savePatient', patientInput), /同名/)
  const doctor = repo.execute('saveDictionary', {
    kind: 'doctor',
    name: '甲',
    id: null,
    revision: 0,
    active: true
  })
  const visit = repo.execute('createVisit', {
    patientId: patient.id,
    doctorId: doctor.id,
    date: '2026-09-28',
    kind: '初诊'
  })
  const saved = repo.execute('saveVisit', {
    ...draft(visit),
    body: { ...visit.body, narrative: '不可覆盖' }
  })
  assert.throws(() => repo.execute('saveVisit', draft(visit)), /其他页面更新/)
  assert.throws(
    () => repo.execute('saveVisit', { ...draft(saved), categoryIds: [doctor.id] }),
    /分类/
  )
  assert.deepEqual(repo.execute('visit', visit.id), saved)
  repo.execute('saveDictionary', { ...doctor, kind: 'doctor', active: false })
  const continued = repo.execute('createVisit', {
    patientId: patient.id,
    doctorId: doctor.id,
    date: '2026-09-29',
    kind: '复诊'
  })
  assert.equal(continued.doctorId, doctor.id)
  const other = repo.execute('savePatient', { ...patientInput, name: '新患者' })
  assert.throws(
    () =>
      repo.execute('createVisit', {
        patientId: other.id,
        doctorId: doctor.id,
        date: '2026-09-29',
        kind: '初诊'
      }),
    /启用/
  )
  assert.equal(repo.execute('visit', visit.id).doctorName, '甲')
})

test('输入边界拒绝假日期、额外字段、超长文本和注入式编号', async (context) => {
  assert.throws(() => parsePatient({ ...patientInput, unexpected: true }), /字段/)
  assert.throws(() => parsePatient({ ...patientInput, birthDate: '2025-02-29' }), /日期/)
  assert.throws(
    () => parseVisitCreate({ patientId: "' OR 1=1", doctorId: '', date: '', kind: '初诊' }),
    /编号/
  )
  const { repo } = await fixture(context)
  const p = repo.execute('savePatient', patientInput)
  const d = repo.execute('saveDictionary', {
    kind: 'doctor',
    name: '甲',
    id: null,
    revision: 0,
    active: true
  })
  const v = repo.execute('createVisit', {
    patientId: p.id,
    doctorId: d.id,
    date: '2026-09-29',
    kind: '初诊'
  })
  assert.throws(
    () => parseVisitSave({ ...draft(v), body: { ...v.body, narrative: '字'.repeat(20001) } }),
    /字符/
  )
  assert.throws(() => parseVisitSave({ ...draft(v), categoryIds: [d.id, d.id] }), /重复/)
  assert.throws(
    () => parseVisitSave({ ...draft(v), body: { ...v.body, narrative: '\n'.repeat(4000) } }),
    /最多 100 页/
  )
})

test('就诊类型不能手动改写，连续读取按建立顺序分页且包含完整正文', async (context) => {
  const { repo } = await fixture(context)
  const patient = repo.execute('savePatient', patientInput)
  const doctor = repo.execute('saveDictionary', {
    id: null,
    revision: 0,
    kind: 'doctor',
    name: '连续病例医生',
    active: true
  })
  const input = { patientId: patient.id, doctorId: doctor.id, date: '2026-09-29', kind: '初诊' }
  assert.throws(() => repo.execute('createVisit', { ...input, kind: '复诊' }), /首次/)
  const first = repo.execute('createVisit', input)
  assert.throws(() => repo.execute('createVisit', input), /后续/)
  assert.throws(() => repo.execute('saveVisit', { ...draft(first), kind: '复诊' }), /不能更改/)
  const second = repo.execute('createCase', {
    ...input,
    kind: '复诊',
    patient: { ...first.patient, age: '46岁', maritalStatus: '已婚' },
    categoryIds: [],
    body: { ...EMPTY_RECORD, narrative: '复诊正文' }
  })
  assert.equal(second.patient.age, '46')
  assert.equal(second.patient.maritalStatus, '是')
  const page = repo.execute('caseVisits', { patientId: patient.id, page: 1, pageSize: 1 })
  assert.equal(page.total, 2)
  assert.equal(page.items[0].id, first.id)
  assert.deepEqual(
    repo.execute('caseVisits', { patientId: patient.id, page: 2, pageSize: 1 }).items,
    [second]
  )
})

test('未来版本与损坏数据库启动失败且不重置文件', async (context) => {
  const f = await fixture(context)
  f.repo.db.exec('PRAGMA user_version = 99')
  assert.throws(() => new ClinicalRepository(f.dataDirectory), /版本/)
  const badDir = join(f.dataDirectory, '损坏库')
  const { mkdir } = await import('node:fs/promises')
  await mkdir(badDir)
  const file = join(badDir, 'clinical.sqlite')
  await writeFile(file, 'damaged-file')
  assert.throws(() => new ClinicalRepository(badDir))
  assert.equal(await readFile(file, 'utf8'), 'damaged-file')
})
