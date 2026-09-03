<p align="center">
  <img src="resources/Conversate.png" width="128" alt="Conversate Logo">
</p>

# Conversate

*Live Speech Intelligence & Proactive Context for macOS*

## Overview

Conversate is a native macOS utility designed to act as your real-time conversational co-pilot. Whether you are in a remote meeting, conducting an interview, or listening to a live stream, Conversate captures dual-channel audio (your microphone and the system's internal loopback) to generate a live, speaker-diarized transcript. Beyond simple speech-to-text, it leverages a sliding window of context to feed proactive visual cues to your screen and compiles highly structured, grammatically polished summaries the moment your session ends.

## The End Product: Key Features

* 🎙️ **Native Dual Audio Capture:** Seamlessly routes local microphone input and macOS system loopback simultaneously, with zero third-party virtual audio cables required.
* ⚡ **Live Speaker Diarization:** Lightning-fast, real-time speech-to-text with automatic speaker detection, powered by a persistent Deepgram WebSocket connection.
* 🧠 **Proactive Context Cues:** A background engine analyzes the rolling transcript every few seconds, surfacing relevant concepts, entity bios, or quick answers on the fly without user prompting.
* 🌐 **Universal AI Support:** Provider-agnostic LLM architecture. Connect to Google Gemini, or switch to any OpenAI-compatible endpoint (Groq, OpenRouter, or local models via LM Studio/Ollama) using built-in presets.
* 📝 **Intelligent Logging & Export:** Raw, unpunctuated speech is automatically processed into properly capitalized, formatted prose. Sessions are saved locally as Markdown logs with one-click PDF export.
* 🌗 **Polished macOS UI:** Built with Electron and Vite, featuring dynamic layout modules, a non-intrusive notification drawer, and native Light/Dark mode integration.

## Development History

Conversate began as an experiment in AI-assisted prototyping and vibe coding—a push to see how quickly complex local hardware APIs (like Web Audio) could be securely bridged with real-time cloud intelligence.

The initial builds focused strictly on overcoming the hurdles of dual-audio stream mixing and keeping WebSocket connections stable during live speech. As the transcription pipeline solidified, the focus shifted to intelligence. Early integrations with Gemini were aggressive, immediately hitting strict 15-requests-per-minute rate limits as the app attempted to analyze every spoken sentence.

This bottleneck drove the architectural pivot that defines the final product: an intelligent local pre-flight heuristic that only queries the AI when actual context is needed, paired with a universal LLM selector. This allowed the app to dynamically switch away from strict free-tiers to blazing-fast, open-weight models on Groq (like Llama 3) for zero-latency proactive cues. Through iterative refinement of prompt engineering, local audio muting, and error-handling, Conversate evolved from a simple transcription logger into a highly resilient, modular desktop utility.

## Getting Started

### Prerequisites

To run Conversate locally, you will need to configure your own API keys on first launch:

1. **Deepgram API Key:** Required for live speech-to-text WebSocket streaming.
2. **LLM Provider Key:** A Google Gemini API key, a Groq API key, or any OpenAI-compatible base URL/Key combo for proactive cues and summaries.

### 🔑 How to Get Your API Keys

Conversate requires you to provide your own API keys. All keys are stored securely and exclusively on your local machine. 

#### 1. Deepgram (Required for Live Audio Transcription)
Deepgram handles the real-time speech-to-text and multi-speaker diarization.
* Go to the [Deepgram Console](https://console.deepgram.com/) and create a free account (includes starting credits).
* Navigate to **API Keys** on the left sidebar.
* Click **Create a New API Key**, name it "Conversate", and copy the generated key.

#### 2. AI Provider (Required for Proactive Cues & Summaries)
You only need **one** of the following LLM providers. Groq is highly recommended for its zero-latency open-weight models, which are ideal for real-time proactive cues.

* **Groq (Recommended - Lightning Fast)**
  * Go to the [GroqCloud Console](https://console.groq.com/keys).
  * Sign in and click **Create API Key**.
  * In Conversate, select the **Groq** preset and paste your key.

* **Google Gemini (Alternative)**
  * Go to [Google AI Studio](https://aistudio.google.com/app/apikey).
  * Click **Create API Key** and generate one for a new or existing project.
  * In Conversate, select the **Google Gemini** preset and paste your key.

* **OpenRouter (Alternative)**
  * Go to [OpenRouter Keys](https://openrouter.ai/keys).
  * Click **Create Key**. 
  * In Conversate, select the **OpenRouter** preset and paste your key.

### Installation
1. Navigate to the [Releases](https://github.com/NobodyHome298/conversate/releases) page on GitHub.
2. Download the latest macOS `.dmg` file.
3. Open the downloaded file and drag **Conversate** into your Applications folder.
4. Launch the app and configure your API keys in the Settings menu to begin capturing.

## Data Privacy

Conversate operates entirely on your local machine. Audio is streamed directly to Deepgram for transcription, and context is routed exclusively to your configured AI provider. No conversation data, logs, or API keys are stored on external servers or databases outside of your local macOS `~/Documents/Conversate` directory.
