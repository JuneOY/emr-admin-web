import { dialog, type BrowserWindow } from 'electron'
import type { DataManagementService } from '../../backend/services/data-management-service'
import { parseDataOperation, type DataOperationResult } from '../../shared/data-management'

export async function manageLocalData(
  window: BrowserWindow,
  data: DataManagementService,
  input: unknown
): Promise<DataOperationResult | null> {
  const operation = parseDataOperation(input)
  const selectDirectory = async (title: string) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title,
      properties: ['openDirectory', 'createDirectory']
    })
    return canceled ? undefined : filePaths[0]
  }
  if (operation === 'backup') {
    const parent = await selectDirectory('选择备份存放位置，将新建一个带日期的备份文件夹')
    if (!parent) return null
    return { directory: await data.backup(parent), reload: false }
  }
  const source =
    operation === 'restore'
      ? await selectDirectory('选择包含 emr-backup.json 的完整备份文件夹')
      : undefined
  if (operation === 'restore') {
    if (!source) return null
    await data.verifyBackup(source)
  }
  const target = await selectDirectory(
    operation === 'restore'
      ? '选择恢复后病例的存放位置（须为空文件夹）'
      : '选择新的病例数据目录（须为空文件夹）'
  )
  if (!target) return null
  const { response } = await dialog.showMessageBox(window, {
    type: 'question',
    title: operation === 'restore' ? '恢复病例备份' : '更改数据目录',
    message:
      operation === 'restore' ? '恢复备份并切换当前资料库？' : '将当前病例和附件迁移到新目录？',
    detail: `新目录：${target}\n原数据保留在：${data.application.info.dataDirectory}\n${operation === 'restore' ? '恢复不会合并现有病例。' : ''}完成后将自动重新载入页面。`,
    buttons: ['取消', operation === 'restore' ? '恢复并启用' : '开始迁移'],
    defaultId: 0,
    cancelId: 0
  })
  if (response !== 1) return null
  if (source) await data.restore(source, target)
  else await data.migrate(target)
  return { directory: data.application.info.dataDirectory, reload: true }
}
