import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  formatPrescriptionEdit,
  formatPrescriptionText,
  prescriptionBlocks,
  PRESCRIPTION_ITEM_GAP
} from '../shared/prescription-layout'
import {
  insertPrescription,
  prescriptionText,
  type PrescriptionInput
} from '../shared/prescriptions'

const sample: PrescriptionInput = {
  id: null,
  revision: 0,
  name: '仅供软件测试的处方',
  kind: '中药饮片',
  items: Array.from({ length: 7 }, (_, index) => ({
    name: `测试项${index + 1}`,
    amount: '测试量',
    unit: '份',
    usage: index === 2 ? '单项说明' : ''
  })),
  usage: '用法第一行\n用法第二行  仍为说明',
  notes: '合成内容，不用于医疗',
  active: true
}

test('两类处方引用不含处方名，每行四项并完整保留用法与备注', () => {
  for (const kind of ['中药饮片', '西药／中成药'] as const) {
    const value = prescriptionText({ ...sample, kind })
    const lines = value.split('\n')
    assert.equal(value.includes(sample.name), false)
    assert.equal(lines[0].split(PRESCRIPTION_ITEM_GAP).length, 4)
    assert.equal(lines[1].split(PRESCRIPTION_ITEM_GAP).length, 3)
    assert.ok(lines[0].includes('测试项3  测试量 份  单项说明'))
    assert.ok(value.endsWith(`用法：${sample.usage}\n备注：${sample.notes}`))
    assert.equal(formatPrescriptionText(value), value)
  }
})

test('旧引用处方按四项整理，保留自由段落、空行和多份处方边界', () => {
  const drugs = sample.items.map((item) => `${item.name}  测试量 份`)
  const old = `${sample.name}\n${drugs.join('\n')}\n用法：${sample.usage}\n备注：${sample.notes}`
  const value = `医生手写说明\n保留原段落\n\n${old}\n\n${old}`
  const formatted = formatPrescriptionText(value)
  assert.ok(formatted.startsWith('医生手写说明\n保留原段落\n\n'))
  assert.equal(formatted.split(drugs.slice(0, 4).join(PRESCRIPTION_ITEM_GAP)).length, 3)
  assert.equal(formatted.split(`用法：${sample.usage}\n备注：${sample.notes}`).length, 3)
  assert.equal(formatPrescriptionText(formatted), formatted)
  assert.equal(prescriptionBlocks(value).filter((block) => block.kind === 'items').length, 2)
  assert.equal(formatPrescriptionText('\n普通手写内容\n\n下一段\n'), '\n普通手写内容\n\n下一段\n')
})

test('只有名称及长药品仍完整保留，追加不改写原文，容量边界不因排版溢出', () => {
  const names = {
    ...sample,
    items: sample.items.map((item) => ({ ...item, amount: '', unit: '', usage: '' }))
  }
  const value = prescriptionText(names)
  assert.equal(
    value.split('\n')[0],
    sample.items
      .slice(0, 4)
      .map((item) => item.name)
      .join(PRESCRIPTION_ITEM_GAP)
  )
  const long = {
    ...sample,
    items: [{ ...sample.items[0], name: '长名称'.repeat(25), usage: '<合成说明> & 完整保留' }]
  }
  const appended = insertPrescription(value, long).text
  assert.ok(appended.startsWith(value + '\n\n'))
  assert.ok(appended.includes(long.items[0].name))
  assert.ok(appended.includes(long.items[0].usage))
  const maximum = '测试  内容\n'.repeat(3000).slice(0, 20000)
  assert.equal(formatPrescriptionText(maximum), maximum)
})

test('从首尾和手写段落中间插入，保留未选中的文字并把光标放到新增内容之后', () => {
  const original = '前段手写内容\n\n后段手写内容'
  for (const position of [0, original.indexOf('后段'), original.length]) {
    const result = insertPrescription(original, sample, { start: position, end: position })
    assert.equal(result.text.includes(sample.name), false)
    assert.ok(result.text.startsWith(original.slice(0, position)))
    assert.ok(result.text.endsWith(original.slice(position)))
    assert.ok(result.text.slice(0, result.selection.start).endsWith(`备注：${sample.notes}`))
    assert.equal(result.selection.end, result.selection.start)
  }
  assert.deepEqual(insertPrescription('', sample), {
    text: prescriptionText(sample),
    selection: { start: prescriptionText(sample).length, end: prescriptionText(sample).length }
  })
})

test('在药品间空格与换行处插入，合并为每行四项并保持顺序', () => {
  const drugs = Array.from({ length: 6 }, (_, index) => `原药${index + 1}  测试量 份`)
  const existing =
    drugs.slice(0, 4).join(PRESCRIPTION_ITEM_GAP) +
    '\n' +
    drugs.slice(4).join(PRESCRIPTION_ITEM_GAP)
  const addition = { ...sample, usage: '', notes: '' }
  for (const [position, index] of [
    [existing.indexOf(PRESCRIPTION_ITEM_GAP) + 2, 1],
    [existing.indexOf('\n'), 4],
    [existing.indexOf('原药5'), 4]
  ]) {
    const result = insertPrescription(existing, addition, { start: position, end: position })
    const items = prescriptionBlocks(result.text).flatMap((block) =>
      block.kind === 'items' ? block.items : []
    )
    assert.deepEqual(items, [
      ...drugs.slice(0, index),
      ...prescriptionBlocks(prescriptionText(addition)).flatMap((block) =>
        block.kind === 'items' ? block.items : []
      ),
      ...drugs.slice(index)
    ])
    assert.deepEqual(
      result.text.split('\n').map((line) => line.split(PRESCRIPTION_ITEM_GAP).length),
      [4, 4, 4, 1]
    )
    assert.ok(result.text.slice(0, result.selection.start).endsWith('测试项7  测试量 份'))
  }
})

test('选区替换与只有名称的药品插入不会重复药品，保留现有用法段落', () => {
  const existing = '原药1    原药2    原药3    原药4\n用法：原有用法  保留'
  const addition = {
    ...sample,
    items: [{ name: '新药', amount: '', unit: '', usage: '' }],
    usage: '',
    notes: ''
  }
  const result = insertPrescription(existing, addition, {
    start: existing.indexOf('原药2'),
    end: existing.indexOf('原药3')
  })
  assert.equal(result.text, '原药1    新药    原药3    原药4\n用法：原有用法  保留')
  assert.equal(result.selection.start, result.text.indexOf('新药') + 2)
  assert.equal(
    insertPrescription(existing, addition, { start: 0, end: existing.length }).text,
    '新药'
  )
})

test('插入处方的多行用法不能吞入后面的药品，选区之外的说明保持原文', () => {
  const existing = '原药1  测试量    原药2  测试量\n备注：旧说明  保留'
  const position = existing.indexOf('原药2')
  const result = insertPrescription(existing, sample, { start: position, end: position })
  assert.ok(result.text.includes(`用法：${sample.usage}\n备注：${sample.notes}\n\n原药2  测试量`))
  assert.ok(result.text.endsWith('备注：旧说明  保留'))
  assert.equal(prescriptionBlocks(result.text).filter((block) => block.kind === 'items').length, 2)
})

test('失焦重排映射光标和选区，重复引用仍插在上次引用内容之后', () => {
  const old = sample.items.map((item) => `${item.name}  测试量 份`).join('\n')
  const selection = { start: old.indexOf('测试项5'), end: old.indexOf('测试项6') }
  const result = formatPrescriptionEdit(old, selection)
  assert.equal(result.selection.start, result.text.indexOf('测试项5'))
  assert.equal(result.selection.end, result.text.indexOf('测试项6'))
  const addition = { ...sample, items: [sample.items[0]], usage: '', notes: '' }
  const first = insertPrescription(old, addition, { start: selection.start, end: selection.start })
  const second = insertPrescription(
    first.text,
    { ...addition, items: [sample.items[1]] },
    first.selection
  )
  assert.ok(second.text.includes('测试项1  测试量 份    测试项2  测试量 份    测试项5  测试量 份'))
})

test('容量超限整体拒绝，替换选区可腾出容量，过期位置限制在文本范围内', () => {
  const original = '字'.repeat(20000)
  assert.throws(() => insertPrescription(original, sample, { start: 100, end: 100 }), /字符/)
  assert.equal(
    insertPrescription(original, sample, { start: 0, end: original.length }).text,
    prescriptionText(sample)
  )
  assert.ok(
    insertPrescription('原文', sample, { start: 999, end: 999 }).text.startsWith('原文\n\n')
  )
  assert.ok(insertPrescription('原文', sample, { start: -10, end: -2 }).text.endsWith('\n\n原文'))
})
