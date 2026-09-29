import { app, BrowserWindow, dialog } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { createDesktopWindow } from './application'
import { DataLocationRepository } from '../../backend/storage/data-location'

app.setName('emr-admin')
if (!app.requestSingleInstanceLock()) app.quit()
else {
  const openWindow = async () =>
    createDesktopWindow({
      dataDirectory: await new DataLocationRepository(app.getPath('userData')).resolve(),
      profileDirectory: app.getPath('userData'),
      protectedDirectories: [app.isPackaged ? dirname(app.getPath('exe')) : app.getAppPath()],
      version: app.getVersion(),
      entryFile: fileURLToPath(new URL('../renderer/index.html', import.meta.url)),
      preloadFile: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      clinicalWorkerFile: fileURLToPath(new URL('./clinical-worker.js', import.meta.url)),
      developmentUrl: app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL
    })
  const showStartupError = (error: unknown) => {
    dialog.showErrorBox('软件启动失败', error instanceof Error ? error.message : String(error))
    app.quit()
  }
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
  })
  void app.whenReady().then(openWindow).catch(showStartupError)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void openWindow().catch(showStartupError)
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
