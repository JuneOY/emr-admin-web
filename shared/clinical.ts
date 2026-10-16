import type { Prescription, PrescriptionInput, PrescriptionQuery } from './prescriptions'
import type { Attachment } from './attachments'

export type Sex = '男' | '女' | '未填'
export type VisitKind = '初诊' | '复诊'
export type DictionaryKind = 'doctor' | 'category'

export interface PatientDetails {
  name: string
  phone: string
  sex: Sex
  birthDate: string
  address: string
  occupation: string
  ethnicity: string
  maritalStatus: string
}

export interface Patient extends PatientDetails {
  id: string
  recordNumber: string
  revision: number
  createdAt: string
  updatedAt: string
}

export interface PatientInput extends PatientDetails {
  id: string | null
  revision: number
}

export interface PatientQuery {
  keyword: string
  doctorId: string
  categoryId: string
  page: number
  pageSize: number
}

export interface PatientRow extends Patient {
  visitCount: number
  latestVisitDate: string | null
  latestDoctorId: string | null
  latestDoctorName: string | null
}

export interface CaseDelete {
  patientId: string
  revision: number
  updatedAt: string
  visitCount: number
}

export interface Page<T> {
  items: T[]
  total: number
}

export interface DictionaryItem {
  id: string
  name: string
  active: boolean
  revision: number
}

export interface DictionaryInput {
  kind: DictionaryKind
  id: string | null
  name: string
  active: boolean
  revision: number
}

export interface Dictionaries {
  doctors: DictionaryItem[]
  categories: DictionaryItem[]
}

export interface RecordBody {
  narrative: string
  mechanism: string
  diagnosis: string
  prescription: string
}

export interface PatientSnapshot extends PatientDetails {
  age: string
}

export interface VisitSummary {
  id: string
  patientId: string
  doctorId: string
  /** 通过医生 ID 关联的最新姓名，创建时的姓名副本保留在数据库中。 */
  doctorName: string
  date: string
  kind: VisitKind
  revision: number
  createdAt: string
  updatedAt: string
  categoryIds: string[]
}

export interface Visit extends VisitSummary {
  recordNumber: string
  patient: PatientSnapshot
  body: RecordBody
  layoutVersion: 1
}

export interface VisitCreate {
  patientId: string
  doctorId: string
  date: string
  kind: VisitKind
}

export interface VisitSave {
  id: string
  revision: number
  date: string
  kind: VisitKind
  patient: PatientSnapshot
  body: RecordBody
  categoryIds: string[]
}

export interface VisitDelete {
  id: string
  revision: number
}

export interface CaseCreate extends Omit<VisitSave, 'id' | 'revision'> {
  patientId: string | null
  doctorId: string
}

export interface VisitQuery {
  patientId: string
  page: number
  pageSize: number
}

export interface ClinicalOperations {
  dictionaries: { input: null; output: Dictionaries }
  saveDictionary: { input: DictionaryInput; output: DictionaryItem }
  patients: { input: PatientQuery; output: Page<PatientRow> }
  patient: { input: string; output: Patient }
  savePatient: { input: PatientInput; output: Patient }
  visits: { input: VisitQuery; output: Page<VisitSummary> }
  caseVisits: { input: VisitQuery; output: Page<Visit> }
  visit: { input: string; output: Visit }
  createVisit: { input: VisitCreate; output: Visit }
  createCase: { input: CaseCreate; output: Visit }
  deleteCase: { input: CaseDelete; output: { pendingAttachments: boolean } }
  deleteVisit: { input: VisitDelete; output: { pendingAttachments: boolean } }
  saveVisit: { input: VisitSave; output: Visit }
  prescriptions: { input: PrescriptionQuery; output: Page<Prescription> }
  prescription: { input: string; output: Prescription }
  savePrescription: { input: PrescriptionInput; output: Prescription }
  attachments: { input: string; output: Attachment[] }
}

export type ClinicalMethod = keyof ClinicalOperations
export const CLINICAL_METHODS: ClinicalMethod[] = [
  'dictionaries',
  'saveDictionary',
  'patients',
  'patient',
  'savePatient',
  'visits',
  'caseVisits',
  'visit',
  'createVisit',
  'createCase',
  'deleteCase',
  'deleteVisit',
  'saveVisit',
  'prescriptions',
  'prescription',
  'savePrescription',
  'attachments'
]

export const EMPTY_PATIENT: PatientDetails = {
  name: '',
  phone: '',
  sex: '未填',
  birthDate: '',
  address: '',
  occupation: '',
  ethnicity: '',
  maritalStatus: ''
}

export const EMPTY_RECORD: RecordBody = {
  narrative: '',
  mechanism: '',
  diagnosis: '',
  prescription: ''
}

export function previousPrescription(
  visits: readonly Pick<Visit, 'id' | 'patientId' | 'date' | 'kind' | 'body'>[],
  index: number
): string {
  const current = visits[index]
  if (!current || current.kind !== '复诊') return ''
  let previous: (typeof visits)[number] | undefined
  // 只引用当前单据之前的就诊；同日取后建立者，空处方不回退更早记录。
  for (const visit of visits.slice(0, index)) {
    if (!visit.id || visit.patientId !== current.patientId || visit.date > current.date) continue
    if (!previous || visit.date >= previous.date) previous = visit
  }
  return previous?.body.prescription ?? ''
}

export function localDate(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function ageAt(birthDate: string, visitDate: string): string {
  if (!birthDate || birthDate > visitDate) return ''
  const birth = birthDate.split('-').map(Number)
  const visit = visitDate.split('-').map(Number)
  const years = visit[0] - birth[0] - (visitDate.slice(5) < birthDate.slice(5) ? 1 : 0)
  return String(years)
}

export function ageValue(value: string): string {
  return value.replace(/岁/g, '').trim()
}

export function maritalStatusValue(value: string): string {
  return value === '已婚' ? '是' : value === '未婚' ? '否' : value
}
