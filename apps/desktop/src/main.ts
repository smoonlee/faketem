import { app, BrowserWindow, dialog } from 'electron'
import { join, resolve } from 'node:path'
import { ConfigRepository } from '../../../packages/server/src/config-repository.js'
import { createLogger } from '../../../packages/server/src/logger.js'
import { createSandboxRuntime, type SandboxRuntime } from '../../../packages/server/src/runtime.js'

let runtime: SandboxRuntime | undefined
let mainWindow: BrowserWindow | undefined
let localOrigin = ''
let stopping = false

function isLocalUrl(value: string): boolean {
  try {
    return new URL(value).origin === localOrigin
  } catch {
    return false
  }
}

async function start(): Promise<void> {
  const dataDirectory = app.getPath('userData')
  const configRepository = new ConfigRepository(join(dataDirectory, 'config.json'))
  const config = await configRepository.loadOrCreate()
  const webDistDirectory = app.isPackaged
    ? join(process.resourcesPath, 'web')
    : resolve(__dirname, '../../web/dist')
  const sandbox = createSandboxRuntime({
    config,
    configRepository,
    logger: createLogger({ debug: false }),
    portableRoot: dataDirectory,
    webDistDirectory,
    webPort: 0,
  })
  await sandbox.start()
  runtime = sandbox
  localOrigin = `http://127.0.0.1:${sandbox.getStatus().webPort}`

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'ATEM Sandbox',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  })
  await mainWindow.loadURL(localOrigin)
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow !== undefined) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event, url) => {
      if (!isLocalUrl(url)) event.preventDefault()
    })
    contents.setWindowOpenHandler(({ url }) =>
      isLocalUrl(url)
        ? {
            action: 'allow',
            overrideBrowserWindowOptions: {
              webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
            },
          }
        : { action: 'deny' },
    )
  })
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (runtime !== undefined && !stopping) {
      event.preventDefault()
      stopping = true
      void runtime.stop().finally(() => app.exit())
    }
  })
  void app
    .whenReady()
    .then(start)
    .catch((error: unknown) => {
      dialog.showErrorBox(
        'ATEM Sandbox could not start',
        error instanceof Error ? error.message : String(error),
      )
      app.quit()
    })
}
