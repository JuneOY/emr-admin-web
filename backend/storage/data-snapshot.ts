import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, open, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'
import { ClinicalError } from '../../shared/clinical-validation'
import { SettingsRepository } from './settings-repository'
import { plainDirectory, writeJsonAtomically } from './data-directories'

const MANIFEST = 'emr-backup.json'
const validName =
  /^(clinical\.sqlite|settings\.json|attachments\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/
interface SnapshotFile {
  name: string
  size: number
  sha256: string
}
interface SnapshotManifest {
  format: 'emr-backup'
  version: 1
  databaseVersion: number
  createdAt: string
  files: SnapshotFile[]
}

async function digest(path: string): Promise<{ size: number; sha256: string }> {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ClinicalError('备份不能包含链接或特殊文件')
  const file = await open(path, 'r')
  try {
    const hash = createHash('sha256')
    let size = 0
    for await (const chunk of file.createReadStream({ autoClose: false })) {
      size += chunk.length
      hash.update(chunk)
    }
    return { size, sha256: hash.digest('hex') }
  } finally {
    await file.close()
  }
}

async function copy(source: string, target: string): Promise<{ size: number; sha256: string }> {
  const stat = await lstat(source)
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new ClinicalError('资料中包含链接或特殊文件，已停止复制')
  await copyFile(source, target, constants.COPYFILE_EXCL)
  const file = await open(target, 'r+')
  try {
    await file.sync()
  } finally {
    await file.close()
  }
  return digest(target)
}

async function readManifest(directory: string): Promise<SnapshotManifest> {
  await plainDirectory(directory)
  const path = join(directory, MANIFEST)
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024)
    throw new ClinicalError('备份清单不正确或过大')
  let value: SnapshotManifest
  try {
    value = JSON.parse(await readFile(path, 'utf8'))
  } catch {
    throw new ClinicalError('备份清单损坏，请选择完整的备份文件夹')
  }
  if (
    !value ||
    value.format !== 'emr-backup' ||
    value.version !== 1 ||
    value.databaseVersion !== 2 ||
    !Array.isArray(value.files)
  )
    throw new ClinicalError('备份格式或版本不受支持，请选择本软件生成的备份')
  const names = new Set<string>()
  for (const item of value.files) {
    if (
      !item ||
      typeof item.name !== 'string' ||
      !validName.test(item.name) ||
      names.has(item.name) ||
      !Number.isSafeInteger(item.size) ||
      item.size < 0 ||
      typeof item.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(item.sha256)
    )
      throw new ClinicalError('备份清单存在无效路径、重复文件或校验信息')
    names.add(item.name)
  }
  if (!names.has('clinical.sqlite') || !names.has('settings.json'))
    throw new ClinicalError('备份缺少数据库或本地设置')
  await plainDirectory(join(directory, 'attachments'))
  return value
}

async function validateDatabase(directory: string, manifest: SnapshotManifest): Promise<void> {
  const db = new DatabaseSync(join(directory, 'clinical.sqlite'), { readOnly: true })
  try {
    if (
      Number(db.prepare('PRAGMA user_version').get()?.user_version) !== manifest.databaseVersion ||
      db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').get()
    )
      throw new ClinicalError('备份数据库完整性检查未通过')
    for (const table of [
      'patients',
      'doctors',
      'categories',
      'visits',
      'prescriptions',
      'attachments'
    ])
      db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get()
    const files = new Map(manifest.files.map((file) => [file.name, file]))
    for (const row of db
      .prepare('SELECT id, size, checksum FROM attachments WHERE removed = 0')
      .iterate()) {
      const file = files.get(`attachments/${row.id}`)
      if (!file || file.sha256 !== row.checksum || file.size !== Number(row.size))
        throw new ClinicalError('备份中的附件与病例记录不一致')
    }
    await new SettingsRepository(directory).read()
  } finally {
    db.close()
  }
}

export async function verifySnapshot(directory: string): Promise<SnapshotManifest> {
  const manifest = await readManifest(directory)
  for (const item of manifest.files) {
    const current = await digest(join(directory, item.name))
    if (current.sha256 !== item.sha256 || current.size !== item.size)
      throw new ClinicalError('备份文件缺失或内容发生变化，未启用此备份')
  }
  await validateDatabase(directory, manifest)
  return manifest
}

// 调用方使用 Worker 串行队列暂停写入，数据库和附件来自同一个稳定时间点。
export async function createSnapshot(
  db: DatabaseSync,
  source: string,
  target: string
): Promise<void> {
  if ((await readdir(target)).length) throw new ClinicalError('快照目标必须为空目录')
  await mkdir(join(target, 'attachments'))
  const databaseFile = join(target, 'clinical.sqlite')
  await backup(db, databaseFile)
  const settings = await new SettingsRepository(source).read()
  await writeJsonAtomically(join(target, 'settings.json'), { version: 1, settings })
  const files: SnapshotFile[] = []
  for (const name of ['clinical.sqlite', 'settings.json'])
    files.push({ name, ...(await digest(join(target, name))) })
  await plainDirectory(join(source, 'attachments'))
  for (const row of db
    .prepare('SELECT id, size, checksum FROM attachments WHERE removed = 0')
    .iterate()) {
    const name = `attachments/${row.id}`
    if (!validName.test(name)) throw new ClinicalError('附件编号不正确，无法生成完整备份')
    const copied = await copy(join(source, name), join(target, name))
    if (copied.sha256 !== row.checksum || copied.size !== Number(row.size))
      throw new ClinicalError('附件原件不完整，已停止备份并保留原资料库')
    files.push({ name, ...copied })
  }
  const manifest: SnapshotManifest = {
    format: 'emr-backup',
    version: 1,
    databaseVersion: 2,
    createdAt: new Date().toISOString(),
    files
  }
  await validateDatabase(target, manifest)
  await writeJsonAtomically(join(target, MANIFEST), manifest)
}

export async function restoreSnapshot(source: string, target: string): Promise<void> {
  const manifest = await readManifest(source)
  if ((await readdir(target)).length) throw new ClinicalError('恢复目标必须为空目录')
  await mkdir(join(target, 'attachments'))
  for (const item of manifest.files) {
    const copied = await copy(join(source, item.name), join(target, item.name))
    if (copied.sha256 !== item.sha256 || copied.size !== item.size)
      throw new ClinicalError('备份文件缺失或校验失败，未更改现有病例库')
  }
  await validateDatabase(target, manifest)
  // 启用的资料库不保留旧备份清单，避免之后修改数据后被误认作可恢复备份。
}
