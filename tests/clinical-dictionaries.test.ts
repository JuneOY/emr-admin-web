import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createPinia } from 'pinia'
import { computed } from 'vue'
import { useClinicalDictionariesStore } from '../src/store/modules/clinical-dictionaries'
import type { Dictionaries, DictionaryItem } from '../shared/clinical'

const doctor: DictionaryItem = { id: 'doctor-a', name: '医生甲', active: true, revision: 1 }
const initial = (): Dictionaries => ({
  doctors: [{ ...doctor }, { ...doctor, id: 'doctor-b', name: '医生乙' }],
  categories: []
})

test('医生连续更名和停用后，所有历史引用响应更新且不影响其他医生', () => {
  const store = useClinicalDictionariesStore(createPinia())
  store.applyLoad(store.beginLoad(), initial())
  const history = [
    { doctorId: 'doctor-a', doctorName: '创建时姓名' },
    { doctorId: 'doctor-b', doctorName: '医生乙' },
    { doctorId: 'doctor-a', doctorName: '医生甲' }
  ]
  const names = computed(() =>
    history.map((visit) => store.doctorName(visit.doctorId, visit.doctorName))
  )
  store.applySaved('doctor', { ...doctor, name: '医生甲更名', revision: 2 })
  assert.deepEqual(names.value, ['医生甲更名', '医生乙', '医生甲更名'])
  store.applySaved('doctor', { ...doctor, name: '医生甲最新', revision: 3, active: false })
  assert.deepEqual(names.value, ['医生甲最新', '医生乙', '医生甲最新'])
  assert.equal(history[0].doctorName, '创建时姓名')
  assert.equal(store.doctorName('missing', '保留姓名'), '保留姓名')
})

test('医生保存成功后，迟到的查询和旧版本保存结果不能恢复旧姓名', () => {
  const store = useClinicalDictionariesStore(createPinia())
  store.applyLoad(store.beginLoad(), initial())
  const pending = store.beginLoad()
  store.applySaved('doctor', { ...doctor, name: '已修改', revision: 2 })
  store.applyLoad(pending, initial())
  store.applySaved('doctor', doctor)
  assert.equal(store.doctorName(doctor.id, ''), '已修改')
})

test('并行字典查询只接受最近请求，医生和分类各自维护', () => {
  const store = useClinicalDictionariesStore(createPinia())
  const first = store.beginLoad()
  const second = store.beginLoad()
  store.applyLoad(second, {
    doctors: [{ ...doctor, name: '最新查询', revision: 2 }],
    categories: []
  })
  store.applyLoad(first, initial())
  store.applySaved('category', { id: 'category-a', name: '肝脏', active: true, revision: 1 })
  assert.equal(store.doctorName(doctor.id, ''), '最新查询')
  assert.equal(store.dictionaries.categories[0].name, '肝脏')
})
