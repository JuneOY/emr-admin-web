import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { ClinicalError, id } from '../../shared/clinical-validation'
import {
  parsePrescription,
  parsePrescriptionQuery,
  type Prescription
} from '../../shared/prescriptions'

export class PrescriptionRepository {
  constructor(private db: DatabaseSync) {}
  private from(row: Record<string, unknown>): Prescription {
    return {
      id: String(row.id),
      name: String(row.name),
      kind: row.kind as Prescription['kind'],
      items: JSON.parse(String(row.items)),
      usage: String(row.usage),
      notes: String(row.notes),
      active: Boolean(row.active),
      revision: Number(row.revision),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }
  get(input: unknown): Prescription {
    const row = this.db.prepare('SELECT * FROM prescriptions WHERE id = ?').get(id(input))
    if (!row) throw new ClinicalError('处方不存在')
    return this.from(row)
  }
  list(input: unknown) {
    const query = parsePrescriptionQuery(input)
    const conditions: string[] = [],
      params: SQLInputValue[] = []
    if (query.keyword) {
      conditions.push("name LIKE ? ESCAPE '\\'")
      params.push(`%${query.keyword.replace(/[\\%_]/g, '\\$&')}%`)
    }
    if (query.kind) {
      conditions.push('kind = ?')
      params.push(query.kind)
    }
    if (query.activeOnly) conditions.push('active = 1')
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const total = Number(
      this.db.prepare(`SELECT COUNT(*) AS n FROM prescriptions ${where}`).get(...params)?.n
    )
    const items = this.db
      .prepare(`SELECT * FROM prescriptions ${where} ORDER BY updated_at DESC, id LIMIT ? OFFSET ?`)
      .all(...params, query.pageSize, (query.page - 1) * query.pageSize)
      .map((row) => this.from(row))
    return { items, total }
  }
  save(input: unknown): Prescription {
    const value = parsePrescription(input)
    const key = value.id ?? randomUUID(),
      now = new Date().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (
        this.db
          .prepare('SELECT id FROM prescriptions WHERE name = ? AND kind = ? AND id != ?')
          .get(value.name, value.kind, key)
      )
        throw new ClinicalError('同类型下已有此处方名称，请使用其他名称')
      const fields = [
        value.name,
        value.kind,
        JSON.stringify(value.items),
        value.usage,
        value.notes,
        Number(value.active)
      ]
      if (value.id) {
        const result = this.db
          .prepare(
            'UPDATE prescriptions SET name = ?, kind = ?, items = ?, usage = ?, notes = ?, active = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?'
          )
          .run(...fields, now, key, value.revision)
        if (result.changes !== 1) throw new ClinicalError('处方已被更新，请保留输入后重新打开处方')
      } else {
        if (value.revision !== 0) throw new ClinicalError('新处方版本不正确')
        this.db
          .prepare(
            'INSERT INTO prescriptions(name, kind, items, usage, notes, active, id, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)'
          )
          .run(...fields, key, now, now)
      }
      const result = this.get(key)
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
