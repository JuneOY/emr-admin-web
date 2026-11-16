import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_RECORD, previousPrescription, type Visit } from '../shared/clinical'

function visit(date: string, prescription: string, kind: Visit['kind'] = '复诊') {
  return {
    id: `${date}-${prescription}`,
    patientId: 'patient-a',
    kind,
    date,
    body: { ...EMPTY_RECORD, narrative: '病情不参与引用', prescription }
  }
}

test('没有前次记录或当前为初诊时，没有上次处方', () => {
  const initial = visit('2026-10-01', '初诊处方', '初诊')
  assert.equal(previousPrescription([], 0), '')
  assert.equal(previousPrescription([initial], 0), '')
  assert.equal(previousPrescription([initial], -1), '')
  assert.equal(previousPrescription([initial], 2), '')
})

test('首次复诊可引用初诊处方，引用为独立文字且不修改其他栏目', () => {
  const initial = visit('2026-10-01', '初诊处方', '初诊')
  const current = visit('2026-10-09', '')
  current.body.prescription = previousPrescription([initial, current], 1)
  assert.equal(current.body.prescription, '初诊处方')
  current.body.prescription = '本次修改后的处方'
  assert.equal(initial.body.prescription, '初诊处方')
  assert.equal(current.body.narrative, '病情不参与引用')
})

test('按最近就诊日期选择处方，同日取后建立者，补录旧单据不回退来源', () => {
  const records = [
    visit('2026-10-01', '初诊处方', '初诊'),
    visit('2026-10-08', '第一次复诊处方'),
    visit('2026-10-08', '同日后建立的处方'),
    visit('2026-10-03', '补录旧记录处方'),
    visit('2026-10-09', '')
  ]
  assert.equal(previousPrescription(records, 4), '同日后建立的处方')
  assert.equal(previousPrescription(records, 1), '初诊处方')
})

test('不能引用当前单据、后续单据、未来日期、其他患者或未保存记录的处方', () => {
  const records = [
    visit('2026-10-01', '可用处方', '初诊'),
    visit('2026-10-10', '未来日期处方'),
    { ...visit('2026-10-08', '其他患者处方'), patientId: 'patient-b' },
    { ...visit('2026-10-08', '未保存处方'), id: '' },
    visit('2026-10-09', '当前处方'),
    visit('2026-10-09', '后续处方')
  ]
  assert.equal(previousPrescription(records, 4), '可用处方')
})

test('上次处方为空时不回退早期处方，保留处方自由文字及用法', () => {
  const records = [
    visit('2026-10-01', '早期处方', '初诊'),
    visit('2026-10-08', ''),
    visit('2026-10-09', '')
  ]
  assert.equal(previousPrescription(records, 2), '')
  records[1].body.prescription = '药品一  10 g    药品二  6 g\n用法：由医生填写\n备注：测试'
  assert.equal(previousPrescription(records, 2), records[1].body.prescription)
})
