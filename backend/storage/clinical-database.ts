import { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

export function openClinicalDatabase(directory: string): DatabaseSync {
  mkdirSync(directory, { recursive: true })
  const db = new DatabaseSync(join(directory, 'clinical.sqlite'))
  try {
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version)
    if (version > 2) throw new Error('病历数据库版本较新，请使用对应版本的软件')
    db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;'
    )
    if (version === 0) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE patients (
          number INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL, phone TEXT NOT NULL, details TEXT NOT NULL,
          revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX patient_name ON patients(name);
        CREATE INDEX patient_phone ON patients(phone);
        CREATE INDEX patient_updated ON patients(updated_at DESC);
        CREATE TABLE doctors (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL, revision INTEGER NOT NULL);
        CREATE TABLE visits (
          id TEXT PRIMARY KEY, patient_id TEXT NOT NULL REFERENCES patients(id),
          doctor_id TEXT NOT NULL REFERENCES doctors(id), doctor_name TEXT NOT NULL,
          date TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('初诊','复诊')),
          patient_snapshot TEXT NOT NULL, body TEXT NOT NULL,
          layout_version INTEGER NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE INDEX visit_patient_date ON visits(patient_id, date DESC, created_at DESC);
        CREATE INDEX visit_doctor_patient ON visits(doctor_id, patient_id);
        CREATE TABLE visit_categories (
          visit_id TEXT NOT NULL REFERENCES visits(id), category_id TEXT NOT NULL REFERENCES categories(id),
          PRIMARY KEY (visit_id, category_id)
        );
        CREATE INDEX visit_category ON visit_categories(category_id, visit_id);
        PRAGMA user_version = 1;
        COMMIT;`)
    }
    if (version < 2) {
      db.exec(`BEGIN IMMEDIATE;
        CREATE TABLE prescriptions (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
          items TEXT NOT NULL, usage TEXT NOT NULL, notes TEXT NOT NULL,
          active INTEGER NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX prescription_name_kind ON prescriptions(name, kind);
        CREATE INDEX prescription_updated ON prescriptions(active, updated_at DESC);
        CREATE TABLE attachments (
          id TEXT PRIMARY KEY, visit_id TEXT NOT NULL REFERENCES visits(id),
          name TEXT NOT NULL, kind TEXT NOT NULL, media_type TEXT NOT NULL,
          size INTEGER NOT NULL, checksum TEXT NOT NULL, created_at TEXT NOT NULL,
          removed INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX attachment_checksum ON attachments(visit_id, checksum) WHERE removed = 0;
        CREATE INDEX attachment_visit ON attachments(visit_id, removed, created_at);
        PRAGMA user_version = 2;
        COMMIT;`)
    }
    return db
  } catch (error) {
    db.close()
    throw error
  }
}
