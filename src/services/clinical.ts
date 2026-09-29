import type {
  ClinicalMethod,
  ClinicalOperations,
  Dictionaries,
  DictionaryInput,
  DictionaryItem
} from '@shared/clinical'
import { bridge, unwrap } from './desktop'
import { ElMessage } from 'element-plus'
import type { AttachmentImport, VisitPdfInput } from '@shared/attachments'
import { useClinicalDictionariesStore } from '@/store/modules/clinical-dictionaries'

export async function clinicalCall<M extends ClinicalMethod>(
  method: M,
  input: ClinicalOperations[M]['input']
): Promise<ClinicalOperations[M]['output']> {
  const dictionaries = useClinicalDictionariesStore()
  const request = method === 'dictionaries' ? dictionaries.beginLoad() : 0
  // Vue 的响应式 Proxy 不能穿过 IPC，边界处转换为普通可序列化数据。
  const result = await unwrap(bridge().clinical(method, JSON.parse(JSON.stringify(input))))
  if (method === 'dictionaries') dictionaries.applyLoad(request, result as Dictionaries)
  if (method === 'saveDictionary')
    dictionaries.applySaved((input as DictionaryInput).kind, result as DictionaryItem)
  return result
}

export const exportVisitPdf = (input: VisitPdfInput) =>
  unwrap(bridge().exportVisitPdf(JSON.parse(JSON.stringify(input))))
export const importAttachments = (input: AttachmentImport) =>
  unwrap(bridge().importAttachments({ ...input }))
export const readAttachment = (id: string) => unwrap(bridge().readAttachment(id))
export const exportAttachment = (id: string) => unwrap(bridge().exportAttachment(id))
export const removeAttachment = (id: string) => unwrap(bridge().removeAttachment(id))
export function notifyError(error: unknown): void {
  ElMessage.error({
    message: error instanceof Error ? error.message : '本地操作失败',
    grouping: true
  })
}
