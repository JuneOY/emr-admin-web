import { ClinicalError, id, object, text } from './clinical-validation'

export const ATTACHMENT_KINDS = ['舌苔照', '检查单', '其他'] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]
export type AttachmentMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
export const MAX_IMPORT_FILES = 20
export const MAX_VISIT_ATTACHMENTS = 200
export interface Attachment {
  id: string
  visitId: string
  name: string
  kind: AttachmentKind
  mediaType: AttachmentMedia
  size: number
  createdAt: string
}
export interface AttachmentImport {
  visitId: string
  kind: AttachmentKind
}
export interface AttachmentImportResult {
  added: Attachment[]
  skipped: number
}
export interface AttachmentContent {
  attachment: Attachment
  bytes: Uint8Array
}
export interface VisitPdfInput {
  visitId: string
  imageIds: string[]
}
export function parseAttachmentImport(input: unknown): AttachmentImport {
  const value = object(input, ['visitId', 'kind'])
  if (!ATTACHMENT_KINDS.includes(value.kind as AttachmentKind))
    throw new ClinicalError('附件分类不正确')
  return { visitId: id(value.visitId), kind: value.kind as AttachmentKind }
}
export function parseVisitPdf(input: unknown): VisitPdfInput {
  const value = object(input, ['visitId', 'imageIds'])
  if (!Array.isArray(value.imageIds) || value.imageIds.length > 50)
    throw new ClinicalError('每次最多附加 50 张图片')
  const imageIds = value.imageIds.map(id)
  if (new Set(imageIds).size !== imageIds.length) throw new ClinicalError('导出图片不能重复')
  return { visitId: id(value.visitId), imageIds }
}
export function attachmentName(input: unknown): string {
  const name = text(input, '附件名称', 240, true)
  if (/[<>:"/\\|?*]/.test(name) || name === '.' || name === '..')
    throw new ClinicalError('附件名称包含不支持的字符')
  return name
}
