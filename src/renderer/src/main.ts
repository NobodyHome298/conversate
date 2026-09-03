/**
 * Conversate - Renderer Entry Point
 * Handles In-App Key Management, Selective Audio Stream Capture, Dynamic Mic Selection,
 * Real-Time VU Meter, Session Cues Tracking, Post-Conversation Summary IPC, G2 HUD rendering,
 * Conversation History, and hardware gestures.
 */

import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
  OsEventTypeList
} from '@evenrealities/even_hub_sdk'
import { ConversateWSClient, AICue, SummaryReport } from './ws-client'
import { DualAudioMixer } from './audio-mixer'
import './ui.css'
import {
  mountUi,
  setStatus,
  setCaptureButtonState,
  populateMicrophoneSelect,
  populateSettingsForm,
  openSettingsModal,
  startVuMeter,
  stopVuMeter,
  updateTranscript,
  addCueCard,
  resetUiForNewSession,
  showSummaryGenerating,
  renderSummaryReportContent,
  addSystemAlert,
  isSummaryModuleEnabled,
  AppApiKeys,
  CaptureToggleOptions
} from './ui'

let activeCue: AICue | null = null
let sessionCues: AICue[] = []
let currentFinalText = ''
let currentInterimText = ''
let isSessionTerminated = false
let isDualCapturing = false
let selectedMicId = ''

const WS_URL = 'ws://127.0.0.1:8000'

// Dual Audio Mixer (Mic + macOS System Loopback)
let audioMixer: DualAudioMixer | null = null

function generateHudContent(): string {
  if (isSessionTerminated) {
    return 'Conversate\n━━━━━━━━━━━━━━━━━━━━━━━━\nSession Ended\nSummary saved to Documents.'
  }

  if (activeCue) {
    const cueIcon = activeCue.type === 'Bio' ? '👤' : activeCue.type === 'Concept' ? '💡' : '⚡'
    return `${cueIcon} [${activeCue.type.toUpperCase()}]\n${activeCue.text}\n┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈\n${isDualCapturing ? '● Audio Live' : '○ Standby'} · Tap to dismiss`
  }

  if (!isDualCapturing) {
    return 'Conversate\n━━━━━━━━━━━━━━━━━━━━━━━━\nStandby Mode\nClick "Start Capture" or tap'
  }

  const recentSpeech = (currentFinalText + ' ' + currentInterimText).trim()
  if (!recentSpeech) {
    return 'Conversate · Audio Active\n━━━━━━━━━━━━━━━━━━━━━━━━\nListening for speech…\nProactive cues will appear'
  }

  const preview = recentSpeech.length > 110 ? '…' + recentSpeech.slice(-110) : recentSpeech
  return `Conversate · Transcribing\n━━━━━━━━━━━━━━━━━━━━━━━━\n"${preview}"`
}

let lastRenderedContent = ''
let renderDebounceTimer: number | null = null

function scheduleGlassesRender() {
  const nextContent = generateHudContent()

  if (renderDebounceTimer !== null) return
  renderDebounceTimer = window.setTimeout(async () => {
    renderDebounceTimer = null
    if (nextContent === lastRenderedContent) return
    lastRenderedContent = nextContent

    try {
      if (bridge) {
        await bridge.textContainerUpgrade(
          new TextContainerUpgrade({
            containerID: 1,
            containerName: 'conversate_hud',
            content: nextContent
          })
        )
      }
    } catch (err) {
      console.warn('textContainerUpgrade failed:', err)
    }
  }, 120)
}

function handleDismissCue() {
  if (activeCue) {
    console.log('[Conversate] Dismissing active cue')
    activeCue = null
    wsClient.dismissCue()
    scheduleGlassesRender()
  }
}

async function handleStopAndGenerateSummary() {
  console.log('[Conversate] Stop Capture triggered: stopping audio streams.')
  isSessionTerminated = true
  stopVuMeter()
  if (audioMixer) {
    audioMixer.stop()
  }
  isDualCapturing = false
  setCaptureButtonState(false, true)

  if (!isSummaryModuleEnabled()) {
    console.log('[Conversate] Post-Conversation Summary module is disabled. Skipping summary generation.')
    setStatus('paused', 'Session stopped · Summary disabled')
    scheduleGlassesRender()
    return
  }

  setStatus('summarized', 'Session ended · Generating summary…')
  scheduleGlassesRender()

  // Show summary loading indicator in the right column
  showSummaryGenerating()

  // Generate summary via IPC with transcript & accumulated cues
  try {
    if (window.electronAPI?.generateSummary) {
      const report = await window.electronAPI.generateSummary({
        transcript: currentFinalText,
        cues: sessionCues
      })
      console.log('[Conversate] Summary generated via IPC:', report)
      setStatus('summarized', 'Summary Generated')
      renderSummaryReportContent(report.markdown, report.summaryPath, report.fileName)
    } else {
      wsClient.stopAndSummarize()
    }
  } catch (err) {
    console.error('[Conversate] Error generating summary:', err)
    wsClient.stopAndSummarize()
  }
}

async function handleNewConversate() {
  console.log('[Conversate] Starting fresh conversation session.')
  // Explicitly halt active mixer streams to prevent zombie inputs
  if (audioMixer) {
    audioMixer.stop()
  }
  stopVuMeter()
  isDualCapturing = false

  isSessionTerminated = false
  sessionCues = []
  currentFinalText = ''
  currentInterimText = ''
  activeCue = null

  // Trigger backend session buffer reset & clean STT reconnection
  try {
    if (window.electronAPI?.resetSession) {
      await window.electronAPI.resetSession()
    }
  } catch (err) {
    console.warn('[Conversate] Error invoking resetSession IPC:', err)
  }

  resetUiForNewSession()
  setStatus('listening', 'Ready for new session')
  scheduleGlassesRender()
}

async function handleToggleDualCapture(options: CaptureToggleOptions = { enableMic: true, enableSystem: false }) {
  if (isDualCapturing) {
    // When capturing is active, clicking the button triggers Stop Capture and generates Summary
    await handleStopAndGenerateSummary()
  } else {
    isSessionTerminated = false
    setStatus('connecting', 'Acquiring audio stream(s)…')
    if (!audioMixer) {
      audioMixer = new DualAudioMixer(
        (pcmChunk: Uint8Array) => {
          wsClient.sendPcm(pcmChunk)
        },
        (status) => {
          isDualCapturing = status.isCapturing
          setCaptureButtonState(status.isCapturing)
          if (status.error) {
            setStatus('error', `Audio error: ${status.error}`)
          }
        }
      )
    }

    const success = await audioMixer.start(selectedMicId, options)
    if (success) {
      isDualCapturing = true
      audioMixer.setMicMute(!options.enableMic)
      audioMixer.setSystemMute(!options.enableSystem)
      setCaptureButtonState(true)
      const desc = options.enableMic && options.enableSystem
        ? 'Dual Audio Live (Mic + System Loopback)'
        : options.enableMic
          ? 'Microphone Live'
          : 'System Audio Loopback Live'
      setStatus('listening', desc)

      const analyser = audioMixer.getAnalyser()
      if (analyser) {
        startVuMeter(analyser)
      }

      await refreshAudioDevices()
    } else {
      stopVuMeter()
      setCaptureButtonState(false)
      setStatus('error', 'Could not start audio capture')
    }
    scheduleGlassesRender()
  }
}

async function handleMicSelected(deviceId: string) {
  selectedMicId = deviceId
  console.log('[Conversate] User switched microphone device:', deviceId)
  if (audioMixer && isDualCapturing) {
    await audioMixer.switchMicrophone(deviceId)
  }
}

async function handleSaveSettings(keys: AppApiKeys) {
  console.log('[Conversate] Saving API keys to persistent configuration...')
  if (window.electronAPI?.saveKeys) {
    await window.electronAPI.saveKeys(keys)
  } else if (window.api?.saveKeys) {
    await window.api.saveKeys(keys)
  }
}

async function refreshAudioDevices() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return
    const allDevices = await navigator.mediaDevices.enumerateDevices()
    const audioInputs = allDevices.filter((d) => d.kind === 'audioinput')
    populateMicrophoneSelect(audioInputs, selectedMicId)
  } catch (err) {
    console.warn('[Conversate] Could not enumerate audio devices:', err)
  }
}

async function initSettings() {
  try {
    let savedKeys: AppApiKeys = {}
    if (window.electronAPI?.getKeys) {
      savedKeys = await window.electronAPI.getKeys()
    } else if (window.api?.getKeys) {
      savedKeys = await window.api.getKeys()
    }

    populateSettingsForm(savedKeys)

    const hasKeys = Boolean(savedKeys.deepgram || savedKeys.deepgramApiKey || savedKeys.gemini || savedKeys.geminiApiKey)
    if (!hasKeys) {
      console.log('[Conversate] No API keys configured. Opening Settings modal.')
      openSettingsModal()
    }
  } catch (err) {
    console.warn('[Conversate] Failed to load initial settings:', err)
  }
}

// Mount Desktop UI
mountUi({
  onToggleCapture: handleToggleDualCapture,
  onNewConversate: handleNewConversate,
  onMicSelected: handleMicSelected,
  onSaveSettings: handleSaveSettings,
  onToggleMicMute: (isMuted: boolean) => {
    if (isDualCapturing && audioMixer) {
      audioMixer.setMicMute(isMuted)
    }
  },
  onToggleSystemMute: (isMuted: boolean) => {
    if (isDualCapturing && audioMixer) {
      audioMixer.setSystemMute(isMuted)
    }
  }
})

// Initialize Settings and Device list
initSettings()
refreshAudioDevices()

if (navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener('devicechange', () => {
    console.log('[Conversate] Audio devices changed. Refreshing device list...')
    refreshAudioDevices()
  })
}

// Global App Alert Listener
if (window.electronAPI?.onAppAlert) {
  window.electronAPI.onAppAlert((msg: string) => {
    console.warn('[Conversate] System alert received:', msg)
    addSystemAlert(msg)
  })
}

// Initialize Local WebSocket Client
const wsClient = new ConversateWSClient(WS_URL, {
  onReady: (msg) => {
    setStatus('listening', 'Connected to Engine')
    console.log('[Conversate] Backend ready:', msg)
  },
  onStt: (update) => {
    currentFinalText = update.finalText
    currentInterimText = update.interimText
    updateTranscript(currentFinalText, currentInterimText)
    scheduleGlassesRender()
  },
  onCue: (cue) => {
    console.log('[Conversate] Received AI Cue:', cue)
    activeCue = cue
    sessionCues.push(cue)
    addCueCard(cue)
    scheduleGlassesRender()
  },
  onCueDismissed: () => {
    activeCue = null
    scheduleGlassesRender()
  },
  onSummary: (report: SummaryReport) => {
    console.log('[Conversate] Received Summary Report from WS:', report)
    setStatus('summarized', 'Summary Generated')
    renderSummaryReportContent(report.markdown, report.summaryPath, (report as any).fileName)
  },
  onError: (err) => {
    setStatus('error', `Backend: ${err}`)
    addSystemAlert(`Backend: ${err}`)
  }
})

// Initialize Even Hub Bridge for G2 glasses (if connected)
let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>> | null = null

try {
  bridge = await waitForEvenAppBridge()

  const hudContainer = new TextContainerProperty({
    xPosition: 0,
    yPosition: 0,
    width: 576,
    height: 288,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: 1,
    containerName: 'conversate_hud',
    content: generateHudContent(),
    isEventCapture: 1
  })

  const created = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({ containerTotalNum: 1, textObject: [hudContainer] })
  )

  if (created === 0) {
    console.log('[Conversate] Successfully created G2 HUD page container.')
    await bridge.audioControl(true)
    setStatus('listening', 'G2 Smart Glasses connected · Ready')
  }

  function eventTypeOf(envelope?: { eventType?: OsEventTypeList }): OsEventTypeList | null {
    if (!envelope) return null
    return envelope.eventType ?? OsEventTypeList.CLICK_EVENT
  }

  bridge.onEvenHubEvent((event) => {
    const pcm = event.audioEvent?.audioPcm
    if (pcm) {
      wsClient.sendPcm(pcm)
    }

    const sysType = eventTypeOf(event.sysEvent)
    const textType = eventTypeOf(event.textEvent)

    if (sysType === OsEventTypeList.DOUBLE_CLICK_EVENT || textType === OsEventTypeList.DOUBLE_CLICK_EVENT) {
      handleStopAndGenerateSummary()
      return
    }

    if (sysType === OsEventTypeList.CLICK_EVENT || textType === OsEventTypeList.CLICK_EVENT) {
      if (activeCue) {
        handleDismissCue()
      } else {
        handleToggleDualCapture()
      }
      return
    }

    if (sysType === OsEventTypeList.SYSTEM_EXIT_EVENT || sysType === OsEventTypeList.ABNORMAL_EXIT_EVENT) {
      stopVuMeter()
      if (audioMixer) audioMixer.stop()
      wsClient.close()
    }
  })
} catch (err) {
  console.log('[Conversate] Running in Desktop Mode')
  setStatus('listening', 'Desktop Mode · Local Engine Ready')
  scheduleGlassesRender()
}

window.addEventListener('beforeunload', () => {
  stopVuMeter()
  if (audioMixer) audioMixer.stop()
  wsClient.close()
})
