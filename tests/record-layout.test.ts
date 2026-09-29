import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_PATIENT, EMPTY_RECORD, type Visit } from '../shared/clinical'
import { estimateRecordPages, escapeHtml, recordHtml, RECORD_FIELDS } from '../shared/record-layout'

const visit: Visit = {
  id: '',
  patientId: '',
  doctorId: '',
  doctorName: '医生甲',
  date: '2026-09-29',
  kind: '初诊',
  revision: 1,
  createdAt: '',
  updatedAt: '',
  categoryIds: [],
  recordNumber: 'P0000001',
  patient: { ...EMPTY_PATIENT, name: '测试', age: '40岁' },
  body: EMPTY_RECORD,
  layoutVersion: 1
}

test('连续 PDF 保留所有正文，只输出一次患者资料、处方栏目与医生署名', () => {
  const body = {
    narrative: '中文病情与ASCII\n\n👨‍👩‍👧‍👦é\t'.repeat(200),
    mechanism: '病机\n'.repeat(20),
    diagnosis: '诊断'.repeat(200),
    prescription: '示例文字\n'.repeat(60)
  }
  const html = recordHtml({ ...visit, body })
  assert.ok(estimateRecordPages(body) > 1)
  assert.equal(estimateRecordPages(EMPTY_RECORD), 1)
  for (const field of RECORD_FIELDS) {
    assert.ok(html.includes(escapeHtml(body[field])))
    assert.equal((html.match(new RegExp(`data-field="${field}"`, 'g')) || []).length, 1)
  }
  assert.equal((html.match(/class="record-header"/g) || []).length, 1)
  assert.equal((html.match(/医师签字：/g) || []).length, 1)
  assert.ok(!html.includes('class="record-paper"'))
  assert.ok(!html.includes('overflow: hidden'))
})

test('A4 连续打印保留固定栏目，转义文本且不允许 HTML 执行', () => {
  const html = recordHtml({
    ...visit,
    body: { ...EMPTY_RECORD, narrative: '<img src=x onerror=alert(1)>\n'.repeat(20) }
  })
  assert.ok(html.includes('病机要点'))
  assert.match(html, /size:\s*a4\s+portrait/i)
  assert.ok(html.includes('&lt;img'))
  assert.ok(!html.includes('<img'))
  assert.ok(!html.includes('<script'))
  assert.match(html, /break-after: avoid/)
})

test('打印保留原病历单的横向资料、无标题病情区及签字，完整输出已填信息', () => {
  const patient = {
    name: '模板测试',
    phone: '13900000000',
    sex: '女' as const,
    age: '36',
    birthDate: '1990-01-01',
    maritalStatus: '是',
    occupation: '软件验证',
    ethnicity: '汉族',
    address: '模板地址 <只作测试>'
  }
  const html = recordHtml({ ...visit, patient })
  for (const value of Object.values(patient)) assert.ok(html.includes(escapeHtml(value)))
  assert.match(html, /<h1 class="record-title">初诊病例<\/h1>/)
  assert.match(html, /2026 年 09 月 29 日/)
  assert.match(html, /class="record-sheet"/)
  assert.match(html, /class="record-patient-row record-address-row"/)
  assert.match(html, /class="record-patient-row record-contact-row"/)
  assert.ok(html.indexOf('data-field="narrative"') < html.indexOf('data-field="mechanism"'))
  assert.ok(html.indexOf('data-field="diagnosis"') < html.indexOf('data-field="prescription"'))
  assert.ok(!html.includes('<h2>病情记录'))
  assert.ok(!/<(?:input|textarea|select)\b/.test(html))
  assert.ok(!recordHtml(visit).includes('class="record-patient-row record-contact-row"'))
})

test('复诊打印基本信息仅保留姓名，初诊年龄与婚否兼容旧数据', () => {
  const patient = {
    ...visit.patient,
    phone: '13912345678',
    birthDate: '1986-01-01',
    age: '40岁',
    maritalStatus: '已婚',
    address: '不应在复诊显示的住址'
  }
  const first = recordHtml({ ...visit, patient })
  assert.ok(!first.includes('40岁'))
  assert.ok(!first.includes('已婚'))
  assert.ok(first.includes('>是</span>'))
  const followup = recordHtml({ ...visit, kind: '复诊', patient })
  assert.match(followup, /<h1 class="record-title">复诊病例<\/h1>/)
  assert.match(followup, /record-followup-row/)
  assert.ok(followup.includes(patient.name))
  for (const value of [
    '联系电话',
    '出生日期',
    '家庭住址',
    '性别',
    '年龄',
    '婚否',
    patient.phone,
    patient.address
  ])
    assert.ok(!followup.includes(value))
})
