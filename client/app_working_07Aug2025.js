// --- COMBINED APP.JS WITH PRODUCTION LOGIC AND STREAMING CAPABILITIES ---

// New Streaming Audio Player Class
class StreamingAudioPlayer {
    constructor() {
        this.audioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
        this.audioQueue = [];
        this.isPlaying = false;
        this.onPlaybackComplete = () => {};
        this.nextChunkTimestamp = 0;
        this.currentSource = null;
    }

    async addAudioChunk(arrayBuffer) {
        try {
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.audioQueue.push(audioBuffer);
            if (!this.isPlaying) {
                this.playNextChunk();
            }
        } catch (error) {
            console.error('❌ Error decoding audio chunk:', error);
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

// Sanskrit Tutor App with Dual STT and Streaming Playback
class SanskritTutorApp {
  constructor() {
    this.ws = null;
    this.audioHandler = null;
    this.audioPlayer = new Audio(); // Kept from original, but not used for streaming
    this.streamingAudioPlayer = null; // New streaming player instance
    this.isConnected = false;
    this.isListening = false;
    this.config = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
	this.ttsPlaybackActive = false;
	this.allowBargeInImmediate = false; 
	this.currentAudio = null;
	this.serverState = 'listening';
    
    console.log('🕉️ Sanskrit Tutor App initialized');
  }

  async initialize() {
    console.log('🚀 Initializing Sanskrit Tutor App...');
    try {
        // FIX: Use the client-side CONFIG.getBaseURL() to fetch the server config
        const BACKEND_URL = CONFIG.getBaseURL();
        const response = await fetch(`${BACKEND_URL}/config`);
        if (!response.ok) throw new Error(`Failed to fetch config: ${response.status}`);
        const config = await response.json();
        this.config = config;
        this.allowBargeInImmediate = config.allowBargeTTSPlaybackImmediate === true;

        this.audioHandler = new AudioHandler();
        this.audioHandler.setConfig(config);
        this.audioHandler.onAudioData = (audioBlob) => this.sendAudioToServer(audioBlob);
        
        this.audioHandler.setOnSpeechValidatedCallback(() => {
          if (this.ttsPlaybackActive && this.allowBargeInImmediate) {
            console.log("🛑 Speech validated — interrupting TTS");
            this.stopTTSPlayback();
          }
        });

        // Use new streaming player
        this.streamingAudioPlayer = new StreamingAudioPlayer();
        this.streamingAudioPlayer.onPlaybackComplete = () => {
            this.ttsPlaybackActive = false;
            if (this.isListening) {
                this.audioHandler.startListening();
            }
        };

        await this.initializeAudio();
        console.log('✅ App initialization completed');
    } catch (error) {
        console.error('❌ App initialization failed:', error);
    }
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
    
    this.ws.onmessage = (event) => {
      this.handleWebSocketMessage(event);
    };
  }

  // --- NEW METHODS FOR RUNPOD STREAMING ---

  async handleWebSocketMessage(event) {
    try {
        if (typeof event.data === 'string') {
            const data = JSON.parse(event.data);
            switch (data.type) {
                case 'stream_start':
                    console.log(`🔊 Received stream start: ${data.text}`);
                    this.ttsPlaybackActive = true;
                    this.streamingAudioPlayer.stopPlayback(); 
                    break;
                case 'audio_chunk':
                    const audioDataHex = data.audio_data;
                    if (audioDataHex) {
                        const buffer = this.hexToArrayBuffer(audioDataHex);
                        await this.streamingAudioPlayer.addAudioChunk(buffer);
                    }
                    break;
                case 'stream_complete':
                    console.log(`✅ TTS streaming complete. Total chunks: ${data.total_chunks}`);
                    break;
                case 'error':
                    console.error(`❌ Server error: ${data.message}`);
                    this.handleErrorMessage(data);
                    break;
                case 'llm_response': // This is the old format, may not be needed if using new protocol
                    console.log(`🤖 Received LLM response: ${data.text}`);
                    this.handleLLMResponse(data);
                    break;
                case 'pong':
                    console.log('🏓 Pong received');
                    break;
                case 'status_update':
                    this.handleStatusUpdateMessage(data);
                    break;
                default:
                    console.warn('Unknown message type:', data.type, data);
                    break;
            }
        }
    } catch (error) {
        console.error('❌ Error handling WebSocket message:', error);
    }
  }

  hexToArrayBuffer(hex) {
    const uint8 = new Uint8Array(hex.match(/[\da-f]{2}/gi).map(function(h) {
        return parseInt(h, 16)
    }));
    return uint8.buffer;
  }
  
  stopTTSPlayback() {
    if (this.streamingAudioPlayer) {
      this.streamingAudioPlayer.stopPlayback();
      this.ttsPlaybackActive = false;
    }
  }

  // --- EXISTING METHODS FROM PRODUCTION VERSION ---

  handleStatusUpdateMessage(data) {
    console.log(`ℹ️ Server Status Update: ${data.message} (Code: ${data.statusCode})`);
    this.showStatus(data.message, data.statusType || 'info');
    
    this.serverState = data.statusCode === 'BUSY_SERVER' ? 'processing' : 'listening';
    
    if (data.statusCode === 'BUSY_SERVER') {
      document.getElementById('voice-circle').style.backgroundColor = 'orange';
      document.getElementById('voice-status').textContent = data.message;
    } else if (data.statusCode === 'READY') {
      setTimeout(() => {
        if (this.isListening) {
          document.getElementById('voice-circle').style.backgroundColor = '';
          document.getElementById('voice-status').textContent = 'Listening...';
        }
      }, 3000);
    }
  }

  handleConnectedMessage(data) {
    console.log('✅ Server connection confirmed');
    this.showStatus('Connected to Sanskrit Tutor', 'success');
  }

  handleLLMResponse(data) {
    console.log('🤖 Received LLM response:', data);
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

  sendAudioToServer(audioBlob) {
    console.log('🔍 DEBUG sendAudio: isConnected =', this.isConnected);
    console.log('🔍 DEBUG sendAudio: ws =', this.ws);
    console.log('🔍 DEBUG sendAudio: ws.readyState =', this.ws?.readyState);
    if (this.serverState != 'listening') {
        console.log('🚫 Audio blocked - server busy processing');
        return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.error('❌ Cannot send audio: WebSocket not connected');
      console.log('🔍 DEBUG: ws =', this.ws);
      console.log('🔍 DEBUG: readyState =', this.ws?.readyState);
      return;
    }
    console.log(`📤 Sending audio to server: ${audioBlob.size} bytes`);
    this.ws.send(audioBlob);
  }

  sendTextMessage(message) {
    if (!this.isConnected || !this.ws) {
      console.error('❌ Cannot send message: WebSocket not connected');
      return;
    }
    console.log('📤 Sending text message:', message);
    this.ws.send(JSON.stringify(message));
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

  updateProcessingTime(timeMs) {
    const timeElement = document.getElementById('processing-time');
    if (timeElement) {
      timeElement.textContent = `⏱️ ${timeMs}ms`;
      timeElement.className = 'processing-time';
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

  getStatus() {
    return {
      isConnected: this.isConnected,
      isListening: this.isListening,
      audioHandler: this.audioHandler?.getStatus(),
      config: this.config,
      reconnectAttempts: this.reconnectAttempts
    };
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
}

// ──────────────────────────────────────────────────────────────────────────────
// Application Initialization and Event Handlers
// ──────────────────────────────────────────────────────────────────────────────

let app;

// Initialize app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  try {
    // FIX: Change the URL to remove the incorrect '/api' prefix
    app = new SanskritTutorApp();
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

window.app = app;
