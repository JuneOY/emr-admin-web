import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SETTINGS, parseSettings } from '../shared/desktop'

test('名称去除首尾空格，保留中文，并返回独立结果', () => {
  const input = { workspaceName: '  门诊资料库  ', confirmBeforeExit: true }
  const result = parseSettings(input)
  assert.deepEqual(result, { workspaceName: '门诊资料库', confirmBeforeExit: true })
  assert.equal(input.workspaceName, '  门诊资料库  ')
  assert.notEqual(result, input)
  assert.deepEqual(parseSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS)
})

test('接受名称上限，拒绝空白、超长和控制字符', () => {
  assert.equal(
    parseSettings({ ...DEFAULT_SETTINGS, workspaceName: '医'.repeat(40) }).workspaceName.length,
    40
  )
  for (const workspaceName of [
    '',
    '   ',
    '医'.repeat(41),
    '名字\n',
    '名\t字',
    '名\u0000字',
    '名\u007f字'
  ]) {
    assert.throws(() => parseSettings({ ...DEFAULT_SETTINGS, workspaceName }), /名称/)
  }
})

test('拒绝缺失字段、额外字段及不支持的字段类型', () => {
  for (const value of [
    null,
    undefined,
    [],
    '门诊',
    123,
    {},
    { workspaceName: '门诊' },
    { workspaceName: 123, confirmBeforeExit: false },
    { workspaceName: '门诊', confirmBeforeExit: 'false' },
    { ...DEFAULT_SETTINGS, path: 'C:/其他文件' },
    Object.assign(Object.create({ confirmBeforeExit: false }), {
      workspaceName: '门诊',
      other: true
    })
  ]) {
    assert.throws(() => parseSettings(value), /设置/)
  }
})
