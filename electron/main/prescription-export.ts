import { BrowserWindow, dialog } from 'electron'
import * as XLSX from 'xlsx'
import type { ClinicalClient } from '../../backend/services/clinical-client'
import { localDate } from '../../shared/clinical'
import type { PrescriptionExportResult } from '../../shared/exports'
import { prescriptionSheets, type SheetCell } from '../../shared/prescription-sheet'
import type { Prescription } from '../../shared/prescriptions'
import { writeExport } from './export-file'

const PAGE_SIZE = 100

async function allPrescriptions(clinical: ClinicalClient): Promise<Prescription[]> {
  const items: Prescription[] = []
  for (let page = 1; ; page += 1) {
    const result = await clinical.call('prescriptions', {
      keyword: '',
      kind: '',
      activeOnly: false,
      page,
      pageSize: PAGE_SIZE
    })
    items.push(...result.items)
    if (!result.items.length || page * PAGE_SIZE >= result.total) break
  }
  return items
}

function sheetOf(rows: SheetCell[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet['!cols'] = widths.map((wch) => ({ wch }))
  sheet['!autofilter'] = {
    ref: `A1:${XLSX.utils.encode_col(rows[0].length - 1)}${rows.length}`
  }
  return sheet
}

/**
 * 导出处方库为 xlsx：一行一张处方便于浏览，另附一行一个药品的明细表便于检索。
 * 导出范围固定为全部处方（含已停用），不受列表筛选影响。
 */
export async function exportPrescriptionLibrary(
  window: BrowserWindow,
  clinical: ClinicalClient,
  dataDirectory: string
): Promise<PrescriptionExportResult | null> {
  const items = await allPrescriptions(clinical)
  if (!items.length) throw new Error('处方库暂无处方，未生成文件')

  const { library, items: detail } = prescriptionSheets(items)
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    book,
    sheetOf(library, [24, 14, 10, 8, 60, 36, 28, 18, 18]),
    '处方库'
  )
  XLSX.utils.book_append_sheet(book, sheetOf(detail, [24, 14, 8, 24, 16, 10, 32]), '处方明细')
  const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: '导出处方库',
    defaultPath: `处方库-${localDate()}.xlsx`,
    filters: [{ name: 'Excel 工作簿', extensions: ['xlsx'] }]
  })
  if (canceled || !filePath) return null
  await writeExport(filePath, bytes, dataDirectory)
  return { exported: items.length }
}
