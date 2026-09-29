import type {
  AttachmentContent,
  AttachmentImport,
  AttachmentImportResult
} from '../../shared/attachments'

// 此契约只在主进程与 Worker 间使用，绝不能加入渲染端 CLINICAL_METHODS 白名单。
export interface ClinicalInternalOperations {
  createSnapshot: { input: string; output: void }
  verifySnapshot: { input: string; output: void }
  restoreSnapshot: { input: { source: string; target: string }; output: void }
  importAttachments: {
    input: { request: AttachmentImport; paths: string[] }
    output: AttachmentImportResult
  }
  readAttachment: { input: string; output: AttachmentContent }
  removeAttachment: { input: string; output: void }
}
