/**
 * Conversate Renderer WebSocket Client
 * Connects to embedded WebSocket server on port 8000.
 */

export interface AICue {
  type: 'Concept' | 'Bio' | 'Answer'
  text: string
  timestamp?: string
}

export interface SttUpdate {
  finalText: string
  interimText: string
  isFinal: boolean
}

export interface SummaryReport {
  summaryPath: string
  markdown: string
}

export interface ConversateClientCallbacks {
  onReady?: (message: string) => void
  onStt?: (update: SttUpdate) => void
  onCue?: (cue: AICue) => void
  onCueDismissed?: () => void
  onSummary?: (report: SummaryReport) => void
  onError?: (error: string) => void
  onClose?: () => void
}

export class ConversateWSClient {
  private ws: WebSocket | null = null
  private url: string
  private callbacks: ConversateClientCallbacks
  private reconnectTimer: number | null = null
  private isClosedExplicitly = false

  constructor(url: string, callbacks: ConversateClientCallbacks) {
    this.url = url
    this.callbacks = callbacks
    this.connect()
  }

  private connect() {
    this.isClosedExplicitly = false
    try {
      this.ws = new WebSocket(this.url)
      this.ws.binaryType = 'arraybuffer'

      this.ws.onopen = () => {
        console.log('[ConversateWS] Connected to backend at', this.url)
      }

      this.ws.onmessage = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          try {
            const data = JSON.parse(event.data)
            this.handleJsonMessage(data)
          } catch (e) {
            console.warn('[ConversateWS] Failed to parse message:', event.data)
          }
        }
      }

      this.ws.onerror = (err: Event) => {
        console.error('[ConversateWS] WebSocket error:', err)
        this.callbacks.onError?.('WebSocket connection error')
      }

      this.ws.onclose = () => {
        console.log('[ConversateWS] Connection closed')
        this.callbacks.onClose?.()
        if (!this.isClosedExplicitly) {
          this.reconnectTimer = window.setTimeout(() => this.connect(), 2000)
        }
      }
    } catch (err) {
      console.error('[ConversateWS] Connection failed:', err)
      this.callbacks.onError?.(String(err))
    }
  }

  private handleJsonMessage(data: any) {
    // Handle structured transcript payload { type: 'transcript', text: string }
    if (data.type === 'transcript' && typeof data.text === 'string') {
      const isFinal = Boolean(data.isFinal)
      this.callbacks.onStt?.({
        finalText: data.finalText || (isFinal ? data.text : ''),
        interimText: isFinal ? '' : data.text,
        isFinal: isFinal
      })
      return
    }

    const event = data.event
    switch (event) {
      case 'ready':
        this.callbacks.onReady?.(data.message || 'Connected')
        break
      case 'stt':
        this.callbacks.onStt?.({
          finalText: data.finalText || '',
          interimText: data.interimText || '',
          isFinal: Boolean(data.isFinal)
        })
        break
      case 'cue':
        if (data.type && data.text) {
          this.callbacks.onCue?.({
            type: data.type,
            text: data.text,
            timestamp: data.timestamp
          })
        }
        break
      case 'cue_dismissed':
        this.callbacks.onCueDismissed?.()
        break
      case 'summary':
        this.callbacks.onSummary?.({
          summaryPath: data.summaryPath || '',
          markdown: data.markdown || ''
        })
        break
      case 'error':
        this.callbacks.onError?.(data.message || 'Unknown backend error')
        break
      default:
        break
    }
  }

  public sendPcm(chunk: Uint8Array) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk.buffer)
    }
  }

  public sendTextInput(text: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'text_input', text }))
    }
  }

  public dismissCue() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'dismiss' }))
    }
  }

  public stopAndSummarize() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'stop_and_summarize' }))
    }
  }

  public close() {
    this.isClosedExplicitly = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}
