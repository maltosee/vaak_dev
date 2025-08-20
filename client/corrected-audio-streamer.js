/**
 * Corrected Audio Streamer - Proper mode determination + WAV header handling
 * Batch mode: accumulate all chunks → merge → play once
 * Streaming mode: buffer threshold → merge → play → repeat
 */

export class CorrectedAudioStreamer extends EventTarget {
    constructor(config = {}, logger = console.log) {
        super();
        this.logger = (msg, level = 'info') => logger(`[CorrectedStreamer] ${msg}`, level);
        
        // Configuration from /config endpoint - NO HARDCODING
        this.config = {
            bufferThresholdMs: config.bufferThresholdMs, // From server config
            websocketTimeoutMs: config.websocketTimeoutMs, // From server config  
            minStreamingDurationMs: config.minStreamingDurationMs, // Threshold for mode determination
            ...config
        };
        
        // Validate required config
        if (!this.config.bufferThresholdMs || !this.config.websocketTimeoutMs || !this.config.minStreamingDurationMs) {
            throw new Error('Missing required config: bufferThresholdMs, websocketTimeoutMs, minStreamingDurationMs');
        }
        
        // Audio context
        this.audioContext = null;
        this.gainNode = null;
        
        // Mode determination
        this.estimatedDurationMs = 0;
        this.isStreamingMode = false; // true = streaming, false = batch
        this.modeSet = false;
        
        // State
        this.isInitialized = false;
        this.isActive = false;
        this.isPlaying = false;
        this.currentSource = null;
        
        // Buffer management
        this.audioChunks = []; // Array of {rawAudioData, sequence, duration, sampleRate, channels}
        this.chunksReceived = 0;
        this.expectedTotalChunks = null;
        this.streamComplete = false;
        this.bufferDurationMs = 0;
        this.totalDurationMs = 0;
        this.nextPlayTime = 0;
        this.endOfAudio = false;
        this.isCollecting = true;
        
        
        this.logger('Initialized corrected audio streamer');
    }

    async initialize() {
        if (this.isInitialized) return;

        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 44100,
                latencyHint: 'interactive'
            });

            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);

            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.isInitialized = true;
            this.nextPlayTime = this.audioContext.currentTime;
            
            this.logger(`Initialized - State: ${this.audioContext.state}, Rate: ${this.audioContext.sampleRate}Hz`);
            
            this.dispatchEvent(new CustomEvent('initialized', {
                detail: { sampleRate: this.audioContext.sampleRate }
            }));

        } catch (error) {
            this.logger(`Initialization failed: ${error.message}`, 'error');
            throw error;
        }
    }
	
	// In corrected-audio-streamer.js:
	setApp(app) {
	  this.app = app;
	  this.logger('App reference set for barge-in capability');
	}

    setEstimatedDuration(durationMs) {
        this.estimatedDurationMs = durationMs;
        this.isStreamingMode = durationMs > this.config.minStreamingDurationMs;
        this.modeSet = true;
        
        this.logger(`Duration: ${durationMs}ms, Mode: ${this.isStreamingMode ? 'STREAMING' : 'BATCH'} (threshold: ${this.config.minStreamingDurationMs}ms)`);
        
        this.dispatchEvent(new CustomEvent('modeSet', {
            detail: {
                estimatedDurationMs: durationMs,
                isStreamingMode: this.isStreamingMode,
                threshold: this.config.minStreamingDurationMs
            }
        }));
    }

    startStream() {
        if (!this.isInitialized) {
            throw new Error('Not initialized - call initialize() first');
        }

        this.reset();
        this.isActive = true;
        this.isCollecting = true;
        this.nextPlayTime = this.audioContext.currentTime;
        
        this.logger(`Stream started${this.modeSet ? ` in ${this.isStreamingMode ? 'STREAMING' : 'BATCH'} mode` : ' (mode pending)'}`);
        this.dispatchEvent(new CustomEvent('streamStarted'));
    }

    /**
     * Extract raw audio data from WAV chunk, removing headers
     */
    extractRawAudioFromWAV(arrayBuffer) {
        const dataView = new DataView(arrayBuffer);
        
        // Validate RIFF header
        const riff = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(0, 4)));
        if (riff !== 'RIFF') {
            throw new Error('Invalid WAV file - missing RIFF header');
        }
        
        // Parse WAV headers to find data chunk
        let offset = 12; // Skip RIFF header (4) + file size (4) + WAVE (4)
        let dataOffset = null;
        let dataSize = 0;
        let sampleRate = 0;
        let numChannels = 0;
        let bitsPerSample = 0;
        
        while (offset < arrayBuffer.byteLength - 8) {
            const chunkId = String.fromCharCode(...new Uint8Array(arrayBuffer.slice(offset, offset + 4)));
            const chunkSize = dataView.getUint32(offset + 4, true); // little endian
            
            if (chunkId === 'fmt ') {
                // Format chunk - extract audio parameters
                numChannels = dataView.getUint16(offset + 10, true);
                sampleRate = dataView.getUint32(offset + 12, true);
                bitsPerSample = dataView.getUint16(offset + 22, true);
                
                this.logger(`WAV format: ${numChannels}ch, ${sampleRate}Hz, ${bitsPerSample}bit`);
                
            } else if (chunkId === 'data') {
                // Data chunk - this is the raw audio we want
                dataOffset = offset + 8;
                dataSize = chunkSize;
                break;
            }
            
            offset += 8 + chunkSize;
        }
        
        if (dataOffset === null) {
            throw new Error('No data chunk found in WAV file');
        }
        
        // Extract raw audio data (without WAV headers)
        const rawAudioData = arrayBuffer.slice(dataOffset, dataOffset + dataSize);
        
        return {
            rawAudioData,
            sampleRate,
            numChannels,
            bitsPerSample,
            dataSize
        };
    }

    /**
     * Merge raw audio data chunks and create proper WAV file
     */
    mergeRawAudioToWAV(chunks) {
        if (chunks.length === 0) return null;
        
        // Ensure all chunks have same format
        const firstChunk = chunks[0];
        const { sampleRate, numChannels, bitsPerSample } = firstChunk;
        
        for (const chunk of chunks) {
            if (chunk.sampleRate !== sampleRate || chunk.numChannels !== numChannels || chunk.bitsPerSample !== bitsPerSample) {
                this.logger(`Format mismatch in chunk ${chunk.sequence}: expected ${numChannels}ch/${sampleRate}Hz/${bitsPerSample}bit, got ${chunk.numChannels}ch/${chunk.sampleRate}Hz/${chunk.bitsPerSample}bit`, 'warning');
            }
        }
        
        // Calculate total data size
        const totalDataSize = chunks.reduce((sum, chunk) => sum + chunk.rawAudioData.byteLength, 0);
        const blockAlign = numChannels * (bitsPerSample / 8);
        const byteRate = sampleRate * blockAlign;
        
        // Create complete WAV file with proper headers
        const wavHeaderSize = 44;
        const totalFileSize = wavHeaderSize + totalDataSize;
        const wavBuffer = new ArrayBuffer(totalFileSize);
        const wavView = new DataView(wavBuffer);
        const wavBytes = new Uint8Array(wavBuffer);
        
        // Write WAV header
        let offset = 0;
        
        // RIFF header
        wavBytes.set([0x52, 0x49, 0x46, 0x46], offset); // "RIFF"
        offset += 4;
        wavView.setUint32(offset, totalFileSize - 8, true); // File size - 8
        offset += 4;
        wavBytes.set([0x57, 0x41, 0x56, 0x45], offset); // "WAVE"
        offset += 4;
        
        // Format chunk
        wavBytes.set([0x66, 0x6D, 0x74, 0x20], offset); // "fmt "
        offset += 4;
        wavView.setUint32(offset, 16, true); // Format chunk size
        offset += 4;
        wavView.setUint16(offset, 1, true); // Audio format (PCM)
        offset += 2;
        wavView.setUint16(offset, numChannels, true); // Number of channels
        offset += 2;
        wavView.setUint32(offset, sampleRate, true); // Sample rate
        offset += 4;
        wavView.setUint32(offset, byteRate, true); // Byte rate
        offset += 4;
        wavView.setUint16(offset, blockAlign, true); // Block align
        offset += 2;
        wavView.setUint16(offset, bitsPerSample, true); // Bits per sample
        offset += 2;
        
        // Data chunk header
        wavBytes.set([0x64, 0x61, 0x74, 0x61], offset); // "data"
        offset += 4;
        wavView.setUint32(offset, totalDataSize, true); // Data size
        offset += 4;
        
        // Merge raw audio data from all chunks in sequence order
        chunks.sort((a, b) => a.sequence - b.sequence);
        
        for (const chunk of chunks) {
            wavBytes.set(new Uint8Array(chunk.rawAudioData), offset);
            offset += chunk.rawAudioData.byteLength;
        }
        
        this.logger(`Merged WAV: ${chunks.length} chunks, ${totalDataSize} bytes audio data, ${totalFileSize} bytes total`);
        
        return wavBuffer;
    }

    async addChunk(arrayBuffer, sequence = null) {
        
		console.log(`🔍 FLOW: addChunk() ENTRY - sequence=${sequence}`);
		
		console.log(`🔍 FLOW: addChunk() PROCESSING - sequence=${sequence}`);

        // Auto-sequence if not provided
        if (sequence === null) {
            sequence = this.chunksReceived + 1;
        }

        this.logger(`Chunk ${sequence} received (${arrayBuffer.byteLength} bytes)`);

        try {
            // Decode immediately like HTML client
				const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
				console.log(`🔍 FLOW: audioBuffer decoded - duration=${audioBuffer.duration * 1000}ms`);
				
				const chunkDurationMs = audioBuffer.duration * 1000;

				// Store decoded AudioBuffer (like HTML client)
				const chunkData = {
					buffer: audioBuffer,
					sequence,
					duration: chunkDurationMs,
					received: Date.now()
				};
            
				console.log(`🔍 FLOW: chunkData created - sequence=${sequence}, duration=${chunkDurationMs}`);
            
				this.chunksReceived++;
				this.totalDurationMs += chunkDurationMs;

				this.logger(`Chunk ${sequence} processed (${chunkDurationMs.toFixed(0)}ms) - Buffer: ${this.bufferDurationMs.toFixed(0)}ms`);
				
				console.log(`🔍 FLOW: counters updated - chunksReceived=${this.chunksReceived}, totalDurationMs=${this.totalDurationMs}`);

				
				// Dispatch buffer update
				this.dispatchEvent(new CustomEvent('bufferUpdate', {
					detail: {
						chunksReceived: this.chunksReceived,
						bufferDurationMs: this.bufferDurationMs,
						totalDurationMs: this.totalDurationMs,
						mode: this.modeSet ? (this.isStreamingMode ? 'streaming' : 'batch') : 'pending'
					}
				}));

				// Check if stream is complete
				if (this.streamComplete) {
					this.checkStreamCompletion();
				}
				
				console.log(`🔍 FLOW: mode check - modeSet=${this.modeSet}, isStreamingMode=${this.isStreamingMode}`);
				// Handle based on mode
				if (this.modeSet) {
					console.log(`🔍 FLOW: entering mode-specific logic`);
					if (this.isStreamingMode) {
						console.log(`🔍 FLOW: STREAMING branch entered`);
						// Add to buffer
						this.audioChunks.push(chunkData);
						
						console.log(`🔍 FLOW: before buffer update - bufferDurationMs=${this.bufferDurationMs}`);
						this.bufferDurationMs += chunkDurationMs;
						
						
						console.log(`🔍 FLOW: after buffer update - bufferDurationMs=${this.bufferDurationMs}, threshold=${this.config.bufferThresholdMs}`);
						
						console.log(`🔍 FLOW: threshold check - condition=${this.bufferDurationMs >= this.config.bufferThresholdMs}`);
						
						// STREAMING MODE: Check buffer threshold for playback
						if (this.bufferDurationMs >= this.config.bufferThresholdMs) {
							
							this.logger(`STREAMING: Buffer threshold reached (${this.bufferDurationMs.toFixed(0)}ms) - playing buffer`);
							await this.flushBufferToPlayback();
						}
					} else {
						
						console.log(`🔍 FLOW: BATCH branch entered`);
						// BATCH MODE: Just accumulate, play only when complete
						this.audioChunks.push(chunkData);
						this.bufferDurationMs += chunkDurationMs;
						this.logger(`BATCH: Accumulating chunk ${sequence} (${this.audioChunks.length} total)`);
					}
				}
				
				// After successful chunk processing, check completion again
				if (this.streamComplete) {
					this.checkStreamCompletion();
				}
				
				console.log(`🔍 FLOW: addChunk() COMPLETE - sequence=${sequence}`);
				return true;

        } catch (error) {
				this.logger(`Failed to process chunk ${sequence}: ${error.message}`, 'error');
				return false;
		}
		
		
    }

    onStreamComplete(totalChunks) {
        this.streamComplete = true;
        this.expectedTotalChunks = totalChunks;
        
        this.logger(`Stream complete signal - expecting ${totalChunks} total chunks (have ${this.chunksReceived})`);
		
		this.startGracePeriodTimer();
        
        this.checkStreamCompletion();
    }
	
	
	startGracePeriodTimer() {
		this.clearGracePeriodTimer();
		this.gracePeriodTimer = setTimeout(() => {
			this.logger(`Grace period expired - forcing completion with ${this.chunksReceived}/${this.expectedTotalChunks} chunks`, 'warning');
			this.forceCompletion();
		}, 2000); // 2 second grace period
	}
	
	forceCompletion() {
	  console.log('🔄 FORCE COMPLETION: Cleaning up interrupted stream');
	  this.clearGracePeriodTimer();
	  this.finalizeStream();
	}

	clearGracePeriodTimer() {
		if (this.gracePeriodTimer) {
			clearTimeout(this.gracePeriodTimer);
			this.gracePeriodTimer = null;
		}
	}
	

    checkStreamCompletion() {
        if (this.streamComplete && this.expectedTotalChunks && 
            this.chunksReceived >= this.expectedTotalChunks) {
            
            this.clearGracePeriodTimer();
			this.logger(`All ${this.expectedTotalChunks} chunks received - finalizing`);
			
				// NOW it's safe to flush remaining buffer
			if (this.audioChunks.length > 0) {
				this.flushBufferToPlayback();
			} else {
				this.finalizeStream();
			}
		   
        }
    }
	
	async flushBufferToPlayback() {
		
		console.log(`🎯 FLUSH: flushBufferToPlayback() called with ${this.audioChunks.length} chunks, ${this.bufferDurationMs}ms buffer`);
		
		console.log(`🎯 FLUSH: TTS playing - VAD state:`, this.app?.audioHandler?.isVadListening);
		console.log(`🎯 FLUSH: User listening state:`, this.app?.isListening);
		console.log(`🎯 FLUSH: Allow barge-in:`, this.app?.allowBargeInImmediate);

		// Force VAD restart if needed for barge-in
		if (this.app?.allowBargeInImmediate && !this.app?.audioHandler?.isVadListening) {
		  console.log(`🎤 FLUSH: Restarting VAD for barge-in detection`);
		  this.app.audioHandler.startListening();
		}
		
		
		console.log(`🎯 FLUSH: Audio context state:`, this.audioContext?.state);
		console.log(`🎯 FLUSH: this.app exists:`, !!this.app);
		console.log(`🎯 FLUSH: audioHandler exists:`, !!this.app?.audioHandler);
		console.log(`🎯 FLUSH: VAD initialized:`, this.app?.audioHandler?.isVadInitialized);
		
		
		if (this.audioChunks.length === 0) return;
		
		this.isPlaying = true;
		
		// Sort chunks by sequence
		this.audioChunks.sort((a, b) => a.sequence - b.sequence);
		
		// Merge AudioBuffers directly (exactly like HTML client)
		const firstBuffer = this.audioChunks[0].buffer;
		const totalSamples = this.audioChunks.reduce((sum, chunk) => sum + chunk.buffer.length, 0);
		const mergedBuffer = this.audioContext.createBuffer(
			firstBuffer.numberOfChannels,
			totalSamples,
			firstBuffer.sampleRate
		);
		
		let offset = 0;
		for (const chunk of this.audioChunks) {
			for (let channel = 0; channel < chunk.buffer.numberOfChannels; channel++) {
				mergedBuffer.getChannelData(channel).set(chunk.buffer.getChannelData(channel), offset);
			}
			offset += chunk.buffer.length;
		}
		
		// Schedule playback
		this.currentSource = this.audioContext.createBufferSource();
		this.currentSource.buffer = mergedBuffer;
		this.currentSource.connect(this.gainNode);
		this.currentSource.start(this.nextPlayTime);
		this.nextPlayTime = Math.max(this.audioContext.currentTime, this.nextPlayTime) + mergedBuffer.duration;
		
		// Handle completion
		this.currentSource.onended = () => {
			this.isPlaying = false;
			this.currentSource = null;
			
			if (this.endOfStream && this.audioChunks.length === 0) {
				this.finalizeStream();
			} else if (this.isStreamingMode) {
				this.dispatchEvent(new CustomEvent('playbackPaused'));
			}
		};
		
		// Reset buffer
		this.audioChunks = [];
		this.bufferDurationMs = 0;
		this.logger(`Flushed buffer to playback, reset counter to 0`);
	}
	

    setVolume(volume) {
        if (this.gainNode) {
            this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
            return true;
        }
        return false;
    }
	
	finalizeStream() {
		this.logger(`🎵 Stream finalized - ${this.chunksReceived} chunks, ${this.totalDurationMs.toFixed(1)}ms total`);
		this.dispatchEvent(new CustomEvent('streamFinalized', {
			detail: {
				chunksReceived: this.chunksReceived,
				totalDurationMs: this.totalDurationMs,
				mode: this.isStreamingMode ? 'streaming' : 'batch'
			}
		}));
	}

    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            return true;
        }
        return false;
    }

	stopPlayback() {
		  console.log("🎯 STREAMER STOP: currentSource exists:", !!this.currentSource, "isPlaying:", this.isPlaying);
		  
		  if (this.currentSource) {
			try {
			  this.currentSource.stop();
			  this.currentSource.disconnect();
			  console.log("🎯 STREAMER STOP: Audio source stopped and disconnected");
			} catch (e) {
			  console.log("🎯 STREAMER STOP: Source already stopped:", e.message);
			}
			this.currentSource = null;
		  }
		  
		  this.isPlaying = false;
		  this.isCollecting = false;
		  
		  // ADD THESE NEW LINES:
		  this.clearGracePeriodTimer();
		  this.streamComplete = false;
		  this.expectedTotalChunks = null;
		  // END NEW LINES
		  
		  this.audioChunks = [];
		  this.bufferDurationMs = 0;
		  
		  console.log("🎯 STREAMER STOP: Complete - isPlaying:", this.isPlaying);
	}

    reset() {
		this.stopPlayback();
    
		// Reset ONLY stream state
		this.audioChunks = [];
		this.chunksReceived = 0;
		this.expectedTotalChunks = null;
		this.streamComplete = false;
		this.bufferDurationMs = 0;
		this.totalDurationMs = 0;
		this.endOfAudio = false;
		this.isCollecting = false;
		this.isPlaying = false;
		this.hasReceivedFirstChunk = false;
		
		
		
		if (this.audioContext) {
			this.nextPlayTime = this.audioContext.currentTime;
		}
    }

    destroy() {
        this.reset();
        
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        
        this.logger('Streamer destroyed');
    }

    getMetrics() {
        return {
            isActive: this.isActive,
            isPlaying: this.isPlaying,
            isStreamingMode: this.isStreamingMode,
            modeSet: this.modeSet,
            estimatedDurationMs: this.estimatedDurationMs,
            chunksReceived: this.chunksReceived,
            bufferDurationMs: this.bufferDurationMs,
            totalDurationMs: this.totalDurationMs,
            contextState: this.audioContext?.state || 'unknown'
        };
    }
	
	createSimpleWAV(chunk) {
		const { rawAudioData, sampleRate, numChannels, bitsPerSample } = chunk;
		const dataSize = rawAudioData.byteLength;
		const blockAlign = numChannels * (bitsPerSample / 8);
		const byteRate = sampleRate * blockAlign;
		
		const wavBuffer = new ArrayBuffer(44 + dataSize);
		const view = new DataView(wavBuffer);
		const bytes = new Uint8Array(wavBuffer);
		
		// Write WAV header
		bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
		view.setUint32(4, 36 + dataSize, true);
		bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
		bytes.set([0x66, 0x6D, 0x74, 0x20], 12); // "fmt "
		view.setUint32(16, 16, true);
		view.setUint16(20, 1, true);
		view.setUint16(22, numChannels, true);
		view.setUint32(24, sampleRate, true);
		view.setUint32(28, byteRate, true);
		view.setUint16(32, blockAlign, true);
		view.setUint16(34, bitsPerSample, true);
		bytes.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
		view.setUint32(40, dataSize, true);
		bytes.set(new Uint8Array(rawAudioData), 44);
		
		return wavBuffer;
	}
	
	
	
	
}