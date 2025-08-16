/**
 * Batch Scheduling Audio Streamer
 * Built from scratch for Sanskrit Tutor with intelligent batch vs streaming modes
 * All timing values in milliseconds for consistency
 */

export class BatchSchedulingAudioStreamer extends EventTarget {
    constructor(config = {}, logger = console.log) {
        super();
        this.logger = (msg, level = 'info') => logger(`[BatchStreamer] ${msg}`, level);
        
        this.logger(`🔍 Streamer constructor received config:`, 'debug', config);
        
        // Configuration - ALL VALUES IN MILLISECONDS
        this.config = {
            batchSizeMs: config.batchSizeMs, // ms worth of audio per batch
            maxBufferDepthMs: config.maxBufferDepthMs , // max ms scheduled ahead
            graceTimeoutMs: config.graceTimeoutMs, // ms to wait for missing chunks
            minStreamingDurationMs: config.minStreamingDurationMs, // threshold for streaming vs batch
            adaptivePlayback: false, // Always disabled for predictable playback
            ...config
        };
        
        this.logger(`🔍 Final applied config (all ms):`, 'debug', JSON.stringify(this.config, null, 2));
        
        // Audio context
        this.audioContext = null;
        this.gainNode = null;
        
        // Mode determination
        this.estimatedDurationMs = 0;
        this.isStreamingMode = false;
        this.isInitialized = false;
        this.isActive = false;
        
        // Chunk management
        this.chunks = new Map(); // sequence -> { arrayBuffer, audioBuffer, duration, received, scheduled }
        this.chunksReceived = 0;
        this.expectedTotalChunks = null;
        this.streamCompleteReceived = false;
        
        // Batch mode state
        this.pendingBatchChunks = []; // Chunks waiting for batch
        this.currentBatchDurationMs = 0;
        this.isWaitingForBatch = false;
        this.lastBatchScheduledTime = 0;
        
        // Streaming mode state
        this.scheduledSources = [];
        this.nextPlayTime = 0;
        this.isPlaybackStarted = false;
        this.lastScheduledSequence = 0;
        
        // Completion tracking
        this.graceTimer = null;
        this.isFinalized = false;
        
        // Metrics
        this.metrics = {
            streamStartTime: null,
            firstChunkTime: null,
            completionTime: null,
            totalBytes: 0,
            batchesScheduled: 0,
            chunksScheduled: 0
        };
        
        this.logger('Initialized with batch scheduling support');
    }

    async initialize() {
        if (this.isInitialized) {
            this.logger('Already initialized', 'warning');
            return;
        }

        try {
            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 44100,
                latencyHint: 'interactive'
            });

            // Create gain node for volume control
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);

            // Resume context if suspended
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            this.isInitialized = true;
            this.logger(`Initialized - State: ${this.audioContext.state}, Rate: ${this.audioContext.sampleRate}Hz`);
            
            this.dispatchEvent(new CustomEvent('initialized', {
                detail: {
                    sampleRate: this.audioContext.sampleRate,
                    state: this.audioContext.state
                }
            }));

        } catch (error) {
            this.logger(`Initialization failed: ${error.message}`, 'error');
            throw error;
        }
    }

    setEstimatedDuration(durationMs) {
        this.estimatedDurationMs = durationMs;
        this.isStreamingMode = durationMs > this.config.minStreamingDurationMs;
        
        this.logger(`Duration estimate: ${durationMs}ms, Mode: ${this.isStreamingMode ? 'STREAMING' : 'BATCH'}`);
        
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

        // Reset state for new stream
        this.reset();
        
        this.isActive = true;
        this.nextPlayTime = this.audioContext.currentTime;
        this.metrics.streamStartTime = Date.now();
        
        this.logger(`Stream started in ${this.isStreamingMode ? 'STREAMING' : 'BATCH'} mode`);
        this.dispatchEvent(new CustomEvent('streamStarted', {
            detail: { mode: this.isStreamingMode ? 'streaming' : 'batch' }
        }));
    }

    async addChunk(arrayBuffer, sequence = null) {
        if (!this.isActive) {
            this.logger(`Chunk rejected - not active (sequence: ${sequence})`, 'warning');
            return false;
        }

        // Auto-sequence if not provided
        if (sequence === null) {
            sequence = this.chunksReceived + 1;
        }

        this.logger(`Chunk ${sequence} received (${arrayBuffer.byteLength} bytes)`);

        try {
            // Decode audio to get duration
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
			this.logger(`🔍 Chunk ${sequence}: ${audioBuffer.sampleRate}Hz, ${audioBuffer.numberOfChannels}ch, samples: ${audioBuffer.length}`);
			
			// Check for silence/corruption
			const channelData = audioBuffer.getChannelData(0);
			const firstSamples = Array.from(channelData.slice(0, 10)).map(s => s.toFixed(3));
			this.logger(`🔍 First samples: [${firstSamples.join(', ')}]`);


			
            const chunkDurationMs = audioBuffer.duration * 1000;
            
            // Store chunk
            const chunkData = {
                arrayBuffer: arrayBuffer.slice(0), // Clone to avoid detachment
                audioBuffer,
                duration: chunkDurationMs,
                received: Date.now(),
                scheduled: false,
                sequence
            };
            
            this.chunks.set(sequence, chunkData);
            this.chunksReceived++;
            this.metrics.totalBytes += arrayBuffer.byteLength;
            
            // Track first chunk
            if (this.metrics.firstChunkTime === null) {
                this.metrics.firstChunkTime = Date.now() - this.metrics.streamStartTime;
                this.dispatchEvent(new CustomEvent('firstChunk', {
                    detail: { ttfc: this.metrics.firstChunkTime }
                }));
            }

            this.logger(`Chunk ${sequence} decoded (${chunkDurationMs.toFixed(0)}ms, ${audioBuffer.numberOfChannels}ch)`);

            // Route to appropriate mode handler
            if (this.isStreamingMode) {
                await this.handleStreamingChunk(chunkData);
            } else {
                await this.handleBatchChunk(chunkData);
            }

            return true;

        } catch (error) {
            this.logger(`Failed to process chunk ${sequence}: ${error.message}`, 'error');
            return false;
        }
    }

    async handleStreamingChunk(chunkData) {
        this.logger(`📡 Streaming: Collecting chunk ${chunkData.sequence} for batch (${chunkData.duration.toFixed(0)}ms)`);
        
        // Add to pending batch for streaming mode
        this.pendingBatchChunks.push(chunkData);
        this.currentBatchDurationMs += chunkData.duration;
        
        this.logger(`Streaming batch progress: ${this.currentBatchDurationMs.toFixed(0)}ms / ${this.config.batchSizeMs}ms`);
        
        // Check if batch is ready to schedule (streaming mode uses batches)
        if (this.currentBatchDurationMs >= this.config.batchSizeMs && !this.isWaitingForBatch) {
            await this.scheduleBatch();
        }
        
        this.updateBatchStatus();
    }

    async handleBatchChunk(chunkData) {
        this.logger(`💾 Batch: Collecting chunk ${chunkData.sequence} - waiting for ALL chunks`);
        
        // In batch mode, just collect all chunks - no early scheduling
        // Chunks will be scheduled only when stream is complete
        
        this.updateBatchStatus();
    }

    startPlayback() {
        if (this.isPlaybackStarted) return;

        this.isPlaybackStarted = true;
        
        // Small delay to ensure context is ready
        this.nextPlayTime = Math.max(this.nextPlayTime, this.audioContext.currentTime + 0.1);
        
        this.logger(`Playback started - Next play time: ${this.nextPlayTime.toFixed(3)}s`);
        
        this.dispatchEvent(new CustomEvent('playbackStarted', {
            detail: {
                startTime: this.nextPlayTime,
                mode: this.isStreamingMode ? 'streaming' : 'batch'
            }
        }));

        // Schedule available chunks
        //this.scheduleSequentialChunks();
    }

    async scheduleBatch() {
        if (this.pendingBatchChunks.length === 0) return;
        
        this.logger(`🚀 Scheduling batch: ${this.pendingBatchChunks.length} chunks, ${this.currentBatchDurationMs.toFixed(0)}ms`);
        
        this.isWaitingForBatch = true;
        this.lastBatchScheduledTime = Date.now();
        
        // Sort chunks by sequence to ensure proper order
        this.pendingBatchChunks.sort((a, b) => a.sequence - b.sequence);
        
        // Start playback if not already started
        if (!this.isPlaybackStarted) {
            this.startPlayback();
        }
        
        // Schedule all chunks in the batch
        for (const chunk of this.pendingBatchChunks) {
            if (!chunk.scheduled) {  // ✅ ADD THIS CHECK
				this.scheduleChunk(chunk.audioBuffer, chunk.sequence);
				chunk.scheduled = true;
				this.metrics.chunksScheduled++;
			}
        }
        
        this.metrics.batchesScheduled++;
		
		// Clear batch - ADD EXPLICIT LOGGING
		this.logger(`🧹 Clearing batch: ${this.pendingBatchChunks.length} chunks, ${this.currentBatchDurationMs.toFixed(0)}ms`);
		
		const batchStartTime = this.nextPlayTime - (this.currentBatchDurationMs / 1000);
		setTimeout(() => {
			this.logger(`🔊 BATCH ${this.metrics.batchesScheduled} SHOULD BE PLAYING NOW`);
		}, (batchStartTime - this.audioContext.currentTime) * 1000);
		
		
        
        // Clear batch (JavaScript event loop ensures this is atomic)
        this.pendingBatchChunks = [];
        this.currentBatchDurationMs = 0;
		
		this.logger(`✅ Batch cleared: pendingChunks=${this.pendingBatchChunks.length}, duration=${this.currentBatchDurationMs}ms`);

        
        this.dispatchEvent(new CustomEvent('batchScheduled', {
            detail: {
                batchNumber: this.metrics.batchesScheduled,
                chunksInBatch: this.metrics.chunksScheduled,
                nextBatchWaitTime: this.estimateNextBatchWaitTime()
            }
        }));
        
		// REPLACE with immediate reset:
		this.isWaitingForBatch = false;
		this.logger('📋 Ready for next streaming batch');
		
		
    }

    scheduleSequentialChunks() {
        if (!this.isPlaybackStarted) return;
        
        // Get current buffer ahead time
        const currentBufferAheadMs = this.getBufferAheadTimeMs();
        
        if (currentBufferAheadMs > this.config.maxBufferDepthMs) {
            this.logger(`Buffer full (${currentBufferAheadMs.toFixed(0)}ms) - throttling scheduling`);
            return;
        }
        
        // Schedule chunks in sequence
        let nextSequence = this.lastScheduledSequence + 1;
        let scheduled = 0;
        
        while (this.chunks.has(nextSequence) && currentBufferAheadMs < this.config.maxBufferDepthMs) {
            const chunk = this.chunks.get(nextSequence);
            
            if (!chunk.scheduled) {
                this.scheduleChunk(chunk.audioBuffer, nextSequence);
                chunk.scheduled = true;
                this.lastScheduledSequence = nextSequence;
                this.metrics.chunksScheduled++;
                scheduled++;
            }
            
            nextSequence++;
        }
        
        if (scheduled > 0) {
            this.logger(`Scheduled ${scheduled} sequential chunks (up to sequence ${this.lastScheduledSequence})`);
        }
        
        // Check for completion
        this.checkForCompletion();
    }

    scheduleChunk(audioBuffer, sequence) {
        try {
            
			// 🔍 ADD THIS - Audio Context State (only for first chunk)
			if (sequence === 1) {
				this.logger(`🔍 Audio Context: ${this.audioContext.state}, Rate: ${this.audioContext.sampleRate}Hz, Latency: ${this.audioContext.baseLatency?.toFixed(3)}s`);
			}

			
			const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.gainNode);

            const startTime = this.nextPlayTime;
            source.start(startTime);
            
            // Track source for cleanup
            this.scheduledSources.push({
                source,
                sequence,
                startTime,
                endTime: startTime + audioBuffer.duration
            });

            // Update next play time
            this.nextPlayTime += audioBuffer.duration;

            this.logger(`Chunk ${sequence} scheduled: ${startTime.toFixed(3)}s - ${this.nextPlayTime.toFixed(3)}s (${audioBuffer.duration.toFixed(3)}s)`);

            // Setup cleanup
            source.onended = () => {
                this.logger(`Chunk ${sequence} playback ended`);
                this.cleanupFinishedSources();
            };

        } catch (error) {
            this.logger(`Failed to schedule chunk ${sequence}: ${error.message}`, 'error');
        }
    }

    getBufferAheadTimeMs() {
        const now = this.audioContext.currentTime;
        const aheadSeconds = Math.max(0, this.nextPlayTime - now);
        return aheadSeconds * 1000; // Convert to ms
    }

    cleanupFinishedSources() {
        const now = this.audioContext.currentTime;
        const before = this.scheduledSources.length;
        
        this.scheduledSources = this.scheduledSources.filter(item => {
            if (item.endTime <= now) {
                try {
                    item.source.disconnect();
                } catch (e) {
                    // Already disconnected
                }
                return false;
            }
            return true;
        });

        const cleaned = before - this.scheduledSources.length;
        if (cleaned > 0) {
            this.logger(`Cleaned up ${cleaned} finished sources`);
        }
    }

    onStreamComplete(totalChunks) {
        this.streamCompleteReceived = true;
        this.expectedTotalChunks = totalChunks;
        
        this.logger(`Stream complete signal received - expecting ${totalChunks} total chunks`);
        this.logger(`Current status: ${this.chunksReceived}/${totalChunks} chunks received`);

        if (!this.isStreamingMode) {
            // BATCH MODE: Schedule ALL collected chunks in one shot
            this.logger(`💾 Batch mode: Scheduling ALL ${this.chunks.size} chunks at once`);
            this.scheduleAllChunksInOrder();
        } else {
            // STREAMING MODE: Flush any remaining partial batch
            if (this.pendingBatchChunks.length > 0) {
                this.logger(`📡 Streaming mode: Flushing remaining ${this.pendingBatchChunks.length} chunks in final batch`);
                this.scheduleBatch();
            }
        }

        // Start grace period for missing chunks
        this.startGracePeriod();
        
        // Try immediate completion check
        this.checkForCompletion();
    }

    async scheduleAllChunksInOrder() {
        // Get all chunks sorted by sequence number to handle out-of-order arrival
        const sortedChunks = Array.from(this.chunks.values())
            .sort((a, b) => a.sequence - b.sequence);
        
        if (sortedChunks.length === 0) {
            this.logger('No chunks to schedule in batch mode', 'warning');
            return;
        }
		
		this.logger(`🔍 BATCH MODE DIAGNOSIS:`);
		this.logger(`   Total chunks: ${sortedChunks.length}`);
		this.logger(`   First chunk samples: [${Array.from(sortedChunks[0].audioBuffer.getChannelData(0).slice(0, 5)).map(s => s.toFixed(3)).join(', ')}]`);
		this.logger(`   Last chunk samples: [${Array.from(sortedChunks[sortedChunks.length-1].audioBuffer.getChannelData(0).slice(0, 5)).map(s => s.toFixed(3)).join(', ')}]`);

        
        const totalDuration = sortedChunks.reduce((sum, chunk) => sum + chunk.duration, 0);
		this.logger(`   Expected total duration: ${totalDuration.toFixed(0)}ms`);
		
		this.logger(`🚀 Batch mode: Scheduling ALL ${sortedChunks.length} chunks in sequence`);
        
        // Start playback if not already started
        if (!this.isPlaybackStarted) {
            this.startPlayback();
        }
        
        // Schedule all chunks in order
        for (const chunk of sortedChunks) {
            if (!chunk.scheduled) {
                this.scheduleChunk(chunk.audioBuffer, chunk.sequence);
                chunk.scheduled = true;
                this.metrics.chunksScheduled++;
				
				// 🔍 Log every 5th chunk for batch timing
				if (chunk.sequence % 5 === 1) {
					this.logger(`🔍 Batch chunk ${chunk.sequence} scheduled at ${startTime.toFixed(3)}s`);
				}

				
            }
        }
        
        this.logger(`✅ Batch mode: All ${sortedChunks.length} chunks scheduled for continuous playback`);
        
        this.dispatchEvent(new CustomEvent('allChunksScheduled', {
            detail: {
                totalChunks: sortedChunks.length,
                mode: 'batch'
            }
        }));
    }

    startGracePeriod() {
        if (this.graceTimer) {
            clearTimeout(this.graceTimer);
        }

        this.graceTimer = setTimeout(() => {
            this.logger(`Grace period expired - finalizing with ${this.chunksReceived}/${this.expectedTotalChunks} chunks`, 'warning');
            this.finalizeStream();
        }, this.config.graceTimeoutMs);

        this.logger(`Grace period started (${this.config.graceTimeoutMs}ms)`);
    }

    checkForCompletion() {
        if (!this.streamCompleteReceived || this.isFinalized) {
            return;
        }

        const hasAllChunks = this.expectedTotalChunks && 
                           this.chunksReceived >= this.expectedTotalChunks;
        
        const allScheduled = this.metrics.chunksScheduled === this.chunksReceived;

        if (hasAllChunks && allScheduled) {
            this.logger('All chunks received and scheduled - finalizing');
            this.finalizeStream();
        }
    }

    finalizeStream() {
        if (this.isFinalized) return;

        this.isFinalized = true;
        this.isActive = false;
        
        // Clear grace timer
        if (this.graceTimer) {
            clearTimeout(this.graceTimer);
            this.graceTimer = null;
        }

        this.metrics.completionTime = Date.now();
        const totalTime = this.metrics.completionTime - this.metrics.streamStartTime;

        //this.logger(`✅ STREAM FINALIZED - ${this.chunksReceived}/${this.expectedTotalChunks} chunks, ${totalTime}ms total`);

        this.logger(`✅ STREAM FINALIZED - ${this.chunksReceived}/${this.expectedTotalChunks} chunks`);

		// Calculate when all audio will finish playing
        const lastPlayTime = this.nextPlayTime;
        const remainingPlayTime = Math.max(0, lastPlayTime - this.audioContext.currentTime);

        this.dispatchEvent(new CustomEvent('streamFinalized', {
            detail: {
                chunksReceived: this.chunksReceived,
                expectedChunks: this.expectedTotalChunks,
                totalTime,
                remainingPlayTimeMs: remainingPlayTime * 1000,
                mode: this.isStreamingMode ? 'streaming' : 'batch',
                batchesScheduled: this.metrics.batchesScheduled,
                metrics: { ...this.metrics }
            }
        }));
		
		// Calculate total audio duration
		const totalAudioDurationMs = Array.from(this.chunks.values())
			.reduce((sum, chunk) => sum + chunk.duration, 0);

		//this.logger(`🎵 Total audio duration: ${totalAudioDurationMs.toFixed(0)}ms (${(totalAudioDurationMs/1000).toFixed(1)}s)`);

        this.logger(`🎵 Total audio duration: ${totalAudioDurationMs.toFixed(0)}ms (${(totalAudioDurationMs/1000).toFixed(1)}s)`);
		
		// Schedule final cleanup after all audio finishes
        if (remainingPlayTime > 0) {
            setTimeout(() => {
                this.dispatchEvent(new CustomEvent('playbackComplete', {
                    detail: { fullyComplete: true }
                }));
                this.logger('🎵 All audio playback completed');
            }, remainingPlayTime * 1000 + 100);
        } else {
            this.dispatchEvent(new CustomEvent('playbackComplete', {
                detail: { fullyComplete: true }
            }));
        }
    }

    estimateNextBatchWaitTime() {
        if (this.isStreamingMode) return 0;
        
        // Estimate how long until next batch based on TTS speed
        const chunksPerMs = this.chunksReceived / (Date.now() - this.metrics.streamStartTime);
        const chunksNeededForBatch = Math.ceil(this.config.batchSizeMs / 500); // Assume 500ms per chunk
        return Math.max(0, chunksNeededForBatch / chunksPerMs);
    }

    updateBufferStatus() {
        let bufferedMs = 0;
        for (const [sequence, chunk] of this.chunks) {
            if (!chunk.scheduled) {
                bufferedMs += chunk.duration;
            }
        }
        
        this.dispatchEvent(new CustomEvent('bufferUpdate', {
            detail: {
                bufferedDurationMs: bufferedMs,
                isHealthy: bufferedMs >= this.config.minBufferThresholdMs,
                mode: 'streaming'
            }
        }));
    }

    updateBatchStatus() {
        const timeSinceLastBatch = Date.now() - this.lastBatchScheduledTime;
        
        this.dispatchEvent(new CustomEvent('batchUpdate', {
            detail: {
                currentBatchDurationMs: this.currentBatchDurationMs,
                targetBatchSizeMs: this.config.batchSizeMs,
                pendingChunks: this.pendingBatchChunks.length,
                isWaitingForBatch: this.isWaitingForBatch,
                timeSinceLastBatchMs: timeSinceLastBatch,
                mode: 'batch'
            }
        }));
    }

    // Control methods
    setVolume(volume) {
        if (this.gainNode) {
            this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
            return true;
        }
        return false;
    }

    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            return true;
        }
        return false;
    }

    // Reset for new stream
    reset() {
        this.logger('Resetting streamer');

        // Stop all sources
        this.scheduledSources.forEach(item => {
            try {
                item.source.stop();
                item.source.disconnect();
            } catch (e) {
                // Already stopped
            }
        });

        // Clear timers
        if (this.graceTimer) {
            clearTimeout(this.graceTimer);
            this.graceTimer = null;
        }

        // Reset state
        this.isActive = false;
        this.isPlaybackStarted = false;
        this.isFinalized = false;
        this.streamCompleteReceived = false;
        
        this.chunks.clear();
        this.scheduledSources = [];
        this.pendingBatchChunks = [];
        this.expectedTotalChunks = null;
        this.lastScheduledSequence = 0;
        this.nextPlayTime = 0;
        this.currentBatchDurationMs = 0;
        this.isWaitingForBatch = false;
        this.chunksReceived = 0;

        // Reset metrics
        this.metrics = {
            streamStartTime: null,
            firstChunkTime: null,
            completionTime: null,
            totalBytes: 0,
            batchesScheduled: 0,
            chunksScheduled: 0
        };
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
            ...this.metrics,
            isActive: this.isActive,
            isStreamingMode: this.isStreamingMode,
            isPlaybackStarted: this.isPlaybackStarted,
            isFinalized: this.isFinalized,
            estimatedDurationMs: this.estimatedDurationMs,
            chunksReceived: this.chunksReceived,
            currentBatchDurationMs: this.currentBatchDurationMs,
            pendingBatchChunks: this.pendingBatchChunks.length,
            contextState: this.audioContext?.state || 'unknown'
        };
    }
}