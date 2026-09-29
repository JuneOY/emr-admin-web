import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DEFAULT_SETTINGS, parseSettings, type LocalSettings } from '../../shared/desktop'

export class SettingsRepository {
  readonly filePath: string
  private pending: Promise<unknown> = Promise.resolve()

  constructor(private readonly directory: string) {
    this.filePath = join(directory, 'settings.json')
  }

  async read(): Promise<LocalSettings> {
    await this.pending.catch(() => undefined)
    return this.readDocument()
  }

  private async readDocument(): Promise<LocalSettings> {
    try {
      const document = JSON.parse(await readFile(this.filePath, 'utf8'))
      if (!document || document.version !== 1) throw new Error('设置版本不受支持，请检查软件版本')
      return parseSettings(document.settings)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS }
      if (error instanceof SyntaxError) throw new Error('本地设置文件损坏，暂时无法读取')
      // 文件损坏时保持原文件，避免用默认值静默覆盖。
      throw error
    }
  }

  async save(input: unknown): Promise<LocalSettings> {
    const settings = parseSettings(input)
    const operation = this.pending
      .catch(() => undefined)
      .then(async () => {
        // 拒绝覆盖损坏或较新版本的设置，错误修复后队列仍可继续。
        await this.readDocument()
        await mkdir(this.directory, { recursive: true })
        const temporaryPath = this.filePath + '.' + randomUUID() + '.tmp'
        try {
          await writeFile(temporaryPath, JSON.stringify({ version: 1, settings }, null, 2), {
            encoding: 'utf8',
            flag: 'wx',
            mode: 0o600
          })
          await rename(temporaryPath, this.filePath)
          return settings
        } finally {
          await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'ENOENT') throw error
          })
        }
      })
    this.pending = operation
    return operation
  }
}
