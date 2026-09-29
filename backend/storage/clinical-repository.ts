import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { openClinicalDatabase } from './clinical-database'
import { PrescriptionRepository } from './prescription-repository'
import { AttachmentRepository } from './attachment-repository'
import {
  ageAt,
  ageValue,
  maritalStatusValue,
  EMPTY_PATIENT,
  EMPTY_RECORD,
  type ClinicalMethod,
  type ClinicalOperations,
  type Dictionaries,
  type DictionaryItem,
  type Patient,
  type PatientInput,
  type PatientRow,
  type Visit,
  type VisitCreate,
  type VisitSave,
  type VisitSummary
} from '../../shared/clinical'
import {
  ClinicalError,
  id,
  parseCaseCreate,
  parseDictionary,
  parsePatient,
  parsePatientQuery,
  parseVisitCreate,
  parseVisitQuery,
  parseVisitSave
} from '../../shared/clinical-validation'

type Row = Record<string, unknown>
const conflict = () => new ClinicalError('记录已被其他页面更新，请保留当前内容后重新打开病例')

export class ClinicalRepository {
  readonly db: DatabaseSync
  readonly prescriptions: PrescriptionRepository
  readonly attachments: AttachmentRepository
  constructor(directory: string) {
    this.db = openClinicalDatabase(directory)
    this.prescriptions = new PrescriptionRepository(this.db)
    this.attachments = new AttachmentRepository(this.db, directory)
  }
  close(): void {
    this.db.close()
  }

  execute<M extends ClinicalMethod>(method: M, input: unknown): ClinicalOperations[M]['output'] {
    const handlers = {
      dictionaries: () => {
        if (input !== null) throw new ClinicalError('查询参数不正确')
        return this.dictionaries()
      },
      saveDictionary: () => this.saveDictionary(input),
      patients: () => this.patients(input),
      patient: () => this.patient(id(input)),
      savePatient: () => this.savePatient(input),
      visits: () => this.visits(input),
      caseVisits: () => this.caseVisits(input),
      visit: () => this.visit(id(input)),
      createVisit: () => this.createVisit(input),
      createCase: () => this.createCase(input),
      saveVisit: () => this.saveVisit(input),
      prescriptions: () => this.prescriptions.list(input),
      prescription: () => this.prescriptions.get(input),
      savePrescription: () => this.prescriptions.save(input),
      attachments: () => this.attachments.list(input)
    }
    if (!Object.hasOwn(handlers, method)) throw new ClinicalError('不支持此本地操作')
    return handlers[method]() as ClinicalOperations[M]['output']
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  private dictionaryItem(row: Row): DictionaryItem {
    return {
      id: String(row.id),
      name: String(row.name),
      active: Boolean(row.active),
      revision: Number(row.revision)
    }
  }

  private dictionaries(): Dictionaries {
    const items = (table: 'doctors' | 'categories') =>
      this.db
        .prepare(`SELECT * FROM ${table} ORDER BY active DESC, rowid`)
        .all()
        .map((row) => this.dictionaryItem(row))
    return { doctors: items('doctors'), categories: items('categories') }
  }

  private saveDictionary(input: unknown): DictionaryItem {
    const value = parseDictionary(input)
    const table = value.kind === 'doctor' ? 'doctors' : 'categories'
    return this.transaction(() => {
      if (
        this.db
          .prepare(`SELECT id FROM ${table} WHERE name = ? AND id != ?`)
          .get(value.name, value.id ?? '')
      )
        throw new ClinicalError('此名称已存在，请核实后使用')
      const key = value.id ?? randomUUID()
      if (value.id) {
        const updated = this.db
          .prepare(
            `UPDATE ${table} SET name = ?, active = ?, revision = revision + 1 WHERE id = ? AND revision = ?`
          )
          .run(value.name, Number(value.active), key, value.revision)
        if (updated.changes !== 1) throw conflict()
      } else {
        if (value.revision !== 0) throw conflict()
        const count = Number(this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n)
        if (count >= 300) throw new ClinicalError('医生或分类数量已达 300 个，请维护现有条目')
        this.db
          .prepare(`INSERT INTO ${table}(id, name, active, revision) VALUES(?, ?, ?, 1)`)
          .run(key, value.name, Number(value.active))
      }
      return this.dictionaryItem(this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(key)!)
    })
  }

  private patientFrom(row: Row): Patient {
    const details = JSON.parse(String(row.details))
    return {
      ...details,
      maritalStatus: maritalStatusValue(details.maritalStatus),
      id: String(row.id),
      recordNumber: `P${String(row.number).padStart(7, '0')}`,
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private patient(key: string): Patient {
    const row = this.db.prepare('SELECT * FROM patients WHERE id = ?').get(key)
    if (!row) throw new ClinicalError('患者记录不存在')
    return this.patientFrom(row)
  }

  private patients(input: unknown) {
    const query = parsePatientQuery(input)
    const conditions: string[] = []
    const params: SQLInputValue[] = []
    if (query.keyword) {
      conditions.push("(p.name LIKE ? ESCAPE '\\' OR p.phone LIKE ? ESCAPE '\\')")
      const keyword = `%${query.keyword.replace(/[\\%_]/g, '\\$&')}%`
      params.push(keyword, keyword)
    }
    if (query.doctorId || query.categoryId) {
      const visitConditions = ['v.patient_id = p.id']
      if (query.doctorId) {
        visitConditions.push('v.doctor_id = ?')
        params.push(query.doctorId)
      }
      if (query.categoryId) {
        visitConditions.push(
          'EXISTS(SELECT 1 FROM visit_categories vc WHERE vc.visit_id = v.id AND vc.category_id = ?)'
        )
        params.push(query.categoryId)
      }
      conditions.push(`EXISTS(SELECT 1 FROM visits v WHERE ${visitConditions.join(' AND ')})`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n FROM patients p ${where}`).get(...params)?.n
    )
    const rows = this.db
      .prepare(
        `SELECT p.*,
      (SELECT COUNT(*) FROM visits v WHERE v.patient_id = p.id) AS visit_count,
      latest.date AS latest_date, latest.doctor_id AS latest_doctor_id,
      COALESCE(d.name, latest.doctor_name) AS latest_doctor_name
      FROM patients p
      LEFT JOIN visits latest ON latest.id = (
        SELECT v.id FROM visits v WHERE v.patient_id = p.id
        ORDER BY v.date DESC, v.created_at DESC, v.id LIMIT 1
      )
      LEFT JOIN doctors d ON d.id = latest.doctor_id
      ${where} ORDER BY p.updated_at DESC, p.number DESC LIMIT ? OFFSET ?`
      )
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize)
    const items: PatientRow[] = rows.map((row) => ({
      ...this.patientFrom(row),
      visitCount: Number(row.visit_count),
      latestVisitDate: row.latest_date ? String(row.latest_date) : null,
      latestDoctorId: row.latest_doctor_id ? String(row.latest_doctor_id) : null,
      latestDoctorName: row.latest_doctor_name ? String(row.latest_doctor_name) : null
    }))
    return { items, total }
  }

  private savePatient(input: unknown): Patient {
    return this.transaction(() => this.writePatient(parsePatient(input)))
  }

  private writePatient(input: PatientInput): Patient {
    const { id: patientId, revision, ...details } = input
    if (
      details.phone &&
      this.db
        .prepare('SELECT id FROM patients WHERE name = ? AND phone = ? AND id != ?')
        .get(details.name, details.phone, patientId ?? '')
    )
      throw new ClinicalError('已存在同名且同电话的患者，请返回病例列表使用该患者的复诊入口')
    const key = patientId ?? randomUUID()
    const now = new Date().toISOString()
    if (patientId) {
      const updated = this.db
        .prepare(
          'UPDATE patients SET name = ?, phone = ?, details = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?'
        )
        .run(details.name, details.phone, JSON.stringify(details), now, key, revision)
      if (updated.changes !== 1) throw conflict()
    } else {
      if (revision !== 0) throw conflict()
      this.db
        .prepare(
          'INSERT INTO patients(id, name, phone, details, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?)'
        )
        .run(key, details.name, details.phone, JSON.stringify(details), now, now)
    }
    return this.patient(key)
  }

  private summaryFrom(row: Row): VisitSummary {
    const key = String(row.id)
    return {
      id: key,
      patientId: String(row.patient_id),
      doctorId: String(row.doctor_id),
      doctorName: String(row.current_doctor_name ?? row.doctor_name),
      date: String(row.date),
      kind: row.kind as VisitSummary['kind'],
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      categoryIds: this.db
        .prepare('SELECT category_id FROM visit_categories WHERE visit_id = ? ORDER BY rowid')
        .all(key)
        .map((tag) => String(tag.category_id))
    }
  }

  private visits(input: unknown) {
    const query = parseVisitQuery(input)
    this.patient(query.patientId)
    const total = Number(
      this.db.prepare('SELECT COUNT(*) AS n FROM visits WHERE patient_id = ?').get(query.patientId)
        ?.n
    )
    const rows = this.db
      .prepare(
        `SELECT v.id, v.patient_id, v.doctor_id, v.doctor_name, d.name AS current_doctor_name,
          v.date, v.kind, v.revision, v.created_at, v.updated_at
         FROM visits v LEFT JOIN doctors d ON d.id = v.doctor_id
         WHERE v.patient_id = ? ORDER BY v.date DESC, v.created_at DESC, v.id LIMIT ? OFFSET ?`
      )
      .all(query.patientId, query.pageSize, (query.page - 1) * query.pageSize)
    return { items: rows.map((row) => this.summaryFrom(row)), total }
  }

  private visit(key: string): Visit {
    const row = this.db
      .prepare(
        `SELECT v.*, p.number, d.name AS current_doctor_name FROM visits v
         JOIN patients p ON p.id = v.patient_id LEFT JOIN doctors d ON d.id = v.doctor_id WHERE v.id = ?`
      )
      .get(key)
    if (!row) throw new ClinicalError('就诊记录不存在')
    if (row.layout_version !== 1) throw new ClinicalError('此病历版式需要更新的软件版本')
    const patient = JSON.parse(String(row.patient_snapshot))
    return {
      ...this.summaryFrom(row),
      recordNumber: `P${String(row.number).padStart(7, '0')}`,
      patient: {
        ...patient,
        age: ageValue(patient.age),
        maritalStatus: maritalStatusValue(patient.maritalStatus)
      },
      body: JSON.parse(String(row.body)),
      layoutVersion: 1
    }
  }

  private caseVisits(input: unknown) {
    const query = parseVisitQuery(input)
    this.patient(query.patientId)
    const total = Number(
      this.db.prepare('SELECT COUNT(*) AS n FROM visits WHERE patient_id = ?').get(query.patientId)
        ?.n
    )
    const rows = this.db
      .prepare(
        'SELECT id FROM visits WHERE patient_id = ? ORDER BY created_at, rowid LIMIT ? OFFSET ?'
      )
      .all(query.patientId, query.pageSize, (query.page - 1) * query.pageSize)
    return { items: rows.map((row) => this.visit(String(row.id))), total }
  }

  private createVisit(input: unknown): Visit {
    return this.transaction(() => this.insertVisit(parseVisitCreate(input)))
  }

  private createCase(input: unknown): Visit {
    const value = parseCaseCreate(input)
    return this.transaction(() => {
      const { age: _age, ...details } = value.patient
      void _age
      const patientId =
        value.patientId ?? this.writePatient({ ...details, id: null, revision: 0 }).id
      const visit = this.insertVisit({
        patientId,
        doctorId: value.doctorId,
        date: value.date,
        kind: value.kind
      })
      return this.updateVisit({
        id: visit.id,
        revision: visit.revision,
        date: value.date,
        kind: value.kind,
        patient: value.patient,
        body: value.body,
        categoryIds: value.categoryIds
      })
    })
  }

  private insertVisit(value: VisitCreate): Visit {
    const {
      id: _id,
      recordNumber: _recordNumber,
      revision: _revision,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...patient
    } = this.patient(value.patientId)
    void [_id, _recordNumber, _revision, _createdAt, _updatedAt]
    if (patient.birthDate && patient.birthDate > value.date)
      throw new ClinicalError('就诊日期不能早于患者出生日期')
    const first = this.db
      .prepare(
        'SELECT doctor_id FROM visits WHERE patient_id = ? ORDER BY created_at, rowid LIMIT 1'
      )
      .get(value.patientId)
    if (first && first.doctor_id !== value.doctorId)
      throw new ClinicalError('复诊须沿用初诊医生，不能更换接诊医生')
    if (value.kind !== (first ? '复诊' : '初诊'))
      throw new ClinicalError(
        first ? '已有初诊病例，后续只能新增复诊病例' : '首次就诊须建立初诊病例'
      )
    const doctor = this.db.prepare('SELECT * FROM doctors WHERE id = ?').get(value.doctorId)
    if (!doctor || (!first && !doctor.active)) throw new ClinicalError('请选择启用中的医生')
    const key = randomUUID(),
      now = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO visits(id, patient_id, doctor_id, doctor_name, date, kind, patient_snapshot, body, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        key,
        value.patientId,
        value.doctorId,
        String(doctor.name),
        value.date,
        value.kind,
        JSON.stringify({ ...patient, age: ageAt(patient.birthDate, value.date) }),
        JSON.stringify(EMPTY_RECORD),
        now,
        now
      )
    this.db.prepare('UPDATE patients SET updated_at = ? WHERE id = ?').run(now, value.patientId)
    return this.visit(key)
  }

  private saveVisit(input: unknown): Visit {
    return this.transaction(() => this.updateVisit(parseVisitSave(input)))
  }

  private updateVisit(value: VisitSave): Visit {
    const original = this.visit(value.id)
    if (original.revision !== value.revision) throw conflict()
    if (value.kind !== original.kind) throw new ClinicalError('已建立的初诊或复诊类型不能更改')
    if (value.patient.birthDate && value.patient.birthDate > value.date)
      throw new ClinicalError('就诊日期不能早于出生日期')
    // 只同步本次实际修改的患者字段，旧病例的未修改快照不能覆盖主索引的新资料。
    const detailKeys = Object.keys(EMPTY_PATIENT) as (keyof typeof EMPTY_PATIENT)[]
    const changedFields = detailKeys.filter((key) => value.patient[key] !== original.patient[key])
    if (changedFields.length) {
      const currentPatient = this.patient(original.patientId)
      const details = { ...EMPTY_PATIENT }
      for (const key of detailKeys) Object.assign(details, { [key]: currentPatient[key] })
      for (const key of changedFields) Object.assign(details, { [key]: value.patient[key] })
      this.writePatient({ ...details, id: currentPatient.id, revision: currentPatient.revision })
    }
    for (const categoryId of value.categoryIds) {
      const tag = this.db.prepare('SELECT active FROM categories WHERE id = ?').get(categoryId)
      if (!tag || (!tag.active && !original.categoryIds.includes(categoryId)))
        throw new ClinicalError('所选分类不存在或已停用')
    }
    const now = new Date().toISOString()
    this.db
      .prepare(
        'UPDATE visits SET date = ?, kind = ?, patient_snapshot = ?, body = ?, revision = revision + 1, updated_at = ? WHERE id = ?'
      )
      .run(
        value.date,
        value.kind,
        JSON.stringify(value.patient),
        JSON.stringify(value.body),
        now,
        value.id
      )
    this.db.prepare('DELETE FROM visit_categories WHERE visit_id = ?').run(value.id)
    const insert = this.db.prepare(
      'INSERT INTO visit_categories(visit_id, category_id) VALUES(?, ?)'
    )
    for (const categoryId of value.categoryIds) insert.run(value.id, categoryId)
    this.db.prepare('UPDATE patients SET updated_at = ? WHERE id = ?').run(now, original.patientId)
    return this.visit(value.id)
  }
}
