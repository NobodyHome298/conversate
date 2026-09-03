import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron'
import { join } from 'path'
import * as fs from 'fs'
import * as path from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initMain } from 'electron-audio-loopback'
import icon from '../../resources/icon.png?asset'
import { ConversateServer, AppApiKeys, SummaryPayload } from './ws-server'

// Initialize macOS audio loopback capture handler before app.whenReady
try {
  initMain()
} catch (e) {
  console.warn('[Conversate Main] electron-audio-loopback initMain failed or already initialized:', e)
}

// Persistent configuration storage in userData/config.json
const configPath = path.join(app.getPath('userData'), 'config.json')

const defaultKeys: AppApiKeys = {
  deepgram: '',
  aiProvider: 'universal',
  geminiModel: 'gemini-3.6-flash',
  uniBaseUrl: '',
  uniModelId: '',
  uniApiKey: '',
  enableCues: true,
  enableSummary: true,
  appTheme: 'system'
}

function loadKeys(): AppApiKeys {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(data)
      const merged = { ...defaultKeys, ...parsed }
      nativeTheme.themeSource = merged.appTheme || 'system'
      return merged
    }
  } catch (err) {
    console.warn('[Conversate Main] Failed to read config.json:', err)
  }
  nativeTheme.themeSource = defaultKeys.appTheme || 'system'
  return { ...defaultKeys }
}

function saveKeys(keys: AppApiKeys) {
  try {
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(configPath, JSON.stringify(keys, null, 2), 'utf-8')
    console.log('[Conversate Main] Keys successfully saved to:', configPath)
  } catch (err) {
    console.error('[Conversate Main] Failed to write config.json:', err)
  }
}

let server: ConversateServer | null = null
let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 980,
    minHeight: 680,
    show: false,
    title: 'Conversate - Real-Time Transcription',
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function formatFriendlyError(err: any): string {
  const msg = typeof err === 'string' ? err : err?.message || String(err)
  if (msg.includes('429') || msg.includes('rate_limit_exceeded')) {
    return 'AI Quota Exceeded: You have made too many requests. Please wait a moment or upgrade your API plan.'
  }
  if (msg.includes('404') || msg.toLowerCase().includes('decommissioned')) {
    return 'Model Unavailable: The selected AI model is currently offline or retired. Please select a different provider or model in Settings.'
  }
  if (msg.includes('invalid_api_key') || msg.includes('Incorrect API key') || msg.includes('401')) {
    return 'Invalid API Key: Please verify your Groq or Gemini API key in Settings.'
  }
  if (msg.includes('ECONNRESET') || msg.includes('1011') || err?.code === 1011) {
    return 'Transcription Disconnected: The audio server dropped the connection due to network instability or inactivity. Reconnecting...'
  }

  // Fallback: Return first 2-3 sentences under 8 lines
  const sentences = msg.split(/(?<=[.?!])\s+/).filter(Boolean)
  const shortMsg = sentences.slice(0, 3).join(' ') || msg
  const lines = shortMsg.split('\n').slice(0, 8).join('\n')
  return lines.length > 250 ? lines.substring(0, 250) + '...' : lines
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('app.donotknock.conversate')

  app.setAboutPanelOptions({
    applicationName: 'Conversate',
    applicationVersion: 'v1.0.0',
    copyright: 'donotknock.app'
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Start embedded WebSocket server on port 8000 with loaded keys and error alert bridge
  try {
    const initialKeys = loadKeys()
    server = new ConversateServer(8000, initialKeys, (alertMsg: string) => {
      const friendlyMsg = formatFriendlyError(alertMsg)
      console.log('[Conversate Main] Dispatching app-alert to renderer:', friendlyMsg)
      mainWindow?.webContents.send('app-alert', friendlyMsg)
    })
    server.start()
  } catch (err) {
    console.error('[Conversate Main] Failed to start WebSocket server:', err)
  }

  // IPC listener for opening external URLs in default browser
  ipcMain.on('open-external-link', (_, url: string) => {
    if (url && typeof url === 'string') {
      console.log('[Conversate Main] Opening external link:', url)
      shell.openExternal(url)
    }
  })

  // IPC handlers for In-App Key Management
  ipcMain.handle('get-keys', () => {
    return loadKeys()
  })

  ipcMain.handle('save-keys', (_, keys: AppApiKeys) => {
    saveKeys(keys)
    nativeTheme.themeSource = keys.appTheme || 'system'
    if (server) {
      server.reloadKeys(keys)
    }
    return { success: true }
  })

  // IPC handler for Session Reset and STT re-establishment
  ipcMain.handle('reset-session', async () => {
    console.log('[Conversate Main] reset-session IPC invoked. Resetting server buffer & reconnecting STT...')
    if (server) {
      server.resetSession()
    }
    return { success: true }
  })

  // IPC handler for Post-Conversation Summary generation with transcript & cues
  ipcMain.handle('generate-summary', async (_, payload?: SummaryPayload) => {
    if (server) {
      console.log('[Conversate Main] generate-summary IPC called with payload:', {
        hasTranscript: Boolean(payload?.transcript),
        cuesCount: payload?.cues?.length || 0
      })
      return await server.generateSummaryReport(payload)
    }
    return { summaryPath: '', markdown: 'No active session found.', fileName: '' }
  })

  // IPC handler for Save to PDF feature with custom/synced fileName
  ipcMain.handle('save-to-pdf', async (event, customFileName?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { success: false, error: 'Window not found' }

    try {
      const sanitizedName = (customFileName || `Conversate_Summary_${Date.now()}`).replace(/\.pdf$/i, '').replace(/[^a-zA-Z0-9 -]/g, '')
      const { filePath, canceled } = await dialog.showSaveDialog(win, {
        title: 'Save Summary as PDF',
        defaultPath: `${sanitizedName}.pdf`,
        filters: [{ name: 'PDFs', extensions: ['pdf'] }]
      })

      if (canceled || !filePath) {
        return { success: false, canceled: true }
      }

      console.log('[Conversate Main] Generating PDF for path:', filePath)
      const pdfData = await win.webContents.printToPDF({
        printBackground: true,
        margins: { marginType: 'default' }
      })

      fs.writeFileSync(filePath, pdfData)
      console.log('[Conversate Main] PDF successfully saved to:', filePath)
      return { success: true, filePath }
    } catch (err: any) {
      console.error('[Conversate Main] Failed to generate/save PDF:', err)
      return { success: false, error: err?.message || String(err) }
    }
  })

  // IPC handler for Conversation History fetching
  ipcMain.handle('get-history', async () => {
    const logsDir = server ? server.getLogsDir() : path.join(app.getPath('documents'), 'Conversate', 'logs')
    try {
      if (!fs.existsSync(logsDir)) {
        return []
      }
      const files = fs.readdirSync(logsDir).filter((f) => f.endsWith('.md'))
      const history = files.map((filename) => {
        const fullPath = path.join(logsDir, filename)
        const stats = fs.statSync(fullPath)
        return {
          filename,
          fullPath,
          createdAt: stats.birthtime.toISOString(),
          size: stats.size
        }
      })
      // Sort newest first
      return history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    } catch (err) {
      console.error('[Conversate Main] Failed to get history logs:', err)
      return []
    }
  })

  // IPC handler for deleting a history log file
  ipcMain.handle('delete-history', async (_, filename: string) => {
    const logsDir = server ? server.getLogsDir() : path.join(app.getPath('documents'), 'Conversate', 'logs')
    try {
      const safeFilename = path.basename(filename)
      const targetPath = path.join(logsDir, safeFilename)
      if (fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath)
        console.log('[Conversate Main] Deleted history file:', targetPath)
        return { success: true }
      }
      return { success: false, error: 'File not found' }
    } catch (err: any) {
      console.error('[Conversate Main] Error deleting history file:', err)
      return { success: false, error: err?.message || String(err) }
    }
  })

  // IPC handler for reading a history file's markdown content
  ipcMain.handle('get-history-content', async (_, filename: string) => {
    const logsDir = server ? server.getLogsDir() : path.join(app.getPath('documents'), 'Conversate', 'logs')
    try {
      const safeFilename = path.basename(filename)
      const targetPath = path.join(logsDir, safeFilename)
      if (fs.existsSync(targetPath)) {
        const markdown = fs.readFileSync(targetPath, 'utf-8')
        return { success: true, markdown, summaryPath: targetPath, fileName: safeFilename.replace(/\.md$/i, '') }
      }
      return { success: false, error: 'File not found' }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (server) {
    server.stop()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
