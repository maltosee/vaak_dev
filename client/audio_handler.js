// Audio handling with @ricky0123/vad-web
class AudioHandler {
    constructor() {
        this.vad = null;
        this.isListening = false;
        this.isInitialized = false;
        this.onSpeechStart = null;
        this.onSpeechEnd = null;
        this.onError = null;
        this.onStatusChange = null;
        
        console.log('🎵 AudioHandler initialized');
    }
	
    /**
     * Fetch VAD configuration from server
     */
    async fetchVADConfig() {
        try {
            console.log('📋 Fetching VAD config from server');
            const response = await fetch(`${CONFIG.getBaseURL()}/vad-config`);
            const config = await response.json();
            console.log('✅ VAD config loaded from server');
            return config;
        } catch (error) {
            console.error('❌ Failed to fetch VAD config, using defaults:', error);
            return {
                executionProvider: 'cpu',
                model: 'silero_vad_legacy.onnx',
                positiveSpeechThreshold: 0.8,
                negativeSpeechThreshold: 0.6,
                redemptionFrames: 20,
                frameSamples: 1536,
                preSpeechPadFrames: 5,
                minSpeechFrames: 15
            };
        }
    }

    /**
     * Initialize VAD with callbacks
     * @param {Object} callbacks - Event callbacks
     */
    async initialize(callbacks = {}) {
        try {
            console.log('🔧 Initializing VAD...');
            
            this.onSpeechStart = callbacks.onSpeechStart || (() => {});
            this.onSpeechEnd = callbacks.onSpeechEnd || (() => {});
            this.onError = callbacks.onError || (() => {});
            this.onStatusChange = callbacks.onStatusChange || (() => {});
			
			 // Fetch VAD configuration from server
			const vadConfig = await this.fetchVADConfig();

            // Initialize @ricky0123/vad-web
            this.vad = await vad.MicVAD.new({
				executionProvider: vadConfig.executionProvider,
                model: vadConfig.model,
                positiveSpeechThreshold: vadConfig.positiveSpeechThreshold,
                negativeSpeechThreshold: vadConfig.negativeSpeechThreshold,
                redemptionFrames: vadConfig.redemptionFrames,
                frameSamples: vadConfig.frameSamples,
                preSpeechPadFrames: vadConfig.preSpeechPadFrames,
                minSpeechFrames: vadConfig.minSpeechFrames,
                onSpeechStart: () => {
                    console.log('🎤 Speech detected - recording started');
                    this.onStatusChange('speaking');
                    this.onSpeechStart();
                },
                onSpeechEnd: (audioData) => {
                    console.log(`🎤 Speech ended - processing ${audioData.length} samples`);
                    this.onStatusChange('processing');
                    
                    // Convert Float32Array to WebM blob for server
                    this.processAudioData(audioData);
                },
                onVADMisfire: () => {
                    console.log('⚠️ VAD misfire detected');
                    this.onStatusChange('listening');
                }
            });

            this.isInitialized = true;
            console.log('✅ VAD initialized successfully');
            
            return { success: true };

        } catch (error) {
            console.error('❌ VAD initialization failed:', error);
            this.isInitialized = false;
            this.onError(`VAD initialization failed: ${error.message}`);
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Start listening for speech
     */
    async startListening() {
        try {
            if (!this.isInitialized) {
                throw new Error('VAD not initialized');
            }

            if (this.isListening) {
                console.log('⚠️ Already listening');
                return { success: true };
            }

            console.log('🎤 Starting VAD listening...');
            await this.vad.start();
            
            this.isListening = true;
            this.onStatusChange('listening');
            
            console.log('✅ VAD listening started');
            return { success: true };

        } catch (error) {
            console.error('❌ Failed to start listening:', error);
            this.onError(`Failed to start listening: ${error.message}`);
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop listening for speech
     */
    async stopListening() {
        try {
            if (!this.isListening) {
                console.log('⚠️ Not currently listening');
                return { success: true };
            }

            console.log('🛑 Stopping VAD listening...');
            await this.vad.pause();
            
            this.isListening = false;
            this.onStatusChange('idle');
            
            console.log('✅ VAD listening stopped');
            return { success: true };

        } catch (error) {
            console.error('❌ Failed to stop listening:', error);
            this.onError(`Failed to stop listening: ${error.message}`);
            
            return { success: false, error: error.message };
        }
    }

    /**
     * Process audio data from VAD and send to server
     * @param {Float32Array} audioData - Audio samples from VAD
     */
    async processAudioData(audioData) {
        try {
            console.log(`🔄 Processing audio: ${audioData.length} samples`);
            
            // Convert Float32Array to WAV blob
            const audioBlob = this.createWAVBlob(audioData, 16000);
            
            // Convert blob to array buffer for WebSocket
            const arrayBuffer = await audioBlob.arrayBuffer();
            const audioBuffer = new Uint8Array(arrayBuffer);
            
            console.log(`📤 Sending audio to server: ${audioBuffer.length} bytes`);
            
            // Send to server via callback
            this.onSpeechEnd(audioBuffer);
            
        } catch (error) {
            console.error('❌ Audio processing failed:', error);
            this.onError(`Audio processing failed: ${error.message}`);
            this.onStatusChange('listening'); // Resume listening on error
        }
    }

    /**
     * Create WAV blob from Float32Array
     * @param {Float32Array} audioData - Audio samples
     * @param {number} sampleRate - Sample rate (default 16000)
     * @returns {Blob} WAV audio blob
     */
    createWAVBlob(audioData, sampleRate = 16000) {
        const length = audioData.length;
        const buffer = new ArrayBuffer(44 + length * 2);
        const view = new DataView(buffer);
        
        // WAV header
        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };
        
        writeString(0, 'RIFF');
        view.setUint32(4, 36 + length * 2, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeString(36, 'data');
        view.setUint32(40, length * 2, true);
        
        // Convert float samples to 16-bit PCM
        let offset = 44;
        for (let i = 0; i < length; i++) {
            const sample = Math.max(-1, Math.min(1, audioData[i]));
            view.setInt16(offset, sample * 0x7FFF, true);
            offset += 2;
        }
        
        return new Blob([buffer], { type: 'audio/wav' });
    }

    /**
     * Play audio response from server
     * @param {ArrayBuffer} audioBuffer - Audio data from server
     * @param {string} format - Audio format (mp3, wav, etc.)
     */
    async playAudioResponse(audioBuffer, format = 'mp3') {
        try {
            console.log(`🔊 Playing audio response: ${audioBuffer.length} bytes`);
            
            // Create blob and object URL
            const audioBlob = new Blob([audioBuffer], { type: `audio/${format}` });
            const audioUrl = URL.createObjectURL(audioBlob);
            
            // Get audio element
            const audioElement = document.getElementById('audio-player');
            if (!audioElement) {
                throw new Error('Audio player element not found');
            }
            
            // Set up playback
            audioElement.src = audioUrl;
            
            // Handle playback events
            audioElement.onloadeddata = () => {
                console.log('🎵 Audio loaded, starting playback');
                this.onStatusChange('speaking');
            };
            
            audioElement.onended = () => {
                console.log('✅ Audio playback completed');
                URL.revokeObjectURL(audioUrl); // Clean up
                this.onStatusChange('listening');
            };
            
            audioElement.onerror = (error) => {
                console.error('❌ Audio playback error:', error);
                URL.revokeObjectURL(audioUrl);
                this.onError('Audio playback failed');
                this.onStatusChange('listening');
            };
            
            // Start playback
            await audioElement.play();
            
        } catch (error) {
            console.error('❌ Audio playback failed:', error);
            this.onError(`Audio playback failed: ${error.message}`);
            this.onStatusChange('listening');
        }
    }

    /**
     * Get current VAD status
     * @returns {Object} Status information
     */
    getStatus() {
        return {
            isInitialized: this.isInitialized,
            isListening: this.isListening,
            vadAvailable: typeof vad !== 'undefined'
        };
    }

    /**
     * Destroy VAD instance and clean up
     */
    async destroy() {
        try {
            if (this.vad && this.isListening) {
                await this.vad.pause();
            }
            
            this.vad = null;
            this.isListening = false;
            this.isInitialized = false;
            
            console.log('🗑️ AudioHandler destroyed');
            
        } catch (error) {
            console.error('❌ Error destroying AudioHandler:', error);
        }
    }

    /**
     * Test microphone access
     * @returns {boolean} True if microphone is accessible
     */
    async testMicrophone() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop()); // Stop immediately
            console.log('✅ Microphone access granted');
            return true;
        } catch (error) {
            console.error('❌ Microphone access denied:', error);
            return false;
        }
    }
}

// Export for use in app.js
window.AudioHandler = AudioHandler;