import { Worker } from 'node:worker_threads'
import type { ClinicalMethod, ClinicalOperations } from '../../shared/clinical'
import type { ClinicalInternalOperations } from './clinical-internal'

export class ClinicalClient {
  private worker: Worker
  private sequence = 0
  private failure: Error | null = null
  private closing = false
  private exited: Promise<void>
  private pending = new Map<
    number,
    { resolve: (value: any) => void; reject: (error: Error) => void }
  >()
  readonly ready: Promise<void>

  constructor(workerFile: string, directory: string) {
    this.worker = new Worker(workerFile, { workerData: { directory } })
    this.exited = new Promise((resolve) => this.worker.once('exit', () => resolve()))
    this.ready = new Promise((resolve, reject) => this.pending.set(0, { resolve, reject }))
    this.worker.on('message', (message) => {
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      if (message.success) request.resolve(message.data)
      else request.reject(new Error(message.message))
    })
    const fail = () => {
      this.failure = new Error('本地病历服务已停止，请退出并重新打开软件')
      for (const request of this.pending.values()) request.reject(this.failure)
      this.pending.clear()
    }
    this.worker.on('error', (error) => {
      console.error('病历服务异常', error)
      fail()
    })
    this.worker.on('exit', fail)
  }

  async call<M extends ClinicalMethod>(
    method: M,
    input: ClinicalOperations[M]['input']
  ): Promise<ClinicalOperations[M]['output']> {
    return this.request(method, input, false)
  }

  async internal<M extends keyof ClinicalInternalOperations>(
    method: M,
    input: ClinicalInternalOperations[M]['input']
  ): Promise<ClinicalInternalOperations[M]['output']> {
    return this.request(method, input, true)
  }

  private async request<T>(method: string, input: unknown, internal: boolean): Promise<T> {
    await this.ready
    if (this.closing) throw new Error('病例资料库正在关闭')
    if (this.failure) throw this.failure
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ id, method, input, internal })
    })
  }

  async close(): Promise<void> {
    if (!this.closing && !this.failure) {
      this.closing = true
      this.worker.postMessage({ close: true })
    }
    await this.exited
  }
}
