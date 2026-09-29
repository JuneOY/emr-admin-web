import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function isTrustedPage(url: string, entryFile: string, developmentUrl?: string): boolean {
  try {
    const candidate = new URL(url)
    if (candidate.username || candidate.password) return false
    if (developmentUrl) {
      const allowed = new URL(developmentUrl)
      return (
        ['127.0.0.1', 'localhost'].includes(allowed.hostname) &&
        allowed.protocol === 'http:' &&
        candidate.origin === allowed.origin &&
        candidate.pathname === allowed.pathname
      )
    }
    return (
      candidate.protocol === 'file:' && resolve(fileURLToPath(candidate)) === resolve(entryFile)
    )
  } catch {
    return false
  }
}
