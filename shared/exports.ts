import { ClinicalError, id, object } from './clinical-validation'

/** 单次批量导出最多包含的患者数量，避免一次导出耗时过长且难以核对。 */
export const MAX_BATCH_PATIENTS = 100

/** 单次就诊附加图片的总容量上限，与单次导出 PDF 保持一致。 */
export const MAX_CASE_IMAGES_BYTES = 100 * 1024 * 1024

export interface CaseExportInput {
  patientIds: string[]
}

export interface CaseExportProgress {
  /** 已完成的病历数量。 */
  completed: number
  total: number
  /** 正在生成的文件描述，用于界面提示。 */
  label: string
}

export interface CaseExportResult {
  directory: string
  exported: number
  /** 单份病历生成失败的数量，失败原因写入主进程日志。 */
  failed: number
  /** 因图片超过容量上限而只导出文字的病历数量。 */
  withoutImages: number
}

export interface PrescriptionExportResult {
  exported: number
}

export function parseCaseExport(input: unknown): CaseExportInput {
  const value = object(input, ['patientIds'])
  if (!Array.isArray(value.patientIds) || value.patientIds.length < 1)
    throw new ClinicalError('请选择需要导出的病例')
  if (value.patientIds.length > MAX_BATCH_PATIENTS)
    throw new ClinicalError(`每次最多导出 ${MAX_BATCH_PATIENTS} 位患者的病例`)
  const patientIds = value.patientIds.map((item) => id(item))
  if (new Set(patientIds).size !== patientIds.length)
    throw new ClinicalError('待导出的病例不能重复')
  return { patientIds }
}

const invalidFileNameChar = /[<>:"/\\|?*]/
const FILE_NAME_MAX = 120

/** 把 Windows 与 macOS 都不接受的字符替换为下划线，控制字符同样替换。 */
function safeFileNameText(value: string): string {
  return Array.from(value)
    .map((char) => {
      const code = char.codePointAt(0) ?? 0
      return invalidFileNameChar.test(char) || code < 32 || code === 127 ? '_' : char
    })
    .join('')
}

/**
 * 生成不含扩展名的导出文件名：病案号-姓名-日期-初诊/复诊。
 * 姓名与病案号来自本地数据，仍需清理文件名不接受的字符与结尾的空格、点号。
 */
export function caseFileBase(input: {
  recordNumber: string
  name: string
  date: string
  kind: string
}): string {
  const raw = [input.recordNumber, input.name, input.date, input.kind].filter(Boolean).join('-')
  const cleaned = safeFileNameText(raw)
    .replace(/[. ]+$/, '')
    .trim()
  const value = cleaned || '病例'
  return Array.from(value).slice(0, FILE_NAME_MAX).join('').trim() || '病例'
}
