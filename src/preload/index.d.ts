import { ElectronAPI } from '@electron-toolkit/preload'

export interface AppApiKeys {
  deepgram?: string
  deepgramApiKey?: string
  gemini?: string
  geminiApiKey?: string
  llm?: string
  openaiApiKey?: string
  geminiModel?: string
  enableCues?: boolean
  enableSummary?: boolean
  aiProvider?: 'gemini' | 'universal' | 'groq'
  groqKey?: string
  uniBaseUrl?: string
  uniModelId?: string
  uniApiKey?: string
  appTheme?: 'system' | 'dark' | 'light'
}

export interface SummaryReportResult {
  summaryPath: string
  markdown: string
  fileName?: string
}

export interface SummaryPayload {
  transcript?: string
  cues?: any[]
}

export interface PdfExportResult {
  success: boolean
  filePath?: string
  canceled?: boolean
  error?: string
}

export interface HistoryItem {
  filename: string
  fullPath: string
  createdAt: string
  size: number
}

export interface HistoryContentResult {
  success: boolean
  markdown?: string
  summaryPath?: string
  fileName?: string
  error?: string
}

export interface CustomAPI {
  enableLoopback: () => Promise<void>
  disableLoopback: () => Promise<void>
  getKeys: () => Promise<AppApiKeys>
  saveKeys: (keys: AppApiKeys) => Promise<{ success: boolean }>
  generateSummary: (payload?: SummaryPayload) => Promise<SummaryReportResult>
  resetSession: () => Promise<{ success: boolean }>
  saveToPDF: (fileName?: string) => Promise<PdfExportResult>
  getHistory: () => Promise<HistoryItem[]>
  deleteHistory: (filename: string) => Promise<{ success: boolean; error?: string }>
  getHistoryContent: (filename: string) => Promise<HistoryContentResult>
  onAppAlert: (callback: (msg: string) => void) => void
  openExternal: (url: string) => void
}

export type MergedElectronAPI = ElectronAPI & CustomAPI

declare global {
  interface Window {
    electron: ElectronAPI
    electronAPI: MergedElectronAPI
    api: CustomAPI
  }
}
