import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom loopback audio, persistent key controls, summary generation, PDF export, history management, session reset, alert listener, and external browser link opener
const customAPI = {
  enableLoopback: () => ipcRenderer.invoke('enable-loopback-audio'),
  disableLoopback: () => ipcRenderer.invoke('disable-loopback-audio'),
  getKeys: () => ipcRenderer.invoke('get-keys'),
  saveKeys: (keys: any) =>
    ipcRenderer.invoke('save-keys', keys),
  generateSummary: (payload?: { transcript?: string; cues?: any[] }) =>
    ipcRenderer.invoke('generate-summary', payload),
  resetSession: () => ipcRenderer.invoke('reset-session'),
  saveToPDF: (fileName?: string) => ipcRenderer.invoke('save-to-pdf', fileName),
  getHistory: () => ipcRenderer.invoke('get-history'),
  deleteHistory: (filename: string) => ipcRenderer.invoke('delete-history', filename),
  getHistoryContent: (filename: string) => ipcRenderer.invoke('get-history-content', filename),
  onAppAlert: (callback: (msg: string) => void) => {
    ipcRenderer.on('app-alert', (_, msg: string) => callback(msg))
  },
  openExternal: (url: string) => ipcRenderer.send('open-external-link', url)
}

const mergedElectronAPI = {
  ...electronAPI,
  ...customAPI
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('electronAPI', mergedElectronAPI)
    contextBridge.exposeInMainWorld('api', customAPI)
  } catch (error) {
    console.error('[Conversate Preload] Error exposing contextBridge APIs:', error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.electronAPI = mergedElectronAPI
  // @ts-ignore (define in dts)
  window.api = customAPI
}
