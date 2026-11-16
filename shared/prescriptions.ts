import { ClinicalError, id, integer, object, text } from './clinical-validation'
import {
  formatPrescriptionEdit,
  prescriptionItemRows,
  prescriptionRuns,
  PRESCRIPTION_ITEM_GAP,
  type PrescriptionSelection
} from './prescription-layout'

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
    ...prescriptionItemRows(
      value.items.map((item) =>
        [item.name, [item.amount, item.unit].filter(Boolean).join(' '), item.usage]
          .filter(Boolean)
          .join('  ')
      )
    ).map((row) => row.join(PRESCRIPTION_ITEM_GAP)),
    value.usage && `用法：${value.usage}`,
    value.notes && `备注：${value.notes}`
  ]
    .filter(Boolean)
    .join('\n')
}
export function insertPrescription(
  current: string,
  prescription: PrescriptionInput,
  selection: PrescriptionSelection = { start: current.length, end: current.length }
) {
  const start = Math.max(0, Math.min(selection.start, selection.end, current.length))
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), current.length))
  const runs = prescriptionRuns(current).filter((run) => run.kind === 'items')
  const beforeItems = runs.some((run) => run.start < start && start <= run.end)
  const afterItems = runs.some((run) => run.start <= end && end < run.end)
  let before = current.slice(0, start),
    after = current.slice(end)
  // 药品段内合并相邻的分隔空白，其他手写段落只补足边界，不删除文字。
  if (beforeItems) before = before.replace(/\s+$/, '')
  if (afterItems) after = after.replace(/^\s+/, '')
  const left = !before
    ? ''
    : beforeItems
      ? PRESCRIPTION_ITEM_GAP
      : '\n'.repeat(Math.max(0, 2 - (before.match(/\n*$/)?.[0].length || 0)))
  const right = !after
    ? ''
    : afterItems && !prescription.usage && !prescription.notes
      ? PRESCRIPTION_ITEM_GAP
      : '\n'.repeat(Math.max(0, 2 - (after.match(/^\n*/)?.[0].length || 0)))
  const addition = prescriptionText(prescription)
  const position = before.length + left.length + addition.length
  const result = formatPrescriptionEdit(before + left + addition + right + after, {
    start: position,
    end: position
  })
  text(result.text, '处方内容', 20000, true, true)
  return result
}
