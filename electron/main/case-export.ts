import { BrowserWindow, dialog } from 'electron'
import type { ClinicalClient } from '../../backend/services/clinical-client'
import type { AttachmentContent } from '../../shared/attachments'
import type { Patient } from '../../shared/clinical'
import {
  MAX_CASE_IMAGES_BYTES,
  caseFileBase,
  parseCaseExport,
  type CaseExportProgress,
  type CaseExportResult
} from '../../shared/exports'
import { assertOutsideDataDirectory, uniqueExportPath, writeExport } from './export-file'
import { renderVisitPdf } from './pdf'

interface ExportJob {
  visitId: string
  base: string
  label: string
}

/** 一位患者的全部就诊摘要，按就诊时间正序展开为待导出任务。 */
async function patientJobs(clinical: ClinicalClient, patientId: string): Promise<ExportJob[]> {
  const patient: Patient = await clinical.call('patient', patientId)
  const jobs: ExportJob[] = []
  for (let page = 1; ; page += 1) {
    const result = await clinical.call('visits', { patientId, page, pageSize: 100 })
    for (const visit of result.items) {
      jobs.push({
        visitId: visit.id,
        base: caseFileBase({
          recordNumber: patient.recordNumber,
          name: patient.name,
          date: visit.date,
          kind: visit.kind
        }),
        label: `${patient.recordNumber} ${patient.name} ${visit.date} ${visit.kind}`
      })
    }
    if (!result.items.length || page * 100 >= result.total) break
  }
  return jobs
}

async function visitImages(clinical: ClinicalClient, visitId: string) {
  const attachments = await clinical.call('attachments', visitId)
  const images = attachments.filter((item) => item.mediaType.startsWith('image/'))
  const size = images.reduce((sum, item) => sum + item.size, 0)
  return size > MAX_CASE_IMAGES_BYTES ? { images: [], overflow: true } : { images, overflow: false }
}

export async function exportPatientCases(
  window: BrowserWindow,
  clinical: ClinicalClient,
  input: unknown,
  dataDirectory: string,
  report: (progress: CaseExportProgress) => void
): Promise<CaseExportResult | null> {
  const value = parseCaseExport(input)
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: '选择病例导出文件夹',
    buttonLabel: '导出到此处',
    properties: ['openDirectory', 'createDirectory']
  })
  if (canceled || !filePaths.length) return null
  const directory = filePaths[0]
  await assertOutsideDataDirectory(directory, dataDirectory)

  const jobs: ExportJob[] = []
  for (const patientId of value.patientIds) jobs.push(...(await patientJobs(clinical, patientId)))
  if (!jobs.length) throw new Error('所选患者暂无就诊记录，未生成文件')

  let exported = 0,
    failed = 0,
    withoutImages = 0
  for (const [index, job] of jobs.entries()) {
    report({ completed: index, total: jobs.length, label: job.label })
    try {
      const visit = await clinical.call('visit', job.visitId)
      const selected = await visitImages(clinical, job.visitId)
      if (selected.overflow) withoutImages += 1
      const images: AttachmentContent[] = []
      // 逐张读取，避免一次把多份病历的图片同时留在内存中。
      for (const item of selected.images)
        images.push(await clinical.internal('readAttachment', item.id))
      const bytes = await renderVisitPdf(visit, images)
      await writeExport(await uniqueExportPath(directory, job.base), bytes, dataDirectory)
      exported += 1
    } catch (error) {
      failed += 1
      console.error('[病例导出]', job.visitId, error)
    }
    report({ completed: index + 1, total: jobs.length, label: job.label })
  }
  if (!exported)
    throw new Error(
      failed ? `所选 ${failed} 份病历均未导出，请检查附件是否完整后再导出` : '病例未导出'
    )
  return { directory, exported, failed, withoutImages }
}
