import { randomUUID } from 'node:crypto'
import { access, writeFile, rename, rm, realpath } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'

/**
 * 批量导出前先整体校验目标文件夹，避免写到一半才因目录位于资料库内而失败。
 * 单个文件仍由 writeExport 校验其父目录。
 */
export async function assertOutsideDataDirectory(
  path: string,
  dataDirectory: string
): Promise<void> {
  const target = resolve(path).toLowerCase(),
    protectedPath = resolve(dataDirectory).toLowerCase()
  let real: string, protectedReal: string
  try {
    real = (await realpath(path)).toLowerCase()
  } catch {
    throw new Error('无法读取导出位置，请检查目标文件夹')
  }
  try {
    protectedReal = (await realpath(dataDirectory)).toLowerCase()
  } catch {
    throw new Error('无法读取资料库目录，请稍后重新导出')
  }
  if (
    real === protectedReal ||
    real.startsWith(protectedReal + sep) ||
    target === protectedPath ||
    target.startsWith(protectedPath + sep)
  )
    throw new Error('请选择数据目录以外的位置导出文件')
}

/** 批量导出不能覆盖用户已有文件，重名时依次追加 (2)、(3)。 */
export async function uniqueExportPath(
  directory: string,
  base: string,
  extension = 'pdf'
): Promise<string> {
  const exists = async (path: string) => {
    try {
      await access(path)
      return true
    } catch {
      return false
    }
  }
  let candidate = join(directory, `${base}.${extension}`)
  for (let index = 2; await exists(candidate); index += 1) {
    candidate = join(directory, `${base} (${index}).${extension}`)
  }
  return candidate
}

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
