// Sanskrit Tutor App with Dual STT and Transcript Display
class SanskritTutorApp {
  constructor() {
    this.ws = null;
    this.audioHandler = null;
    this.isConnected = false;
    this.isListening = false;
    this.config = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    
    console.log('🕉️ Sanskrit Tutor App initialized');
  }

  /**
   * Initialize the application
   */
  async initialize() {
    console.log('🚀 Initializing Sanskrit Tutor App...');
    
    try {
      // Initialize audio handler
      this.audioHandler = new AudioHandler();
      this.audioHandler.onAudioData = (audioBlob) => this.sendAudioToServer(audioBlob);
      
      console.log('✅ App initialization completed');
      
    } catch (error) {
      console.error('❌ App initialization failed:', error);
      this.showError('Failed to initialize application');
    }
  }

  /**
   * Connect to WebSocket server
   */
  async connect() {
    try {
      //const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      //const wsUrl = `${protocol}//${window.location.host}`;
      
	  const wsUrl = CONFIG.getWebSocketURL();
      console.log('🔌 Connecting to WebSocket:', wsUrl);
      
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();
      
      // Wait for connection
      await new Promise((resolve, reject) => {
        this.ws.onopen = resolve;
        this.ws.onerror = reject;
        setTimeout(() => reject(new Error('Connection timeout')), 10000);
      });
      
      // Initialize audio after successful connection
      await this.initializeAudio();
      
      console.log('✅ Connected successfully');
      this.showStatus('Connected to Sanskrit Tutor', 'success');
      
    } catch (error) {
      console.error('❌ Connection failed:', error);
      this.showError('Failed to connect to server');
      this.scheduleReconnect();
    }
  }

  /**
   * Setup WebSocket event handlers
   */
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
  
  
  // NEW: Add a new handler function for status updates
  handleStatusUpdateMessage(data) {
      console.log(`ℹ️ Server Status Update: ${data.message} (Code: ${data.statusCode})`);
      this.showStatus(data.message, data.statusType || 'info'); // Use statusType for styling
      // Optionally, you can add more specific UI reactions based on data.statusCode
      if (data.statusCode === 'BUSY_SERVER') {
          // Maybe change the voice indicator to red or flashing to indicate "busy"
          document.getElementById('voice-circle').style.backgroundColor = 'orange'; // Example
          document.getElementById('voice-status').textContent = data.message;
      } else if (data.statusCode === 'SHORT_UTTERANCE') {
          // Revert voice indicator to listening or show a distinct color
          document.getElementById('voice-circle').style.backgroundColor = ''; // Revert to default
          document.getElementById('voice-status').textContent = data.message;
      }
      // Revert after a short delay for busy/short utterance messages
      setTimeout(() => {
          if (this.isListening) { // Only revert if still in listening mode
            document.getElementById('voice-circle').style.backgroundColor = ''; // Revert
            document.getElementById('voice-status').textContent = 'Listening...';
          }
      }, 3000); // Revert after 3 seconds
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleWebSocketMessage(event) {
    try {
      // Debug logging
      console.log('🔍 DEBUG: Raw message received:', typeof event.data);
      console.log('🔍 DEBUG: Is ArrayBuffer?', event.data instanceof ArrayBuffer);
      console.log('🔍 DEBUG: Is Blob?', event.data instanceof Blob);
      console.log('🔍 DEBUG: Size/Length:', event.data.size || event.data.length || event.data.byteLength);
      
      console.log('📨 Received message:', typeof event.data, event.data.constructor.name);
      
      if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);
        console.log('📨 Received message:', data.type);
        
        switch (data.type) {
          case 'connected':
            this.handleConnectedMessage(data);
            break;
            
          case 'config':
            this.handleConfigMessage(data);
            break;
            
          case 'llm_response':
            this.handleLLMResponse(data);
            break;
            
          case 'error':
            this.handleErrorMessage(data);
            break;
            
          case 'pong':
            console.log('🏓 Pong received');
            break;
			
		  case 'status_update': // NEW: Handle status updates from server
            this.handleStatusUpdateMessage(data);
            break;
            
          default:
            console.log(`⚠️ Unknown message type: ${data.type}`);
        }
        
      } else if (event.data instanceof Blob) {
        this.handleAudioResponse(event.data);
      } else if (event.data instanceof ArrayBuffer) {
        this.handleAudioResponse(new Blob([event.data]));
      }
      
    } catch (error) {
      console.error('❌ Message handling error:', error);
      this.showError('Failed to process server response');
    }
  }

  /**
   * Handle connected message from server
   */
  handleConnectedMessage(data) {
    console.log('✅ Server connection confirmed');
    this.showStatus('Connected to Sanskrit Tutor', 'success');
  }

  /**
   * Handle configuration message from server
   */
  handleConfigMessage(data) {
    console.log('📋 Received server configuration:', data);
    this.config = data;
    
    // Update audio handler with VAD delay
    if (data.vadEndDelayMs && this.audioHandler) {
      this.audioHandler.updateVadEndDelay(data.vadEndDelayMs);
    }
    
    // Update UI with configuration
    this.updateConfigDisplay(data);
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
    
    // Then display AI response
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
  }

  /**
   * Handle error message from server
   */
  handleErrorMessage(data) {
    console.error('❌ Server error:', data.message);
    this.showError(data.message);
  }

  /**
   * Handle audio response from server
   */
  async handleAudioResponse(audioBlob) {
    console.log(`🔊 Received audio response (Blob): ${audioBlob.size} bytes`);
    
    try {
      await this.playAudioResponse(audioBlob);
    } catch (error) {
      console.error('❌ Audio playback error:', error);
      this.showError('Failed to play audio response');
    }
  }

  /**
   * Play audio response from server
   */
  async playAudioResponse(audioBlob) {
    console.log('🎵 Processing audio response...');
    
    try {
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      
      // Set up audio event handlers
      audio.onloadstart = () => console.log('🎵 Audio loading...');
      audio.oncanplaythrough = () => console.log('🎵 Audio ready to play');
      audio.onplay = () => console.log('🎵 Audio playback started');
      audio.onended = () => {
        console.log('🎵 Audio playback completed');
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
    if (this.isListening && this.audioHandler) {
      console.log('🎤 Re-enabling speech detection after audio playback');
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
   * Send audio data to server
   */
  sendAudioToServer(audioBlob) {
    
	console.log('🔍 DEBUG sendAudio: isConnected =', this.isConnected);
    console.log('🔍 DEBUG sendAudio: ws =', this.ws);
    console.log('🔍 DEBUG sendAudio: ws.readyState =', this.ws?.readyState);
	
	// Check actual WebSocket state instead of isConnected flag
	  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
		console.error('❌ Cannot send audio: WebSocket not connected');
		console.log('🔍 DEBUG: ws =', this.ws);
		console.log('🔍 DEBUG: readyState =', this.ws?.readyState);
		return;
	  }
    
    console.log(`📤 Sending audio to server: ${audioBlob.size} bytes`);
    this.ws.send(audioBlob);
  }

  /**
   * Send text message to server
   */
  sendTextMessage(message) {
    if (!this.isConnected || !this.ws) {
      console.error('❌ Cannot send message: WebSocket not connected');
      return;
    }
    
    console.log('📤 Sending text message:', message);
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
   * Update configuration display
   */
  updateConfigDisplay(config) {
    const configElement = document.getElementById('config-display');
    if (configElement) {
      configElement.innerHTML = `
        <div class="config-item">
          <span class="label">Dual STT:</span>
          <span class="value">${config.enableDualSTT ? '✅ Enabled' : '❌ Disabled'}</span>
        </div>
        <div class="config-item">
          <span class="label">VAD Delay:</span>
          <span class="value">${config.vadEndDelayMs}ms</span>
        </div>
        <div class="config-item">
          <span class="label">Sample Rate:</span>
          <span class="value">${config.audioConfig?.sampleRate || 16000}Hz</span>
        </div>
      `;
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
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
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
    
    this.sendTextMessage({
      type: 'text_input',
      text: text.trim()
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
   * Get application status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      isListening: this.isListening,
      audioHandler: this.audioHandler?.getStatus(),
      config: this.config,
      reconnectAttempts: this.reconnectAttempts
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
    //await app.connect();
    
    // Setup event listeners
    setupEventListeners();
    
  } catch (error) {
    console.error('❌ Failed to start application:', error);
  }
});

// Setup UI event listeners
// Setup UI event listeners
function setupEventListeners() {
  // ========== CONNECT BUTTON - This was missing! ==========
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
								// FIXED CODE:
									// Always connect (since we're not auto-connecting anymore)
									  await app.connect();
									  showConversationSection(name);
								} 
						   catch (error) {
								document.getElementById('auth-status').textContent = 'Connection failed';
								connectBtn.disabled = false;
						  }
				});
	  }
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
    disconnectBtn.addEventListener('click', () => {
      app.stopListening();
      document.getElementById('conversation-section').classList.add('hidden');
      document.getElementById('auth-section').classList.remove('hidden');
      document.getElementById('connect-btn').disabled = false;
      document.getElementById('auth-status').textContent = '';
    });
  }

  // ========== EXISTING CODE (keep as is) ==========
  // Microphone button
  const micButton = document.getElementById('mic-button');
  if (micButton) {
    micButton.addEventListener('click', () => app.handleMicrophoneToggle());
  }
  
  // Text input
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
  
  // Clear chat button
  const clearButton = document.getElementById('clear-chat');
  if (clearButton) {
    clearButton.addEventListener('click', () => {
      const messagesContainer = document.getElementById('messages');
      if (messagesContainer) {
        messagesContainer.innerHTML = '';
      }
    });
  }
  
  // Ping button (for testing)
  const pingButton = document.getElementById('ping-button');
  if (pingButton) {
    pingButton.addEventListener('click', () => app.sendPing());
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
    // Page is hidden, optionally pause listening
    console.log('📱 Page hidden');
  } else {
    // Page is visible again
    console.log('📱 Page visible');
  }
});

// Export app for debugging
window.SanskritTutorApp = app;