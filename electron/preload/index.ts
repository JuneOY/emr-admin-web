import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { DESKTOP_CHANNELS, type DesktopApi } from '../../shared/desktop'
import type { CaseExportProgress } from '../../shared/exports'

const api: DesktopApi = {
  manageLocalData: (operation) => ipcRenderer.invoke(DESKTOP_CHANNELS.manageLocalData, operation),
  clinical: (method, input) => ipcRenderer.invoke(DESKTOP_CHANNELS.clinical, method, input),
  exportVisitPdf: (input) => ipcRenderer.invoke(DESKTOP_CHANNELS.exportVisitPdf, input),
  exportCases: (input) => ipcRenderer.invoke(DESKTOP_CHANNELS.exportCases, input),
  exportPrescriptions: () => ipcRenderer.invoke(DESKTOP_CHANNELS.exportPrescriptions),
  onCaseExportProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: CaseExportProgress) => listener(progress)
    ipcRenderer.on(DESKTOP_CHANNELS.exportProgress, handler)
    return () => ipcRenderer.removeListener(DESKTOP_CHANNELS.exportProgress, handler)
  },
  importAttachments: (input) => ipcRenderer.invoke(DESKTOP_CHANNELS.importAttachments, input),
  readAttachment: (attachmentId) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.readAttachment, attachmentId),
  exportAttachment: (attachmentId) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.exportAttachment, attachmentId),
  removeAttachment: (attachmentId) =>
    ipcRenderer.invoke(DESKTOP_CHANNELS.removeAttachment, attachmentId),
  getApplicationInfo: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getApplicationInfo),
  getSettings: () => ipcRenderer.invoke(DESKTOP_CHANNELS.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(DESKTOP_CHANNELS.saveSettings, settings),
  openDataDirectory: () => ipcRenderer.invoke(DESKTOP_CHANNELS.openDataDirectory)
}
contextBridge.exposeInMainWorld('emrDesktop', Object.freeze(api))
