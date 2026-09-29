import { dialog, type BrowserWindow } from 'electron'
import { extname } from 'node:path'
import type { ClinicalClient } from '../../backend/services/clinical-client'
import { id } from '../../shared/clinical-validation'
import { parseAttachmentImport } from '../../shared/attachments'
import { writeExport } from './export-file'

export async function importAttachments(
  window: BrowserWindow,
  clinical: ClinicalClient,
  input: unknown
) {
  const request = parseAttachmentImport(input)
  await clinical.call('visit', request.visitId)
  const result = await dialog.showOpenDialog(window, {
    title: '添加本次就诊附件',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片与 PDF', extensions: ['jpg', 'jpeg', 'png', 'webp', 'pdf'] }]
  })
  if (result.canceled || !result.filePaths.length) return null
  return clinical.internal('importAttachments', { request, paths: result.filePaths })
}

export async function exportAttachment(
  window: BrowserWindow,
  clinical: ClinicalClient,
  directory: string,
  input: unknown
) {
  const content = await clinical.internal('readAttachment', id(input))
  const result = await dialog.showSaveDialog(window, {
    title: '导出附件原件',
    defaultPath: content.attachment.name,
    filters: [{ name: '原始附件', extensions: [extname(content.attachment.name).slice(1)] }]
  })
  if (result.canceled || !result.filePath) return false
  await writeExport(result.filePath, content.bytes, directory)
  return true
}
