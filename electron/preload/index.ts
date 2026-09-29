import { contextBridge, ipcRenderer } from 'electron'
import { DESKTOP_CHANNELS, type DesktopApi } from '../../shared/desktop'

const api: DesktopApi = {
  manageLocalData: (operation) => ipcRenderer.invoke(DESKTOP_CHANNELS.manageLocalData, operation),
  clinical: (method, input) => ipcRenderer.invoke(DESKTOP_CHANNELS.clinical, method, input),
  exportVisitPdf: (input) => ipcRenderer.invoke(DESKTOP_CHANNELS.exportVisitPdf, input),
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
