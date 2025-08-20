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
		this.clientState = 'listening';
		this.graceTimeout = null;

		
		console.log('🕉️ Enhanced Sanskrit Tutor App initialized');
	  }
  
  
	  setState(newState, reason = '', timeoutMs = null) {
			  console.log(`🔄 STATE: ${this.clientState} → ${newState} (${reason})`);
			  
			  // Clear existing timeout
			  if (this.stateTimeout) {
				clearTimeout(this.stateTimeout);
				this.stateTimeout = null;
			  }
			  
			  this.clientState = newState;
			  this.ttsPlaybackActive = (newState === 'tts_playing');
			  this.updateUIForState(newState);
			  
			  // Implement state actions
			  if (newState === 'listening') {
					this.audioHandler.startListening(); // Unblock VAD
				// No timeout needed - this is the default state
			  } 
			  else 
			  {
					//this.audioHandler.stopListening(); // Block VAD
					// Set timeout to auto-reset to listening (unless explicitly no timeout)
					if (timeoutMs !== null && newState !== 'disconnected') {
					  const gracePeriod = timeoutMs || this.config.ttsGracePeriodMs;
					  this.stateTimeout = setTimeout(() => {
						this.setState('listening', 'timeout');
					  }, gracePeriod);
					}
			  }
	  }

	updateUIForState(state) {
	  const statusMap = {
		'listening': 'Listening...',
		'processing': 'Processing...',
		'tts_playing': 'Playing response...'
	  };
	  this.updateVoiceStatus(statusMap[state] || state);
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
		  this.allowBargeInImmediate = config.allowBargeTTSPlaybackImmediate !== false; // Default true unless explicitly false

		  // Initialize audio handler
		  this.audioHandler = new AudioHandler();
		  this.audioHandler.setConfig(config);
		  this.audioHandler.onAudioData = (audioBlob) => {
			  
			  this.sendAudioToServer(audioBlob);
			  this.setState('processing', 'audio_data', this.config.ttsGracePeriodMs); // ← ADD THIS
		  };
		  
			// Enhanced barge-in with multiple detection methods
		  // Test ALL possible speech detection methods
			// REPLACE the existing onSpeechValidatedCallback setup:
		  this.audioHandler.setOnSpeechValidatedCallback(() => {
				console.log("🎤 SPEECH VALIDATED - TTS Active:", this.ttsPlaybackActive, "Allow Barge:", this.allowBargeInImmediate);
				
				// ✅ ADD THIS BLOCK FIRST:
				if (this.clientState !== 'listening' && !this.ttsPlaybackActive) 
				{
					console.log("🚫 Speech blocked - server busy, not TTS");
					this.showFlashMessage('Server busy processing, please wait...', 'warning', 1500);
					return false; // Block VAD early
				}
				if(this.clientState == 'tts_interrupted')
				{
					console.log("🚫 TTS interrupted no audio will be processed till all remaining playback is completed.. please wait");
					this.showFlashMessage('no audio will be processed till all remaining playback is completed.. please wait', 'warning', 1500);
					return false; // Block VAD early
				}
				if(this.clientState == 'disconnected')
				{
					console.log("🚫 Disconnected from server.. attempting to reconnect");
					this.showFlashMessage('Disconnected from server please wait for reconnection',1500);
					return false; // Block VAD early
				}
				
				if (this.ttsPlaybackActive && this.allowBargeInImmediate) {
					console.log("🛑 BARGE-IN: Speech detected during TTS");
					this.setState('tts_interrupted', 'tts_barge_in', this.config.ttsGracePeriodMs); // ← ADD THIS
					// Show user feedback
					this.showFlashMessage('Stopping playback, please wait audio will be enabled after existing playback completes...', 'info', 2000);
					
					// Signal server to stop
					if (this.ws && this.ws.readyState === WebSocket.OPEN) {
						
							console.log("🛑 Sending tts_interrupt to server");  // ← KEEP THIS SIMPLE LOG
							this.ws.send(JSON.stringify({
								type: 'tts_interrupt',
								reason: 'user_speech_detected'
							}));
					}
					else {
								console.log("🛑 WebSocket not ready:", {
									exists: !!this.ws,
									readyState: this.ws?.readyState
								});
					}
							
					// Show user feedback
					this.showFlashMessage('Stopping playback, please wait audio will be enabled after existing playback completes...', 'info', 2000);
					return false; // 🎯 KEY: Discard this audio, block VAD
				}
				
				
				return true; // Allow normal processing
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
		  
		  // ADD THIS LINE:
		  this.audioStreamer.setApp(this); // Pass app reference

		  // Setup event handlers
		  this.setupStreamerEventHandlers();

		  await this.initializeAudio();
		  
		  // After: await this.initializeAudio();
		  console.log('🔍 VAD DEBUG - Available properties:', Object.keys(this.audioHandler));
		  console.log('🔍 VAD DEBUG - AudioHandler methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.audioHandler)));
		  console.log('🔍 VAD DEBUG - Current state:', {
			  isListening: this.audioHandler.isListening,
			  isVadListening: this.audioHandler.isVadListening,
			  vadActive: this.audioHandler.vadActive,
			  listening: this.audioHandler.listening
		  });
		  
		  
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
			this.clearStreamCompletionTimeout(); // ADD THIS LINE at the start
			const { chunksReceived, totalDurationMs, mode } = e.detail;
			console.log(`🎵 Stream finalized (${mode}): ${chunksReceived} chunks, ${(totalDurationMs/1000).toFixed(1)}s total`);
			
			
			this.setState('listening', 'stream_finalized'); // ← REPLACE entire block with this
			this.enableUIControls();
		});
		
		
  }

  async connect() {
		console.log('🔍 CONNECT() CALLED');
		try {
		  const wsUrl = this.config.websocketUrl;
		  console.log('🔌 Connecting to WebSocket:', wsUrl);
		  
		  // Ensure clean state before connecting
		  if (this.ws) {
			this.ws.close();
			this.ws = null;
		  }
		  
		  
		  this.ws = new WebSocket(wsUrl);
		  this.setupWebSocketHandlers();
		  
		  /**await new Promise((resolve, reject) => {
			this.ws.onopen = resolve;
			this.ws.onerror = reject;
			setTimeout(() => reject(new Error('Connection timeout')), 10000);
		  });**/
		
		  console.log('✅ Connected successfully');
		  this.showStatus('Connected to Sanskrit Tutor', 'success');
		  console.log('Websocket status : ', this.isConnected);
		} catch (error) {
		  console.error('❌ Connection failed:', error);
		  this.showError('Failed to connect to server');
		  this.scheduleReconnect();
		}
  }

  setupWebSocketHandlers() {
    this.ws.onopen = () => {
      console.log('🔌 WebSocket connected at:', new Date().toISOString());
      this.isConnected = true;
	  console.log('🔌 Set isConnected to true');
      this.reconnectAttempts = 0;
      this.updateConnectionStatus(true);
	  
	  this.setState('listening', 'websocket_connected'); // ← ADD THIS
    };
    
    this.ws.onclose = (event) => {
		  console.log('🔌 WebSocket CLOSED at:', new Date().toISOString(), 'Code:', event.code, 'Reason:', event.reason, 'Clean:', event.wasClean);
		  this.isConnected = false;
		  this.updateConnectionStatus(false);
		  
		  // Stop VAD and set error state
		  //this.stopListening();
		  //this.updateAudioStatus('error');
		  
		  
		  // Clean up audio state
		  this.cleanupAudioState();
		  this.setState('disconnected', 'websocket_closed');
		  
		  if (!event.wasClean) {
			this.scheduleReconnect();
			this.setState('listening', 'websocket_closed'); // ← ADD THIS
		  }
		  
    };
    
    this.ws.onerror = (error) => {
		  console.log('🔌 WebSocket ERROR at:', new Date().toISOString(), error);
		  this.showError('Connection error occurred');
		  // Stop VAD and set error state
		  this.stopListening();
		  this.updateAudioStatus('error');
		  
		  // Clean up audio state
		  this.cleanupAudioState();
    };
	
    
    this.ws.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const data = JSON.parse(event.data);
          await this.handleWebSocketJsonMessage(data);
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
			  this.setState('tts_playing', 'tts_stream_start'); // ← ADD THIS
			  break;
			  
			case 'tts_stream_complete':				
				this.handleStreamComplete(data.total_chunks);
				this.setState('listening', 'tts_stream_complete'); 
				break;
			  
			case 'connected':
			  console.log('✅ Server connection confirmed');
			  this.showStatus('Connected to Sanskrit Tutor', 'success');
			  break;
			  
			case 'error':
			  console.error(`❌ Server error: ${data.message}`);
			  this.handleErrorMessage(data);
			  this.setState('listening', 'server error in websocket'); 
			  break;
			  
			case 'llm_response':
			  console.log(`🤖 Received LLM response: ${data.text}`);
			  this.handleLLMResponse(data);
			  this.setState('tts_starting', 'llm_response_received');
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
	  
		  console.log("🎵 TTS STREAM STARTING ");
		  
		  // CRITICAL: Keep VAD running during TTS for barge-in
		  //console.log("🎤 TTS START: VAD state before TTS:", this.audioHandler.isVadListening);
		 // console.log("🎤 TTS START: Keeping VAD active for barge-in");
		  
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
			if (!totalChunks || totalChunks <= 0) {
				console.error('Invalid total_chunks received:', totalChunks);
				this.forceStreamCleanup();
				return;
			}
			
			console.log(`✅ TTS streaming complete. Total chunks: ${totalChunks}`);
			this.audioStreamer.onStreamComplete(totalChunks);
			
			const timeoutMs = this.config.audioConfig?.streamCompletionTimeoutMs || this.config.audioConfig?.websocketTimeoutMs;
				  this.streamCompletionTimeout = setTimeout(() => {
					this.forceStreamCleanup();
			}, timeoutMs);
  
  }
  
	  forceStreamCleanup() {
			this.clearStreamCompletionTimeout();
			this.enableUIControls();
	  }

	clearStreamCompletionTimeout() {
		if (this.streamCompletionTimeout) {
			clearTimeout(this.streamCompletionTimeout);
			this.streamCompletionTimeout = null;
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
	 
		console.log('🔍 EXACT STATE: isConnected:', this.isConnected, 'ws exists:', !!this.ws, 'ws.readyState:', this.ws?.readyState, 'OPEN constant:', WebSocket.OPEN);

		
		if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
			console.error('❌ Cannot send audio: WebSocket not connected');
			this.stopListening();
			this.updateAudioStatus('error');
			this.showFlashMessage('Connection lost - stopping voice detection', 'error');
			return;
		}
		
		console.log(`📤 Sending audio to server: ${audioBlob.size} bytes`);
		this.ws.send(audioBlob);

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
	  console.log('🔍 AFTER START LISTENING: isConnected =', this.isConnected); // ADD THIS
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
  
  cleanupAudioState() {
	  if (this.audioStreamer) {
		this.audioStreamer.stopPlayback();
		this.audioStreamer.reset();
	  }
	  this.clearStreamCompletionTimeout();
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
  
  showFlashMessage(message, type = 'info', duration = 3000) {
	  const flashElement = document.getElementById('flash-message');
	  if (flashElement) {
		flashElement.textContent = message;
		flashElement.className = `flash-message ${type} show`;
		
		// Auto-hide after duration
		setTimeout(() => {
		  flashElement.classList.remove('show');
		}, duration);
	  }
  }

  // Additional utility methods...
  displayUserTranscript(transcript, language) {
	  console.log('🔍 DISPLAYING USER:', transcript);
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
	  messagesContainer.insertBefore(transcriptDiv, messagesContainer.firstChild); // Changed from appendChild
	  console.log(`📝 Displayed user transcript: "${transcript}" (${language})`);
  }

 displayAIResponse(text) {
	  console.log('🔍 DISPLAYING AI:', text);
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
	  messagesContainer.insertBefore(responseDiv, messagesContainer.firstChild); // Changed from appendChild
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

	// Stop VAD on server errors
    this.stopListening();
    this.updateAudioStatus('error');
	
	// Full state cleanup on errors
	this.cleanupAudioState();
	
  }

  handleStatusUpdateMessage(data) {
    console.log(`ℹ️ Server Status Update: ${data.message} (Code: ${data.statusCode})`);
    this.showStatus(data.message, data.statusType || 'info');
    
    this.clientState = data.statusCode === 'BUSY_SERVER' ? 'processing' : 'listening';
    
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
				console.log('🔍 AFTER CONNECT: isConnected =', app.isConnected); // ADD THIS
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
            console.log('🔍 DISCONNECT CLICKED'); // ADD THIS LINE HERE
			await app.stopListening();
            if (app.ws) {
                app.ws.close();
                app.ws = null;
            }
            app.isConnected = false;
			
			
			// ADD THIS BLOCK:
			const messagesContainer = document.getElementById('messages');
			console.log('🔍 Messages before clear:', messagesContainer?.children.length);
			if (messagesContainer) {
				messagesContainer.innerHTML = '';
				console.log('🔍 Messages after clear:', messagesContainer.children.length);
			}
			
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