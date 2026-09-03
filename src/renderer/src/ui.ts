/**
 * Conversate macOS Desktop UI
 * Two-Column Full-Height Layout for Live Speech Transcription and Proactive AI Cues.
 * Features Right-Justified Audio Toggles, Real-Time Validation, Post-Conversation Summary,
 * Force Black Print Stylesheet for PDF Export, Dynamic Filename Sync, Conversation History,
 * Global Alert Toast, and Slide-Out Notification Drawer with Hover-to-Read Mechanics.
 */

import { AICue } from './ws-client'

export interface HistoryItem {
  filename: string
  fullPath: string
  createdAt: string
  size: number
}

export interface SystemAlert {
  id: number
  text: string
  read: boolean
  timestamp: string
}

export type UIStatus = 'connecting' | 'listening' | 'paused' | 'error' | 'summarized'

let statusEl: HTMLElement
let transcriptFinalEl: HTMLElement
let transcriptInterimEl: HTMLElement
let cuesContainerEl: HTMLElement
let cuesListEl: HTMLElement
let cuesCounterEl: HTMLElement
let summarySectionEl: HTMLElement
let summaryContentEl: HTMLElement
let toggleCaptureBtn: HTMLButtonElement
let newConversateBtn: HTMLButtonElement
let micSelectEl: HTMLSelectElement
let toggleMicCheckbox: HTMLInputElement
let toggleSystemCheckbox: HTMLInputElement
let audioWarningEl: HTMLElement
let vuBarEl: HTMLElement
let settingsModalEl: HTMLElement
let historyModalEl: HTMLElement
let historyListEl: HTMLElement
let alertsBtnEl: HTMLButtonElement
let alertBadgeEl: HTMLElement
let alertToastEl: HTMLElement
let alertsDrawerEl: HTMLElement
let alertsListEl: HTMLElement
let markAllReadBtnEl: HTMLButtonElement
let closeAlertsDrawerBtnEl: HTMLButtonElement
let deepgramInputEl: HTMLInputElement
let geminiInputEl: HTMLInputElement
let settingsToastEl: HTMLElement

let vuAnimFrameId: number | null = null
let toastTimer: number | null = null
let cueCount = 0
let systemAlerts: SystemAlert[] = []
let geminiModelSelectEl: HTMLSelectElement
let toggleModCuesCheckbox: HTMLInputElement
let toggleModSummaryCheckbox: HTMLInputElement
let aiProviderSelectEl: HTMLSelectElement
let universalSettingsContainerEl: HTMLElement
let geminiSettingsContainerEl: HTMLElement
let uniBaseUrlInputEl: HTMLInputElement
let uniModelIdInputEl: HTMLInputElement
let uniApiKeyInputEl: HTMLInputElement
let uniPresetSelectEl: HTMLSelectElement
let themeSelectEl: HTMLSelectElement
let currentSummaryName: string = ''

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

export interface CaptureToggleOptions {
  enableMic: boolean
  enableSystem: boolean
}

export interface UICallbacks {
  onToggleCapture: (options: CaptureToggleOptions) => void
  onNewConversate: () => void
  onMicSelected: (deviceId: string) => void
  onSaveSettings: (keys: AppApiKeys) => void
  onToggleMicMute?: (isMuted: boolean) => void
  onToggleSystemMute?: (isMuted: boolean) => void
}

export function mountUi(callbacks: UICallbacks) {
  const app = document.querySelector<HTMLDivElement>('#app')!
  app.innerHTML = `
    <div class="conversate-app">
      <!-- Top Navigation & Branding -->
      <header class="app-header">
        <div class="brand">
          <div class="brand-icon">✦</div>
          <div class="brand-text">
            <h2>Conversate</h2>
            <span class="subtext"><i>We are the stories we tell ourselves</i></span>
          </div>
        </div>
        <div class="header-right">
          <button id="btn-open-history" class="btn btn-outline" title="View Past Summaries">
            📜 History
          </button>
          <button id="btn-open-settings" class="btn btn-outline btn-settings" title="Configure API Keys">
            ⚙️ Settings
          </button>
          <div class="status-badge status-connecting" id="status-badge">Connecting…</div>
          <!-- Alerts Bell on the far right with overlay badge -->
          <button id="alerts-btn" style="position: relative; background: transparent; border: none; font-size: 1.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 6px;" title="System Alerts">
            🔔
            <span id="alert-badge" style="display: none; position: absolute; top: -5px; right: -8px; background: #ef4444; color: white; border-radius: 50%; padding: 0.1rem 0.35rem; font-size: 0.65rem; font-weight: bold; line-height: 1;">0</span>
          </button>
        </div>
      </header>

      <!-- Main Two-Column Full-Height Layout -->
      <main class="main-layout main-grid">
        <!-- Left Column: Live Speech Transcript (Full Height) -->
        <section class="transcript-column">
          <div class="card full-height-card">
            <div class="card-header column-header">
              <!-- Dedicated Flex Header for Title & Right-Justified New Conversate Button -->
              <div class="title-row" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.8rem;">
                <h3 style="margin: 0; font-size: 15px; font-weight: 600; color: #fff;">🎙️ Live Speech Transcript</h3>
                <button id="new-conversate-btn" class="btn btn-new-conversate" style="background: #3b82f6; color: white; border: none; border-radius: 4px; padding: 0.4rem 0.8rem; font-size: 0.85rem; cursor: pointer; font-weight: 600;" title="Start a fresh recording session">
                  + New Conversate
                </button>
              </div>

              <!-- Controls Toolbar: Left-aligned Mic select & VU meter; Right-aligned Toggles & Capture Button -->
              <div class="transcript-controls-toolbar">
                <div class="audio-input-left">
                  <div class="mic-select-wrapper" title="Select Input Microphone">
                    <select id="mic-select" class="mic-select">
                      <option value="">Default Microphone</option>
                    </select>
                  </div>

                  <div class="vu-meter-wrapper" title="Real-Time Audio Input Level">
                    <span class="vu-label">LEVEL</span>
                    <div class="vu-meter-container">
                      <div class="vu-meter-bar" id="vu-bar"></div>
                    </div>
                  </div>
                </div>

                <!-- Right-Justified Audio Checkbox Toggles & Capture Button -->
                <div class="capture-controls">
                  <label class="audio-toggle">
                    <input type="checkbox" id="toggle-mic" checked /> Microphone
                  </label>
                  <label class="audio-toggle">
                    <input type="checkbox" id="toggle-system" /> System Loopback
                  </label>
                  <button id="btn-toggle-capture" class="btn btn-capture btn-primary">
                    🎙️ Start Capture
                  </button>
                </div>
              </div>

              <!-- Validation Warning (Displays when both inputs are unchecked) -->
              <div id="audio-warning" style="display: none; color: #ef4444; text-align: right; font-size: 0.85rem; margin-top: 0.5rem;">
                Please select at least one audio input (Microphone or System Loopback).
              </div>
            </div>

            <div class="transcript-box" id="transcript-box" aria-live="polite">
              <span id="transcript-final"></span>
              <span id="transcript-interim" class="transcript-interim"></span>
              <span class="transcript-cursor">|</span>
            </div>
          </div>
        </section>

        <!-- Right Column: Proactive AI Cues & Post-Conversation Summary (Full Height) -->
        <section class="cues-column">
          <div class="card full-height-card cues-card-container">
            <!-- Proactive Cues Section -->
            <div id="cues-container" class="cues-view-container">
              <div class="card-header column-header cues-header" id="cues-header">
                <div class="title-row">
                  <h3>✨ Proactive Cues</h3>
                  <span class="cues-tag">Sliding Window</span>
                </div>
                <div class="cues-header-right">
                  <span class="cues-counter" id="cues-counter">0 cues</span>
                </div>
              </div>

              <div class="cues-list" id="cues-list">
                <div class="empty-state">
                  <div class="empty-icon">💡</div>
                  <p>Waiting for context cues…</p>
                  <span>Concepts, entity bios, and quick answers will appear here in real time.</span>
                </div>
              </div>
            </div>

            <!-- Post-Conversation Summary Section with Save to PDF -->
            <div id="summary-section" style="display: none; flex-direction: column; height: 100%;">
              <div class="summary-header-row" style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 0.5rem; margin-bottom: 1rem;">
                <h3 style="color: #d4d4d8; font-size: 0.95rem; margin: 0; font-weight: 600;">Post-Conversation Summary</h3>
                <button id="save-pdf-btn" class="btn btn-save-pdf" style="padding: 0.4rem 0.9rem; border-radius: 6px; background: #3b82f6; color: white; border: none; cursor: pointer; font-size: 11.5px; font-weight: 600;">
                  📄 Save to PDF
                </button>
              </div>
              <div id="summary-content" style="color: #a1a1aa; font-size: 0.95rem; overflow-y: auto; padding-right: 0.5rem; line-height: 1.6; flex: 1;">
                Generating summary...
              </div>
            </div>
          </div>
        </section>
      </main>

      <!-- Global Alert Toast (Snackbar placed at top: 70px below header) -->
      <div id="alert-toast" style="position: fixed; top: 70px; right: -350px; width: 300px; background: #ef4444; color: white; padding: 1rem; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); transition: right 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); z-index: 9999; word-break: break-word; font-size: 12.5px; line-height: 1.4;"></div>

      <!-- Slide-Out Notification Drawer -->
      <div id="alerts-drawer" style="position: fixed; top: 0; right: -350px; width: 350px; height: 100vh; background: #1e1e24; border-left: 1px solid #333; z-index: 10000; transition: right 0.3s ease; display: flex; flex-direction: column; box-shadow: -4px 0 15px rgba(0,0,0,0.5);">
        <div style="padding: 1rem; border-bottom: 1px solid #333; display: flex; justify-content: space-between; align-items: center;">
          <h3 style="margin: 0; color: #fff; font-size: 1rem; display: flex; align-items: center; gap: 6px;">
            <span>🔔</span> System Alerts
          </h3>
          <div style="display: flex; align-items: center; gap: 8px;">
            <button id="mark-all-read-btn" style="background: transparent; color: #3b82f6; border: none; cursor: pointer; font-size: 0.8rem; padding: 2px 4px;">Mark all as read</button>
            <button id="close-alerts-drawer-btn" style="background: transparent; border: none; color: #8891a4; font-size: 14px; cursor: pointer; padding: 2px 6px;">✕</button>
          </div>
        </div>
        <ul id="alerts-list" style="list-style: none; padding: 0; margin: 0; overflow-y: auto; flex: 1;"></ul>
      </div>

      <!-- Conversation History Modal Dialog -->
      <div id="history-modal" class="modal-overlay" style="display: none;">
        <div class="modal-card history-modal-card">
          <div class="modal-header">
            <div class="modal-title">
              <span class="modal-icon">📜</span>
              <h3>Conversation History</h3>
            </div>
            <button id="btn-close-history" class="btn-icon" title="Close">✕</button>
          </div>

          <div class="modal-body">
            <p class="modal-desc">
              All previously generated summaries saved in <code>~/Documents/Conversate/logs/</code>.
            </p>
            <div class="history-list-wrapper">
              <ul id="history-list" class="history-list">
                <div class="empty-state" style="padding: 20px;">No recorded conversation summaries found.</div>
              </ul>
            </div>
          </div>

          <div class="modal-footer">
            <button id="btn-done-history" class="btn btn-primary">Done</button>
          </div>
        </div>
      </div>

      <!-- Settings Modal Dialog -->
      <div id="settings-modal" class="modal-overlay" style="display: none;">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title">
              <span class="modal-icon">⚙️</span>
              <h3>API Key Settings</h3>
            </div>
            <button id="btn-close-modal" class="btn-icon" title="Close">✕</button>
          </div>

          <div class="modal-body">
            <p class="modal-desc">
              Configure your API keys for live Speech-to-Text streaming and real-time LLM proactive HUD cues. Keys are saved locally on your Mac.
            </p>

            <div class="form-group">
              <label for="input-deepgram-key">
                Deepgram API Key <span class="label-badge">STT</span>
              </label>
              <div class="input-password-wrapper">
                <input
                  type="password"
                  id="input-deepgram-key"
                  placeholder="Enter Deepgram Token (e.g. 4a5b...)"
                  autocomplete="off"
                />
                <button type="button" class="btn-toggle-reveal" data-target="input-deepgram-key" title="Toggle Visibility">👁️</button>
              </div>
              <span class="input-hint">Used for live audio transcription with multi-speaker diarization.</span>
            </div>

            <div class="form-group" style="margin-top: 0.8rem;">
              <label for="theme-select" style="display: block; color: var(--text-muted); font-size: 0.85rem;">App Theme</label>
              <select id="theme-select" style="width: 100%; padding: 0.5rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; margin-top: 0.25rem; font-size: 12px; outline: none; cursor: pointer;">
                <option value="system">System Match</option>
                <option value="dark">Dark Mode</option>
                <option value="light">Light Mode</option>
              </select>
            </div>

            <div class="form-group" style="margin-top: 0.8rem;">
              <label for="ai-provider-select" style="display: block; color: var(--text-muted); font-size: 0.85rem;">
                AI Provider <span class="label-badge" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">LLM</span>
              </label>
              <select id="ai-provider-select" style="width: 100%; padding: 0.5rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; margin-top: 0.25rem; font-size: 12px; outline: none; cursor: pointer;">
                <option value="gemini">Google Gemini</option>
                <option value="universal">OpenAI-Compatible (Groq, OpenRouter, Local)</option>
              </select>
            </div>

            <!-- Gemini Settings -->
            <div id="gemini-settings" style="margin-top: 1rem; display: none;">
              <div class="form-group">
                <label for="input-gemini-key">
                  Google Gemini API Key <span class="label-badge badge-gemini">LLM</span>
                </label>
                <div class="input-password-wrapper">
                  <input
                    type="password"
                    id="input-gemini-key"
                    placeholder="Enter Gemini API Key (e.g. AIzaSy...)"
                    autocomplete="off"
                  />
                  <button type="button" class="btn-toggle-reveal" data-target="input-gemini-key" title="Toggle Visibility">👁️</button>
                </div>
                <span class="input-hint">Powers proactive context cues and automated post-meeting summaries.</span>
              </div>

              <div class="form-group">
                <label for="gemini-model-select" style="display: block; color: var(--text-muted); font-size: 0.85rem;">Gemini Model</label>
                <select id="gemini-model-select" style="width: 100%; padding: 0.5rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; margin-top: 0.25rem; font-size: 12px; outline: none; cursor: pointer;">
                  <option value="gemini-3.6-flash">Gemini 3.6 Flash</option>
                  <option value="gemini-3.6-pro">Gemini 3.6 Pro</option>
                </select>
              </div>
            </div>

            <!-- Universal OpenAI-Compatible Settings -->
            <div id="universal-settings" style="margin-top: 1rem; display: none;">
              <label style="display: block; color: var(--text-muted); font-size: 0.85rem;">Preset Configuration</label>
              <select id="uni-preset-select" style="width: 100%; padding: 0.5rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; margin-top: 0.25rem; margin-bottom: 1rem; font-size: 12px; outline: none; cursor: pointer;">
                <option value="custom">Custom Manual Entry</option>
                <option value="groq-llama3">Groq (Llama 3.1 8B)</option>
                <option value="groq-oss20">Groq (GPT-OSS 20B)</option>
                <option value="openrouter-haiku">OpenRouter (Claude 3 Haiku)</option>
              </select>

              <label style="display: block; color: var(--text-muted); font-size: 0.85rem;">Base URL</label>
              <input type="text" id="uni-base-url" placeholder="e.g., https://openrouter.ai/api/v1 or https://api.groq.com/openai/v1" style="width: 100%; padding: 0.5rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; margin-top: 0.25rem; margin-bottom: 0.5rem; font-size: 12px; outline: none;">
              
              <label style="display: block; color: var(--text-muted); font-size: 0.85rem;">Model ID</label>
              <input type="text" id="uni-model-id" placeholder="e.g., llama-3.1-8b-instant or openai/gpt-4o-mini" style="width: 100%; padding: 0.5rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; margin-top: 0.25rem; margin-bottom: 0.5rem; font-size: 12px; outline: none;">

              <label style="display: block; color: var(--text-muted); font-size: 0.85rem;">API Key</label>
              <div class="input-password-wrapper" style="margin-top: 0.25rem;">
                <input type="password" id="uni-api-key" placeholder="Enter API Key (optional for local models)" style="width: 100%; padding: 0.5rem; background: var(--bg-input); color: var(--text-primary); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; outline: none;" autocomplete="off">
                <button type="button" class="btn-toggle-reveal" data-target="uni-api-key" title="Toggle Visibility">👁️</button>
              </div>
              <span class="input-hint" style="display: block; margin-top: 0.35rem;">Compatible with Groq, OpenRouter, Together, Ollama, LM Studio, etc.</span>
            </div>

            <div style="margin-top: 1.2rem; border-top: 1px solid var(--border); padding-top: 1rem;">
              <h4 style="margin: 0 0 0.5rem 0; color: var(--text-primary); font-size: 13px;">Active Modules</h4>
              <label style="display: flex; align-items: center; color: var(--text-muted); margin-bottom: 0.5rem; cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="toggle-mod-cues" checked style="margin-right: 0.5rem; accent-color: var(--accent-green); cursor: pointer;" /> Enable Proactive Cues
              </label>
              <label style="display: flex; align-items: center; color: var(--text-muted); cursor: pointer; font-size: 12px;">
                <input type="checkbox" id="toggle-mod-summary" checked style="margin-right: 0.5rem; accent-color: var(--accent-green); cursor: pointer;" /> Enable Post-Conversation Summary
              </label>
            </div>

            <div id="settings-toast" class="settings-toast" style="display: none;"></div>
          </div>

          <div class="modal-footer">
            <button id="btn-cancel-settings" class="btn btn-outline">Cancel</button>
            <button id="btn-save-settings" class="btn btn-primary">Save & Apply</button>
          </div>
        </div>
      </div>

      <!-- Fixed Footer with donotknock.app Link -->
      <footer class="app-footer">
        <div class="footer-left">
          <span>Dual Audio Capture (Mic + macOS Loopback) · Live Speaker Diarization</span>
        </div>
        <div class="footer-right">
          <a href="#" id="footer-link" class="footer-link">donotknock.app</a>
        </div>
      </footer>
    </div>
  `

  statusEl = document.getElementById('status-badge')!
  transcriptFinalEl = document.getElementById('transcript-final')!
  transcriptInterimEl = document.getElementById('transcript-interim')!
  cuesContainerEl = document.getElementById('cues-container')!
  cuesListEl = document.getElementById('cues-list')!
  cuesCounterEl = document.getElementById('cues-counter')!
  summarySectionEl = document.getElementById('summary-section')!
  summaryContentEl = document.getElementById('summary-content')!
  toggleCaptureBtn = document.getElementById('btn-toggle-capture') as HTMLButtonElement
  newConversateBtn = document.getElementById('new-conversate-btn') as HTMLButtonElement
  micSelectEl = document.getElementById('mic-select') as HTMLSelectElement
  toggleMicCheckbox = document.getElementById('toggle-mic') as HTMLInputElement
  toggleSystemCheckbox = document.getElementById('toggle-system') as HTMLInputElement
  audioWarningEl = document.getElementById('audio-warning')!
  vuBarEl = document.getElementById('vu-bar')!
  settingsModalEl = document.getElementById('settings-modal')!
  historyModalEl = document.getElementById('history-modal')!
  historyListEl = document.getElementById('history-list')!
  alertsBtnEl = document.getElementById('alerts-btn') as HTMLButtonElement
  alertBadgeEl = document.getElementById('alert-badge')!
  alertToastEl = document.getElementById('alert-toast')!
  alertsDrawerEl = document.getElementById('alerts-drawer')!
  alertsListEl = document.getElementById('alerts-list')!
  markAllReadBtnEl = document.getElementById('mark-all-read-btn') as HTMLButtonElement
  closeAlertsDrawerBtnEl = document.getElementById('close-alerts-drawer-btn') as HTMLButtonElement
  deepgramInputEl = document.getElementById('input-deepgram-key') as HTMLInputElement
  geminiInputEl = document.getElementById('input-gemini-key') as HTMLInputElement
  geminiModelSelectEl = document.getElementById('gemini-model-select') as HTMLSelectElement
  aiProviderSelectEl = document.getElementById('ai-provider-select') as HTMLSelectElement
  universalSettingsContainerEl = document.getElementById('universal-settings')!
  geminiSettingsContainerEl = document.getElementById('gemini-settings')!
  uniBaseUrlInputEl = document.getElementById('uni-base-url') as HTMLInputElement
  uniModelIdInputEl = document.getElementById('uni-model-id') as HTMLInputElement
  uniApiKeyInputEl = document.getElementById('uni-api-key') as HTMLInputElement
  uniPresetSelectEl = document.getElementById('uni-preset-select') as HTMLSelectElement
  themeSelectEl = document.getElementById('theme-select') as HTMLSelectElement
  toggleModCuesCheckbox = document.getElementById('toggle-mod-cues') as HTMLInputElement
  toggleModSummaryCheckbox = document.getElementById('toggle-mod-summary') as HTMLInputElement
  settingsToastEl = document.getElementById('settings-toast')!

  themeSelectEl?.addEventListener('change', () => {
    applyTheme(themeSelectEl.value)
  })

  uniPresetSelectEl?.addEventListener('change', () => {
    const val = uniPresetSelectEl.value
    if (val === 'groq-llama3') {
      if (uniBaseUrlInputEl) uniBaseUrlInputEl.value = 'https://api.groq.com/openai/v1'
      if (uniModelIdInputEl) uniModelIdInputEl.value = 'llama-3.1-8b-instant'
    } else if (val === 'groq-oss20') {
      if (uniBaseUrlInputEl) uniBaseUrlInputEl.value = 'https://api.groq.com/openai/v1'
      if (uniModelIdInputEl) uniModelIdInputEl.value = 'openai/gpt-oss-20b'
    } else if (val === 'openrouter-haiku') {
      if (uniBaseUrlInputEl) uniBaseUrlInputEl.value = 'https://openrouter.ai/api/v1'
      if (uniModelIdInputEl) uniModelIdInputEl.value = 'anthropic/claude-3-haiku'
    }
  })

  function updateProviderVisibility() {
    const isUniversal = aiProviderSelectEl ? (aiProviderSelectEl.value === 'universal' || aiProviderSelectEl.value === 'groq') : false
    if (universalSettingsContainerEl) universalSettingsContainerEl.style.display = isUniversal ? 'block' : 'none'
    if (geminiSettingsContainerEl) geminiSettingsContainerEl.style.display = isUniversal ? 'none' : 'block'
  }

  aiProviderSelectEl?.addEventListener('change', updateProviderVisibility)

  // Checkbox validation logic
  function validateAudioSelection() {
    const isValid = toggleMicCheckbox.checked || toggleSystemCheckbox.checked
    if (!isValid) {
      toggleCaptureBtn.disabled = true
      toggleCaptureBtn.style.opacity = '0.45'
      toggleCaptureBtn.style.cursor = 'not-allowed'
      audioWarningEl.style.display = 'block'
    } else {
      toggleCaptureBtn.disabled = false
      toggleCaptureBtn.style.opacity = '1'
      toggleCaptureBtn.style.cursor = 'pointer'
      audioWarningEl.style.display = 'none'
    }
  }

  toggleMicCheckbox.addEventListener('change', (e) => {
    const isChecked = (e.target as HTMLInputElement).checked
    callbacks.onToggleMicMute?.(!isChecked)
    validateAudioSelection()
  })

  toggleSystemCheckbox.addEventListener('change', (e) => {
    const isChecked = (e.target as HTMLInputElement).checked
    callbacks.onToggleSystemMute?.(!isChecked)
    validateAudioSelection()
  })

  // Save to PDF button binding with synced filename
  document.getElementById('save-pdf-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('save-pdf-btn') as HTMLButtonElement
    if (btn) btn.textContent = '⏳ Saving PDF…'
    try {
      if (window.electronAPI?.saveToPDF) {
        const res = await window.electronAPI.saveToPDF(currentSummaryName)
        if (res.success) {
          console.log('[Conversate UI] PDF saved successfully:', res.filePath)
        }
      }
    } catch (err) {
      console.error('[Conversate UI] Error saving PDF:', err)
    } finally {
      if (btn) btn.textContent = '📄 Save to PDF'
    }
  })

  // New Conversate button binding
  newConversateBtn.addEventListener('click', () => {
    callbacks.onNewConversate()
  })

  // Alerts button click logic:
  // - If systemAlerts.length === 0: show toast "No active system alerts." and do not open drawer
  // - If systemAlerts.length > 0: toggle drawer between 0px (open) and -350px (closed)
  alertsBtnEl.addEventListener('click', () => {
    if (systemAlerts.length === 0) {
      showToast('No active system alerts.')
      return
    }

    const isOpen = alertsDrawerEl.style.right === '0px'
    if (isOpen) {
      alertsDrawerEl.style.right = '-350px'
    } else {
      renderDrawer()
      alertsDrawerEl.style.right = '0px'
    }
  })

  // Close drawer button
  closeAlertsDrawerBtnEl.addEventListener('click', () => {
    alertsDrawerEl.style.right = '-350px'
  })

  // Mark all alerts as read
  markAllReadBtnEl.addEventListener('click', () => {
    systemAlerts.forEach((a) => {
      a.read = true
    })
    renderDrawer()
    updateBadge()
  })

  // History modal open/close
  document.getElementById('btn-open-history')?.addEventListener('click', () => openHistoryModal())
  document.getElementById('btn-close-history')?.addEventListener('click', () => closeHistoryModal())
  document.getElementById('btn-done-history')?.addEventListener('click', () => closeHistoryModal())

  // Footer link external browser launch
  document.getElementById('footer-link')!.addEventListener('click', (e) => {
    e.preventDefault()
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal('https://donotknock.app')
    } else if (window.electron?.ipcRenderer) {
      window.electron.ipcRenderer.send('open-external-link', 'https://donotknock.app')
    } else {
      window.open('https://donotknock.app', '_blank')
    }
  })

  // Settings Modal open/close bindings
  document.getElementById('btn-open-settings')!.addEventListener('click', () => openSettingsModal())
  document.getElementById('btn-close-modal')!.addEventListener('click', () => closeSettingsModal())
  document.getElementById('btn-cancel-settings')!.addEventListener('click', () => closeSettingsModal())

  // Save settings handler
  document.getElementById('btn-save-settings')!.addEventListener('click', () => {
    const deepgramApiKey = deepgramInputEl.value.trim()
    const geminiApiKey = geminiInputEl.value.trim()
    const aiProvider = (aiProviderSelectEl ? aiProviderSelectEl.value : 'gemini') as 'gemini' | 'universal' | 'groq'
    const geminiModel = geminiModelSelectEl ? geminiModelSelectEl.value : 'gemini-3.6-flash'
    const uniBaseUrl = uniBaseUrlInputEl ? uniBaseUrlInputEl.value.trim() : ''
    const uniModelId = uniModelIdInputEl ? uniModelIdInputEl.value.trim() : ''
    const uniApiKey = uniApiKeyInputEl ? uniApiKeyInputEl.value.trim() : ''
    const enableCues = toggleModCuesCheckbox ? toggleModCuesCheckbox.checked : true
    const enableSummary = toggleModSummaryCheckbox ? toggleModSummaryCheckbox.checked : true

    const appTheme = (themeSelectEl ? themeSelectEl.value : 'system') as 'system' | 'dark' | 'light'
    applyTheme(appTheme)

    callbacks.onSaveSettings({
      deepgramApiKey,
      geminiApiKey,
      geminiModel,
      enableCues,
      enableSummary,
      aiProvider,
      uniBaseUrl,
      uniModelId,
      uniApiKey,
      groqKey: uniApiKey,
      appTheme
    })
    applyModuleLayout()
    showSettingsToast('✓ Settings saved and applied successfully!', 'success')
    setTimeout(() => {
      closeSettingsModal()
    }, 800)
  })

  // Toggle reveal password inputs
  document.querySelectorAll<HTMLButtonElement>('.btn-toggle-reveal').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target')
      if (targetId) {
        const input = document.getElementById(targetId) as HTMLInputElement
        if (input) {
          input.type = input.type === 'password' ? 'text' : 'password'
        }
      }
    })
  })

  // Audio capture button handler
  toggleCaptureBtn.addEventListener('click', () => {
    if (!toggleCaptureBtn.classList.contains('btn-danger')) {
      // Hide the summary section
      const summarySection = document.getElementById('summary-section')
      if (summarySection) summarySection.style.display = 'none'

      // Show the cues section if the module is enabled in settings
      const cuesContainer = document.getElementById('cues-container')
      if (cuesContainer && isCuesModuleEnabled()) {
        cuesContainer.style.display = 'flex'
      }
    }

    callbacks.onToggleCapture({
      enableMic: toggleMicCheckbox.checked,
      enableSystem: toggleSystemCheckbox.checked
    })
  })

  micSelectEl.addEventListener('change', () => callbacks.onMicSelected(micSelectEl.value))

  injectStyles()
}

/**
 * Recalculate unread alert count and update the bell badge
 */
function updateBadge() {
  const unreadCount = systemAlerts.filter((a) => !a.read).length
  if (alertBadgeEl) {
    if (unreadCount > 0) {
      alertBadgeEl.textContent = String(unreadCount)
      alertBadgeEl.style.display = 'block'
    } else {
      alertBadgeEl.style.display = 'none'
    }
  }
}

/**
 * Populate the Notification Drawer with alerts and attach hover-to-read listeners
 */
function renderDrawer() {
  if (!alertsListEl) return
  alertsListEl.innerHTML = ''

  if (systemAlerts.length === 0) {
    const emptyLi = document.createElement('li')
    emptyLi.style.cssText = 'padding: 20px; text-align: center; color: #8891a4; font-size: 13px;'
    emptyLi.textContent = 'No system alerts recorded.'
    alertsListEl.appendChild(emptyLi)
    return
  }

  // Display newest alerts first
  const sorted = [...systemAlerts].reverse()

  sorted.forEach((alert) => {
    const li = document.createElement('li')
    li.style.cssText = `
      padding: 12px 14px;
      border-bottom: 1px solid #282832;
      transition: background 0.2s, border-color 0.2s;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 4px;
      background: ${alert.read ? '#141419' : '#232631'};
      border-left: ${alert.read ? '4px solid transparent' : '4px solid #ef4444'};
      color: ${alert.read ? '#8891a4' : '#f3f5f9'};
    `

    li.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
        <span style="font-weight: 700; color: ${alert.read ? '#8891a4' : '#ef4444'};">${alert.read ? 'READ' : 'NEW ALERT'}</span>
        <span style="color: #6b7280;">${alert.timestamp}</span>
      </div>
      <div style="font-size: 12.5px; line-height: 1.4; word-break: break-word;">${escapeHtml(alert.text)}</div>
    `

    // Hover-to-Read mechanic: instantly mark as read on mouseenter
    li.addEventListener('mouseenter', () => {
      if (!alert.read) {
        alert.read = true
        li.style.background = '#141419'
        li.style.borderLeft = '4px solid transparent'
        li.style.color = '#8891a4'
        const badgeSpan = li.querySelector('span')
        if (badgeSpan) {
          badgeSpan.textContent = 'READ'
          badgeSpan.style.color = '#8891a4'
        }
        updateBadge()
      }
    })

    alertsListEl.appendChild(li)
  })
}

/**
 * Push an incoming system alert into the state array, update UI and trigger toast
 */
export function addSystemAlert(msg: string) {
  systemAlerts.push({
    id: Date.now() + Math.random(),
    text: msg,
    read: false,
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  })

  updateBadge()
  renderDrawer()
  showToast(msg)
}

/**
 * Display a global alert notification snackbar toast
 */
export function showToast(msg: string) {
  if (!alertToastEl) return
  alertToastEl.textContent = msg
  alertToastEl.style.right = '20px'

  if (toastTimer !== null) {
    clearTimeout(toastTimer)
  }

  toastTimer = window.setTimeout(() => {
    if (alertToastEl) {
      alertToastEl.style.right = '-350px'
    }
    toastTimer = null
  }, 3000)
}

export function openSettingsModal() {
  if (!settingsModalEl) return
  settingsModalEl.style.display = 'flex'
}

export function closeSettingsModal() {
  if (!settingsModalEl) return
  settingsModalEl.style.display = 'none'
  if (settingsToastEl) settingsToastEl.style.display = 'none'
}

export async function openHistoryModal() {
  if (!historyModalEl) return
  historyModalEl.style.display = 'flex'
  await loadAndRenderHistory()
}

export function closeHistoryModal() {
  if (!historyModalEl) return
  historyModalEl.style.display = 'none'
}

async function loadAndRenderHistory() {
  if (!historyListEl) return
  try {
    const items: HistoryItem[] = window.electronAPI?.getHistory ? await window.electronAPI.getHistory() : []
    if (!items || items.length === 0) {
      historyListEl.innerHTML = '<div class="empty-state" style="padding: 20px;">No saved summaries found.</div>'
      return
    }

    historyListEl.innerHTML = ''
    items.forEach((item) => {
      const li = document.createElement('li')
      li.className = 'history-item'
      const readableDate = new Date(item.createdAt).toLocaleString()
      const displayTitle = item.filename
        .replace(/\.md$/i, '')
        .replace(/^Conversate Summary\s*-\s*/i, '')
        .replace(/^Conversation Summary\s*-\s*/i, '')
        .trim()
      li.innerHTML = `
        <div class="history-item-info history-info">
          <strong>${escapeHtml(displayTitle)}</strong>
          <span>${readableDate} · ${(item.size / 1024).toFixed(1)} KB</span>
        </div>
        <div class="history-item-actions history-actions">
          <button class="btn btn-outline btn-sm btn-view-history" data-filename="${escapeHtml(item.filename)}">👁️ View</button>
          <button class="btn btn-danger btn-sm btn-delete-history" data-filename="${escapeHtml(item.filename)}">🗑️ Delete</button>
        </div>
      `
      historyListEl.appendChild(li)
    })

    // Bind delete buttons
    historyListEl.querySelectorAll<HTMLButtonElement>('.btn-delete-history').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filename = btn.getAttribute('data-filename')
        if (filename && window.electronAPI?.deleteHistory) {
          btn.disabled = true
          await window.electronAPI.deleteHistory(filename)
          await loadAndRenderHistory()
        }
      })
    })

    // Bind view buttons
    historyListEl.querySelectorAll<HTMLButtonElement>('.btn-view-history').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const filename = btn.getAttribute('data-filename')
        if (filename && window.electronAPI?.getHistoryContent) {
          const res = await window.electronAPI.getHistoryContent(filename)
          if (res.success && res.markdown) {
            currentSummaryName = res.fileName || filename.replace(/\.md$/i, '')
            renderSummaryReportContent(res.markdown, res.summaryPath, currentSummaryName)
            setCaptureButtonState(false, true)
            closeHistoryModal()
          }
        }
      })
    })
  } catch (err) {
    console.error('[Conversate UI] Error loading history:', err)
  }
}

export function applyModuleLayout() {
  const enableCues = toggleModCuesCheckbox ? toggleModCuesCheckbox.checked : true
  const enableSummary = toggleModSummaryCheckbox ? toggleModSummaryCheckbox.checked : true

  const mainLayout = document.querySelector<HTMLElement>('.main-layout, .main-grid')
  const cuesColumn = document.querySelector<HTMLElement>('.cues-column')

  if (!enableCues && !enableSummary) {
    if (mainLayout) mainLayout.style.gridTemplateColumns = '1fr'
    if (cuesColumn) cuesColumn.style.display = 'none'
    if (cuesContainerEl) cuesContainerEl.style.display = 'none'
    if (summarySectionEl) summarySectionEl.style.display = 'none'
  } else if (enableCues && !enableSummary) {
    if (mainLayout) mainLayout.style.gridTemplateColumns = '1fr 1fr'
    if (cuesColumn) cuesColumn.style.display = 'flex'
    if (cuesContainerEl) cuesContainerEl.style.display = 'flex'
    if (summarySectionEl) summarySectionEl.style.display = 'none'
  } else if (!enableCues && enableSummary) {
    if (mainLayout) mainLayout.style.gridTemplateColumns = '1fr 1fr'
    if (cuesColumn) cuesColumn.style.display = 'flex'
    if (cuesContainerEl) cuesContainerEl.style.display = 'none'
    if (summarySectionEl) summarySectionEl.style.display = 'flex'
  } else {
    // Both enabled: 1fr 1fr, right column displays active view
    if (mainLayout) mainLayout.style.gridTemplateColumns = '1fr 1fr'
    if (cuesColumn) cuesColumn.style.display = 'flex'
    if (cuesContainerEl) cuesContainerEl.style.display = 'flex'
  }

  // Update Status Bar in bottom-left footer
  const footerLeft = document.querySelector('.footer-left span')
  if (footerLeft) {
    const base = 'Dual Audio Capture (Mic + macOS Loopback) · Live Speaker Diarization'
    const activeMods: string[] = []
    if (enableCues) activeMods.push('[Proactive Cues]')
    if (enableSummary) activeMods.push('[Summary]')
    if (activeMods.length === 0) activeMods.push('[None]')
    footerLeft.textContent = `${base} · Active: ${activeMods.join(' ')}`
  }
}

export function isSummaryModuleEnabled(): boolean {
  return toggleModSummaryCheckbox ? toggleModSummaryCheckbox.checked : true
}

export function isCuesModuleEnabled(): boolean {
  return toggleModCuesCheckbox ? toggleModCuesCheckbox.checked : true
}

export function populateSettingsForm(keys: AppApiKeys) {
  const dgKey = keys.deepgram || keys.deepgramApiKey || ''
  const gemKey = keys.gemini || keys.geminiApiKey || keys.llm || ''
  if (deepgramInputEl && dgKey) {
    deepgramInputEl.value = dgKey
  }
  if (geminiInputEl && gemKey) {
    geminiInputEl.value = gemKey
  }
  if (geminiModelSelectEl && keys.geminiModel) {
    geminiModelSelectEl.value = keys.geminiModel
  }
  if (aiProviderSelectEl) {
    if (keys.aiProvider) {
      aiProviderSelectEl.value = keys.aiProvider === 'groq' ? 'universal' : keys.aiProvider
    }
  }
  if (uniBaseUrlInputEl) {
    uniBaseUrlInputEl.value = keys.uniBaseUrl || ''
  }
  if (uniModelIdInputEl) {
    uniModelIdInputEl.value = keys.uniModelId || ''
  }
  if (uniApiKeyInputEl) {
    uniApiKeyInputEl.value = keys.uniApiKey || keys.groqKey || keys.openaiApiKey || ''
  }

  const isUniversal = aiProviderSelectEl ? (aiProviderSelectEl.value === 'universal' || aiProviderSelectEl.value === 'groq') : false
  if (universalSettingsContainerEl) universalSettingsContainerEl.style.display = isUniversal ? 'block' : 'none'
  if (geminiSettingsContainerEl) geminiSettingsContainerEl.style.display = isUniversal ? 'none' : 'block'

  if (toggleModCuesCheckbox) {
    toggleModCuesCheckbox.checked = keys.enableCues !== false
  }
  if (toggleModSummaryCheckbox) {
    toggleModSummaryCheckbox.checked = keys.enableSummary !== false
  }
  if (themeSelectEl) {
    themeSelectEl.value = keys.appTheme || 'system'
  }
  applyTheme(keys.appTheme || 'system')
  applyModuleLayout()
}

export function applyTheme(theme: string = 'system') {
  if (theme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light')
  } else if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  } else {
    document.documentElement.removeAttribute('data-theme')
  }
}

export function showSettingsToast(msg: string, type: 'success' | 'error' = 'success') {
  if (!settingsToastEl) return
  settingsToastEl.textContent = msg
  settingsToastEl.className = `settings-toast toast-${type}`
  settingsToastEl.style.display = 'block'
}

export function populateMicrophoneSelect(devices: MediaDeviceInfo[], selectedId?: string) {
  if (!micSelectEl) return
  const currentVal = selectedId || micSelectEl.value
  micSelectEl.innerHTML = ''

  if (devices.length === 0) {
    const opt = document.createElement('option')
    opt.value = ''
    opt.textContent = 'Default Microphone'
    micSelectEl.appendChild(opt)
    return
  }

  devices.forEach((dev, idx) => {
    const opt = document.createElement('option')
    opt.value = dev.deviceId
    opt.textContent = dev.label || `Microphone ${idx + 1}`
    if (dev.deviceId === currentVal) {
      opt.selected = true
    }
    micSelectEl.appendChild(opt)
  })
}

export function startVuMeter(analyser: AnalyserNode) {
  stopVuMeter()
  if (!vuBarEl) return

  const dataArray = new Uint8Array(analyser.frequencyBinCount)

  const updateMeter = () => {
    analyser.getByteFrequencyData(dataArray)
    let sum = 0
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i]
    }
    const avg = sum / dataArray.length
    const percent = Math.min(100, Math.round((avg / 128) * 100))

    if (vuBarEl) {
      vuBarEl.style.width = `${percent}%`
      if (percent > 75) {
        vuBarEl.style.backgroundColor = '#FF5252'
      } else if (percent > 45) {
        vuBarEl.style.backgroundColor = '#FFD54F'
      } else {
        vuBarEl.style.backgroundColor = '#3CFA44'
      }
    }

    vuAnimFrameId = requestAnimationFrame(updateMeter)
  }

  vuAnimFrameId = requestAnimationFrame(updateMeter)
}

export function stopVuMeter() {
  if (vuAnimFrameId !== null) {
    cancelAnimationFrame(vuAnimFrameId)
    vuAnimFrameId = null
  }
  if (vuBarEl) {
    vuBarEl.style.width = '0%'
  }
}

export function setStatus(status: UIStatus, text: string) {
  if (!statusEl) return
  statusEl.className = `status-badge status-${status}`
  statusEl.textContent = text
}

export function setCaptureButtonState(isCapturing: boolean, isContinue: boolean = false) {
  if (!toggleCaptureBtn) return
  if (isCapturing) {
    toggleCaptureBtn.className = 'btn btn-capture btn-danger'
    toggleCaptureBtn.textContent = '⏹ Stop Capture'
    toggleCaptureBtn.style.backgroundColor = ''
    toggleCaptureBtn.style.color = ''

    // Hide the summary section
    const summarySection = document.getElementById('summary-section')
    if (summarySection) summarySection.style.display = 'none'

    // Show the cues section if the module is enabled in settings
    const cuesContainer = document.getElementById('cues-container')
    if (cuesContainer && isCuesModuleEnabled()) {
      cuesContainer.style.display = 'flex'
    }
  } else if (isContinue) {
    toggleCaptureBtn.className = 'btn btn-capture'
    toggleCaptureBtn.textContent = '▶ Continue Capture'
    toggleCaptureBtn.style.backgroundColor = '#eab308'
    toggleCaptureBtn.style.color = '#000'
  } else {
    toggleCaptureBtn.className = 'btn btn-capture btn-primary'
    toggleCaptureBtn.textContent = '🎙️ Start Capture'
    toggleCaptureBtn.style.backgroundColor = ''
    toggleCaptureBtn.style.color = ''
  }
}

export function updateTranscript(finalText: string, interimText: string) {
  if (!transcriptFinalEl || !transcriptInterimEl) return
  transcriptFinalEl.textContent = finalText ? finalText + '\n' : ''
  transcriptInterimEl.textContent = interimText
  const box = document.getElementById('transcript-box')
  if (box) box.scrollTop = box.scrollHeight
}

export function addCueCard(cue: AICue) {
  if (!cuesListEl) return
  cueCount++
  if (cuesCounterEl) cuesCounterEl.textContent = `${cueCount} cue${cueCount === 1 ? '' : 's'}`

  const empty = cuesListEl.querySelector('.empty-state')
  if (empty) empty.remove()

  const cueEl = document.createElement('div')
  cueEl.className = `cue-item cue-type-${cue.type?.toLowerCase() || 'concept'}`
  cueEl.innerHTML = `
    <div class="cue-item-header">
      <span class="cue-badge">${cue.type || 'Concept'}</span>
      <span class="cue-time">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
    </div>
    <div class="cue-content">${escapeHtml(cue.text)}</div>
  `

  cuesListEl.prepend(cueEl)
}

/**
 * Reset UI views and state for starting a fresh conversation
 */
export function resetUiForNewSession() {
  cueCount = 0
  currentSummaryName = ''
  if (cuesContainerEl) {
    cuesContainerEl.style.display = 'flex'
  }
  if (summarySectionEl) {
    summarySectionEl.style.display = 'none'
  }
  if (cuesCounterEl) {
    cuesCounterEl.textContent = '0 cues'
  }
  if (cuesListEl) {
    cuesListEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">💡</div>
        <p>Waiting for context cues…</p>
        <span>Concepts, entity bios, and quick answers will appear here in real time.</span>
      </div>
    `
  }
  if (transcriptFinalEl) transcriptFinalEl.textContent = ''
  if (transcriptInterimEl) transcriptInterimEl.textContent = ''
  setCaptureButtonState(false, false)
}

/**
 * Show the Post-Conversation Summary loading state in the right column
 */
export function showSummaryGenerating() {
  if (cuesContainerEl) {
    cuesContainerEl.style.display = 'none'
  }
  if (summarySectionEl) {
    summarySectionEl.style.display = 'flex'
  }
  if (summaryContentEl) {
    summaryContentEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px; color: var(--accent-cyan); padding: 10px 0;">
        <span>⏳</span> <em>Generating post-conversation executive summary & action items…</em>
      </div>
    `
  }
}

/**
 * Render the final summary markdown report into the summary container
 */
export function renderSummaryReportContent(markdown: string, summaryPath?: string, fileName?: string) {
  if (fileName) {
    currentSummaryName = fileName
  }
  if (cuesContainerEl) {
    cuesContainerEl.style.display = 'none'
  }
  if (summarySectionEl) {
    summarySectionEl.style.display = 'flex'
  }
  if (summaryContentEl) {
    const pathHtml = summaryPath
      ? `<div class="summary-file-path" style="font-size: 11px; color: var(--text-muted); margin-bottom: 12px;">Saved to: <code style="background: #000; padding: 2px 6px; border-radius: 4px; color: var(--accent-green);">${escapeHtml(summaryPath)}</code></div>`
      : ''
    summaryContentEl.innerHTML = pathHtml + renderMarkdown(markdown)
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function renderMarkdown(md: string): string {
  return md
    .replace(/^### (.*$)/gim, '<h4 style="color: var(--text-primary); font-size: 13px; margin: 10px 0 4px;">$1</h4>')
    .replace(/^## (.*$)/gim, '<h3 style="color: var(--accent-cyan); font-size: 14px; margin: 12px 0 6px;">$1</h3>')
    .replace(/^# (.*$)/gim, '<h2 style="color: var(--text-primary); font-size: 16px; margin: 14px 0 8px;">$1</h2>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong style="color: var(--text-primary);">$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/^- \[ \] (.*$)/gim, '<div class="todo-item unchecked" style="padding: 2px 0; color: var(--text-primary);">◻ $1</div>')
    .replace(/^- \[x\] (.*$)/gim, '<div class="todo-item checked" style="padding: 2px 0; color: var(--accent-green);">☑ $1</div>')
    .replace(/^- (.*$)/gim, '<li style="margin-left: 16px; color: var(--text-muted);">$1</li>')
    .replace(/\n\n/gim, '<br/><br/>')
}

function injectStyles() {
  const css = `
    :root {
      --bg-main: #121214;
      --bg-surface: #1e1e24;
      --bg-input: #27272a;
      --border: #3f3f46;
      --border-subtle: #333333;
      --text-primary: #ffffff;
      --text-muted: #d4d4d8;

      --bg-dark: var(--bg-main);
      --bg-panel: var(--bg-surface);
      --bg-cues: var(--bg-surface);
      --bg-card: var(--bg-input);
      --border-color: var(--border);
      --text-main: var(--text-primary);
      --text-subtitle: var(--text-muted);

      --accent-green: #3CFA44;
      --accent-cyan: #00E5FF;
      --accent-purple: #B388FF;
      --accent-amber: #FFD54F;
      --accent-red: #FF5252;
    }

    @media (prefers-color-scheme: light) {
      :root {
        --bg-main: #f8fafc;
        --bg-surface: #ffffff;
        --bg-input: #f1f5f9;
        --border: #cbd5e1;
        --border-subtle: #e2e8f0;
        --text-primary: #0f172a;
        --text-muted: #475569;

        --bg-dark: var(--bg-main);
        --bg-panel: var(--bg-surface);
        --bg-cues: var(--bg-surface);
        --bg-card: var(--bg-input);
        --border-color: var(--border);
        --text-main: var(--text-primary);
        --text-subtitle: var(--text-muted);
      }
    }

    html[data-theme="light"] {
      --bg-main: #f8fafc;
      --bg-surface: #ffffff;
      --bg-input: #f1f5f9;
      --border: #cbd5e1;
      --border-subtle: #e2e8f0;
      --text-primary: #0f172a;
      --text-muted: #475569;

      --bg-dark: var(--bg-main);
      --bg-panel: var(--bg-surface);
      --bg-cues: var(--bg-surface);
      --bg-card: var(--bg-input);
      --border-color: var(--border);
      --text-main: var(--text-primary);
      --text-subtitle: var(--text-muted);
    }

    html[data-theme="dark"] {
      --bg-main: #121214;
      --bg-surface: #1e1e24;
      --bg-input: #27272a;
      --border: #3f3f46;
      --border-subtle: #333333;
      --text-primary: #ffffff;
      --text-muted: #d4d4d8;

      --bg-dark: var(--bg-main);
      --bg-panel: var(--bg-surface);
      --bg-cues: var(--bg-surface);
      --bg-card: var(--bg-input);
      --border-color: var(--border);
      --text-main: var(--text-primary);
      --text-subtitle: var(--text-muted);
    }

    * { box-sizing: border-box; }
    body, html {
      margin: 0; padding: 0; width: 100%; height: 100%;
      background: var(--bg-dark); color: var(--text-main);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      user-select: none; overflow: hidden;
    }

    .conversate-app {
      display: flex; flex-direction: column; height: 100vh; padding: 16px 20px; box-sizing: border-box; gap: 14px;
    }

    /* Top Navigation Header */
    .app-header {
      display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px;
      border-bottom: 1px solid var(--border-color); flex-shrink: 0;
    }

    .brand { display: flex; align-items: center; gap: 12px; }
    .brand-icon {
      font-size: 22px; color: var(--accent-green); background: rgba(60, 250, 68, 0.1);
      width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
      border: 1px solid rgba(60, 250, 68, 0.3);
    }
    .brand-text h2 { margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; color: var(--text-primary); }
    .brand-text .subtext { font-size: 11.5px; color: var(--text-subtitle); font-style: italic; }

    .header-right { display: flex; align-items: center; gap: 10px; }
    .btn-settings { font-size: 12px; padding: 6px 12px; border-radius: 8px; }

    .status-badge {
      font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
      padding: 6px 12px; border-radius: 20px; border: 1px solid transparent;
    }
    .status-connecting { color: var(--text-muted); border-color: var(--border-color); background: var(--bg-input); }
    .status-listening  { color: var(--accent-green); border-color: var(--accent-green); background: rgba(60,250,68,0.1); }
    .status-paused     { color: var(--accent-amber); border-color: var(--accent-amber); background: rgba(255,213,79,0.1); }
    .status-error      { color: var(--accent-red); border-color: var(--accent-red); background: rgba(255,82,82,0.1); }
    .status-summarized { color: var(--accent-cyan); border-color: var(--accent-cyan); background: rgba(0,229,255,0.1); }

    /* Main Two-Column Full-Height Layout */
    .main-layout {
      display: grid; grid-template-columns: 1fr 1fr; gap: 16px; flex: 1; min-height: 0;
    }

    .transcript-column, .cues-column {
      display: flex; flex-direction: column; min-height: 0; height: 100%;
    }

    .card {
      background: var(--bg-panel); border: 1px solid var(--border-color); border-radius: 14px; padding: 18px;
    }
    .cues-card-container {
      background: var(--bg-cues); border-color: #2F2F3B;
    }

    .full-height-card {
      display: flex; flex-direction: column; height: 100%; min-height: 0;
    }

    .cues-view-container {
      display: flex; flex-direction: column; height: 100%; min-height: 0;
    }

    /* Standardized Column Headers */
    .column-header {
      display: flex; flex-direction: column; gap: 12px; margin-bottom: 14px; flex-shrink: 0;
    }
    .title-row {
      display: flex; align-items: center; gap: 10px; height: 28px;
    }
    .title-row h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--text-primary); }
    .btn-new-conversate {
      background: #3b82f6; color: white; border: none; border-radius: 4px; padding: 0.4rem 0.8rem; font-size: 0.85rem; cursor: pointer; font-weight: 600;
    }
    .btn-new-conversate:hover { background: #2563eb; }

    .cues-header {
      flex-direction: row; justify-content: space-between; align-items: center; height: 74px; margin-bottom: 14px;
    }
    .cues-tag { font-size: 10px; color: var(--accent-purple); background: rgba(179,136,255,0.12); padding: 2px 8px; border-radius: 4px; font-weight: 600; }
    .cues-counter { font-size: 11px; color: var(--text-muted); background: rgba(0,0,0,0.3); padding: 5px 12px; border-radius: 20px; border: 1px solid var(--border-color); }

    /* Controls Toolbar */
    .transcript-controls-toolbar {
      display: flex; justify-content: space-between; align-items: center; gap: 12px;
      background: var(--bg-surface); padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border-color); flex-wrap: wrap;
    }
    .audio-input-left {
      display: flex; align-items: center; gap: 10px; flex: 1; min-width: 140px;
    }
    .mic-select-wrapper { flex: 1; }
    .mic-select {
      width: 100%; background: var(--bg-card); border: 1px solid var(--border-color); color: var(--text-main);
      padding: 5px 8px; border-radius: 6px; font-size: 11px; outline: none; cursor: pointer;
    }
    .mic-select:focus { border-color: var(--accent-cyan); }

    .vu-meter-wrapper { display: flex; align-items: center; gap: 5px; }
    .vu-label { font-size: 9px; font-weight: 700; color: var(--text-muted); letter-spacing: 0.05em; }
    .vu-meter-container {
      width: 55px; height: 9px; background: var(--bg-main); border-radius: 5px; border: 1px solid var(--border-color);
      overflow: hidden; display: flex; align-items: center; padding: 1px;
    }
    .vu-meter-bar {
      height: 100%; width: 0%; background: var(--accent-green); border-radius: 3px;
      transition: width 0.05s ease-out, background-color 0.1s;
    }

    /* Right-Justified Audio Controls */
    .capture-controls {
      display: flex; justify-content: flex-end; align-items: center; gap: 1rem;
    }
    .audio-toggle {
      display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-muted); cursor: pointer; font-weight: 500;
    }
    .audio-toggle input[type="checkbox"] {
      cursor: pointer; accent-color: var(--accent-green); width: 13px; height: 13px; margin: 0;
    }

    /* Live Transcript Box */
    .transcript-box {
      flex: 1; min-height: 0; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px;
      padding: 16px; font-size: 14px; line-height: 1.7; overflow-y: auto; color: var(--text-main);
      white-space: pre-wrap; word-break: break-word; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .transcript-interim { color: var(--text-muted); font-style: italic; }
    .transcript-cursor { color: var(--accent-green); font-weight: bold; animation: blink 1s infinite; }
    @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

    /* Proactive Cues List */
    .cues-list {
      flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; padding-right: 4px;
    }
    .empty-state {
      flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
      color: var(--text-muted); text-align: center; padding: 20px; gap: 8px;
    }
    .empty-icon { font-size: 32px; opacity: 0.4; margin-bottom: 4px; }
    .empty-state p { margin: 0; font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .empty-state span { font-size: 12px; max-width: 280px; line-height: 1.4; }

    .cue-item {
      padding: 12px 14px; border-radius: 10px; background: var(--bg-surface); border-left: 4px solid var(--border-color);
      display: flex; flex-direction: column; gap: 4px; animation: slideDown 0.25s ease-out; flex-shrink: 0;
      border-top: 1px solid var(--border-color); border-right: 1px solid var(--border-color); border-bottom: 1px solid var(--border-color);
    }
    @keyframes slideDown { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }

    .cue-item-header { display: flex; justify-content: space-between; align-items: center; }
    .cue-type-concept { border-left-color: var(--accent-cyan); }
    .cue-type-concept .cue-badge { color: var(--accent-cyan); background: rgba(0,229,255,0.1); }
    .cue-type-bio { border-left-color: var(--accent-purple); }
    .cue-type-bio .cue-badge { color: var(--accent-purple); background: rgba(179,136,255,0.1); }
    .cue-type-answer { border-left-color: var(--accent-amber); }
    .cue-type-answer .cue-badge { color: var(--accent-amber); background: rgba(255,213,79,0.1); }

    .cue-badge { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 6px; border-radius: 4px; }
    .cue-content { font-size: 13.5px; font-weight: 500; color: var(--text-primary); line-height: 1.4; margin-top: 2px; }
    .cue-time { font-size: 10px; color: var(--text-muted); }

    /* Buttons */
    .btn {
      padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
      border: 1px solid transparent; transition: all 0.2s; display: inline-flex; align-items: center; justify-content: center;
    }
    .btn-outline { background: transparent; border-color: var(--border-color); color: var(--text-main); }
    .btn-outline:hover { background: var(--bg-card); border-color: var(--text-muted); }
    .btn-danger { background: rgba(255,82,82,0.15); border-color: var(--accent-red); color: var(--accent-red); }
    .btn-danger:hover { background: var(--accent-red); color: #fff; }
    .btn-primary { background: #3CFA44; color: #000; font-weight: 700; }
    .btn-primary:hover { background: #56ff5d; }
    .btn-capture { font-size: 11px; padding: 6px 14px; white-space: nowrap; }
    .btn-save-pdf:hover { background: #2563eb !important; }
    .btn-sm { padding: 4px 8px; font-size: 11px; }

    /* History Modal Card */
    .history-modal-card { max-width: 600px; }
    .history-list-wrapper { max-height: 300px; overflow-y: auto; }
    .history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .history-item {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      justify-content: space-between !important;
      gap: 12px !important;
      padding: 12px !important;
      min-height: 64px !important;
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 8px;
    }
    .history-info, .history-item-info {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      overflow: hidden !important;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .history-item-info strong, .history-info strong { font-size: 13px; color: var(--text-primary); }
    .history-item-info span, .history-info span { font-size: 11px; color: var(--text-muted); }
    .history-actions, .history-item-actions {
      display: flex !important;
      flex-direction: row !important;
      align-items: center !important;
      gap: 8px !important;
      flex-shrink: 0 !important;
      white-space: nowrap !important;
    }
    .history-actions button, .history-item-actions button {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      height: 36px !important;
      padding: 0 12px !important;
      white-space: nowrap !important;
      flex-shrink: 0 !important;
    }

    /* Settings Modal Overlay */
    .modal-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(6, 8, 12, 0.8); backdrop-filter: blur(8px);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
      animation: modalFadeIn 0.2s ease-out;
    }
    @keyframes modalFadeIn { from { opacity: 0; } to { opacity: 1; } }

    .modal-card {
      background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 16px;
      width: 100%; max-width: 520px; padding: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.7);
      display: flex; flex-direction: column; gap: 16px;
    }
    .modal-header {
      display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color);
      padding-bottom: 12px;
    }
    .modal-title { display: flex; align-items: center; gap: 8px; }
    .modal-title h3 { margin: 0; font-size: 16px; font-weight: 700; color: var(--text-primary); }
    .btn-icon {
      background: transparent; border: none; color: var(--text-muted); font-size: 16px; cursor: pointer; padding: 4px 8px; border-radius: 6px;
    }
    .btn-icon:hover { color: var(--text-primary); background: var(--bg-card); }

    .modal-body { display: flex; flex-direction: column; gap: 14px; }
    .modal-desc { font-size: 12px; color: var(--text-muted); margin: 0; line-height: 1.45; }

    .form-group { display: flex; flex-direction: column; gap: 6px; }
    .form-group label {
      font-size: 12px; font-weight: 600; color: var(--text-primary); display: flex; align-items: center; gap: 6px;
    }
    .label-badge {
      font-size: 9px; padding: 2px 6px; border-radius: 4px; font-weight: 800; text-transform: uppercase;
      background: rgba(0, 229, 255, 0.15); color: var(--accent-cyan);
    }
    .badge-gemini { background: rgba(179, 136, 255, 0.15); color: var(--accent-purple); }

    .input-password-wrapper {
      display: flex; align-items: center; background: #0B0D12; border: 1px solid var(--border-color);
      border-radius: 8px; overflow: hidden; padding-right: 6px;
    }
    .input-password-wrapper input {
      flex: 1; background: transparent; border: none; padding: 10px 12px; color: var(--text-main);
      font-size: 12px; font-family: monospace; outline: none;
    }
    .input-password-wrapper:focus-within { border-color: var(--accent-green); }
    .btn-toggle-reveal {
      background: transparent; border: none; cursor: pointer; font-size: 13px; opacity: 0.6; padding: 4px;
    }
    .btn-toggle-reveal:hover { opacity: 1; }
    .input-hint { font-size: 11px; color: #6E7687; }

    .settings-toast {
      padding: 8px 12px; border-radius: 6px; font-size: 12px; font-weight: 600;
    }
    .toast-success { background: rgba(60, 250, 68, 0.15); color: var(--accent-green); border: 1px solid var(--accent-green); }

    .modal-footer {
      display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color);
      padding-top: 14px;
    }

    /* Fixed Footer */
    .app-footer {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border-color);
      padding-top: 10px; flex-shrink: 0;
    }
    .footer-link {
      color: var(--accent-cyan); text-decoration: none; font-weight: 600; transition: color 0.2s;
    }
    .footer-link:hover { color: #fff; text-decoration: underline; }

    /* Force Black Print Stylesheet for High-Quality PDF Export */
    @media print {
      * {
        color: #000000 !important;
        background: transparent !important;
        text-shadow: none !important;
      }
      body, html {
        background: white !important;
        color: black !important;
        height: auto !important;
        overflow: visible !important;
      }
      .app-header, .app-footer, .transcript-column, .capture-controls, #save-pdf-btn, #new-conversate-btn,
      .modal-overlay, .transcript-controls-toolbar, #cues-container, #btn-open-history, #btn-open-settings,
      #alerts-btn, #status-badge, .btn-new-conversate, #alert-toast, #alerts-drawer {
        display: none !important;
      }
      .main-layout { display: block !important; }
      .cues-column {
        width: 100% !important;
        display: block !important;
        border: none !important;
        background: white !important;
      }
      .cues-card-container {
        background: white !important;
        border: none !important;
        box-shadow: none !important;
        padding: 0 !important;
      }
      #summary-section, #summary-content {
        display: block !important;
        overflow: visible !important;
        color: black !important;
        font-size: 11pt !important;
      }
      #summary-section h3, #summary-section h4, #summary-section h2 {
        color: black !important;
        border-bottom: 1px solid #ccc !important;
      }
      .summary-file-path code {
        background: #f0f0f0 !important;
        color: #333 !important;
      }
      .todo-item { color: black !important; }
    }
  `
  const style = document.createElement('style')
  style.textContent = css
  document.head.appendChild(style)
}
