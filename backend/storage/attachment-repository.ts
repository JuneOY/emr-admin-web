import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, rm, lstat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import {
  attachmentName,
  MAX_ATTACHMENT_BYTES,
  MAX_IMPORT_FILES,
  MAX_VISIT_ATTACHMENTS,
  parseAttachmentImport,
  type Attachment,
  type AttachmentContent,
  type AttachmentImportResult,
  type AttachmentMedia
} from '../../shared/attachments'
import { ClinicalError, id } from '../../shared/clinical-validation'

const checksum = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

export function detectAttachment(bytes: Buffer, name: string): AttachmentMedia {
  const extension = extname(name).toLowerCase()
  if (extension === '.pdf' && bytes.subarray(0, 5).toString() === '%PDF-') return 'application/pdf'
  if (
    ['.jpg', '.jpeg'].includes(extension) &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return 'image/jpeg'
  if (extension === '.png' && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))
    return 'image/png'
  if (
    extension === '.webp' &&
    bytes.subarray(0, 4).toString() === 'RIFF' &&
    bytes.subarray(8, 12).toString() === 'WEBP'
  )
    return 'image/webp'
  throw new ClinicalError('只支持内容与扩展名一致的 JPG、PNG、WebP 图片和 PDF 文件')
}

// 源文件在读取中增长时也不能突破限制；每次仅持有一个文件的内容。
async function readLimited(path: string): Promise<Buffer> {
  if ((await lstat(path)).isSymbolicLink()) throw new ClinicalError('不能导入或读取链接文件')
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_ATTACHMENT_BYTES)
      throw new ClinicalError('附件须为非空文件，且单个不超过 20 MB')
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of handle.createReadStream({ autoClose: false })) {
      size += chunk.length
      if (size > MAX_ATTACHMENT_BYTES) throw new ClinicalError('单个附件不能超过 20 MB')
      chunks.push(chunk as Buffer)
    }
    if (!size) throw new ClinicalError('不能导入空文件')
    return Buffer.concat(chunks)
  } finally {
    await handle.close()
  }
}

export class AttachmentRepository {
  private directory: string
  constructor(
    private db: DatabaseSync,
    dataDirectory: string
  ) {
    this.directory = join(dataDirectory, 'attachments')
  }
  private path(key: string): string {
    return join(this.directory, id(key))
  }
  private async prepareDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    if ((await lstat(this.directory)).isSymbolicLink())
      throw new ClinicalError('附件目录不能是链接目录')
  }
  private ensureVisit(key: string): void {
    if (!this.db.prepare('SELECT id FROM visits WHERE id = ?').get(key))
      throw new ClinicalError('就诊记录不存在')
  }
  private from(row: Record<string, unknown>): Attachment {
    return {
      id: String(row.id),
      visitId: String(row.visit_id),
      name: String(row.name),
      kind: row.kind as Attachment['kind'],
      mediaType: row.media_type as AttachmentMedia,
      size: Number(row.size),
      createdAt: String(row.created_at)
    }
  }
  list(input: unknown): Attachment[] {
    const key = id(input)
    this.ensureVisit(key)
    return this.db
      .prepare(
        'SELECT * FROM attachments WHERE visit_id = ? AND removed = 0 ORDER BY created_at, rowid'
      )
      .all(key)
      .map((row) => this.from(row))
  }
  async import(input: unknown, paths: string[]): Promise<AttachmentImportResult> {
    const value = parseAttachmentImport(input)
    this.ensureVisit(value.visitId)
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.length > MAX_IMPORT_FILES ||
      paths.some((path) => typeof path !== 'string')
    )
      throw new ClinicalError('每次请选择 1 至 20 个附件')
    await this.prepareDirectory()
    const originalCount = this.list(value.visitId).length
    const created: string[] = []
    const rows: (Attachment & { checksum: string })[] = []
    const hashes = new Set<string>()
    let skipped = 0
    try {
      for (const source of paths) {
        const name = attachmentName(basename(source))
        const bytes = await readLimited(source)
        const mediaType = detectAttachment(bytes, name)
        const hash = checksum(bytes)
        if (
          hashes.has(hash) ||
          this.db
            .prepare(
              'SELECT id FROM attachments WHERE visit_id = ? AND checksum = ? AND removed = 0'
            )
            .get(value.visitId, hash)
        ) {
          skipped++
          continue
        }
        if (originalCount + rows.length >= MAX_VISIT_ATTACHMENTS)
          throw new ClinicalError('每次就诊最多保存 200 个附件')
        const key = randomUUID()
        const handle = await open(this.path(key), 'wx')
        created.push(key)
        try {
          await handle.writeFile(bytes)
          await handle.sync()
        } finally {
          await handle.close()
        }
        rows.push({
          id: key,
          visitId: value.visitId,
          name,
          kind: value.kind,
          mediaType,
          size: bytes.length,
          createdAt: new Date().toISOString(),
          checksum: hash
        })
        hashes.add(hash)
      }
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const insert = this.db.prepare(
          'INSERT INTO attachments(id, visit_id, name, kind, media_type, size, checksum, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)'
        )
        for (const row of rows)
          insert.run(
            row.id,
            row.visitId,
            row.name,
            row.kind,
            row.mediaType,
            row.size,
            row.checksum,
            row.createdAt
          )
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      return {
        added: rows.map(({ checksum: _hash, ...row }) => {
          void _hash
          return row
        }),
        skipped
      }
    } catch (error) {
      await Promise.allSettled(created.map((key) => rm(this.path(key), { force: true })))
      throw error
    }
  }
  async read(input: unknown): Promise<AttachmentContent> {
    const key = id(input)
    const row = this.db.prepare('SELECT * FROM attachments WHERE id = ? AND removed = 0').get(key)
    if (!row) throw new ClinicalError('附件不存在或已移除')
    await this.prepareDirectory()
    let bytes: Buffer
    try {
      bytes = await readLimited(this.path(key))
    } catch {
      throw new ClinicalError('附件原件无法读取，请检查本地数据目录')
    }
    if (bytes.length !== Number(row.size) || checksum(bytes) !== row.checksum)
      throw new ClinicalError('附件原件校验不通过，请使用完整备份恢复文件')
    return { attachment: this.from(row), bytes }
  }
  async remove(input: unknown): Promise<void> {
    const key = id(input)
    if (
      this.db.prepare('UPDATE attachments SET removed = 1 WHERE id = ? AND removed = 0').run(key)
        .changes !== 1
    )
      throw new ClinicalError('附件不存在或已移除')
    await this.cleanup()
  }
  async cleanup(): Promise<void> {
    await this.prepareDirectory()
    // 元数据先标记移除，中断或文件占用时下次启动继续清理，不重新展示已移除附件。
    for (const row of this.db.prepare('SELECT id FROM attachments WHERE removed = 1').all()) {
      const key = id(row.id)
      try {
        await rm(this.path(key), { force: true })
        this.db.prepare('DELETE FROM attachments WHERE id = ? AND removed = 1').run(key)
      } catch {
        /* 文件占用时保留清理标记。 */
      }
    }
  }
}
