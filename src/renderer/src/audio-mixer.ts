/**
 * DualAudioMixer
 * Captures user microphone and macOS system audio loopback simultaneously (or selectively),
 * mixes active audio streams with Web Audio API, and converts to Linear PCM s16le @ 16kHz mono.
 * Includes AnalyserNode for real-time visual level metering, hot-swappable mic selection,
 * and dynamic GainNodes for runtime muting/unmuting without stream disruption.
 */

export interface MixerStatus {
  isCapturing: boolean
  isMicActive: boolean
  isSystemActive: boolean
  currentDeviceId?: string
  error?: string
}

export interface CaptureOptions {
  enableMic?: boolean
  enableSystem?: boolean
}

export class DualAudioMixer {
  // Persistent node references to prevent garbage collection
  private audioCtx: AudioContext | null = null
  private micStream: MediaStream | null = null
  private systemStream: MediaStream | null = null
  private micSource: MediaStreamAudioSourceNode | null = null
  private systemSource: MediaStreamAudioSourceNode | null = null
  private micGainNode: GainNode | null = null
  private systemGainNode: GainNode | null = null
  private mixerDestination: MediaStreamAudioDestinationNode | null = null
  private mixedStreamSource: MediaStreamAudioSourceNode | null = null
  private scriptProcessor: ScriptProcessorNode | null = null
  private silenceGain: GainNode | null = null
  private analyser: AnalyserNode | null = null

  private onPcmCallback: ((chunk: Uint8Array) => void) | null = null
  private onStatusCallback: ((status: MixerStatus) => void) | null = null

  private isCapturing = false
  private currentDeviceId: string | undefined = undefined
  private lastLogTime = 0
  private loggedBytesCount = 0

  constructor(
    onPcm: (chunk: Uint8Array) => void,
    onStatus?: (status: MixerStatus) => void
  ) {
    this.onPcmCallback = onPcm
    this.onStatusCallback = onStatus || null
  }

  public async start(
    selectedDeviceId?: string,
    options: CaptureOptions = { enableMic: true, enableSystem: false }
  ): Promise<boolean> {
    if (this.isCapturing) return true

    const enableMic = options.enableMic !== false
    const enableSystem = options.enableSystem === true

    if (!enableMic && !enableSystem) {
      const err = 'Please select at least one audio input (Microphone or System Loopback).'
      console.warn('[DualAudioMixer]', err)
      if (this.onStatusCallback) {
        this.onStatusCallback({
          isCapturing: false,
          isMicActive: false,
          isSystemActive: false,
          error: err
        })
      }
      return false
    }

    try {
      this.currentDeviceId = selectedDeviceId
      console.log(`[DualAudioMixer] Starting Audio Capture (Mic: ${enableMic}, System: ${enableSystem}, Device: ${selectedDeviceId || 'Default'})...`)

      // 1. Capture Microphone if enabled
      if (enableMic) {
        const micConstraints: MediaStreamConstraints = {
          audio: selectedDeviceId
            ? {
                deviceId: { exact: selectedDeviceId },
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
            : {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
              }
        }

        try {
          this.micStream = await navigator.mediaDevices.getUserMedia(micConstraints)
          console.log('[DualAudioMixer] Microphone stream acquired successfully.')
        } catch (micErr) {
          console.error('[DualAudioMixer] Failed to acquire microphone:', micErr)
          throw micErr
        }
      }

      // 2. Capture System Audio via loopback if enabled
      if (enableSystem) {
        try {
          if (window.electronAPI?.enableLoopback) {
            await window.electronAPI.enableLoopback()
          } else if (window.api?.enableLoopback) {
            await window.api.enableLoopback()
          }

          // getDisplayMedia requires video: true for Chromium loopback handler
          this.systemStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
          })

          if (window.electronAPI?.disableLoopback) {
            await window.electronAPI.disableLoopback()
          } else if (window.api?.disableLoopback) {
            await window.api.disableLoopback()
          }

          // Remove video tracks to conserve CPU/RAM
          const videoTracks = this.systemStream.getVideoTracks()
          videoTracks.forEach((t) => {
            t.stop()
            this.systemStream?.removeTrack(t)
          })
          console.log('[DualAudioMixer] System loopback audio stream acquired.')
        } catch (sysErr) {
          console.warn('[DualAudioMixer] System audio loopback not granted or cancelled by user:', sysErr)
        }
      }

      // 3. Initialize AudioContext at 16,000 Hz
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext
      this.audioCtx = new AudioCtxClass({ sampleRate: 16000 })
      if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume()
      }

      // 4. Create mixing destination & AnalyserNode
      this.mixerDestination = this.audioCtx.createMediaStreamDestination()
      this.analyser = this.audioCtx.createAnalyser()
      this.analyser.fftSize = 256
      this.analyser.smoothingTimeConstant = 0.65

      // Create GainNodes for dynamic runtime muting/unmuting
      this.micGainNode = this.audioCtx.createGain()
      this.systemGainNode = this.audioCtx.createGain()

      // Route Microphone through micGainNode
      if (this.micStream && this.micStream.getAudioTracks().length > 0) {
        this.micSource = this.audioCtx.createMediaStreamSource(this.micStream)
        this.micSource.connect(this.micGainNode)
        this.micGainNode.connect(this.mixerDestination)
      }

      // Route System Loopback through systemGainNode
      if (this.systemStream && this.systemStream.getAudioTracks().length > 0) {
        this.systemSource = this.audioCtx.createMediaStreamSource(this.systemStream)
        this.systemSource.connect(this.systemGainNode)
        this.systemGainNode.connect(this.mixerDestination)
      }

      // 5. Connect mixed stream to Analyser and ScriptProcessor
      this.mixedStreamSource = this.audioCtx.createMediaStreamSource(this.mixerDestination.stream)
      this.mixedStreamSource.connect(this.analyser)

      // ScriptProcessor converts mixed Float32 audio to Linear PCM s16le @ 16kHz
      const bufferSize = 4096
      this.scriptProcessor = this.audioCtx.createScriptProcessor(bufferSize, 1, 1)

      // Feedback prevention: connect scriptProcessor to a zero-gain node before destination
      this.silenceGain = this.audioCtx.createGain()
      this.silenceGain.gain.value = 0

      this.mixedStreamSource.connect(this.scriptProcessor)
      this.scriptProcessor.connect(this.silenceGain)
      this.silenceGain.connect(this.audioCtx.destination)

      this.lastLogTime = Date.now()
      this.loggedBytesCount = 0

      this.scriptProcessor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!this.isCapturing) return
        const inputData = e.inputBuffer.getChannelData(0)
        const pcmData = this.float32ToInt16Pcm(inputData)

        if (this.onPcmCallback && pcmData.length > 0) {
          this.onPcmCallback(pcmData)
          this.loggedBytesCount += pcmData.byteLength
        }

        // Log non-zero audio pipeline delivery every 3 seconds
        const now = Date.now()
        if (now - this.lastLogTime >= 3000) {
          console.log(`[DualAudioMixer] Audio pipeline active: streamed ${this.loggedBytesCount} PCM bytes in last 3s.`)
          this.lastLogTime = now
          this.loggedBytesCount = 0
        }
      }

      this.isCapturing = true
      this.notifyStatus()
      return true
    } catch (err: any) {
      console.error('[DualAudioMixer] Failed to start audio mixer:', err)
      this.stop()
      if (this.onStatusCallback) {
        this.onStatusCallback({
          isCapturing: false,
          isMicActive: false,
          isSystemActive: false,
          error: err?.message || String(err)
        })
      }
      return false
    }
  }

  /**
   * Dynamically mute or unmute the microphone via its GainNode.
   */
  public setMicMute(isMuted: boolean): void {
    if (this.micGainNode) {
      this.micGainNode.gain.value = isMuted ? 0 : 1
      console.log(`[DualAudioMixer] Microphone mute set to: ${isMuted}`)
    }
  }

  /**
   * Dynamically mute or unmute the system loopback audio via its GainNode.
   */
  public setSystemMute(isMuted: boolean): void {
    if (this.systemGainNode) {
      this.systemGainNode.gain.value = isMuted ? 0 : 1
      console.log(`[DualAudioMixer] System Loopback mute set to: ${isMuted}`)
    }
  }

  /**
   * Dynamically hot-swap the microphone stream without interrupting the system loopback audio.
   */
  public async switchMicrophone(deviceId: string): Promise<boolean> {
    if (!this.isCapturing || !this.audioCtx || !this.mixerDestination) {
      this.currentDeviceId = deviceId
      return true
    }

    try {
      console.log(`[DualAudioMixer] Hot-swapping microphone to device ID: ${deviceId}...`)

      // Stop and disconnect old mic stream
      if (this.micSource) {
        this.micSource.disconnect()
        this.micSource = null
      }
      if (this.micStream) {
        this.micStream.getTracks().forEach((t) => t.stop())
        this.micStream = null
      }

      // Request new mic stream
      const constraints: MediaStreamConstraints = {
        audio: deviceId
          ? {
              deviceId: { exact: deviceId },
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          : true
      }

      this.micStream = await navigator.mediaDevices.getUserMedia(constraints)
      this.micSource = this.audioCtx.createMediaStreamSource(this.micStream)
      if (this.micGainNode) {
        this.micSource.connect(this.micGainNode)
      } else {
        this.micSource.connect(this.mixerDestination)
      }
      this.currentDeviceId = deviceId

      console.log('[DualAudioMixer] Microphone hot-swap completed.')
      this.notifyStatus()
      return true
    } catch (err) {
      console.error('[DualAudioMixer] Failed to switch microphone:', err)
      return false
    }
  }

  /**
   * Returns the AnalyserNode for real-time visual VU metering.
   */
  public getAnalyser(): AnalyserNode | null {
    return this.analyser
  }

  /**
   * Convert Float32 audio samples (-1.0 to 1.0) to 16-bit signed Linear PCM (s16le)
   */
  private float32ToInt16Pcm(input: Float32Array): Uint8Array {
    const int16 = new Int16Array(input.length)
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]))
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
    }
    return new Uint8Array(int16.buffer)
  }

  private notifyStatus() {
    if (this.onStatusCallback) {
      this.onStatusCallback({
        isCapturing: this.isCapturing,
        isMicActive: Boolean(this.micStream && this.micStream.getAudioTracks().some((t) => t.enabled)),
        isSystemActive: Boolean(this.systemStream && this.systemStream.getAudioTracks().some((t) => t.enabled)),
        currentDeviceId: this.currentDeviceId
      })
    }
  }

  public stop() {
    this.isCapturing = false

    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect()
      this.scriptProcessor = null
    }

    if (this.silenceGain) {
      this.silenceGain.disconnect()
      this.silenceGain = null
    }

    if (this.mixedStreamSource) {
      this.mixedStreamSource.disconnect()
      this.mixedStreamSource = null
    }

    if (this.analyser) {
      this.analyser.disconnect()
      this.analyser = null
    }

    if (this.micGainNode) {
      this.micGainNode.disconnect()
      this.micGainNode = null
    }

    if (this.systemGainNode) {
      this.systemGainNode.disconnect()
      this.systemGainNode = null
    }

    if (this.micSource) {
      this.micSource.disconnect()
      this.micSource = null
    }

    if (this.systemSource) {
      this.systemSource.disconnect()
      this.systemSource = null
    }

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop())
      this.micStream = null
    }

    if (this.systemStream) {
      this.systemStream.getTracks().forEach((t) => t.stop())
      this.systemStream = null
    }

    if (this.audioCtx) {
      this.audioCtx.close().catch(() => {})
      this.audioCtx = null
    }

    this.notifyStatus()
  }
}
