import { randomUUID } from 'node:crypto'
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export function dataPath(input: unknown): string {
  if (
    typeof input !== 'string' ||
    !isAbsolute(input) ||
    Array.from(input).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('请选择有效的本地绝对路径')
  const path = resolve(input)
  if (path === parse(path).root || path.startsWith('\\\\'))
    throw new Error('请选择本机磁盘中的独立文件夹')
  return path
}

export async function plainDirectory(path: string): Promise<string> {
  const stat = await lstat(path)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('不能使用文件或链接目录')
  return realpath(path)
}

export function containsPath(parent: string, child: string): boolean {
  const difference = relative(parent.toLowerCase(), child.toLowerCase())
  return (
    !difference ||
    (!difference.startsWith('..' + sep) && difference !== '..' && !isAbsolute(difference))
  )
}

export async function assertSeparateDirectory(
  target: string,
  protectedDirectories: string[]
): Promise<void> {
  const actual = await plainDirectory(dataPath(target))
  for (const protectedPath of protectedDirectories) {
    const existing = await realpath(protectedPath)
    if (containsPath(existing, actual) || containsPath(actual, existing))
      throw new Error('请选择与当前资料库、应用配置及软件目录相互独立的文件夹')
  }
}

export async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    const file = await open(temporary, 'wx')
    try {
      await file.writeFile(JSON.stringify(value, null, 2), 'utf8')
      await file.sync()
    } finally {
      await file.close()
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

// 只发布到用户选择的空目录；失败时仅清理本操作创建的临时目录。
export class StagedDataDirectory {
  private published = false
  private constructor(
    readonly target: string,
    readonly staging: string
  ) {}

  static async create(
    target: string,
    protectedDirectories: string[]
  ): Promise<StagedDataDirectory> {
    target = await plainDirectory(dataPath(target))
    await assertSeparateDirectory(target, protectedDirectories)
    if ((await readdir(target)).length) throw new Error('目标文件夹不是空的，请选择一个空文件夹')
    const staging = await mkdtemp(join(dirname(target), '.emr-data-'))
    return new StagedDataDirectory(target, staging)
  }

  async publish(): Promise<void> {
    if ((await plainDirectory(this.target)) !== this.target)
      throw new Error('目标目录位置发生变化，已停止操作')
    if ((await readdir(this.target)).length)
      throw new Error('目标目录已有文件，已停止操作以保留原文件')
    await rmdir(this.target)
    try {
      await rename(this.staging, this.target)
      this.published = true
    } catch (error) {
      await mkdir(this.target, { recursive: true }).catch(() => {})
      throw error
    }
  }

  async cleanup(): Promise<void> {
    if (this.published) return
    if (
      dirname(this.staging) !== dirname(this.target) ||
      !basename(this.staging).startsWith('.emr-data-')
    )
      throw new Error('临时目录范围不正确')
    await rm(this.staging, { recursive: true, force: true })
  }
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}
