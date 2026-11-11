import type { Prescription, PrescriptionItem } from './prescriptions'

export const PRESCRIPTION_LIBRARY_HEADERS = [
  '处方名称',
  '类型',
  '状态',
  '药品数',
  '药品明细',
  '用法说明',
  '备注',
  '创建时间',
  '更新时间'
] as const

export const PRESCRIPTION_ITEM_HEADERS = [
  '处方名称',
  '类型',
  '序号',
  '药品名称',
  '用量',
  '单位',
  '药品用法'
] as const

export type SheetCell = string | number

export interface PrescriptionSheets {
  /** 一行一张处方，便于浏览、筛选和打印。 */
  library: SheetCell[][]
  /** 一行一个药品，便于按药品检索与再加工。 */
  items: SheetCell[][]
}

export function formatExportTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return value
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 单味药在一行内展示：药名 + 用量（用量为空时不写，避免只剩一个孤立的单位）。
 */
function itemLine(item: PrescriptionItem): string {
  const dose = item.amount ? `${item.amount}${item.unit}` : ''
  return dose ? `${item.name} ${dose}` : item.name
}

export function prescriptionSheets(items: Prescription[]): PrescriptionSheets {
  const library: SheetCell[][] = [[...PRESCRIPTION_LIBRARY_HEADERS]]
  const rows: SheetCell[][] = [[...PRESCRIPTION_ITEM_HEADERS]]
  for (const prescription of items) {
    library.push([
      prescription.name,
      prescription.kind,
      prescription.active ? '启用' : '已停用',
      prescription.items.length,
      prescription.items.map(itemLine).join('；'),
      prescription.usage,
      prescription.notes,
      formatExportTime(prescription.createdAt),
      formatExportTime(prescription.updatedAt)
    ])
    prescription.items.forEach((item, index) => {
      rows.push([
        prescription.name,
        prescription.kind,
        index + 1,
        item.name,
        item.amount,
        item.unit,
        item.usage
      ])
    })
  }
  return { library, items: rows }
}
