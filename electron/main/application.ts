import { BrowserWindow, dialog, type Session } from 'electron'
import { DataManagementService } from '../../backend/services/data-management-service'
import { registerDesktopHandlers } from './ipc'
import { isTrustedPage } from './security'

export interface DesktopWindowOptions {
  dataDirectory: string
  profileDirectory?: string
  protectedDirectories?: string[]
  version: string
  entryFile: string
  preloadFile: string
  clinicalWorkerFile: string
  developmentUrl?: string
  show?: boolean
  session?: Session
}

export async function createDesktopWindow(options: DesktopWindowOptions): Promise<BrowserWindow> {
  const data = await DataManagementService.open(
    options.dataDirectory,
    options.profileDirectory ?? options.dataDirectory,
    options.clinicalWorkerFile,
    options.version,
    options.protectedDirectories
  )
  const window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    title: '门诊病历',
    backgroundColor: '#fafbfc',
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadFile,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      session: options.session
    }
  })
  const dispose = registerDesktopHandlers(window, data, options.entryFile, options.developmentUrl)
  window.on('closed', () => {
    dispose()
    void data.clinical.close()
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedPage(url, options.entryFile, options.developmentUrl)) event.preventDefault()
  })
  const session = window.webContents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      const allowed = options.developmentUrl ? new URL(options.developmentUrl).host : ''
      callback({ cancel: !allowed || new URL(details.url).host !== allowed })
    }
  )

  let allowClose = false
  let confirming = false
  window.on('close', (event) => {
    if (data.busy) {
      event.preventDefault()
      return
    }
    if (allowClose) return
    event.preventDefault()
    if (confirming) return
    confirming = true
    void (async () => {
      const settings = await data.application.settings.read()
      const response = settings.confirmBeforeExit
        ? (
            await dialog.showMessageBox(window, {
              type: 'question',
              message: '关闭门诊病历？',
              buttons: ['继续使用', '关闭软件'],
              defaultId: 0,
              cancelId: 0
            })
          ).response
        : 1
      if (response === 1) {
        allowClose = true
        window.close()
      }
    })()
      .catch((error) => {
        console.error('读取关闭设置失败', error)
        allowClose = true
        window.close()
      })
      .finally(() => {
        confirming = false
      })
  })

  try {
    if (options.developmentUrl) await window.loadURL(options.developmentUrl)
    else await window.loadFile(options.entryFile)
    if (options.show !== false) window.show()
    return window
  } catch (error) {
    window.destroy()
    throw error
  }
}
