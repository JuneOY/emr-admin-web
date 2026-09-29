import { randomUUID } from 'node:crypto'
import { writeFile, rename, rm, realpath } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

export async function writeExport(
  path: string,
  bytes: Uint8Array,
  dataDirectory: string
): Promise<void> {
  const target = resolve(path).toLowerCase(),
    protectedPath = resolve(dataDirectory).toLowerCase()
  const [parent, protectedReal] = await Promise.all([
    realpath(dirname(path)),
    realpath(dataDirectory)
  ])
    .then((paths) => paths.map((value) => value.toLowerCase()))
    .catch(() => {
      throw new Error('无法读取导出位置，请检查目标文件夹')
    })
  if (
    target === protectedPath ||
    target.startsWith(protectedPath + sep) ||
    parent === protectedReal ||
    parent.startsWith(protectedReal + sep)
  )
    throw new Error('请选择数据目录以外的位置导出文件')
  const temporary = join(dirname(path), `.emr-export-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, path)
  } catch {
    throw new Error('文件未导出，请检查目标文件是否被占用以及磁盘空间')
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
