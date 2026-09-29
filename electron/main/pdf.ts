import { BrowserWindow, dialog } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Visit } from '../../shared/clinical'
import type { AttachmentContent, VisitPdfInput } from '../../shared/attachments'
import { recordHtml, type RecordImage } from '../../shared/record-layout'
import type { ClinicalClient } from '../../backend/services/clinical-client'
import { writeExport } from './export-file'

export async function renderVisitPdf(
  visit: Visit,
  images: AttachmentContent[] = []
): Promise<Buffer> {
  const temporaryRoot = resolve(tmpdir())
  const directory = await mkdtemp(join(temporaryRoot, 'emr-print-'))
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true
    }
  })
  printWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    const printable: RecordImage[] = []
    for (const [index, content] of images.entries()) {
      const extension = (
        { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>
      )[content.attachment.mediaType]
      if (!extension || content.attachment.visitId !== visit.id)
        throw new Error('请选择本次就诊的图片')
      const source = `image-${index}.${extension}`
      await writeFile(join(directory, source), content.bytes, { flag: 'wx' })
      printable.push({ attachment: content.attachment, source })
    }
    const file = join(directory, 'record.html')
    await writeFile(file, recordHtml(visit, printable), { flag: 'wx' })
    await printWindow.loadFile(file)
    await printWindow.webContents.executeJavaScript(
      `Promise.all([document.fonts.ready, ...Array.from(document.images, image => image.decode())]).then(() => {
        const record = document.querySelector('.record-document')
        const prescription = record.querySelector('.record-prescription .record-text')
        const pixelsPerMm = document.body.getBoundingClientRect().width / 182
        const availableHeight = (297 - 14 - 18) * pixelsPerMm
        const overflow = Math.max(0, record.getBoundingClientRect().height - availableHeight)
        const minimum = parseFloat(getComputedStyle(prescription).minHeight)
        // 处方留白只使用首页剩余空间，长正文自然撑高，不能因为空白额外生成一页。
        prescription.style.minHeight = Math.max(0, minimum - overflow) + 'px'
        return true
      })`
    )
    return await printWindow.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margins: { top: 14 / 25.4, bottom: 18 / 25.4, left: 14 / 25.4, right: 14 / 25.4 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;padding:0 14mm;font-size:12px;color:#000;text-align:right;font-family:SimSun,serif">第 <span class="pageNumber"></span> 页 / 共 <span class="totalPages"></span> 页</div>',
      generateTaggedPDF: true
    })
  } finally {
    printWindow.destroy()
    if (
      dirname(directory) === temporaryRoot &&
      directory.startsWith(join(temporaryRoot, 'emr-print-'))
    )
      await rm(directory, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}

export async function exportVisitPdf(
  window: BrowserWindow,
  clinical: ClinicalClient,
  input: VisitPdfInput,
  dataDirectory: string
): Promise<boolean> {
  const visit = await clinical.call('visit', input.visitId)
  const attachments = await clinical.call('attachments', visit.id)
  const selected = input.imageIds.map((key) => {
    const item = attachments.find((attachment) => attachment.id === key)
    if (!item || !item.mediaType.startsWith('image/'))
      throw new Error('请选择本次就诊的图片，PDF 报告请单独导出')
    return item
  })
  if (selected.reduce((sum, item) => sum + item.size, 0) > 100 * 1024 * 1024)
    throw new Error('所选图片总大小不能超过 100 MB，请分次导出')
  const name = `${visit.patient.name}-${visit.date}-${visit.kind}`.replace(/[<>:"/\\|?*]/g, '_')
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: '导出本次病历',
    defaultPath: `${name}.pdf`,
    filters: [{ name: 'PDF 文档', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return false
  const images: AttachmentContent[] = []
  for (const item of selected) images.push(await clinical.internal('readAttachment', item.id))
  let bytes: Buffer
  try {
    bytes = await renderVisitPdf(visit, images)
  } catch {
    throw new Error('病历 PDF 生成失败，请检查所选图片是否完整且可以预览')
  }
  await writeExport(filePath, bytes, dataDirectory)
  return true
}
