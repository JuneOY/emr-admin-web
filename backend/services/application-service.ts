import { mkdir } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { ApplicationInfo } from '../../shared/desktop'
import { SettingsRepository } from '../storage/settings-repository'

export class ApplicationService {
  readonly settings: SettingsRepository
  readonly info: ApplicationInfo

  constructor(dataDirectory: string, version: string) {
    if (!isAbsolute(dataDirectory)) throw new Error('应用数据目录必须使用绝对路径')
    const directory = resolve(dataDirectory)
    this.settings = new SettingsRepository(directory)
    this.info = {
      name: '门诊病历',
      version,
      dataDirectory: directory,
      attachmentsDirectory: join(directory, 'attachments')
    }
  }

  async initialize(): Promise<void> {
    await mkdir(this.info.attachmentsDirectory, { recursive: true })
  }
}
