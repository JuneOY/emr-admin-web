import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  assertOutsideDataDirectory,
  uniqueExportPath,
  writeExport
} from '../electron/main/export-file'
import { MAX_BATCH_PATIENTS, caseFileBase, parseCaseExport } from '../shared/exports'
import { formatExportTime, prescriptionSheets } from '../shared/prescription-sheet'
import type { Prescription } from '../shared/prescriptions'

const idA = randomUUID(),
  idB = randomUUID()

function prescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: randomUUID(),
    revision: 1,
    name: '测试处方',
    kind: '中药饮片',
    items: [
      { name: '测试药品甲', amount: '10', unit: 'g', usage: '水煎服' },
      { name: '测试药品乙', amount: '6', unit: 'g', usage: '后下' }
    ],
    usage: '每日一剂',
    notes: '仅供软件验证',
    active: true,
    createdAt: '2026-01-05T02:03:04.000Z',
    updatedAt: '2026-01-06T02:03:04.000Z',
    ...overrides
  }
}

test('批量导出参数只接受去重后的有效患者编号', () => {
  assert.deepEqual(parseCaseExport({ patientIds: [idA, idB] }), { patientIds: [idA, idB] })
  for (const input of [
    null,
    {},
    { patientIds: [] },
    { patientIds: 'abc' },
    { patientIds: [idA, idA] },
    { patientIds: ['not-an-id'] },
    { patientIds: [idA], extra: true },
    { patientIds: Array.from({ length: MAX_BATCH_PATIENTS + 1 }, () => randomUUID()) }
  ])
    assert.throws(() => parseCaseExport(input), Error, JSON.stringify(input))
})

test('病例文件名清理不支持的字符并限制长度', () => {
  assert.equal(
    caseFileBase({ recordNumber: 'P0000001', name: '张三', date: '2026-01-05', kind: '初诊' }),
    'P0000001-张三-2026-01-05-初诊'
  )
  assert.equal(
    caseFileBase({
      recordNumber: 'P1',
      name: 'a<b>c:d"e/f\\g|h?i*j',
      date: '2026-01-05',
      kind: '复诊'
    }),
    'P1-a_b_c_d_e_f_g_h_i_j-2026-01-05-复诊'
  )
  const long = caseFileBase({
    recordNumber: 'P1',
    name: '姓'.repeat(200),
    date: '2026-01-05',
    kind: '初诊'
  })
  assert.equal(Array.from(long).length, 120)
  assert.equal(caseFileBase({ recordNumber: '', name: '', date: '', kind: '' }), '病例')
})

test('重名导出依次追加序号，不覆盖已有文件', async (context) => {
  const root = await mkdtemp(join(resolve(tmpdir()), 'emr-export-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(await uniqueExportPath(root, '病例'), join(root, '病例.pdf'))
  await writeFile(join(root, '病例.pdf'), 'a')
  assert.equal(await uniqueExportPath(root, '病例'), join(root, '病例 (2).pdf'))
  await writeFile(join(root, '病例 (2).pdf'), 'b')
  assert.equal(await uniqueExportPath(root, '病例'), join(root, '病例 (3).pdf'))
})

test('批量导出拒绝写入资料库目录及其子目录', async (context) => {
  const root = await mkdtemp(join(resolve(tmpdir()), 'emr-guard-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const dataDirectory = join(root, '资料库'),
    inside = join(dataDirectory, '导出'),
    outside = join(root, '导出')
  await mkdir(inside, { recursive: true })
  await mkdir(outside, { recursive: true })
  await assert.rejects(() => assertOutsideDataDirectory(dataDirectory, dataDirectory), {
    message: '请选择数据目录以外的位置导出文件'
  })
  await assert.rejects(() => assertOutsideDataDirectory(inside, dataDirectory), {
    message: '请选择数据目录以外的位置导出文件'
  })
  await assert.doesNotReject(() => assertOutsideDataDirectory(outside, dataDirectory))
  await assert.rejects(() => assertOutsideDataDirectory(join(root, '不存在'), dataDirectory), {
    message: '无法读取导出位置，请检查目标文件夹'
  })
  // 单文件写入仍保留原有的父目录校验。
  await assert.rejects(
    () => writeExport(join(dataDirectory, '病例.pdf'), Buffer.from('x'), dataDirectory),
    { message: '请选择数据目录以外的位置导出文件' }
  )
})

test('处方库表格按处方与药品两个维度展开', () => {
  const sheets = prescriptionSheets([
    prescription(),
    prescription({ name: '已停用处方', kind: '西药／中成药', items: [], active: false })
  ])
  assert.deepEqual(sheets.library[0], [
    '处方名称',
    '类型',
    '状态',
    '药品数',
    '药品明细',
    '用法说明',
    '备注',
    '创建时间',
    '更新时间'
  ])
  assert.equal(sheets.library.length, 3)
  assert.deepEqual(sheets.library[1].slice(0, 5), [
    '测试处方',
    '中药饮片',
    '启用',
    2,
    '测试药品甲 10g；测试药品乙 6g'
  ])
  assert.deepEqual(sheets.library[2].slice(0, 5), ['已停用处方', '西药／中成药', '已停用', 0, ''])
  assert.deepEqual(sheets.items[0], [
    '处方名称',
    '类型',
    '序号',
    '药品名称',
    '用量',
    '单位',
    '药品用法'
  ])
  assert.equal(sheets.items.length, 3)
  assert.deepEqual(sheets.items[1], ['测试处方', '中药饮片', 1, '测试药品甲', '10', 'g', '水煎服'])
  assert.deepEqual(sheets.items[2], ['测试处方', '中药饮片', 2, '测试药品乙', '6', 'g', '后下'])
})

test('导出时间按本地时间格式化，非法值原样返回', () => {
  assert.match(formatExportTime('2026-01-05T02:03:04.000Z'), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(formatExportTime('不是时间'), '不是时间')
})
