import { lstat, mkdir, open, readFile, readdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { dataPath, fileExists, plainDirectory, writeJsonAtomically } from './data-directories'

export const LOCATION_FILE = 'data-location.json'
export const INSTALLER_LOCATION_FILE = 'initial-data-location.ini'

export class DataLocationRepository {
  constructor(readonly profileDirectory: string) {}

  async resolve(): Promise<string> {
    const pointer = join(this.profileDirectory, LOCATION_FILE)
    if (await fileExists(pointer)) {
      if ((await lstat(pointer)).size > 16 * 1024) throw new Error('数据目录配置不正确')
      let location: { version: number; directory: unknown }
      try {
        location = JSON.parse(await readFile(pointer, 'utf8'))
      } catch {
        throw new Error('数据目录配置损坏，请保留配置文件和原病例数据')
      }
      if (!location || location.version !== 1) throw new Error('数据目录配置版本不受支持')
      const directory = dataPath(location.directory)
      if (!(await fileExists(join(directory, 'clinical.sqlite'))))
        throw new Error('原病例数据库无法找到，请检查存放磁盘或目录；未创建替代空库')
      await plainDirectory(directory)
      return directory
    }
    // 旧版本已有病例时沿用原位置，安装预设不能让旧病例突然消失。
    if (await fileExists(join(this.profileDirectory, 'clinical.sqlite')))
      return this.profileDirectory
    const preset = join(this.profileDirectory, INSTALLER_LOCATION_FILE)
    if (!(await fileExists(preset))) return this.profileDirectory
    if ((await lstat(preset)).size > 16 * 1024) throw new Error('安装时的数据目录配置不正确')
    const bytes = await readFile(preset)
    const text = bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))
      ? bytes.subarray(2).toString('utf16le')
      : bytes.toString('utf8').replace(/^\uFEFF/, '')
    const match = /^Directory=(.+)$/m.exec(text.replace(/\r/g, ''))
    if (!match || !/^\[Storage\]$/m.test(text.replace(/\r/g, '')))
      throw new Error('安装时的数据目录配置不正确')
    const directory = dataPath(match[1])
    await mkdir(directory, { recursive: true })
    await plainDirectory(directory)
    if (
      (await readdir(directory)).length &&
      !(await fileExists(join(directory, 'clinical.sqlite')))
    )
      throw new Error('安装时选择的目录中已有其他文件，无法初始化病例库')
    const probe = join(directory, `.emr-write-${randomUUID()}`)
    try {
      const file = await open(probe, 'wx')
      await file.close()
    } finally {
      await rm(probe, { force: true })
    }
    return directory
  }

  async save(directory: string): Promise<void> {
    await plainDirectory(dataPath(directory))
    if (!(await fileExists(join(directory, 'clinical.sqlite'))))
      throw new Error('目标病例库尚未准备完成')
    await writeJsonAtomically(join(this.profileDirectory, LOCATION_FILE), { version: 1, directory })
  }
}
