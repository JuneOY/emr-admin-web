import { ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { DESKTOP_CHANNELS, type DesktopResult } from '../../shared/desktop'
import type { DataManagementService } from '../../backend/services/data-management-service'
import { isTrustedPage } from './security'
import {
  CLINICAL_METHODS,
  type ClinicalMethod,
  type ClinicalOperations
} from '../../shared/clinical'
import { id } from '../../shared/clinical-validation'
import { exportVisitPdf } from './pdf'
import { parseVisitPdf } from '../../shared/attachments'
import { importAttachments, exportAttachment } from './attachments'
import { manageLocalData } from './data-management'

export function registerDesktopHandlers(
  window: BrowserWindow,
  data: DataManagementService,
  entryFile: string,
  developmentUrl?: string
): () => void {
  let activeOperations = 0
  const register = <T>(
    channel: string,
    argumentCount: number,
    action: (...args: unknown[]) => Promise<T> | T
  ) => {
    ipcMain.handle(
      channel,
      async (event: IpcMainInvokeEvent, ...args: unknown[]): Promise<DesktopResult<T>> => {
        if (
          event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame ||
          !isTrustedPage(event.senderFrame.url, entryFile, developmentUrl) ||
          args.length !== argumentCount
        )
          return { success: false, message: '当前页面无权执行此操作' }
        try {
          if (data.busy) throw new Error('正在处理病例资料，请等待完成')
          const exclusive = channel === DESKTOP_CHANNELS.manageLocalData
          if (exclusive && activeOperations)
            throw new Error('还有本地操作未完成，请稍后进行资料管理')
          if (exclusive) data.busy = true
          activeOperations++
          try {
            return { success: true, data: await action(...args) }
          } finally {
            activeOperations--
            if (exclusive) data.busy = false
          }
        } catch (error) {
          console.error('[本地服务]', channel, error)
          return {
            success: false,
            message: error instanceof Error ? error.message : '本地操作失败，请重试'
          }
        }
      }
    )
  }
  register(DESKTOP_CHANNELS.manageLocalData, 1, (input) => manageLocalData(window, data, input))
  register(DESKTOP_CHANNELS.getApplicationInfo, 0, () => ({ ...data.application.info }))
  register(DESKTOP_CHANNELS.clinical, 2, (method, input) => {
    if (typeof method !== 'string' || !CLINICAL_METHODS.includes(method as ClinicalMethod))
      throw new Error('不支持此本地操作')
    return data.clinical.call(
      method as ClinicalMethod,
      input as ClinicalOperations[ClinicalMethod]['input']
    )
  })
  let exporting = false
  register(DESKTOP_CHANNELS.exportVisitPdf, 1, async (input) => {
    if (exporting) throw new Error('正在导出病历，请等待完成')
    exporting = true
    try {
      const value = parseVisitPdf(input)
      return await exportVisitPdf(window, data.clinical, value, data.application.info.dataDirectory)
    } finally {
      exporting = false
    }
  })
  let importing = false
  register(DESKTOP_CHANNELS.importAttachments, 1, async (input) => {
    if (importing) throw new Error('正在添加附件，请等待完成')
    importing = true
    try {
      return await importAttachments(window, data.clinical, input)
    } finally {
      importing = false
    }
  })
  register(DESKTOP_CHANNELS.readAttachment, 1, (input) =>
    data.clinical.internal('readAttachment', id(input))
  )
  register(DESKTOP_CHANNELS.removeAttachment, 1, (input) =>
    data.clinical.internal('removeAttachment', id(input))
  )
  register(DESKTOP_CHANNELS.exportAttachment, 1, (input) =>
    exportAttachment(window, data.clinical, data.application.info.dataDirectory, input)
  )
  register(DESKTOP_CHANNELS.getSettings, 0, () => data.application.settings.read())
  register(DESKTOP_CHANNELS.saveSettings, 1, (input) => data.application.settings.save(input))
  register(DESKTOP_CHANNELS.openDataDirectory, 0, async () => {
    const error = await shell.openPath(data.application.info.dataDirectory)
    if (error) throw new Error('无法打开本地数据目录：' + error)
  })
  return () => Object.values(DESKTOP_CHANNELS).forEach((channel) => ipcMain.removeHandler(channel))
}
