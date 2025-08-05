// Sanskrit Tutor App with RunPod TTS Integration
class SanskritTutorApp {
  constructor() {
    this.ws = null; // Fly.io WebSocket
    this.audioHandler = null;
    this.runpodTTS = null; // ADD RunPod TTS Manager
    this.audioPlayer = new Audio();
    this.isConnected = false;
    this.isListening = false;
    this.config = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    
    // ADD CLIENT ID:
    this.clientId = `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // TTS barge-in state
    this.ttsPlaybackActive = false;
    this.allowBargeInImmediate = false;
    this.currentAudio = null;
    
    console.log(`🕉️ Sanskrit Tutor App initialized with client ID: ${this.clientId}`);
  }

  /**
   * Initialize the application
   */
  async initialize() {
    console.log('🚀 Initializing Sanskrit Tutor App...');
    
    // Step 1: Fetch /config before anything else
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`);
    
    const config = await response.json();
    this.config = config;
    this.allowBargeInImmediate = config.allowBargeTTSPlaybackImmediate === true;
    
    // Step 2: Initialize audio handler
    this.audioHandler = new AudioHandler();
	this.audioHandler.setConfig(config);
	this.audioHandler.onAudioData = (audioBlob) => this.sendAudioToServer(audioBlob);
    
    this.audioHandler.setOnSpeechValidatedCallback(() => {
		if (this.audioPlayer) {
			this.audioPlayer.stopPlayback();
		}
	});
	
	this.audioPlayer = new StreamingAudioPlayer();
	this.audioPlayer.onPlaybackComplete = () => {
		// Re-enable listening after playback
		if (this.isListening && this.audioHandler) {
			this.audioHandler.startListening();
		}
	};
	
    
    // Step 3: Initialize RunPod TTS Manager
    this.runpodTTS = new RunPodTTSManager(this.clientId);
    
    // Set up RunPod TTS callbacks
    this.runpodTTS.onStreamStart = (streamInfo) => {
      console.log(`🎵 TTS Stream starting: ${streamInfo.estimatedDuration}s`);
      this.ttsPlaybackActive = true;
    };
    
    this.runpodTTS.onAudioReady = (audioElement) => {
      console.log('🎵 TTS Audio ready for playback');
      this.currentAudio = audioElement;
      
      // Set up audio event handlers
      audioElement.onended = () => {
        console.log('🎵 TTS Audio playback completed');
        this.ttsPlaybackActive = false;
        this.currentAudio = null;
        this.onAudioPlaybackComplete();
      };
    };
    
    this.runpodTTS.onStreamComplete = (data) => {
      console.log(`✅ TTS Stream completed: ${data.total_chunks} chunks`);
    };
    
    this.runpodTTS.onError = (error) => {
      console.error('❌ RunPod TTS error:', error);
      this.showError('TTS service error: ' + error.error);
      this.ttsPlaybackActive = false;
      this.currentAudio = null;
    };
    
    console.log('✅ App initialization completed');
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    try {
      const wsUrl = this.config.websocketUrl;
      console.log('🔌 Connecting to Fly.io WebSocket:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();
      
      // Wait for Fly.io connection
      await new Promise((resolve, reject) => {
        this.ws.onopen = resolve;
        this.ws.onerror = reject;
        setTimeout(() => reject(new Error('Fly.io connection timeout')), 10000);
      });
      
      // Initialize audio after successful connection
      await this.initializeAudio();
      
      // Initialize RunPod TTS connection
      if (this.config.runpod && this.config.runpod.websocketUrl) {
        try {
          await this.runpodTTS.initialize({
            runpodWsUrl: this.config.runpod.websocketUrl,
            streamingThreshold: this.config.tts?.streamingThreshold || 6.0,
            bufferPercentage: this.config.tts?.bufferPercentage || 0.3,
            chunkDuration: this.config.tts?.chunkDuration || 0.5
          });
        } catch (error) {
          console.warn('⚠️ RunPod TTS initialization failed:', error.message);
          this.showStatus('TTS service unavailable - will retry on first use', 'warning');
        }
      }
      
      console.log('✅ Connected successfully');
      this.showStatus('Connected to Sanskrit Tutor', 'success');
      
    } catch (error) {
      console.error('❌ Connection failed:', error);
      this.showError('Failed to connect to server');
      this.scheduleReconnect();
    }
  }
  
  /**
   * Centralized barge-in decision logic
   * @returns {boolean} true if audio should be blocked
   */
  shouldBlockAudio() {
    console.log('🔍 DEBUG: allowBargeInImmediate =', this.allowBargeInImmediate);
    
    if (!this.ttsPlaybackActive) {
      return false;
    }
    if (this.allowBargeInImmediate) {
      console.log('🔊 Immediate barge-in - stopping TTS');
      this.stopTTSPlayback();
      this.showStatus('Stopping current response...', 'info');
      return false;
    }
    console.log('🚫 Barge-in not allowed during TTS playback, contact your admin if you really want to stop my playback midway');
    this.showStatus('Barge-in not allowed during TTS playback. Contact your admin if you want to interrupt responses.', 'warning');
    return true;
  }
  
  
  
  // Add this new class inside SanskritTutorApp
class StreamingAudioPlayer {
		constructor() {
			this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
			this.audioQueue = [];
			this.isPlaying = false;
			this.onPlaybackComplete = () => {};
			this.nextChunkTimestamp = 0;
			this.currentSource = null;
		}

		async addAudioChunk(chunkBlob) {
			const arrayBuffer = await chunkBlob.arrayBuffer();
			const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
			this.audioQueue.push(audioBuffer);
			if (!this.isPlaying) {
				this.playNextChunk();
			}
		}

		playNextChunk() {
			if (this.audioQueue.length > 0 && !this.isPlaying) {
				this.isPlaying = true;
				const audioBuffer = this.audioQueue.shift();
				const source = this.audioContext.createBufferSource();
				source.buffer = audioBuffer;
				source.connect(this.audioContext.destination);

				const now = this.audioContext.currentTime;
				const startTime = Math.max(now, this.nextChunkTimestamp);
				this.currentSource = source;
				source.start(startTime);
				this.nextChunkTimestamp = startTime + audioBuffer.duration;

				source.onended = () => {
					this.isPlaying = false;
					this.currentSource = null;
					this.playNextChunk();
					if (this.audioQueue.length === 0) {
						this.onPlaybackComplete();
					}
				};
			}
		}

		stopPlayback() {
			this.audioQueue = [];
			this.isPlaying = false;
			this.nextChunkTimestamp = 0;
			if (this.currentSource) {
				this.currentSource.stop();
				this.currentSource = null;
			}
		}
}
  
  

  /**
   * Setup WebSocket event handlers
   */
  setupWebSocketHandlers() {
    this.ws.onopen = () => {
      console.log('🔌 Fly.io WebSocket connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.updateConnectionStatus(true);
    };

    this.ws.onclose = (event) => {
      console.log('🔌 Fly.io WebSocket disconnected:', event.code, event.reason);
      this.isConnected = false;
      this.updateConnectionStatus(false);
      
      if (!event.wasClean) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('❌ Fly.io WebSocket error:', error);
      this.showError('Connection error occurred');
    };

    this.ws.onmessage = (event) => {
      this.handleWebSocketMessage(event);
    };
  }

  /**
   * Handle status update message
   */
  handleStatusUpdateMessage(data) {
    console.log(`ℹ️ Fly.io Status Update: ${data.message} (Code: ${data.statusCode})`);
    this.showStatus(data.message, data.statusType || 'info');
    
    if (data.statusCode === 'BUSY_SERVER') {
      document.getElementById('voice-circle').style.backgroundColor = 'orange';
      document.getElementById('voice-status').textContent = data.message;
    } else if (data.statusCode === 'SHORT_UTTERANCE') {
      document.getElementById('voice-circle').style.backgroundColor = '';
      document.getElementById('voice-status').textContent = data.message;
    }
    
    setTimeout(() => {
      if (this.isListening) {
        document.getElementById('voice-circle').style.backgroundColor = '';
        document.getElementById('voice-status').textContent = 'Listening...';
      }
    }, 3000);
  }

  /**
   * Stop current TTS playback
   */
  stopTTSPlayback() {
    // Stop RunPod TTS playback
    if (this.runpodTTS) {
      this.runpodTTS.stopCurrentPlayback();
    }
    
    // Legacy audio handling
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    
    this.ttsPlaybackActive = false;
    console.log('🛑 TTS playback stopped');
  }

  /**
   * Show barge-in instruction message
   */
  showBargeInMessage() {
    this.showStatus('Sorry, speak clearly again if you want to stop current playback and ask me something?', 'info');
  }

  /**
   * Handle incoming WebSocket messages from Fly.io
   */
  handleWebSocketMessage(event) {
    try {
      console.log('🔍 DEBUG: Raw message received:', typeof event.data);
      console.log('🔍 DEBUG: Is ArrayBuffer?', event.data instanceof ArrayBuffer);
      console.log('🔍 DEBUG: Is Blob?', event.data instanceof Blob);
      console.log('🔍 DEBUG: Size/Length:', event.data.size || event.data.length || event.data.byteLength);
      
      console.log('📨 Received message:', typeof event.data, event.data.constructor.name);
      
      if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);
        console.log('📨 Received from Fly.io:', data.type);
        
        switch (data.type) {
          case 'connected':
            this.handleConnectedMessage(data);
            this.isConnected = true;
            console.log('✅ Fly.io connection confirmed');
            break;
            
          case 'llm_response':
            this.handleLLMResponse(data);
            break;
            
          // ADD NEW CASE:
          case 'tts_initiated':
            this.handleTTSInitiated(data);
            break;
            
          case 'error':
            this.handleErrorMessage(data);
            break;
            
          case 'pong':
            console.log('🏓 Pong received from Fly.io');
            break;
            
          case 'status_update':
            this.handleStatusUpdateMessage(data);
            break;
            
          default:
            console.log(`⚠️ Unknown Fly.io message type: ${data.type}`);
        }
        
      } else if (event.data instanceof Blob) {
        this.audioPlayer.addAudioChunk(event.data);
      } else if (event.data instanceof ArrayBuffer) {
			this.audioPlayer.addAudioChunk(new Blob([event.data]));
      }
      
    } catch (error) {
      console.error('❌ Fly.io message handling error:', error);
      this.showError('Failed to process server response');
    }
  }

  /**
   * Handle connected message from server
   */
  handleConnectedMessage(data) {
    console.log('✅ Fly.io connection confirmed');
    this.showStatus('Connected to Sanskrit Tutor', 'success');
  }

  /**
   * Handle LLM response with transcript display
   */
  handleLLMResponse(data) {
    console.log('🤖 Received LLM response:', data);
    
    // Display user transcript first
    if (data.transcription) {
      this.displayUserTranscript(data.transcription, data.language || 'unknown');
    }
    
    // Display AI response
    this.displayAIResponse(data.text);
    
    // Show processing time if available
    if (data.processingTime) {
      console.log(`⏱️ Total processing time: ${data.processingTime}ms`);
      this.updateProcessingTime(data.processingTime);
    }
    
    // Show debug info if available
    if (data.debug && this.config?.enableDebugLogging) {
      console.log('🐛 Debug info:', data.debug);
    }
    
    // The TTS will be handled separately via RunPod streaming
  }

  /**
   * Handle TTS initiation notification from Fly.io
   */
  handleTTSInitiated(data) {
    console.log('🎵 TTS initiated by Fly.io:', data);
    
    // Ensure RunPod TTS connection is active
    this.runpodTTS.checkAndReconnect();
    
    // Show status
    this.showStatus('Generating speech response...', 'info');
    
    // Update UI to show TTS is starting
    const statusElement = document.getElementById('tts-status');
    if (statusElement) {
      statusElement.textContent = `🎵 Generating ${data.estimatedDuration?.toFixed(1) || '?'}s of speech...`;
    }
  }

  /**
   * Handle error message from server
   */
  handleErrorMessage(data) {
    console.error('❌ Fly.io error:', data.message);
    this.showError(data.message);
  }

  /**
   * Handle audio response from server (LEGACY - for fallback)
   */
  async handleAudioResponse(audioBlob) {
    console.log(`🔊 Received legacy audio response (Blob): ${audioBlob.size} bytes`);
    
    try {
      await this.playAudioResponse(audioBlob);
    } catch (error) {
      console.error('❌ Audio playback error:', error);
      this.showError('Failed to play audio response');
    }
  }

  /**
   * Play audio response from server (LEGACY - for fallback)
   */
  async playAudioResponse(audioBlob) {
    console.log('🎵 Processing legacy audio response...');
    
    try {
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Stop any ongoing TTS playback before starting new one
      if (this.currentAudio && !this.currentAudio.paused) {
        console.log('🛑 Stopping previous TTS playback before starting new one');
        this.currentAudio.pause();
        this.currentAudio.currentTime = 0;
        this.ttsPlaybackActive = false;
        this.currentAudio = null;
      }
      
      const audio = new Audio(audioUrl);
      this.currentAudio = audio;
      
      // Set up audio event handlers
      audio.onloadstart = () => console.log('🎵 Audio loading...');
      audio.oncanplaythrough = () => console.log('🎵 Audio ready to play');
      
      audio.onplay = () => {
        console.log('🎵 Audio playback started');
        this.ttsPlaybackActive = true;
        this.currentAudio = audio;
      };
      
      audio.onended = () => {
        console.log('🎵 Audio playback completed');
        this.ttsPlaybackActive = false;
        this.currentAudio = null;
        URL.revokeObjectURL(audioUrl);
        this.onAudioPlaybackComplete();
      };
      
      audio.onerror = (error) => {
        console.error('❌ Audio playback error:', error);
        URL.revokeObjectURL(audioUrl);
      };
      
      // Play the audio
      await audio.play();
      console.log('🎵 Audio playback initiated successfully');
      
    } catch (error) {
      console.error('❌ Failed to play audio:', error);
      throw error;
    }
  }

  /**
   * Called when audio playback completes
   */
  onAudioPlaybackComplete() {
    // Re-enable listening after audio playback
    if (this.isListening && this.audioHandler && this.audioHandler.isListening) {
      console.log('🎤 Re-enabling speech detection after audio playback');
      this.audioHandler.startListening();
    } else {
      console.log('🔇 Not restarting - user manually stopped listening');
    }
  }

  /**
   * Display user transcript in chat
   */
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

  /**
   * Display AI response in chat
   */
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

  /**
   * Get human-readable language name
   */
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

  /**
   * Escape HTML to prevent XSS
   */
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Scroll container to bottom
   */
  scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Initialize audio system
   */
  async initializeAudio() {
    try {
      console.log('🎵 Initializing audio...');
      
      // Request microphone permission
      const hasPermission = await this.audioHandler.requestMicrophonePermission();
      if (!hasPermission) {
        throw new Error('Microphone permission denied');
      }
      
      // Initialize VAD
      await this.audioHandler.initialize();
      
      console.log('✅ Audio initialized successfully');
      this.updateAudioStatus('ready');
      
    } catch (error) {
      console.error('❌ Audio initialization failed:', error);
      this.showError('Failed to initialize audio. Please check microphone permissions.');
      throw error;
    }
  }

  /**
   * Start listening for speech
   */
  async startListening() {
    try {
      if (!this.audioHandler || !this.audioHandler.isVadInitialized) {
        throw new Error('Audio handler not initialized');
      }
      
      // Ensure RunPod TTS connection is ready
      await this.runpodTTS.checkAndReconnect();
      
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

  /**
   * Stop listening for speech
   */
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

  /**
   * Send audio data to Fly.io server
   */
  sendAudioToServer(audioBlob) {
    console.log('🔍 DEBUG sendAudio: isConnected =', this.isConnected);
    console.log('🔍 DEBUG sendAudio: ws =', this.ws);
    console.log('🔍 DEBUG sendAudio: ws.readyState =', this.ws?.readyState);
    
    // Check actual WebSocket state
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot send audio: Fly.io WebSocket not connected');
      return;
    }
    
    console.log(`📤 Sending audio to Fly.io: ${audioBlob.size} bytes`);
    this.ws.send(audioBlob);
  }

  /**
   * Send text message to Fly.io server
   */
  sendTextMessage(message) {
    if (!this.isConnected || !this.ws) {
      console.error('❌ Cannot send message: Fly.io WebSocket not connected');
      return;
    }
    
    console.log('📤 Sending text message to Fly.io:', message);
    this.ws.send(JSON.stringify(message));
  }

  /**
   * Update microphone button state
   */
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

  /**
   * Update connection status display
   */
  updateConnectionStatus(isConnected) {
    const statusElement = document.getElementById('connection-status');
    if (statusElement) {
      statusElement.className = `connection-status ${isConnected ? 'connected' : 'disconnected'}`;
      statusElement.textContent = isConnected ? '🔗 Connected' : '🔌 Disconnected';
    }
  }

  /**
   * Update audio status display
   */
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

  /**
   * Update processing time display
   */
  updateProcessingTime(timeMs) {
    const timeElement = document.getElementById('processing-time');
    if (timeElement) {
      timeElement.textContent = `⏱️ ${timeMs}ms`;
      timeElement.className = 'processing-time';
    }
  }

  /**
   * Show status message
   */
  showStatus(message, type = 'info') {
    console.log(`📢 Status (${type}): ${message}`);
    
    const statusElement = document.getElementById('status-message');
    if (statusElement) {
      statusElement.textContent = message;
      statusElement.className = `status-message ${type}`;
      
      // Auto-hide after 5 seconds
      setTimeout(() => {
        statusElement.textContent = '';
        statusElement.className = 'status-message';
      }, 5000);
    }
  }

  /**
   * Show error message
   */
  showError(message) {
    console.error(`❌ App error: ${message}`);
    this.showStatus(message, 'error');
  }

  /**
   * Schedule reconnection attempt
   */
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

  /**
   * Handle microphone button click
   */
  async handleMicrophoneToggle() {
    try {
      if (this.isListening) {
        await this.stopListening();
      } else {
        await this.startListening();
      }
    } catch (error) {
      console.error('❌ Microphone toggle error:', error);
      this.showError('Failed to toggle microphone');
    }
  }

  /**
   * Handle text input submission
   */
  handleTextInput(text) {
    if (!text.trim()) return;
    
    // Ensure RunPod TTS connection for response
    this.runpodTTS.checkAndReconnect();
    
    // ADD CLIENT ID TO MESSAGE:
    this.sendTextMessage({
      type: 'text_input',
      text: text.trim(),
      client_id: this.clientId
    });
    
    // Clear input
    const textInput = document.getElementById('text-input');
    if (textInput) {
      textInput.value = '';
    }
  }

  /**
   * Send ping to server
   */
  sendPing() {
    this.sendTextMessage({ type: 'ping' });
  }

  /**
   * Get application status including RunPod TTS
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      isListening: this.isListening,
      audioHandler: this.audioHandler?.getStatus(),
      runpodTTS: this.runpodTTS?.getStatus(),
      config: this.config,
      reconnectAttempts: this.reconnectAttempts,
      clientId: this.clientId
    };
  }

  /**
   * Cleanup and shutdown
   */
  async cleanup() {
    try {
      console.log('🧹 Cleaning up application...');
      
      await this.stopListening();
      
      if (this.audioHandler) {
        await this.audioHandler.cleanup();
      }
      
      // ADD RUNPOD CLEANUP:
      if (this.runpodTTS) {
        this.runpodTTS.cleanup();
      }
      
      if (this.ws) {
        this.ws.close();
      }
      
      console.log('✅ Application cleanup completed');
      
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Application Initialization and Event Handlers
// ──────────────────────────────────────────────────────────────────────────────

let app;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    app = new SanskritTutorApp();
    await app.initialize();
    
    // Setup event listeners
    setupEventListeners();
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
  }
});

// Setup UI event listeners
function setupEventListeners() {
  // ========== CONNECT BUTTON ==========
  const connectBtn = document.getElementById('connect-btn');
  if (connectBtn) {
    connectBtn.addEventListener('click', async () => {
      console.log('🔍 DEBUG: app.isConnected =', app.isConnected);
      console.log('🔍 DEBUG: app.ws =', app.ws);
      console.log('🔍 DEBUG: app.ws.readyState =', app.ws?.readyState);
    
      const name = document.getElementById('name').value.trim();
      const apiKey = document.getElementById('apiKey').value.trim();
      
      if (!name || !apiKey) {
        app.showError('Please enter both name and API key');
        return;
      }
      
      // Store user info
      app.userName = name;
      app.apiKey = apiKey;
      
      // Show connecting status
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
  
  // Helper function to transition to conversation screen
  function showConversationSection(userName) {
    // Hide auth section
    document.getElementById('auth-section').classList.add('hidden');
    
    // Show conversation section
    document.getElementById('conversation-section').classList.remove('hidden');
    
    // Update user name display
    const userNameElement = document.getElementById('user-name');
    if (userNameElement) {
      userNameElement.textContent = userName;
    }
    
    // Update status
    document.getElementById('status-text').textContent = 'Connected';
    app.showStatus('Ready to start conversation!', 'success');
  }
  
  // ========== START/STOP LISTENING BUTTONS ==========
  const startListeningBtn = document.getElementById('start-listening-btn');
  const stopListeningBtn = document.getElementById('stop-listening-btn');
  
  if (startListeningBtn) {
    startListeningBtn.addEventListener('click', async () => {
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
  
  // ========== DISCONNECT BUTTON ==========
  const disconnectBtn = document.getElementById('disconnect-btn');
  if (disconnectBtn) {
    disconnectBtn.addEventListener('click', async () => {
      await app.stopListening();
      
      // Actually disconnect WebSocket
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

  // ========== EXISTING CODE ==========
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

// Handle page unload
window.addEventListener('beforeunload', () => {
  if (app) {
    app.cleanup();
  }
});

// Handle page visibility changes
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('📱 Page hidden');
  } else {
    console.log('📱 Page visible');
  }
});

// Export app for debugging
window.SanskritTutorApp = app;