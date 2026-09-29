import { ClinicalError, id, integer, object, text } from './clinical-validation'

export const PRESCRIPTION_KINDS = ['中药饮片', '西药／中成药'] as const
export type PrescriptionKind = (typeof PRESCRIPTION_KINDS)[number]
export interface PrescriptionItem {
  name: string
  amount: string
  unit: string
  usage: string
}
export interface PrescriptionInput {
  id: string | null
  revision: number
  name: string
  kind: PrescriptionKind
  items: PrescriptionItem[]
  usage: string
  notes: string
  active: boolean
}
export interface Prescription extends Omit<PrescriptionInput, 'id'> {
  id: string
  createdAt: string
  updatedAt: string
}
export interface PrescriptionQuery {
  keyword: string
  kind: PrescriptionKind | ''
  activeOnly: boolean
  page: number
  pageSize: number
}

function kind(input: unknown, optional = false): PrescriptionKind | '' {
  if ((optional && input === '') || PRESCRIPTION_KINDS.includes(input as PrescriptionKind))
    return input as PrescriptionKind | ''
  throw new ClinicalError('处方类型不正确')
}
export function parsePrescription(input: unknown): PrescriptionInput {
  const value = object(input, [
    'id',
    'revision',
    'name',
    'kind',
    'items',
    'usage',
    'notes',
    'active'
  ])
  if (typeof value.active !== 'boolean') throw new ClinicalError('处方启用状态不正确')
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 80)
    throw new ClinicalError('每张处方须包含 1 至 80 个药品')
  const items = value.items.map((item) => {
    const row = object(item, ['name', 'amount', 'unit', 'usage'])
    return {
      name: text(row.name, '药品名称', 80, true),
      amount: text(row.amount, '用量', 30),
      unit: text(row.unit, '单位', 20),
      usage: text(row.usage, '药品用法', 160)
    }
  })
  const result: PrescriptionInput = {
    id: value.id === null ? null : id(value.id),
    revision: integer(value.revision, '版本', 0, Number.MAX_SAFE_INTEGER),
    name: text(value.name, '处方名称', 80, true),
    kind: kind(value.kind) as PrescriptionKind,
    items,
    usage: text(value.usage, '用法说明', 1500, false, true),
    notes: text(value.notes, '备注', 1500, false, true),
    active: value.active
  }
  text(prescriptionText(result), '处方内容', 20000, true, true)
  return result
}
export function parsePrescriptionQuery(input: unknown): PrescriptionQuery {
  const value = object(input, ['keyword', 'kind', 'activeOnly', 'page', 'pageSize'])
  if (typeof value.activeOnly !== 'boolean') throw new ClinicalError('处方筛选状态不正确')
  return {
    keyword: text(value.keyword, '关键词', 80),
    kind: kind(value.kind, true),
    activeOnly: value.activeOnly,
    page: integer(value.page, '页码', 1, 1000000),
    pageSize: integer(value.pageSize, '每页条数', 1, 100)
  }
}
export function prescriptionText(value: PrescriptionInput): string {
  return [
    value.name,
    ...value.items.map((item) =>
      [item.name, [item.amount, item.unit].filter(Boolean).join(' '), item.usage]
        .filter(Boolean)
        .join('  ')
    ),
    value.usage && `用法：${value.usage}`,
    value.notes && `备注：${value.notes}`
  ]
    .filter(Boolean)
    .join('\n')
}
export function appendPrescription(current: string, prescription: PrescriptionInput): string {
  const addition = prescriptionText(prescription)
  return text(current + (current ? '\n\n' : '') + addition, '处方内容', 20000, true, true)
}
