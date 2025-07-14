// Enhanced Audio Handler with VAD delay support
class AudioHandler {
  constructor() {
    this.isRecording = false;
    this.isListening = false;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.vad = null;
    this.vadConfig = null;
    this.isVadInitialized = false;
    this.vadEndDelayMs = 1500; // Default delay
    this.delayTimeoutId = null;
    this.onAudioData = null; // Callback for audio data
	this.audioMinDurationMs = 0; // Initialize, will be set from server config
	this.lastSpeechEndTime = 0;
	this.bargeInCooldownMs = config.bargeInCooldownMs || 20000;
    
    console.log('🎵 AudioHandler initialized');
  }

  /**
   * Initialize VAD and audio context
   */
  async initialize() {
    try {
		  console.log('🔧 Initializing VAD...');
		  
		  // Fetch VAD configuration from server
		  await this.fetchVadConfig();
		  
		  // Initialize VAD
		  //const vadModule = await import('https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.7/dist/bundle.min.js');
		  this.vad = await window.vad.MicVAD.new({
			  ...this.vadConfig,
			  onSpeechStart: () => this.onSpeechStart(),
			  onSpeechEnd: (samples) => this.onSpeechEnd(samples),
			  onVADMisfire: () => this.onVadMisfire()
			});
		  
		  this.isVadInitialized = true;
		  console.log('✅ VAD initialized successfully');
      
    } catch (error) {
      console.error('❌ VAD initialization failed:', error);
      throw error;
    }
  }

  /**
   * Fetch VAD configuration from server
   */
   async fetchVadConfig() {
		  console.log('📋 Fetching VAD config from server');
		  //const response = await fetch('/config');
		  
		  const baseUrl = window.BACKEND_URL || ''; // default to current origin if not set
		  const response = await fetch(`${baseUrl}/config`);

		  
		  if (!response.ok) {
			throw new Error(`❌ Failed to fetch /config (status: ${response.status})`);
		  }

		  const serverConfig = await response.json();

		  // Mandatory: must exist or throw
		  if (!serverConfig.vadConfig) {
			throw new Error('❌ Missing vadConfig in server response');
		  }

		  this.vadEndDelayMs = serverConfig.vadEndDelayMs;
		  this.audioMinDurationMs = parseInt(serverConfig.audioConfig?.minDuration) || 1500;

		  this.vadConfig = {
			positiveSpeechThreshold: serverConfig.vadConfig.positiveSpeechThreshold,
			negativeSpeechThreshold: serverConfig.vadConfig.negativeSpeechThreshold,
			redemptionFrames: serverConfig.vadConfig.redemptionFrames,
			preSpeechPadFrames: serverConfig.vadConfig.preSpeechPadFrames,
			minSpeechFrames: serverConfig.vadConfig.minSpeechFrames,
			frameSamples: 1536  // optional: move to backend if needed
		  };

		  console.log('✅ VAD config loaded from server');
		  console.log(`🔧 VAD end delay: ${this.vadEndDelayMs}ms`);
	}


  /**
   * Update VAD end delay from server config
   * @param {number} delayMs - Delay in milliseconds
   */
  updateVadEndDelay(delayMs) {
    this.vadEndDelayMs = delayMs || 1500;
    console.log(`🔧 VAD end delay updated: ${this.vadEndDelayMs}ms`);
  }

  /**
   * Handle speech start event
   */
  onSpeechStart() {
    console.log('🎤 Speech detected - recording started');
    this.isRecording = true;
    
    // Update UI to show recording state
    this.updateUIState('recording');
  }

  /**
   * Handle speech end event with configurable delay
   * @param {Float32Array} samples - Audio samples
   */
  async onSpeechEnd(samples) {
		console.log(`🎤 Speech ended - processing ${samples.length} samples`);
		
		  // ✅ ADD: Duration filter for nonsense utterances
		  const durationMs = (samples.length / 16000) * 1000; // Assuming 16kHz sample rate
		  if (durationMs < this.audioMinDurationMs) { // Filter out utterances shorter than 0.5 seconds
			console.log(`⏱️ Skipping short utterance (${Math.round(durationMs)}ms < 500ms)`);
			this.isRecording = false;
			this.updateUIState('listening');
			return;
		  }
		
		
		this.lastSpeechEndTime = Date.now(); // Track last speech end timestamp
	
		// Now check for barge-in logic
		  if (audioPlayer && !audioPlayer.paused) {
				const timeSinceLastSpeech = Date.now() - this.lastSpeechEndTime;
				if (timeSinceLastSpeech < this.bargeInCooldownMs) {
				  console.log(`🔊 Barge-in blocked - cooldown active (${timeSinceLastSpeech}ms < ${this.bargeInCooldownMs}ms)`);
				  return;
				}
				audioPlayer.pause();
				console.log(`🔊 Barge-in allowed - stopping current TTS`);
		  }


	

	
    
    // Clear any existing delay timeout
    if (this.delayTimeoutId) {
      clearTimeout(this.delayTimeoutId);
    }
    
    // Update UI to show processing state
    this.updateUIState('processing');
    
    // Add configurable delay before processing
    console.log(`⏳ Waiting ${this.vadEndDelayMs}ms before sending to server...`);
    
    this.delayTimeoutId = setTimeout(async () => {
      try {
        await this.processAudioSamples(samples);
      } catch (error) {
        console.error('❌ Audio processing error:', error);
        this.updateUIState('error');
      }
    }, this.vadEndDelayMs);
  }

  /**
   * Process audio samples and send to server
   * @param {Float32Array} samples - Audio samples
   */
  async processAudioSamples(samples) {
    console.log(`🔄 Processing audio: ${samples.length} samples`);
    
    try {
      // Convert samples to blob
      const audioBlob = this.samplesToBlob(samples);
      
      // Send to server
      console.log(`📤 Sending audio to server: ${audioBlob.size} bytes`);
      this.sendAudioToServer(audioBlob);
      
      this.isRecording = false;
      
    } catch (error) {
      console.error('❌ Failed to process audio samples:', error);
      this.updateUIState('error');
      throw error;
    }
  }

  /**
   * Convert Float32Array samples to audio blob
   * @param {Float32Array} samples - Audio samples
   * @returns {Blob} Audio blob
   */
  samplesToBlob(samples) {
    try {
      // Convert float32 to int16
      const int16Array = new Int16Array(samples.length);
      for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        int16Array[i] = sample * 0x7FFF;
      }
      
      // Create WAV header
      const wavHeader = this.createWavHeader(int16Array.length * 2, 16000, 1);
      
      // Combine header and data
      const wavData = new Uint8Array(wavHeader.length + int16Array.byteLength);
      wavData.set(wavHeader, 0);
      wavData.set(new Uint8Array(int16Array.buffer), wavHeader.length);
      
      return new Blob([wavData], { type: 'audio/wav' });
      
    } catch (error) {
      console.error('❌ Failed to convert samples to blob:', error);
      throw error;
    }
  }

  /**
   * Create WAV file header
   * @param {number} dataLength - Length of audio data
   * @param {number} sampleRate - Sample rate
   * @param {number} channels - Number of channels
   * @returns {Uint8Array} WAV header
   */
  createWavHeader(dataLength, sampleRate, channels) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    
    // WAV header
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels * 2, true);
    view.setUint16(32, channels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    
    return new Uint8Array(header);
  }

  /**
   * Send audio data to server via callback
   * @param {Blob} audioBlob - Audio data
   */
  sendAudioToServer(audioBlob) {
    if (this.onAudioData && typeof this.onAudioData === 'function') {
      this.onAudioData(audioBlob);
    } else {
      console.error('❌ No audio data callback configured');
    }
  }

  /**
   * Handle VAD misfire (false positive)
   */
  onVadMisfire() {
    console.log('🔇 VAD misfire detected');
    this.isRecording = false;
    this.updateUIState('listening');
  }

  /**
   * Start listening for speech
   */
  async startListening() {
    try {
      if (!this.isVadInitialized) {
        throw new Error('VAD not initialized');
      }
      
      console.log('🎤 Starting VAD listening...');
      await this.vad.start();
      this.isListening = true;
      
      console.log('✅ VAD listening started');
      this.updateUIState('listening');
      
    } catch (error) {
      console.error('❌ Failed to start listening:', error);
      throw error;
    }
  }

  /**
   * Stop listening for speech
   */
  async stopListening() {
    try {
      console.log('🛑 Stopping VAD listening...');
      
      // Clear any pending delay timeout
      if (this.delayTimeoutId) {
        clearTimeout(this.delayTimeoutId);
        this.delayTimeoutId = null;
      }
      
      if (this.vad) {
        await this.vad.pause();
      }
      
      this.isListening = false;
      this.isRecording = false;
      
      console.log('✅ VAD listening stopped');
      this.updateUIState('stopped');
      
    } catch (error) {
      console.error('❌ Failed to stop listening:', error);
    }
  }

  /**
   * Update UI state
   * @param {string} state - Current state (listening, recording, processing, error, stopped)
   */
  updateUIState(state) {
    const stateIndicator = document.getElementById('state-indicator');
    const micButton = document.getElementById('mic-button');
    
    if (stateIndicator) {
      stateIndicator.textContent = this.getStateText(state);
      stateIndicator.className = `state-indicator ${state}`;
    }
    
    if (micButton) {
      micButton.className = `mic-button ${state}`;
      micButton.disabled = (state === 'processing');
    }
    
    // Update other UI elements
    this.updateStatusDisplay(state);
  }

  /**
   * Get human-readable state text
   * @param {string} state - State code
   * @returns {string} Human-readable text
   */
  getStateText(state) {
    const stateTexts = {
      'listening': '🎤 Listening...',
      'recording': '🔴 Recording',
      'processing': '⏳ Processing...',
      'error': '❌ Error',
      'stopped': '⏹️ Stopped'
    };
    
    return stateTexts[state] || '❓ Unknown';
  }

  /**
   * Update status display
   * @param {string} state - Current state
   */
  updateStatusDisplay(state) {
    const statusElement = document.getElementById('audio-status');
    if (statusElement) {
      statusElement.innerHTML = `
        <div class="status-item">
          <span class="label">Audio State:</span>
          <span class="value ${state}">${this.getStateText(state)}</span>
        </div>
        <div class="status-item">
          <span class="label">VAD Delay:</span>
          <span class="value">${this.vadEndDelayMs}ms</span>
        </div>
        <div class="status-item">
          <span class="label">Recording:</span>
          <span class="value">${this.isRecording ? 'Yes' : 'No'}</span>
        </div>
      `;
    }
  }

  /**
   * Request microphone permissions
   * @returns {Promise<boolean>} Permission granted
   */
  async requestMicrophonePermission() {
    try {
      console.log('🎤 Requesting microphone access...');
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000
        } 
      });
      
      // Stop the stream since VAD will handle microphone access
      stream.getTracks().forEach(track => track.stop());
      
      console.log('✅ Microphone access granted');
      return true;
      
    } catch (error) {
      console.error('❌ Microphone access denied:', error);
      return false;
    }
  }

  /**
   * Check if audio is supported
   * @returns {boolean} Audio support status
   */
  isAudioSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * Get audio handler status
   * @returns {Object} Status information
   */
  getStatus() {
    return {
      isInitialized: this.isVadInitialized,
      isListening: this.isListening,
      isRecording: this.isRecording,
      vadEndDelayMs: this.vadEndDelayMs,
      audioSupported: this.isAudioSupported()
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    try {
      await this.stopListening();
      
      if (this.delayTimeoutId) {
        clearTimeout(this.delayTimeoutId);
      }
      
      if (this.vad) {
        await this.vad.destroy();
      }
      
      console.log('🧹 AudioHandler cleaned up');
      
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  }
}

// Export for use in main app
window.AudioHandler = AudioHandler;