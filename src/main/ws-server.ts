/**
 * Embedded WebSocket Server for Conversate macOS App.
 * Handles:
 * 1. Local WebSocket streaming on port 8000 (/ws/stream)
 * 2. Strict Deepgram Live WebSocket (model=nova-2&diarize=true) with 10s KeepAlive pings
 * 3. 1000ms TLS Teardown Delays & Automatic ECONNRESET Reconnection
 * 4. Speaker Tagging (Speaker 0, Speaker 1, etc.)
 * 5. 5-second sliding-window LLM proactive context cues with local pre-flight heuristic filter & 8s cooldown
 * 6. Dual AI Engine Provider: Google Gemini & Universal OpenAI-Compatible (Groq, OpenRouter, Local, etc.)
 * 7. Post-conversation Map-Reduce summary with consecutive speaker grouping & dynamic TITLE parsing
 * 8. Session reset, STT re-establishment, and error alert forwarding
 */

import { WebSocketServer, WebSocket } from 'ws'
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as dotenv from 'dotenv'
import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'

dotenv.config()

export interface AICue {
  type: 'Concept' | 'Bio' | 'Answer' | null
  text: string
  timestamp?: string
}

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

export interface SummaryPayload {
  transcript?: string
  cues?: AICue[]
}

export interface SummaryResult {
  summaryPath: string
  markdown: string
  fileName: string
}

const HUD_CUE_SYSTEM_PROMPT = `You are "Conversate", an ultra-low-latency real-time AI assistant for macOS and Even Realities G2 smart glasses.
You are monitoring a live conversation transcript with speaker diarization tags (e.g. "Speaker 0: ...", "Speaker 1: ...").

Key Instructions:
1. SPEAKER NAME INFERENCE: Analyze conversational clues, introductions, and greetings to infer the actual names of "Speaker 0", "Speaker 1", etc. Use their real inferred names in cues whenever applicable.
2. PROACTIVE CUE RULES: ONLY produce a cue if there is high-value context:
   - "Concept": A technical term, acronym, jargon, product, or company mentioned (e.g., "EBITDA: Earnings Before Interest, Taxes, Depreciation", "RAG: Retrieval-Augmented Generation for LLMs").
   - "Bio": A person's role, company, or background when named (e.g., "Demis Hassabis: CEO of Google DeepMind, Nobel laureate").
   - "Answer": A fast, direct factual answer to an explicit or implicit question asked in conversation (e.g., "Q: When is Q3 ending? -> Ends September 30th").
   - null: Output null if the current dialogue is casual chit-chat, greetings, incomplete thought, or nothing requires a HUD cue. NEVER spam the wearer!
3. The "text" field MUST BE UNDER 15 WORDS. Concise, glanceable, ultra-clear.
4. OUTPUT STRICT JSON ONLY with this exact schema:
{
  "type": "Concept" | "Bio" | "Answer" | null,
  "text": "The short text to display (under 15 words)"
}
Do not include markdown code blocks or extra text. Output valid JSON.`

const SUMMARY_SYSTEM_PROMPT = `You are an executive assistant analyzing a complete transcript from a meeting/conversation captured with speaker diarization and proactive AI cues.
Infer the actual identities of the participants (Speaker 0, Speaker 1, etc.) from dialogue and greetings where possible.

You MUST start your entire response with a short, highly descriptive title of the conversation on the very first line. The title must be a maximum of 5 words. Format it exactly as: TITLE: [Your Title Here]. Do not use markdown for the title line. The rest of your response will be the markdown summary.

You must end the summary with a section titled "## 📝 Raw Transcript".

TASK: Convert the raw transcript into standard, published prose.
- Insert periods, commas, and question marks where natural pauses and sentences occur.
- Capitalize the first letter of every sentence and all proper nouns (names of people, cities, landmarks like Paris Catacombs, etc.).
- Group consecutive thoughts from the same speaker into readable paragraphs under "**Speaker X:** ".
- Preserve every spoken word in its original spoken order, but ensure punctuation and casing follow standard English grammar.

Example Input:
Speaker 0: exploring the dark corridors known as the paris catacombs the footage shows
Example Output:
**Speaker 0:** Exploring the dark corridors known as the Paris Catacombs, the footage shows...

Report Structure:
# 🎙️ Conversation Summary & Action Items
**Date & Time:** {timestamp}
**Total Words:** {word_count} words

## 👥 Participants
- Speaker 0 (Inferred Name / Role)
- Speaker 1 (Inferred Name / Role)

## 📋 Executive Overview
A concise summary of the core discussion and outcomes.

## 💡 Proactive Cues Triggered
- Format each provided proactive cue as: "- **[{type}]** {text}"
(If no cues were triggered, output "- No proactive cues triggered during this session.")

## 🔑 Key Discussion Topics & Decisions
- Bulleted list of primary topics, debates, and decisions reached.

## ✅ Action Items & Next Steps
- [ ] Task 1 (Assignee if identified)
- [ ] Task 2
- [ ] Task 3

## 🧠 Entities & Concepts Referenced
- Summary of key people, companies, tools, or concepts discussed.`

/**
 * Resilient API caller wrapper to gracefully handle undici socket drops & network blips
 */
async function fetchWithRetry<T>(apiCall: () => Promise<T>, retries = 3): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await apiCall()
    } catch (err) {
      if (i === retries - 1) throw err
      console.warn(`[Conversate API] API call failed (attempt ${i + 1}/${retries}), retrying in 1s...`, err)
      await new Promise((res) => setTimeout(res, 1000))
    }
  }
  throw new Error('fetchWithRetry failed after max retries')
}

export class ConversateServer {
  private wss: WebSocketServer | null = null
  private port: number = 8000
  private geminiClient: GoogleGenAI | null = null
  private universalClient: OpenAI | null = null
  private logsDir: string
  private apiKeys: AppApiKeys = {}
  private deepgramSocket: WebSocket | null = null
  private dgConnectTimer: NodeJS.Timeout | null = null
  private dgKeepAliveTimer: NodeJS.Timeout | null = null
  private hasAttemptedReconnect = false
  public onAlert?: (msg: string) => void

  // Active conversation state
  private fullTranscript: string[] = []
  private recentBuffer: string[] = []
  private lastGeminiCallTime: number = 0
  private activeClients: Set<WebSocket> = new Set()
  private slidingInterval: NodeJS.Timeout | null = null

  constructor(port: number = 8000, initialKeys: AppApiKeys = {}, onAlert?: (msg: string) => void) {
    this.port = port
    this.apiKeys = initialKeys
    this.onAlert = onAlert

    const docsPath = app.getPath('documents')
    this.logsDir = path.join(docsPath, 'Conversate', 'logs')
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true })
    }

    this.initClients()
    const dgKey = this.getDeepgramKey()
    if (dgKey) {
      this.startDeepgramLive(dgKey)
    }
    this.setupLlmInterval()
  }

  public getLogsDir(): string {
    return this.logsDir
  }

  public resetSession() {
    console.log('[ConversateServer] Resetting session state and re-establishing STT connection...')
    this.fullTranscript = []
    this.recentBuffer = []
    this.lastGeminiCallTime = 0

    const dgKey = this.getDeepgramKey()
    if (dgKey) {
      this.startDeepgramLive(dgKey)
    }
  }

  public reloadKeys(newKeys: AppApiKeys) {
    console.log('[ConversateServer] Reloading API keys and reinitializing services...')
    this.apiKeys = { ...this.apiKeys, ...newKeys }
    // Clear cooldown timer so new provider is not throttled by old rate limit hits
    this.lastGeminiCallTime = 0
    this.initClients()
    const dgKey = this.getDeepgramKey()
    if (dgKey) {
      this.startDeepgramLive(dgKey)
    }
    this.setupLlmInterval()
  }

  private initClients() {
    this.initGemini()
    this.initUniversal()
  }

  private getDeepgramKey(): string {
    return this.apiKeys.deepgram || this.apiKeys.deepgramApiKey || process.env.DEEPGRAM_API_KEY || ''
  }

  private getGeminiKey(): string {
    return this.apiKeys.gemini || this.apiKeys.geminiApiKey || this.apiKeys.llm || process.env.GEMINI_API_KEY || ''
  }

  private getUniversalApiKey(): string {
    return (
      this.apiKeys.uniApiKey ||
      this.apiKeys.groqKey ||
      this.apiKeys.openaiApiKey ||
      process.env.OPENAI_API_KEY ||
      process.env.GROQ_API_KEY ||
      ''
    )
  }

  private getUniversalBaseUrl(): string {
    const customUrl = (this.apiKeys.uniBaseUrl || process.env.OPENAI_BASE_URL || '').trim()
    return customUrl || 'https://api.groq.com/openai/v1'
  }

  private getUniversalModelId(): string {
    const customModel = (this.apiKeys.uniModelId || process.env.OPENAI_MODEL_ID || '').trim()
    return customModel || 'llama-3.1-8b-instant'
  }

  private getActiveProvider(): 'gemini' | 'universal' | 'groq' {
    return this.apiKeys.aiProvider || 'gemini'
  }

  private getActiveModel(): string {
    return this.apiKeys.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.6-flash'
  }

  /**
   * Pre-flight heuristic filter for sliding-window context buffer:
   * 1. Strips out "Speaker X:" prefixes before evaluating.
   * 2. Returns false if remaining textBuffer is under 8 words.
   * 3. Returns true if textBuffer contains '?' (likely needs an Answer cue).
   * 4. Returns true if it contains capitalized words mid-sentence (likely an entity / concept).
   * 5. Returns false otherwise.
   */
  private shouldExtractCue(textBuffer: string): boolean {
    if (!textBuffer) return false
    const cleaned = textBuffer.replace(/Speaker \d+:\s*/gi, '').trim()
    const words = cleaned.split(/\s+/).filter(Boolean)

    if (words.length < 8) {
      return false
    }

    if (cleaned.includes('?')) {
      return true
    }

    // Check for capitalized word mid-sentence (entity / concept)
    if (/(?<!^\s)[A-Z][a-z]+/.test(cleaned)) {
      return true
    }

    return false
  }

  private setupLlmInterval() {
    if (this.slidingInterval) {
      console.log('[ConversateServer] Clearing existing sliding-window LLM interval.')
      clearInterval(this.slidingInterval)
      this.slidingInterval = null
    }

    this.slidingInterval = setInterval(async () => {
      // Check if Proactive Cues module is enabled
      if (this.apiKeys.enableCues === false) {
        return
      }

      // Free-tier rate limit cooldown: enforce at least 8000ms between calls
      const now = Date.now()
      if (now - this.lastGeminiCallTime < 8000) {
        return
      }

      const recentContext = this.recentBuffer.join('\n').trim()
      if (!recentContext) {
        return
      }

      // Check pre-flight heuristic
      if (!this.shouldExtractCue(recentContext)) {
        // Leave recentBuffer intact to accumulate more conversational context
        return
      }

      // Pre-flight passed and cooldown satisfied: dispatch LLM call and clear buffer
      this.lastGeminiCallTime = Date.now()
      const bufferToAnalyze = recentContext
      this.recentBuffer = []

      const fullContext = this.fullTranscript.join('\n')
      const cue = await this.extractCue(bufferToAnalyze, fullContext)

      if (cue && cue.type && cue.text) {
        console.log(`[ConversateServer] Emitting Proactive Cue: [${cue.type}] ${cue.text}`)
        this.broadcastJson({
          event: 'cue',
          type: cue.type,
          text: cue.text,
          timestamp: new Date().toISOString()
        })
      }
    }, 5000)
  }

  private stopDgKeepAlive() {
    if (this.dgKeepAliveTimer) {
      clearInterval(this.dgKeepAliveTimer)
      this.dgKeepAliveTimer = null
    }
  }

  /**
   * Dedicated Deepgram Live WebSocket with strict query parameters:
   * wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&model=nova-2&diarize=true
   * and 10-second KeepAlive pings.
   */
  public startDeepgramLive(apiKey: string) {
    if (!apiKey || typeof apiKey !== 'string') {
      console.warn('[STT] Cannot start Deepgram Live: empty or invalid API key.')
      return
    }

    this.stopDgKeepAlive()

    if (this.dgConnectTimer) {
      clearTimeout(this.dgConnectTimer)
      this.dgConnectTimer = null
    }

    if (this.deepgramSocket) {
      try {
        console.log('[STT] Closing existing Deepgram WebSocket before reconnection...')
        this.deepgramSocket.removeAllListeners()
        this.deepgramSocket.close()
      } catch (err) {
        console.warn('[STT] Error closing previous Deepgram socket:', err)
      }
      this.deepgramSocket = null
    }

    const dgUrl = 'wss://api.deepgram.com/v1/listen?encoding=linear16&sample_rate=16000&channels=1&model=nova-2&diarize=true'

    this.dgConnectTimer = setTimeout(() => {
      this.dgConnectTimer = null
      try {
        console.log('[STT] Initializing Deepgram Live connection (model: nova-2, diarize: true)...')
        this.deepgramSocket = new WebSocket(dgUrl, {
          headers: {
            Authorization: `Token ${apiKey.trim()}`
          }
        })

        this.deepgramSocket.on('open', () => {
          console.log('[STT] Connected to Deepgram Live')
          this.hasAttemptedReconnect = false
          this.broadcastJson({
            event: 'status',
            message: 'Connected to Deepgram Live STT (nova-2 + Diarization)'
          })

          // Start 10-second KeepAlive interval to prevent code 1011 timeout
          this.stopDgKeepAlive()
          this.dgKeepAliveTimer = setInterval(() => {
            if (this.deepgramSocket && this.deepgramSocket.readyState === WebSocket.OPEN) {
              try {
                this.deepgramSocket.send(JSON.stringify({ type: 'KeepAlive' }))
              } catch (e) {
                console.warn('[STT] Failed to send KeepAlive ping:', e)
              }
            }
          }, 10000)
        })

        this.deepgramSocket.on('message', (data: any) => {
          try {
            const resp = JSON.parse(data.toString())
            const alternatives = resp.channel?.alternatives || []
            if (alternatives.length > 0) {
              const alt = alternatives[0]
              let transcriptText = (alt.transcript || '').trim()
              const isFinal = Boolean(resp.is_final || resp.speech_final)
              const words = alt.words || []

              if (transcriptText) {
                let speakerTag = ''
                if (words.length > 0 && typeof words[0].speaker === 'number') {
                  speakerTag = `Speaker ${words[0].speaker}: `
                }

                const formattedText = speakerTag ? `${speakerTag}${transcriptText}` : transcriptText

                if (isFinal) {
                  this.fullTranscript.push(formattedText)
                  this.recentBuffer.push(formattedText)
                }

                const fullText = this.fullTranscript.join('\n')

                this.broadcastJson({
                  type: 'transcript',
                  text: formattedText,
                  isFinal: isFinal,
                  finalText: fullText
                })

                this.broadcastJson({
                  event: 'stt',
                  finalText: fullText,
                  interimText: isFinal ? '' : formattedText,
                  isFinal: isFinal
                })
              }
            }
          } catch (err) {
            console.error('[STT] Error parsing Deepgram response JSON:', err)
          }
        })

        this.deepgramSocket.on('error', (err: any) => {
          const errMsg = `Deepgram STT error: ${err?.message || String(err)}`
          console.error('[STT]', errMsg)
          this.stopDgKeepAlive()
          this.broadcastJson({
            event: 'error',
            message: errMsg
          })
          this.onAlert?.(errMsg)

          // Automatic ECONNRESET recovery
          if ((err?.code === 'ECONNRESET' || String(err).includes('ECONNRESET')) && !this.hasAttemptedReconnect) {
            console.log('[STT] ECONNRESET detected. Attempting automatic reconnection in 2000ms...')
            this.hasAttemptedReconnect = true
            setTimeout(() => {
              this.startDeepgramLive(apiKey)
            }, 2000)
          }
        })

        this.deepgramSocket.on('close', (code, reason) => {
          console.log(`[STT] Deepgram WebSocket closed (code: ${code}, reason: ${reason?.toString() || 'none'})`)
          this.stopDgKeepAlive()
        })
      } catch (err) {
        const errMsg = `Failed to establish Deepgram connection: ${err instanceof Error ? err.message : String(err)}`
        console.error('[STT]', errMsg)
        this.stopDgKeepAlive()
        this.onAlert?.(errMsg)
      }
    }, 1000)
  }

  private broadcastJson(payload: any) {
    const raw = JSON.stringify(payload)
    for (const client of this.activeClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(raw)
      }
    }
  }

  private initGemini() {
    const apiKey = this.getGeminiKey()
    if (apiKey) {
      try {
        this.geminiClient = new GoogleGenAI({ apiKey })
        console.log('[ConversateServer] Google GenAI initialized successfully with configured key.')
      } catch (e: any) {
        const errMsg = `Could not initialize Google GenAI: ${e?.message || String(e)}`
        console.warn('[ConversateServer]', errMsg)
        this.geminiClient = null
        this.onAlert?.(errMsg)
      }
    } else {
      this.geminiClient = null
    }
  }

  private initUniversal() {
    const apiKey = this.getUniversalApiKey()
    const baseURL = this.getUniversalBaseUrl()
    try {
      this.universalClient = new OpenAI({
        apiKey: apiKey ? apiKey.trim() : 'dummy-key',
        baseURL: baseURL ? baseURL.trim() : 'https://api.groq.com/openai/v1'
      })
      console.log(`[ConversateServer] Universal OpenAI client initialized with Base URL: ${baseURL}`)
    } catch (e: any) {
      const errMsg = `Could not initialize Universal OpenAI client: ${e?.message || String(e)}`
      console.warn('[ConversateServer]', errMsg)
      this.universalClient = null
      this.onAlert?.(errMsg)
    }
  }

  public start() {
    this.wss = new WebSocketServer({ port: this.port })
    console.log(`[ConversateServer] WebSocket server running on ws://127.0.0.1:${this.port}`)

    this.wss.on('connection', (clientWs: WebSocket) => {
      console.log('[ConversateServer] Client connected to local WebSocket.')
      this.activeClients.add(clientWs)

      clientWs.send(
        JSON.stringify({
          event: 'ready',
          message: 'Connected to Conversate macOS Native Backend'
        })
      )

      if (this.fullTranscript.length > 0) {
        clientWs.send(
          JSON.stringify({
            event: 'stt',
            finalText: this.fullTranscript.join('\n'),
            interimText: '',
            isFinal: true
          })
        )
      }

      clientWs.on('message', async (data: any, isBinary: boolean) => {
        if (isBinary) {
          if (this.deepgramSocket && this.deepgramSocket.readyState === WebSocket.OPEN) {
            this.deepgramSocket.send(data)
          }
        } else {
          try {
            const payload = JSON.parse(data.toString())
            const action = payload.action

            if (action === 'dismiss') {
              console.log('[ConversateServer] Wearer dismissed active cue.')
              this.broadcastJson({ event: 'cue_dismissed' })
            } else if (action === 'text_input') {
              const text = (payload.text || '').trim()
              if (text) {
                this.fullTranscript.push(text)
                this.recentBuffer.push(text)
                const fullText = this.fullTranscript.join('\n')
                this.broadcastJson({
                  type: 'transcript',
                  text: text,
                  isFinal: true,
                  finalText: fullText
                })
                this.broadcastJson({
                  event: 'stt',
                  finalText: fullText,
                  interimText: '',
                  isFinal: true
                })
              }
            } else if (action === 'stop_and_summarize') {
              console.log('[ConversateServer] Stopping session and generating summary report...')
              const fullText = this.fullTranscript.join('\n')
              const { summaryPath, markdown, fileName } = await this.generateSummary(fullText, payload.cues)
              this.broadcastJson({
                event: 'summary',
                summaryPath,
                markdown,
                fileName
              })
            } else if (action === 'reset_transcript') {
              console.log('[ConversateServer] Resetting transcript session buffer.')
              this.resetSession()
            } else if (action === 'ping') {
              if (clientWs.readyState === WebSocket.OPEN) {
                clientWs.send(JSON.stringify({ event: 'pong' }))
              }
            }
          } catch (e) {
            console.warn('[ConversateServer] Received invalid control JSON:', data.toString())
          }
        }
      })

      clientWs.on('close', () => {
        console.log('[ConversateServer] Client disconnected.')
        this.activeClients.delete(clientWs)
      })
    })
  }

  private async extractCue(recentContext: string, fullContext: string): Promise<AICue | null> {
    if (!recentContext.trim()) return null

    const prompt = `Recent speech dialogue with speaker tags:
"""${recentContext}"""

Full conversation transcript:
"""${fullContext.slice(-2000)}"""

Analyze speaker names and conversation context, and return the JSON cue:`

    const provider = this.getActiveProvider()
    const isUniversal = provider === 'universal' || provider === 'groq'

    // 1. Universal OpenAI-Compatible Engine (Groq, OpenRouter, Local, etc.)
    if (isUniversal && this.universalClient) {
      try {
        const model = this.getUniversalModelId()
        const response = await fetchWithRetry(async () => {
          return await this.universalClient!.chat.completions.create({
            model,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: HUD_CUE_SYSTEM_PROMPT },
              { role: 'user', content: prompt }
            ]
          })
        }, 3)

        const raw = response.choices[0]?.message?.content || ''
        return this.parseCueJson(raw)
      } catch (e: any) {
        const errMsg = `Universal LLM cue generation error (${this.getUniversalModelId()}): ${e?.message || String(e)}`
        console.error('[ConversateServer]', errMsg)
        this.onAlert?.(errMsg)
      }
    }

    // 2. Google Gemini Engine
    if (this.geminiClient) {
      try {
        const activeModel = this.getActiveModel()
        const response = await fetchWithRetry(async () => {
          return await this.geminiClient!.models.generateContent({
            model: activeModel,
            contents: [HUD_CUE_SYSTEM_PROMPT, prompt],
            config: { responseMimeType: 'application/json' }
          })
        }, 3)

        const raw = response.text || ''
        return this.parseCueJson(raw)
      } catch (e: any) {
        const errMsg = `Gemini cue generation error (${this.getActiveModel()}): ${e?.message || String(e)}`
        console.error('[ConversateServer]', errMsg)
        this.onAlert?.(errMsg)
      }
    }

    return null
  }

  private parseCueJson(raw: string): AICue | null {
    try {
      const cleaned = raw.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim()
      const parsed = JSON.parse(cleaned)
      if (['Concept', 'Bio', 'Answer'].includes(parsed.type) && parsed.text) {
        const words = parsed.text.trim().split(/\s+/)
        const text = words.length > 15 ? words.slice(0, 15).join(' ') + '…' : words.join(' ')
        return { type: parsed.type, text }
      }
    } catch {}
    return null
  }

  /**
   * Public helper called by IPC 'generate-summary' accepting transcript and cues
   */
  public async generateSummaryReport(payload?: SummaryPayload): Promise<SummaryResult> {
    const text = (payload?.transcript && payload.transcript.trim()) || this.fullTranscript.join('\n')
    const cues = payload?.cues || []
    return await this.generateSummary(text, cues)
  }

  private async generateSummary(fullTranscript: string, sessionCues: AICue[] = []): Promise<SummaryResult> {
    const readableTime = new Date().toLocaleString()
    const wordCount = fullTranscript ? fullTranscript.split(/\s+/).length : 0

    // Format cues for prompt
    let cuesSummaryText = ''
    if (sessionCues.length > 0) {
      cuesSummaryText = sessionCues
        .filter((c) => c && c.type && c.text)
        .map((c) => `- **[${c.type}]** ${c.text}`)
        .join('\n')
    }

    // Programmatically merge consecutive speaker utterances into paragraph blocks
    const rawLines = fullTranscript.split('\n').map((l) => l.trim()).filter(Boolean)
    const grouped: Array<{ speaker: string; text: string }> = []

    for (const rawLine of rawLines) {
      const match = rawLine.match(/^(Speaker \d+):\s*(.*)$/i)
      const speaker = match ? match[1] : 'Speaker 0'
      const text = match ? match[2].trim() : rawLine.trim()
      if (!text) continue

      if (grouped.length > 0 && grouped[grouped.length - 1].speaker === speaker) {
        grouped[grouped.length - 1].text += ' ' + text
      } else {
        grouped.push({ speaker, text })
      }
    }

    const rawTranscriptContext = grouped
      .map((g) => `${g.speaker}: ${g.text}`)
      .join('\n\n')

    const formattedTranscript = grouped
      .map((g) => `**${g.speaker}**: ${g.text}`)
      .join('\n\n')

    let llmSummaryResponse = ''
    const prompt = `Transcript with speaker tags:\n"""${rawTranscriptContext || fullTranscript}"""\n\nProactive Cues triggered during this session:\n"""${cuesSummaryText || '(None)'}"""\n\nRemember to start your response with TITLE: [Max 5 Words] on line 1, then generate the markdown summary.`
    const provider = this.getActiveProvider()
    const isUniversal = provider === 'universal' || provider === 'groq'

    // 1. Universal OpenAI-Compatible Engine (Groq, OpenRouter, Local, etc.)
    if (isUniversal && this.universalClient && fullTranscript.trim()) {
      try {
        const model = this.getUniversalModelId()
        const response = await fetchWithRetry(async () => {
          return await this.universalClient!.chat.completions.create({
            model,
            messages: [
              {
                role: 'system',
                content: SUMMARY_SYSTEM_PROMPT.replace('{timestamp}', readableTime).replace('{word_count}', String(wordCount))
              },
              { role: 'user', content: prompt }
            ]
          })
        }, 3)
        llmSummaryResponse = (response.choices[0]?.message?.content || '').trim()
      } catch (e: any) {
        const errMsg = `Universal LLM summary generation error (${this.getUniversalModelId()}): ${e?.message || String(e)}`
        console.error('[ConversateServer]', errMsg)
        this.onAlert?.(errMsg)
      }
    }

    // 2. Google Gemini Engine
    if (!llmSummaryResponse && this.geminiClient && fullTranscript.trim()) {
      try {
        const activeModel = this.getActiveModel()
        const response = await fetchWithRetry(async () => {
          return await this.geminiClient!.models.generateContent({
            model: activeModel,
            contents: [
              SUMMARY_SYSTEM_PROMPT.replace('{timestamp}', readableTime).replace('{word_count}', String(wordCount)),
              prompt
            ]
          })
        }, 3)
        llmSummaryResponse = (response.text || '').trim()
      } catch (e: any) {
        const errMsg = `Gemini summary generation error (${this.getActiveModel()}): ${e?.message || String(e)}`
        console.error('[ConversateServer]', errMsg)
        this.onAlert?.(errMsg)
      }
    }

    let title = 'Conversation Session'
    if (llmSummaryResponse) {
      const lines = llmSummaryResponse.split('\n')
      if (lines.length > 0 && lines[0].startsWith('TITLE:')) {
        title = lines[0].replace('TITLE:', '').trim().replace(/[^a-zA-Z0-9 -]/g, '')
        llmSummaryResponse = lines.slice(1).join('\n').trim()
      }
    }

    if (!llmSummaryResponse) {
      const cuesSection = cuesSummaryText
        ? cuesSummaryText
        : '- No proactive cues triggered during this session.'

      llmSummaryResponse = `# 🎙️ Conversation Summary & Action Items
**Date & Time:** ${readableTime}  
**Word Count:** ${wordCount} words  

## 📋 Executive Overview
Discussion recorded via Conversate on macOS with live speaker diarization.

## 💡 Proactive Cues Triggered
${cuesSection}

## 🔑 Key Discussion Topics
- Live microphone & macOS system loopback audio capture.
- Real-time Deepgram speech-to-text with multi-speaker diarization.
- Proactive AI visual cues emitted for key entities and terms.

## ✅ Action Items & Next Steps
- [ ] Review meeting points and follow up with participants.
- [ ] Verify action items created during conversation.`
    }

    // Use LLM-generated summary with intelligently punctuated and formatted Raw Transcript
    let finalMarkdown = llmSummaryResponse
    if (!finalMarkdown.includes('## 📝 Raw Transcript')) {
      finalMarkdown = `${llmSummaryResponse}\n\n## 📝 Raw Transcript\n\n${formattedTranscript || '(No audio recorded)'}`.trim()
    }

    // Capitalize after periods, question marks, or newlines as safety net
    finalMarkdown = finalMarkdown.replace(/(:\s*|\.\s+|\?\s+|\n\n)([a-z])/g, (_match, prefix, char) => {
      return prefix + char.toUpperCase()
    })

    const now = new Date()
    const dateString = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`
    const fileName = `Conversate Summary - ${title || 'Conversation'} ${dateString}`.trim()
    const summaryPath = path.join(this.logsDir, `${fileName}.md`)

    try {
      fs.writeFileSync(summaryPath, finalMarkdown, 'utf-8')
      console.log(`[ConversateServer] Summary saved to ${summaryPath}`)
    } catch (e) {
      console.error('[ConversateServer] Failed to write summary file:', e)
    }

    return { summaryPath, markdown: finalMarkdown, fileName }
  }

  public stop() {
    this.stopDgKeepAlive()
    if (this.dgConnectTimer) {
      clearTimeout(this.dgConnectTimer)
      this.dgConnectTimer = null
    }
    if (this.slidingInterval) {
      clearInterval(this.slidingInterval)
      this.slidingInterval = null
    }
    if (this.deepgramSocket) {
      try {
        this.deepgramSocket.close()
      } catch {}
      this.deepgramSocket = null
    }
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
  }
}
