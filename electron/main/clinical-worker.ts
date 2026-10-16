import { parentPort, workerData } from 'node:worker_threads'
import { ClinicalRepository } from '../../backend/storage/clinical-repository'
import { ClinicalError } from '../../shared/clinical-validation'
import {
  createSnapshot,
  restoreSnapshot,
  verifySnapshot
} from '../../backend/storage/data-snapshot'

try {
  const repository = new ClinicalRepository(workerData.directory)
  let queue = repository.attachments
    .cleanup()
    .then(() => {
      parentPort!.postMessage({ id: 0, success: true })
    })
    .catch(() => {
      parentPort!.postMessage({ id: 0, success: false, message: '无法打开本地附件目录' })
      repository.close()
      parentPort!.close()
    })
  parentPort!.on('message', (message) => {
    queue = queue
      .then(async () => {
        if (message.close) {
          repository.close()
          parentPort!.close()
          return
        }
        try {
          let data: unknown
          if (message.internal) {
            switch (message.method) {
              case 'createSnapshot':
                await createSnapshot(repository.db, workerData.directory, message.input)
                break
              case 'verifySnapshot':
                await verifySnapshot(message.input)
                break
              case 'restoreSnapshot':
                await restoreSnapshot(message.input.source, message.input.target)
                break
              case 'importAttachments':
                data = await repository.attachments.import(
                  message.input.request,
                  message.input.paths
                )
                break
              case 'readAttachment':
                data = await repository.attachments.read(message.input)
                break
              case 'removeAttachment':
                data = await repository.attachments.remove(message.input)
                break
              default:
                throw new ClinicalError('不支持此内部操作')
            }
          } else {
            data = repository.execute(message.method, message.input)
            if (message.method === 'deleteCase' || message.method === 'deleteVisit') {
              try {
                await repository.attachments.cleanup()
              } catch {
                // 删除已提交，文件任务持久化保留，不能误报记录删除失败。
                console.warn('记录已删除，附件文件等待下次启动清理')
              }
              data = { pendingAttachments: repository.attachments.hasPendingCleanup() }
            }
          }
          parentPort!.postMessage({ id: message.id, success: true, data })
        } catch (error) {
          // 不向页面泄漏 SQL、磁盘路径或病历内容。
          console.error('本地病历操作失败', error instanceof Error ? error.name : '未知错误')
          parentPort!.postMessage({
            id: message.id,
            success: false,
            message:
              error instanceof ClinicalError
                ? error.message
                : '病历数据操作失败，请检查本地磁盘和数据文件'
          })
        }
      })
      .catch(() => {
        parentPort!.postMessage({ id: message.id, success: false, message: '本地文件操作未完成' })
      })
  })
} catch (error) {
  console.error('病历数据库初始化失败', error)
  parentPort!.postMessage({
    id: 0,
    success: false,
    message: '无法打开病历数据库，请检查数据目录或软件版本'
  })
  parentPort!.close()
}
