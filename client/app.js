// Enhanced Sanskrit Tutor App with Batch Scheduling + SequentialWebAudioStreamer
// Handles both streaming and non-streaming modes based on duration

import { CorrectedAudioStreamer } from './corrected-audio-streamer.js';
import { CONFIG } from './config.js';

class EnhancedSanskritTutorApp {
   constructor() {
    this.ws = null;
    this.audioHandler = null;
    this.audioStreamer = null; // RENAMED from batchStreamer
    this.isConnected = false;
    this.isListening = false;
    this.config = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.ttsPlaybackActive = false;
    this.allowBargeInImmediate = false;
    this.serverState = 'listening';
    
    console.log('🕉️ Enhanced Sanskrit Tutor App initialized');
  }


 // 3. REPLACE INITIALIZE METHOD - NO HARDCODING
  async initialize() {
		console.log('🚀 Initializing Enhanced Sanskrit Tutor App...');
		try {
		  const BACKEND_URL = CONFIG.getBaseURL();
		  const response = await fetch(`${BACKEND_URL}/config`);
		  if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`);
		  const config = await response.json();
		  this.config = config;
		  this.allowBargeInImmediate = config.allowBargeTTSPlaybackImmediate === true;

		  // Initialize audio handler
		  this.audioHandler = new AudioHandler();
		  this.audioHandler.setConfig(config);
		  this.audioHandler.onAudioData = (audioBlob) => this.sendAudioToServer(audioBlob);
		  
		  this.audioHandler.setOnSpeechValidatedCallback(() => {
			if (this.ttsPlaybackActive && this.allowBargeInImmediate) {
			  console.log("🛑 Speech validated – interrupting TTS");
			  this.stopTTSPlayback();
			}
		  });

		  // CORRECTED: Initialize with all required config from server - NO HARDCODING
		  const streamerConfig = {
			bufferThresholdMs: config.audioConfig.bufferThresholdMs, // From server
			websocketTimeoutMs: config.audioConfig.websocketTimeoutMs, // From server
			minStreamingDurationMs: config.audioConfig.minStreamingDurationMs // From server
			
		  };
		  
		  // Validate required config exists
		  if (!streamerConfig.bufferThresholdMs || !streamerConfig.websocketTimeoutMs || !streamerConfig.minStreamingDurationMs) {
			throw new Error('Missing required audio config from server: bufferThresholdMs, websocketTimeoutMs, minStreamingDurationMs');
		  }
		  
		  this.audioStreamer = new CorrectedAudioStreamer(
			streamerConfig,
			(msg, level = 'info') => console.log(`[AudioStreamer] ${msg}`)
		  );

		  // Setup event handlers
		  this.setupStreamerEventHandlers();

		  await this.initializeAudio();
		  console.log('✅ App initialization completed');
		} catch (error) {
		  console.error('❌ App initialization failed:', error);
		}
  }



   // 4. REPLACE EVENT HANDLERS - MODE-AWARE EVENTS
  setupStreamerEventHandlers() {
		this.audioStreamer.addEventListener('modeSet', (e) => {
		  const { isStreamingMode, estimatedDurationMs } = e.detail;
		  this.updateVoiceStatus(isStreamingMode ? 'Streaming mode...' : 'Download mode...');
		  console.log(`Mode set: ${isStreamingMode ? 'STREAMING' : 'BATCH'} (${estimatedDurationMs}ms)`);
		});

		this.audioStreamer.addEventListener('streamStarted', () => {
		  this.updateVoiceStatus('Collecting audio chunks...');
		});

		this.audioStreamer.addEventListener('bufferUpdate', (e) => {
		  const { chunksReceived, bufferDurationMs, mode } = e.detail;
		  const bufferSec = (bufferDurationMs / 1000).toFixed(1);
		  
		  if (mode === 'streaming') {
			this.updateVoiceStatus(`Streaming: ${chunksReceived} chunks (${bufferSec}s buffered)`);
		  } else if (mode === 'batch') {
			this.updateVoiceStatus(`Download mode: collecting ${chunksReceived} chunks (${bufferSec}s)`);
		  } else {
			this.updateVoiceStatus(`Collecting: ${chunksReceived} chunks (${bufferSec}s)`);
		  }
		});

		this.audioStreamer.addEventListener('playbackStarted', (e) => {
		  const { chunksCount, mode } = e.detail;
		  if (mode === 'batch') {
			this.updateVoiceStatus(`Playing complete audio (${chunksCount} chunks merged)`);
		  } else {
			this.updateVoiceStatus(`Streaming playback (${chunksCount} chunks)`);
		  }
		});

		this.audioStreamer.addEventListener('playbackPaused', () => {
		  this.updateVoiceStatus('Streaming: waiting for more audio...');
		});

		this.audioStreamer.addEventListener('streamFinalized', (e) => {
			const { chunksReceived, totalDurationMs, mode } = e.detail;
			console.log(`🎵 Stream finalized (${mode}): ${chunksReceived} chunks, ${(totalDurationMs/1000).toFixed(1)}s total`);
			
			// CRITICAL: Complete pipeline - return to listening state
			this.serverState = 'listening';
			this.ttsPlaybackActive = false;
			this.updateVoiceStatus('Listening...');
			this.enableUIControls();
			
			// Resume VAD if user was listening
			if (this.isListening) {
				this.audioHandler.startListening();
			}
		});
		
		this.audioStreamer.addEventListener('pipelineComplete', (e) => {
				console.log(`🔄 Pipeline complete: ${e.detail.reason}`);
				
				// CRITICAL: Return to listening state
				this.serverState = 'listening';
				this.ttsPlaybackActive = false;
				
				if (this.isListening) {
					this.audioHandler.startListening(); // Resume VAD
				}
				
				this.updateVoiceStatus('Listening...');
		});
		
		
  }

  async connect() {
    try {
      const wsUrl = this.config.websocketUrl;
      console.log('🔌 Connecting to WebSocket:', wsUrl);
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();
      
      await new Promise((resolve, reject) => {
        this.ws.onopen = resolve;
        this.ws.onerror = reject;
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });

      console.log('✅ Connected successfully');
      this.showStatus('Connected to Sanskrit Tutor', 'success');
      
    } catch (error) {
      console.error('❌ Connection failed:', error);
      this.showError('Failed to connect to server');
      this.scheduleReconnect();
    }
  }

  setupWebSocketHandlers() {
    this.ws.onopen = () => {
      console.log('🔌 WebSocket connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.updateConnectionStatus(true);
    };
    
    this.ws.onclose = (event) => {
      console.log('🔌 WebSocket disconnected:', event.code, event.reason);
      this.isConnected = false;
      this.updateConnectionStatus(false);
      if (!event.wasClean) {
        this.scheduleReconnect();
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      this.showError('Connection error occurred');
    };
    
    this.ws.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const data = JSON.parse(event.data);
          this.handleWebSocketJsonMessage(data);
        } catch (e) {
          console.error('❌ Failed to parse JSON message:', e);
        }
      } else if (event.data instanceof Blob || event.data instanceof ArrayBuffer) {
        const arrayBuffer = event.data instanceof Blob ? await event.data.arrayBuffer() : event.data;
        await this.handleAudioChunk(arrayBuffer);
      } else {
        console.warn('Unknown WebSocket message type:', event.data);
      }
    };
  }

  // 10. REPLACE JSON MESSAGE HANDLER - RESTORE DURATION ESTIMATE
  handleWebSocketJsonMessage(data) {
		try {
		  switch (data.type) {
			case 'tts_stream_start':
			  console.log(`📊 Received stream start:`, data.text || 'No text provided');
			  this.startTTSStream();
			  break;
			  
			case 'tts_stream_complete':
			  console.log(`✅ TTS streaming complete. Total chunks: ${data.total_chunks}`);
			  this.handleStreamComplete(data.total_chunks);
			  break;
			  
			case 'connected':
			  console.log('✅ Server connection confirmed');
			  this.showStatus('Connected to Sanskrit Tutor', 'success');
			  break;
			  
			case 'error':
			  console.error(`❌ Server error: ${data.message}`);
			  this.handleErrorMessage(data);
			  break;
			  
			case 'llm_response':
			  console.log(`🤖 Received LLM response: ${data.text}`);
			  this.handleLLMResponse(data);
			  break;
			  
			case 'status_update':
			  this.handleStatusUpdateMessage(data);
			  break;
			  
			default:
			  console.warn('Unknown message type:', data.type, data);
			  break;
		  }
		} catch (error) {
		  console.error('❌ Error handling WebSocket JSON message:', error);
		}
  }

  // 11. UPDATE STATUS METHOD
  updateVoiceStatus(message) {
    const statusElement = document.getElementById('voice-status');
    if (statusElement) {
      statusElement.textContent = message;
    }
  }

  // 5. REPLACE TTS STREAM START
  startTTSStream() {
		this.ttsPlaybackActive = true;
		
		// Reset and initialize streamer
		this.audioStreamer.reset();
		this.audioStreamer.initialize().then(() => {
		  this.audioStreamer.startStream();
		});
  }


  // 7. REPLACE HANDLE AUDIO CHUNK
  async handleAudioChunk(arrayBuffer) {
		// Validate audio data
		const uint8 = new Uint8Array(arrayBuffer);
		const isWAV = uint8[0] === 0x52 && uint8[1] === 0x49 && 
					 uint8[2] === 0x46 && uint8[3] === 0x46; // "RIFF"
		
		if (!isWAV) {
		  console.warn(`❌ Invalid audio data received, skipping`);
		  return;
		}

		console.log(`📊 Valid WAV chunk: ${arrayBuffer.byteLength} bytes`);

		// Add chunk to corrected streamer (handles WAV headers properly)
		await this.audioStreamer.addChunk(arrayBuffer);
  }

  // Remove all the old batch scheduling methods since they're now in BatchSchedulingAudioStreamer
  // handleStreamingMode, handleBatchMode, scheduleBatch methods are no longer needed

  // 8. REPLACE HANDLE STREAM COMPLETE
  async handleStreamComplete(totalChunks) {
    console.log(`✅ Stream complete: ${totalChunks} total chunks expected`);
    this.audioStreamer.onStreamComplete(totalChunks);
  }

 // 9. REPLACE STOP TTS PLAYBACK
  stopTTSPlayback() {
		if (this.audioStreamer) {
		  this.audioStreamer.stopPlayback();
		  this.ttsPlaybackActive = false;
		}
  }
  
  // 6. ADD DURATION ESTIMATE HANDLER - REQUIRED FOR MODE DETERMINATION
  handleDurationEstimate(durationMs) {
    console.log(`🕐 Audio duration estimate: ${durationMs}ms`);
    this.audioStreamer.setEstimatedDuration(durationMs);
  }


  enableUIControls() {
    const synthesizeBtn = document.getElementById('synthesize-btn');
    const startListeningBtn = document.getElementById('start-listening-btn');
    
    if (synthesizeBtn) {
      synthesizeBtn.disabled = false;
      synthesizeBtn.textContent = '🎵 Start TTS';
    }
    
    if (startListeningBtn) {
      startListeningBtn.disabled = false;
    }
  }

  // ... Rest of the methods remain the same as original app.js ...
  // (handleLLMResponse, displayUserTranscript, displayAIResponse, etc.)

  async initializeAudio() {
    try {
      console.log('🎵 Initializing audio...');
      const hasPermission = await this.audioHandler.requestMicrophonePermission();
      if (!hasPermission) {
        throw new Error('Microphone permission denied');
      }
      await this.audioHandler.initialize();
      console.log('✅ Audio initialized successfully');
      this.updateAudioStatus('ready');
    } catch (error) {
      console.error('❌ Audio initialization failed:', error);
      this.showError('Failed to initialize audio. Please check microphone permissions.');
      throw error;
    }
  }

  sendAudioToServer(audioBlob) {
    if (this.serverState !== 'listening') {
      console.log('🚫 Audio blocked - server busy processing');
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot send audio: WebSocket not connected');
      return;
    }
    console.log(`📤 Sending audio to server: ${audioBlob.size} bytes`);
    this.ws.send(audioBlob);
	
	this.serverState = 'processing'; // Block further audio
	this.audioHandler.stopListening(); // Stop VAD
  }

  handleMicrophoneToggle() {
    try {
      if (this.isListening) {
        this.stopListening();
      } else {
        this.startListening();
      }
    } catch (error) {
      console.error('❌ Microphone toggle error:', error);
      this.showError('Failed to toggle microphone');
    }
  }

  async startListening() {
    try {
      if (!this.audioHandler || !this.audioHandler.isVadInitialized) {
        throw new Error('Audio handler not initialized');
      }
      console.log('🎤 Starting speech detection...');
      await this.audioHandler.startListening();
      this.isListening = true;
      this.updateMicrophoneButton(true);
      console.log('🎤 Started listening');
    } catch (error) {
      console.error('❌ Failed to start listening:', error);
      this.showError('Failed to start speech detection');
    }
  }

  async stopListening() {
    try {
      console.log('🛑 Stopping speech detection...');
      if (this.audioHandler) {
        await this.audioHandler.stopListening();
      }
      this.isListening = false;
      this.updateMicrophoneButton(false);
      console.log('🛑 Stopped listening');
    } catch (error) {
      console.error('❌ Failed to stop listening:', error);
    }
  }

  handleTextInput(text) {
    if (!text.trim()) return;
    this.sendTextMessage({
      type: 'text_input',
      text: text.trim()
    });
    const textInput = document.getElementById('text-input');
    if (textInput) {
      textInput.value = '';
    }
  }

  sendPing() {
    this.sendTextMessage({ type: 'ping' });
  }

  updateMicrophoneButton(isListening) {
    const micButton = document.getElementById('mic-button');
    if (!micButton) return;
    micButton.classList.toggle('listening', isListening);
    micButton.classList.toggle('stopped', !isListening);
    micButton.title = isListening ? 'Click to stop listening' : 'Click to start listening';
    const icon = micButton.querySelector('i');
    if (icon) {
      icon.className = isListening ? 'fas fa-microphone' : 'fas fa-microphone-slash';
    }
  }

  // Additional utility methods...
  displayUserTranscript(transcript, language) {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    const transcriptDiv = document.createElement('div');
    transcriptDiv.className = 'message user-transcript';
    transcriptDiv.innerHTML = `
      <div class="message-header">
        <span class="speaker">You said</span>
        <span class="language">(${this.getLanguageDisplayName(language)})</span>
        <span class="timestamp">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-content">${this.escapeHtml(transcript)}</div>
    `;
    messagesContainer.appendChild(transcriptDiv);
    this.scrollToBottom(messagesContainer);
    console.log(`📝 Displayed user transcript: "${transcript}" (${language})`);
  }

  displayAIResponse(text) {
    const messagesContainer = document.getElementById('messages');
    if (!messagesContainer) return;
    const responseDiv = document.createElement('div');
    responseDiv.className = 'message ai-response';
    responseDiv.innerHTML = `
      <div class="message-header">
        <span class="speaker">Sanskrit Tutor</span>
        <span class="timestamp">${new Date().toLocaleTimeString()}</span>
      </div>
      <div class="message-content">${this.escapeHtml(text)}</div>
    `;
    messagesContainer.appendChild(responseDiv);
    this.scrollToBottom(messagesContainer);
    console.log(`🤖 Displayed AI response: "${text}"`);
  }

  getLanguageDisplayName(language) {
    const languageNames = {
      'sanskrit': 'Sanskrit',
      'hindi': 'Hindi', 
      'english': 'English',
      'unknown': 'Unknown',
      'text': 'Text Input'
    };
    return languageNames[language] || language;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  }

  handleLLMResponse(data) {
    console.log('🤖 Received LLM response:', data);
	
	// Calculate duration estimate from word count
    if (data.text && this.config.estimatedWPM) {
        const wordCount = data.text.split(/\s+/).length;
        const estimatedDurationMs = Math.round((wordCount / this.config.estimatedWPM) * 60 * 1000);
        console.log(`📊 Word count: ${wordCount}, WPM: ${this.config.estimatedWPM}, Estimated: ${estimatedDurationMs}ms`);
        
        // Set duration immediately
        this.handleDurationEstimate(estimatedDurationMs);
    }
	
    if (data.transcription) {
      this.displayUserTranscript(data.transcription, data.language || 'unknown');
    }
    this.displayAIResponse(data.text);
    if (data.processingTime) {
      console.log(`⏱️ Total processing time: ${data.processingTime}ms`);
      this.updateProcessingTime(data.processingTime);
    }
  }

  handleErrorMessage(data) {
    console.error('❌ Server error:', data.message);
    this.showError(data.message);
    this.serverState = 'listening';
  }

  handleStatusUpdateMessage(data) {
    console.log(`ℹ️ Server Status Update: ${data.message} (Code: ${data.statusCode})`);
    this.showStatus(data.message, data.statusType || 'info');
    
    this.serverState = data.statusCode === 'BUSY_SERVER' ? 'processing' : 'listening';
    
    if (data.statusCode === 'BUSY_SERVER') {
      document.getElementById('voice-circle')?.style.setProperty('backgroundColor', 'orange');
      document.getElementById('voice-status').textContent = data.message;
    } else if (data.statusCode === 'READY') {
      setTimeout(() => {
        if (this.isListening) {
          document.getElementById('voice-circle')?.style.removeProperty('backgroundColor');
          document.getElementById('voice-status').textContent = 'Listening...';
        }
      }, 3000);
    }
  }

  updateProcessingTime(timeMs) {
    const timeElement = document.getElementById('processing-time');
    if (timeElement) {
      timeElement.textContent = `⏱️ ${timeMs}ms`;
      timeElement.className = 'processing-time';
    }
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max reconnection attempts reached');
      this.showError('Connection lost. Please refresh the page.');
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(`🔄 Scheduling reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    this.showStatus(`Reconnecting in ${delay/1000}s... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, 'warning');
    setTimeout(() => this.connect(), delay);
  }

  sendTextMessage(message) {
    if (!this.isConnected || !this.ws) {
      console.error('❌ Cannot send message: WebSocket not connected');
      return;
    }
    console.log('📤 Sending text message:', message);
    this.ws.send(JSON.stringify(message));
  }

  async cleanup() {
    try {
      console.log('🧹 Cleaning up application...');
      await this.stopListening();
      if (this.audioHandler) {
        await this.audioHandler.cleanup();
      }
      if (this.ws) {
        this.ws.close();
      }
      console.log('✅ Application cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  }
  showStatus(message, type = 'info') {
    console.log(`📢 Status (${type}): ${message}`);
    const statusElement = document.getElementById('status-message');
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = `status-message ${type}`;
      setTimeout(() => {
        statusElement.textContent = '';
        statusElement.className = 'status-message';
      }, 5000);
    }
  }

  showError(message) {
    console.error(`❌ App error: ${message}`);
    this.showStatus(message, 'error');
  }

  updateConnectionStatus(isConnected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
      statusElement.className = `connection-status ${isConnected ? 'connected' : 'disconnected'}`;
      statusElement.textContent = isConnected ? '🔗 Connected' : '🔌 Disconnected';
    }
  }

  updateAudioStatus(status) {
    const audioStatus = document.getElementById('audio-status');
    if (audioStatus) {
      const statusText = {
        'initializing': '🔄 Initializing...',
        'ready': '✅ Ready',
        'listening': '🎤 Listening',
        'processing': '⏳ Processing',
        'error': '❌ Error'
      };
      audioStatus.textContent = statusText[status] || status;
      audioStatus.className = `audio-status ${status}`;
    }
  }

	// 12. UPDATE GET STATUS METHOD - ADD MODE INFO
  getStatus() {
		return {
		  isConnected: this.isConnected,
		  isListening: this.isListening,
		  ttsPlaybackActive: this.ttsPlaybackActive,
		  audioHandler: this.audioHandler?.getStatus(),
		  streamerMetrics: this.audioStreamer?.getMetrics(),
		  config: this.config
		};
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Application Initialization and Event Handlers
// ──────────────────────────────────────────────────────────────────────────────

let app;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    app = new EnhancedSanskritTutorApp();
	
    await app.initialize();
    
    setupEventListeners();
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
  }
});

// Setup UI event listeners
function setupEventListeners() {
    const connectBtn = document.getElementById('connect-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
            const name = document.getElementById('name').value.trim();
            const apiKey = document.getElementById('apiKey').value.trim();
            if (!name || !apiKey) {
                app.showError('Please enter both name and API key');
                return;
            }
            app.userName = name;
            app.apiKey = apiKey;
            document.getElementById('auth-status').textContent = 'Connecting...';
            connectBtn.disabled = true;
            try {
                await app.connect();
                showConversationSection(name);
            } catch (error) {
                document.getElementById('auth-status').textContent = 'Connection failed';
                connectBtn.disabled = false;
            }
        });
    }

    const startListeningBtn = document.getElementById('start-listening-btn');
    const stopListeningBtn = document.getElementById('stop-listening-btn');
    if (startListeningBtn) {
        startListeningBtn.addEventListener('click', async () => {
            // Ensure audio context is ready before starting
            if (app.batchStreamer) {
                await app.batchStreamer.resume();
            }
            
            await app.handleMicrophoneToggle();
            startListeningBtn.classList.add('hidden');
            stopListeningBtn.classList.remove('hidden');
            document.getElementById('voice-status').textContent = 'Listening...';
        });
    }
    if (stopListeningBtn) {
        stopListeningBtn.addEventListener('click', async () => {
            await app.handleMicrophoneToggle();
            stopListeningBtn.classList.add('hidden');
            startListeningBtn.classList.remove('hidden');
            document.getElementById('voice-status').textContent = 'Click "Start Listening" to begin';
        });
    }

    const disconnectBtn = document.getElementById('disconnect-btn');
    if (disconnectBtn) {
        disconnectBtn.addEventListener('click', async () => {
            await app.stopListening();
            if (app.ws) {
                app.ws.close();
                app.ws = null;
            }
            app.isConnected = false;
            document.getElementById('conversation-section').classList.add('hidden');
            document.getElementById('auth-section').classList.remove('hidden');
            document.getElementById('connect-btn').disabled = false;
            document.getElementById('auth-status').textContent = '';
        });
    }

    const micButton = document.getElementById('mic-button');
    if (micButton) {
        micButton.addEventListener('click', () => app.handleMicrophoneToggle());
    }
    
    const textInput = document.getElementById('text-input');
    const sendButton = document.getElementById('send-button');
    if (textInput && sendButton) {
        sendButton.addEventListener('click', () => {
            app.handleTextInput(textInput.value);
        });
        textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                app.handleTextInput(textInput.value);
            }
        });
    }
    
    const clearButton = document.getElementById('clear-chat');
    if (clearButton) {
        clearButton.addEventListener('click', () => {
            const messagesContainer = document.getElementById('messages');
            if (messagesContainer) {
                messagesContainer.innerHTML = '';
            }
        });
    }
    
    const pingButton = document.getElementById('ping-button');
    if (pingButton) {
        pingButton.addEventListener('click', () => app.sendPing());
    }
}

function showConversationSection(userName) {
    document.getElementById('auth-section').classList.add('hidden');
    document.getElementById('conversation-section').classList.remove('hidden');
    const userNameElement = document.getElementById('user-name');
    if (userNameElement) {
        userNameElement.textContent = userName;
    }
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = 'Connected';
    }
    if (app && app.showStatus) {
        app.showStatus('Ready to start conversation!', 'success');
    }
}

window.addEventListener('beforeunload', () => {
    if (app && app.cleanup) {
        app.cleanup();
    }
});

// Export for use
window.EnhancedSanskritTutorApp = EnhancedSanskritTutorApp;
window.app = app; // ✅ ADD THIS LINE HERE