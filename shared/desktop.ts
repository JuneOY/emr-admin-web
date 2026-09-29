import type { ClinicalMethod, ClinicalOperations } from './clinical'
import type { DataOperation, DataOperationResult } from './data-management'
import type {
  AttachmentContent,
  AttachmentImport,
  AttachmentImportResult,
  VisitPdfInput
} from './attachments'

export interface LocalSettings {
  workspaceName: string
  confirmBeforeExit: boolean
}

export interface ApplicationInfo {
  name: string
  version: string
  dataDirectory: string
  attachmentsDirectory: string
}

export type DesktopResult<T> = { success: true; data: T } | { success: false; message: string }

export interface DesktopApi {
  manageLocalData(operation: DataOperation): Promise<DesktopResult<DataOperationResult | null>>
  clinical<M extends ClinicalMethod>(
    method: M,
    input: ClinicalOperations[M]['input']
  ): Promise<DesktopResult<ClinicalOperations[M]['output']>>
  exportVisitPdf(input: VisitPdfInput): Promise<DesktopResult<boolean>>
  importAttachments(input: AttachmentImport): Promise<DesktopResult<AttachmentImportResult | null>>
  readAttachment(attachmentId: string): Promise<DesktopResult<AttachmentContent>>
  exportAttachment(attachmentId: string): Promise<DesktopResult<boolean>>
  removeAttachment(attachmentId: string): Promise<DesktopResult<void>>
  getApplicationInfo(): Promise<DesktopResult<ApplicationInfo>>
  getSettings(): Promise<DesktopResult<LocalSettings>>
  saveSettings(settings: LocalSettings): Promise<DesktopResult<LocalSettings>>
  openDataDirectory(): Promise<DesktopResult<void>>
}

export const DESKTOP_CHANNELS = {
  manageLocalData: 'emr:data-manage',
  clinical: 'emr:clinical',
  exportVisitPdf: 'emr:visit-pdf',
  importAttachments: 'emr:attachments-import',
  readAttachment: 'emr:attachment-read',
  exportAttachment: 'emr:attachment-export',
  removeAttachment: 'emr:attachment-remove',
  getApplicationInfo: 'emr:application-info',
  getSettings: 'emr:settings-read',
  saveSettings: 'emr:settings-save',
  openDataDirectory: 'emr:data-directory-open'
} as const

export const DEFAULT_SETTINGS: Readonly<LocalSettings> = {
  workspaceName: '门诊病历',
  confirmBeforeExit: false
}

export function parseSettings(input: unknown): LocalSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('设置格式不正确')
  }
  const value = input as Record<string, unknown>
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'workspaceName') ||
    !Object.hasOwn(value, 'confirmBeforeExit') ||
    typeof value.workspaceName !== 'string' ||
    typeof value.confirmBeforeExit !== 'boolean'
  ) {
    throw new Error('设置包含不支持的字段或类型')
  }
  const workspaceName = value.workspaceName.trim()
  const hasControlCharacter = Array.from(value.workspaceName).some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!workspaceName || workspaceName.length > 40 || hasControlCharacter) {
    throw new Error('资料库名称须为 1 至 40 个可显示字符')
  }
  return { workspaceName, confirmBeforeExit: value.confirmBeforeExit }
}
