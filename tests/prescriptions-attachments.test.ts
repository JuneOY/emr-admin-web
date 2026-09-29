import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtemp, writeFile, readFile, readdir, rm, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClinicalRepository } from '../backend/storage/clinical-repository'
import { detectAttachment } from '../backend/storage/attachment-repository'
import { EMPTY_PATIENT, type Visit } from '../shared/clinical'
import {
  appendPrescription,
  parsePrescription,
  prescriptionText,
  type PrescriptionInput
} from '../shared/prescriptions'
import { MAX_ATTACHMENT_BYTES, parseAttachmentImport, parseVisitPdf } from '../shared/attachments'
import { recordHtml } from '../shared/record-layout'
import { writeExport } from '../electron/main/export-file'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=',
  'base64'
)
const input: PrescriptionInput = {
  id: null,
  revision: 0,
  name: '测试处方',
  kind: '中药饮片',
  items: [{ name: '测试药品，非用药建议', amount: '测试用量', unit: '', usage: '由医生填写' }],
  usage: '测试用法',
  notes: '仅供软件验证',
  active: true
}
const query = { keyword: '', kind: '' as const, activeOnly: false, page: 1, pageSize: 20 }
function saveInput(v: Visit) {
  return {
    id: v.id,
    revision: v.revision,
    date: v.date,
    kind: v.kind,
    patient: v.patient,
    body: v.body,
    categoryIds: v.categoryIds
  }
}
async function fixture(context: TestContext) {
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'emr-files-'))
  const dataDirectory = join(directory, '资料库')
  let repo = new ClinicalRepository(dataDirectory)
  const patient = repo.execute('savePatient', {
    ...EMPTY_PATIENT,
    id: null,
    revision: 0,
    name: '合成患者'
  })
  const doctor = repo.execute('saveDictionary', {
    id: null,
    revision: 0,
    kind: 'doctor',
    name: '测试医生',
    active: true
  })
  const first = repo.execute('createVisit', {
    patientId: patient.id,
    doctorId: doctor.id,
    date: '2026-09-28',
    kind: '初诊'
  })
  const second = repo.execute('createVisit', {
    patientId: patient.id,
    doctorId: doctor.id,
    date: '2026-09-29',
    kind: '复诊'
  })
  context.after(async () => {
    repo.close()
    assert.equal(dirname(directory), temporaryRoot)
    assert.ok(directory.startsWith(join(temporaryRoot, 'emr-files-')))
    await rm(directory, { recursive: true, force: true })
  })
  return {
    directory,
    dataDirectory,
    patient,
    first,
    second,
    get repo() {
      return repo
    },
    reopen() {
      repo.close()
      repo = new ClinicalRepository(dataDirectory)
      return repo
    }
  }
}

test('v1 数据迁移到 v2 保留原有患者、就诊快照和版本，重复启动不重置', async (context) => {
  const f = await fixture(context)
  // 还原上一个版本的真实表结构，保留已有患者与就诊行。
  const patientBeforeMigration = f.repo.execute('patient', f.patient.id)
  f.repo.db.exec('DROP TABLE prescriptions; DROP TABLE attachments; PRAGMA user_version = 1')
  const repo = f.reopen()
  assert.equal(repo.db.prepare('PRAGMA user_version').get()?.user_version, 2)
  assert.deepEqual(repo.execute('patient', f.patient.id), patientBeforeMigration)
  assert.deepEqual(repo.execute('visit', f.first.id), f.first)
  const prescription = repo.execute('savePrescription', input)
  assert.deepEqual(f.reopen().execute('prescription', prescription.id), prescription)
})

test('两类处方可搜索、分页、启停；引用追加独立文字，不受库内修改影响', async (context) => {
  const f = await fixture(context)
  const herbal = f.repo.execute('savePrescription', input)
  const western = f.repo.execute('savePrescription', { ...input, kind: '西药／中成药' })
  const before = '原病历处方\n保留空行\n'
  const content = appendPrescription(before, herbal)
  assert.ok(content.startsWith(before + '\n\n'))
  const visit = f.repo.execute('saveVisit', {
    ...saveInput(f.first),
    body: { ...f.first.body, prescription: content }
  })
  f.repo.execute('savePrescription', {
    ...input,
    id: herbal.id,
    revision: herbal.revision,
    name: '已修改',
    usage: '已变更',
    active: false
  })
  assert.equal(f.repo.execute('visit', visit.id).body.prescription, content)
  assert.equal(f.repo.execute('prescriptions', query).total, 2)
  assert.deepEqual(
    f.repo.execute('prescriptions', { ...query, activeOnly: true }).items.map((item) => item.id),
    [western.id]
  )
  assert.equal(
    f.repo.execute('prescriptions', { ...query, kind: '中药饮片', keyword: '修改' }).total,
    1
  )
  assert.equal(f.repo.execute('prescriptions', { ...query, keyword: '%' }).total, 0)
  assert.equal(f.repo.execute('prescriptions', { ...query, page: 2, pageSize: 1 }).items.length, 1)
  assert.equal(f.reopen().execute('visit', visit.id).body.prescription, content)
})

test('处方过期版本、重复名称及非法明细不能覆盖记录；超过处方容量保留原文', async (context) => {
  const { repo } = await fixture(context)
  const saved = repo.execute('savePrescription', input)
  assert.throws(() => repo.execute('savePrescription', input), /已有/)
  assert.throws(
    () => repo.execute('savePrescription', { ...input, id: saved.id, revision: 0 }),
    /已被更新/
  )
  assert.deepEqual(repo.execute('prescription', saved.id), saved)
  assert.throws(() => parsePrescription({ ...input, items: [] }), /1 至 80/)
  assert.throws(() => parsePrescription({ ...input, unexpected: true }), /字段/)
  assert.throws(
    () => parsePrescription({ ...input, items: [{ ...input.items[0], name: '' }] }),
    /药品名称/
  )
  assert.throws(() => appendPrescription('字'.repeat(20000), input), /字符/)
  assert.ok(prescriptionText(saved).includes(input.items[0].name))
})

test('附件保留原件，按初复诊隔离；重复文件跳过，重开和原文件删除后仍可读', async (context) => {
  const f = await fixture(context)
  const source = join(f.directory, '舌苔测试.png')
  await writeFile(source, png)
  const first = await f.repo.attachments.import({ visitId: f.first.id, kind: '舌苔照' }, [
    source,
    source
  ])
  assert.equal(first.added.length, 1)
  assert.equal(first.skipped, 1)
  assert.equal(
    (await f.repo.attachments.import({ visitId: f.first.id, kind: '检查单' }, [source])).skipped,
    1
  )
  assert.deepEqual(f.repo.execute('attachments', f.second.id), [])
  const second = await f.repo.attachments.import({ visitId: f.second.id, kind: '检查单' }, [source])
  assert.notEqual(second.added[0].id, first.added[0].id)
  await rm(source)
  const repo = f.reopen()
  assert.deepEqual((await repo.attachments.read(first.added[0].id)).bytes, png)
  assert.equal(repo.execute('attachments', f.second.id)[0].kind, '检查单')
  await repo.attachments.remove(first.added[0].id)
  assert.deepEqual(repo.execute('attachments', f.first.id), [])
  await assert.rejects(repo.attachments.read(first.added[0].id), /不存在/)
  assert.deepEqual((await repo.attachments.read(second.added[0].id)).bytes, png)
})

test('附件批次失败清理已复制文件；拒绝超大文件、路径式编号和扩展名伪装', async (context) => {
  const f = await fixture(context)
  const source = join(f.directory, 'good.png'),
    bad = join(f.directory, 'bad.png'),
    large = join(f.directory, 'large.png')
  await writeFile(source, png)
  await writeFile(bad, 'this is html')
  await assert.rejects(
    f.repo.attachments.import({ visitId: f.first.id, kind: '其他' }, [source, bad]),
    /只支持/
  )
  assert.deepEqual(f.repo.execute('attachments', f.first.id), [])
  assert.deepEqual(await readdir(join(f.dataDirectory, 'attachments')), [])
  const handle = await open(large, 'w')
  await handle.truncate(MAX_ATTACHMENT_BYTES + 1)
  await handle.close()
  await assert.rejects(
    f.repo.attachments.import({ visitId: f.first.id, kind: '其他' }, [large]),
    /20 MB/
  )
  await assert.rejects(
    f.repo.attachments.import({ visitId: randomUUID(), kind: '其他' }, [source]),
    /不存在/
  )
  await assert.rejects(f.repo.attachments.read('../clinical.sqlite'), /编号/)
  assert.throws(
    () => parseAttachmentImport({ visitId: f.first.id, kind: '其他', path: source }),
    /字段/
  )
  assert.throws(() => detectAttachment(png, 'fake.pdf'), /只支持/)
  assert.throws(
    () => parseVisitPdf({ visitId: f.first.id, imageIds: [f.first.id, f.first.id] }),
    /重复/
  )
})

test('附件校验损坏和丢失不返回错误字节，清理标记可在下次启动完成', async (context) => {
  const f = await fixture(context)
  const source = join(f.directory, 'file.png')
  await writeFile(source, png)
  const { added } = await f.repo.attachments.import({ visitId: f.first.id, kind: '其他' }, [source])
  const stored = join(f.dataDirectory, 'attachments', added[0].id)
  await writeFile(stored, '损坏')
  await assert.rejects(f.repo.attachments.read(added[0].id), /校验/)
  await rm(stored)
  await assert.rejects(f.repo.attachments.read(added[0].id), /无法读取/)
  await writeFile(stored, png)
  f.repo.db.prepare('UPDATE attachments SET removed = 1 WHERE id = ?').run(added[0].id)
  const repo = f.reopen()
  await repo.attachments.cleanup()
  assert.deepEqual(repo.execute('attachments', f.first.id), [])
  assert.deepEqual(await readdir(join(f.dataDirectory, 'attachments')), [])
})

test('导出原件字节一致且不能覆盖资料库；图片附页标明就诊归属且转义名称', async (context) => {
  const f = await fixture(context)
  const output = join(f.directory, '导出.png')
  await writeExport(output, png, f.dataDirectory)
  assert.deepEqual(await readFile(output), png)
  await assert.rejects(
    writeExport(join(f.dataDirectory, 'clinical.sqlite'), png, f.dataDirectory),
    /以外/
  )
  const attachment = {
    id: randomUUID(),
    visitId: f.first.id,
    name: '<img>.png',
    kind: '检查单' as const,
    mediaType: 'image/png' as const,
    size: png.length,
    createdAt: '2026-09-29T00:00:00Z'
  }
  const html = recordHtml(f.first, [{ attachment, source: 'image-0.png' }])
  assert.ok(html.includes('&lt;img&gt;.png'))
  assert.ok(html.includes('初诊'))
  assert.equal((html.match(/class="record-attachment"/g) || []).length, 1)
  assert.throws(
    () => recordHtml(f.first, [{ attachment, source: 'https://example.com/a.png' }]),
    /来源/
  )
})
