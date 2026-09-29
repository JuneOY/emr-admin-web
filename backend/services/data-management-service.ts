import { randomUUID } from 'node:crypto'
import { mkdir, rm, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { ApplicationService } from './application-service'
import { ClinicalClient } from './clinical-client'
import { DataLocationRepository } from '../storage/data-location'
import { StagedDataDirectory, plainDirectory } from '../storage/data-directories'

export class DataManagementService {
  busy = false
  private constructor(
    public application: ApplicationService,
    public clinical: ClinicalClient,
    private workerFile: string,
    private location: DataLocationRepository,
    private protectedDirectories: string[]
  ) {}

  static async open(
    directory: string,
    profile: string,
    workerFile: string,
    version: string,
    protectedDirectories: string[] = []
  ): Promise<DataManagementService> {
    const application = new ApplicationService(directory, version)
    await application.initialize()
    const clinical = new ClinicalClient(workerFile, directory)
    try {
      await clinical.ready
      const location = new DataLocationRepository(profile)
      await location.save(directory)
      return new DataManagementService(application, clinical, workerFile, location, [
        profile,
        ...protectedDirectories
      ])
    } catch (error) {
      await clinical.close()
      throw error
    }
  }

  private protections(extra: string[] = []): string[] {
    return [this.application.info.dataDirectory, ...this.protectedDirectories, ...extra]
  }

  private async activate(directory: string): Promise<void> {
    const application = new ApplicationService(directory, this.application.info.version)
    await application.initialize()
    const clinical = new ClinicalClient(this.workerFile, directory)
    try {
      await clinical.ready
      // 新库已可读且指针成功落盘后才切换；此前任何失败均继续使用旧库。
      await this.location.save(directory)
    } catch (error) {
      await clinical.close()
      throw new Error('切换目录失败，仍使用原资料库；请检查应用配置目录是否可写', { cause: error })
    }
    const previous = this.clinical
    this.application = application
    this.clinical = clinical
    await previous.close()
  }

  async migrate(target: string): Promise<void> {
    const stage = await StagedDataDirectory.create(target, this.protections())
    try {
      await this.clinical.internal('createSnapshot', stage.staging)
      await rm(join(stage.staging, 'emr-backup.json'))
      await stage.publish()
      await this.activate(stage.target)
    } finally {
      await stage.cleanup()
    }
  }

  async backup(parent: string): Promise<string> {
    await plainDirectory(parent)
    const now = new Date()
    const date = `${now.getFullYear()}${[now.getMonth() + 1, now.getDate()].map((value) => String(value).padStart(2, '0')).join('')}-${[now.getHours(), now.getMinutes(), now.getSeconds()].map((value) => String(value).padStart(2, '0')).join('')}`
    const target = join(parent, `门诊病历备份-${date}-${randomUUID().slice(0, 6)}`)
    await mkdir(target)
    let completed = false
    try {
      const stage = await StagedDataDirectory.create(target, this.protections())
      try {
        await this.clinical.internal('createSnapshot', stage.staging)
        await stage.publish()
        completed = true
        return stage.target
      } finally {
        await stage.cleanup()
      }
    } finally {
      if (!completed) await rmdir(target).catch(() => {})
    }
  }

  async verifyBackup(source: string): Promise<void> {
    await this.clinical.internal('verifySnapshot', source)
  }

  async restore(source: string, target: string): Promise<void> {
    const stage = await StagedDataDirectory.create(target, this.protections([source]))
    try {
      await this.clinical.internal('restoreSnapshot', { source, target: stage.staging })
      await stage.publish()
      await this.activate(stage.target)
    } finally {
      await stage.cleanup()
    }
  }
}
