import type {
  CaseCreate,
  DictionaryInput,
  PatientDetails,
  PatientInput,
  PatientQuery,
  PatientSnapshot,
  RecordBody,
  VisitCreate,
  VisitQuery,
  VisitSave
} from './clinical'
import { MAX_RECORD_PAGES, estimateRecordPages } from './record-layout'
import { ageValue, maritalStatusValue } from './clinical'

export class ClinicalError extends Error {}

function invalid(message: string): never {
  throw new ClinicalError(message)
}

export function object(input: unknown, keys: string[]): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('提交的数据格式不正确')
  const value = input as Record<string, unknown>
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key)))
    invalid('提交的数据包含不支持的字段')
  return value
}

export function text(
  input: unknown,
  label: string,
  max: number,
  required = false,
  multiline = false
): string {
  if (typeof input !== 'string') invalid(`${label}格式不正确`)
  const value = multiline ? input.replace(/\r\n?/g, '\n') : input.trim()
  if (value.length > max || (required && !value))
    invalid(`${label}${required ? '须为 1' : '最多'} 至 ${max} 个字符`)
  if (
    Array.from(value).some((char) => {
      const code = char.charCodeAt(0)
      return (code < 32 && !(multiline && (code === 10 || code === 9))) || code === 127
    })
  )
    invalid(`${label}包含不支持的字符`)
  return value
}

export function id(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)
  )
    invalid('记录编号不正确')
  return input
}

function optionalId(input: unknown): string {
  return input === '' ? '' : id(input)
}
function nullableId(input: unknown): string | null {
  return input === null ? null : id(input)
}

export function integer(input: unknown, label: string, min: number, max: number): number {
  if (typeof input !== 'number' || !Number.isSafeInteger(input) || input < min || input > max)
    invalid(`${label}超出允许范围`)
  return input
}

export function date(input: unknown, label: string, optional = false): string {
  if (input === '' && optional) return ''
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) invalid(`${label}格式不正确`)
  const parsed = new Date(`${input}T12:00:00Z`)
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== input ||
    input < '1850-01-01' ||
    input > '2200-12-31'
  )
    invalid(`${label}不是有效日期`)
  return input
}

function oneOf<T extends string>(input: unknown, values: readonly T[], label: string): T {
  if (!values.includes(input as T)) invalid(`${label}不正确`)
  return input as T
}

const detailKeys = [
  'name',
  'phone',
  'sex',
  'birthDate',
  'address',
  'occupation',
  'ethnicity',
  'maritalStatus'
]
function patientDetails(value: Record<string, unknown>): PatientDetails {
  const phone = text(value.phone, '电话', 30)
  if (phone && !/^[\d+() -]{3,30}$/.test(phone))
    invalid('电话只能包含数字、空格、加号、括号及连字符')
  return {
    name: text(value.name, '姓名', 40, true),
    phone,
    sex: oneOf(value.sex, ['男', '女', '未填'], '性别'),
    birthDate: date(value.birthDate, '出生日期', true),
    address: text(value.address, '家庭住址', 120),
    occupation: text(value.occupation, '职业', 30),
    ethnicity: text(value.ethnicity, '民族', 20),
    maritalStatus: maritalStatusValue(text(value.maritalStatus, '婚否', 20))
  }
}

export function parsePatient(input: unknown): PatientInput {
  const value = object(input, [...detailKeys, 'id', 'revision'])
  return {
    ...patientDetails(value),
    id: nullableId(value.id),
    revision: integer(value.revision, '版本', 0, Number.MAX_SAFE_INTEGER)
  }
}

export function parseDictionary(input: unknown): DictionaryInput {
  const value = object(input, ['kind', 'id', 'name', 'active', 'revision'])
  if (typeof value.active !== 'boolean') invalid('启用状态不正确')
  return {
    kind: oneOf(value.kind, ['doctor', 'category'], '分类类型'),
    id: nullableId(value.id),
    name: text(value.name, '名称', 40, true),
    active: value.active,
    revision: integer(value.revision, '版本', 0, Number.MAX_SAFE_INTEGER)
  }
}

export function parsePatientQuery(input: unknown): PatientQuery {
  const value = object(input, ['keyword', 'doctorId', 'categoryId', 'page', 'pageSize'])
  return {
    keyword: text(value.keyword, '关键词', 60),
    doctorId: optionalId(value.doctorId),
    categoryId: optionalId(value.categoryId),
    page: integer(value.page, '页码', 1, 1000000),
    pageSize: integer(value.pageSize, '每页条数', 1, 100)
  }
}

export function parseVisitQuery(input: unknown): VisitQuery {
  const value = object(input, ['patientId', 'page', 'pageSize'])
  return {
    patientId: id(value.patientId),
    page: integer(value.page, '页码', 1, 1000000),
    pageSize: integer(value.pageSize, '每页条数', 1, 100)
  }
}

export function parseVisitCreate(input: unknown): VisitCreate {
  const value = object(input, ['patientId', 'doctorId', 'date', 'kind'])
  return {
    patientId: id(value.patientId),
    doctorId: id(value.doctorId),
    date: date(value.date, '就诊日期'),
    kind: oneOf(value.kind, ['初诊', '复诊'], '就诊类型')
  }
}

export function parseVisitSave(input: unknown): VisitSave {
  const value = object(input, ['id', 'revision', 'date', 'kind', 'patient', 'body', 'categoryIds'])
  return {
    id: id(value.id),
    revision: integer(value.revision, '版本', 1, Number.MAX_SAFE_INTEGER),
    ...parseRecordFields(value)
  }
}

export function parseCaseCreate(input: unknown): CaseCreate {
  const value = object(input, [
    'patientId',
    'doctorId',
    'date',
    'kind',
    'patient',
    'body',
    'categoryIds'
  ])
  return {
    patientId: nullableId(value.patientId),
    doctorId: id(value.doctorId),
    ...parseRecordFields(value)
  }
}

function parseRecordFields(value: Record<string, unknown>): Omit<VisitSave, 'id' | 'revision'> {
  const snapshot = object(value.patient, [...detailKeys, 'age'])
  const patient: PatientSnapshot = {
    ...patientDetails(snapshot),
    age: ageValue(text(snapshot.age, '年龄', 16))
  }
  const fields = object(value.body, ['narrative', 'mechanism', 'diagnosis', 'prescription'])
  const body: RecordBody = {
    narrative: text(fields.narrative, '病情记录', 20000, false, true),
    mechanism: text(fields.mechanism, '病机要点', 4000, false, true),
    diagnosis: text(fields.diagnosis, '中医诊断', 4000, false, true),
    prescription: text(fields.prescription, '处方', 20000, false, true)
  }
  if (estimateRecordPages(body) > MAX_RECORD_PAGES)
    invalid(`单次病例按最多 ${MAX_RECORD_PAGES} 页估算限制容量，请减少多余空行`)
  if (!Array.isArray(value.categoryIds) || value.categoryIds.length > 20)
    invalid('每次就诊最多选择 20 个分类')
  const categoryIds = value.categoryIds.map(id)
  if (new Set(categoryIds).size !== categoryIds.length) invalid('就诊分类不能重复')
  return {
    date: date(value.date, '就诊日期'),
    kind: oneOf(value.kind, ['初诊', '复诊'], '就诊类型'),
    patient,
    body,
    categoryIds
  }
}
