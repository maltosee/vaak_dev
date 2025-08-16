/**
 * Sequential Web Audio Streamer - Client-Controlled Completion
 * Clean implementation with sequence-aware, buffer-then-stream architecture
 */

export class SequentialWebAudioStreamer extends EventTarget {
    constructor(config = {}, logger = console.log) {
        super();
        this.logger = (msg, level = 'info') => logger(`[Sequential] ${msg}`, level);
        
		// --- ADD THIS LINE ---
        this.logger(`🔍 Streamer constructor received config:`, 'debug', config);
        // --- END ADDITION ---
		
        // Configuration
        this.config = {
            minBufferThreshold: config.minBufferThreshold || 3.0, // seconds
            targetBufferDepth: config.targetBufferDepth || 5.0, // ideal buffer ahead
            maxBufferDepth: config.maxBufferDepth || 7.5, // max buffer before throttling
            graceTimeout: config.graceTimeout || 3000, // ms to wait for missing chunks
            maxChunkGap: config.maxChunkGap || 5000, // ms between chunks before warning
            adaptivePlayback: config.adaptivePlayback === true, // enable adaptive speed
            maxSpeedAdjustment: config.maxSpeedAdjustment || 0.05, // ±5% speed adjustment
            smoothingInterval: config.smoothingInterval || 100, // ms between smoothing checks
            ...config
        };
		
		  // FIX: Log final applied config
		this.logger(`🔍 Final applied config:`, 'debug', JSON.stringify({
			minBufferThreshold: this.config.minBufferThreshold,
			targetBufferDepth: this.config.targetBufferDepth,
			maxBufferDepth: this.config.maxBufferDepth
		}, null, 2));
        
        // Audio context
        this.audioContext = null;
        this.gainNode = null;
        
        // Streaming state
        this.isInitialized = false;
        this.isStreaming = false;
        this.isPlaybackStarted = false;
        
        // Chunk management
        this.chunks = new Map(); // sequence -> { audioBuffer, received, scheduled }
        this.expectedTotalChunks = null;
        this.lastScheduledSequence = 0;
        this.nextPlayTime = 0;
        
        // Buffer management
        this.bufferedDuration = 0;
        this.scheduledSources = [];
        this.currentPlaybackRate = 1.0;
        this.smoothingTimer = null;
		// Add after existing properties
		this.bufferWholeMode = false;
		this.estimatedTotalDuration = 0;
		this.playbackStartTime = null;
		this.isPausedForBuffer = false;
		this.actualAudioDuration = 0;
		
		// Add batch mode properties
		this.batchMode = false;
		this.batchThresholdSeconds = 5.0; // From config
		this.pendingBatchChunks = [];
        
        // Completion tracking
        this.streamCompleteReceived = false;
        this.graceTimer = null;
        this.isFinalized = false;
        
        // Metrics
        this.metrics = {
            chunksReceived: 0,
            chunksScheduled: 0,
            totalBytes: 0,
            firstChunkTime: null,
            streamStartTime: null,
            completionTime: null
        };
        
        this.logger('Initialized with config:', 'debug', this.config);
		
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

    startStream() {
        if (!this.isInitialized) {
            throw new Error('Not initialized - call initialize() first');
        }

        // Reset state for new stream
        this.reset();
        
        this.isStreaming = true;
        this.nextPlayTime = this.audioContext.currentTime;
        this.metrics.streamStartTime = Date.now();
        
        this.logger('Stream started');
        this.dispatchEvent(new CustomEvent('streamStarted'));
    }

    async addChunk(arrayBuffer, sequence = null) {
        if (!this.isStreaming) {
            this.logger(`Chunk rejected - not streaming (sequence: ${sequence})`, 'warning');
            return false;
        }

        // Auto-sequence if not provided (fallback for legacy servers)
        if (sequence === null) {
            sequence = this.metrics.chunksReceived + 1;
        }

        this.logger(`Chunk ${sequence} received (${arrayBuffer.byteLength} bytes)`);
		
		
        try {
            // Decode audio
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));
            
            // Store chunk with sequence
            this.chunks.set(sequence, {
                audioBuffer,
                received: Date.now(),
                scheduled: false,
                byteLength: arrayBuffer.byteLength
            });

            // Update metrics
            this.metrics.chunksReceived++;
            this.metrics.totalBytes += arrayBuffer.byteLength;
            
            if (this.metrics.firstChunkTime === null) {
                this.metrics.firstChunkTime = Date.now() - this.metrics.streamStartTime;
                this.dispatchEvent(new CustomEvent('firstChunk', {
                    detail: { ttfc: this.metrics.firstChunkTime }
                }));
            }

            this.logger(`Chunk ${sequence} decoded (${audioBuffer.duration.toFixed(3)}s, ${audioBuffer.numberOfChannels}ch)`);
			
			
			this.actualAudioDuration += audioBuffer.duration;


            // Update buffered duration
            this.updateBufferedDuration();

            // Check if we should start playback
            if (!this.isPlaybackStarted && this.shouldStartPlayback()) {
                this.startPlayback();
            }

            // Schedule available sequential chunks
            this.scheduleSequentialChunks();

            return true;

        } catch (error) {
            this.logger(`Failed to process chunk ${sequence}: ${error.message}`, 'error');
            return false;
        }
    }

    updateBufferedDuration() {
        // Calculate total duration of unscheduled chunks
        let duration = 0;
        for (const [sequence, chunk] of this.chunks) {
            if (!chunk.scheduled) {
                duration += chunk.audioBuffer.duration;
            }
        }
        this.bufferedDuration = duration;

        this.dispatchEvent(new CustomEvent('bufferUpdate', {
            detail: {
                bufferedDuration: this.bufferedDuration,
                chunksBuffered: this.chunks.size - this.metrics.chunksScheduled,
                isHealthy: this.bufferedDuration >= this.config.minBufferThreshold
            }
        }));
    }

    shouldStartPlayback() {
				if (this.bufferWholeMode) {
				return this.streamCompleteReceived && this.metrics.chunksReceived >= this.expectedTotalChunks;
			}
			
			//const shouldStart = this.bufferedDuration >= this.config.minBufferThreshold;
			// TO THIS:
				const shouldStart = this.bufferedDuration >= this.config.minBufferThreshold;
			
			this.logger(`Playback check - Buffer: ${this.bufferedDuration.toFixed(3)}s, Min: ${this.config.minBufferThreshold.toFixed(1)}s, Should start: ${shouldStart}`);
			return shouldStart;
    }

    getLowestSequence() {
        return Math.min(...Array.from(this.chunks.keys()));
    }

    startPlayback() {
        if (this.isPlaybackStarted) return;

        this.isPlaybackStarted = true;
        
        // Small delay to ensure context is ready
        this.nextPlayTime = Math.max(this.nextPlayTime, this.audioContext.currentTime + 0.1);
		
		this.playbackStartTime = this.nextPlayTime;

        
        this.logger(`Playback started - Next play time: ${this.nextPlayTime.toFixed(3)}s`);
        
        this.dispatchEvent(new CustomEvent('playbackStarted', {
            detail: {
                startTime: this.nextPlayTime,
                bufferedDuration: this.bufferedDuration
            }
        }));

        // Schedule all available sequential chunks
        this.scheduleSequentialChunks();
        
        // Start buffer smoothing
        this.startBufferSmoothing();
    }

    scheduleSequentialChunks() {
        if (!this.isPlaybackStarted) return;

        // Check if we should throttle scheduling based on buffer depth
        const currentBufferAhead = this.getBufferAheadTime();
        
        if (currentBufferAhead > this.config.maxBufferDepth) {
            this.logger(`Buffer full (${currentBufferAhead.toFixed(2)}s) - throttling scheduling`);
            return; // Don't schedule more chunks yet
        }

        // Schedule chunks in sequence starting from where we left off
        let nextSequence = this.lastScheduledSequence + 1;
        let scheduled = 0;

        while (this.chunks.has(nextSequence) && currentBufferAhead < this.config.maxBufferDepth) {
            const chunk = this.chunks.get(nextSequence);
            
            if (!chunk.scheduled) {
                this.scheduleChunk(chunk.audioBuffer, nextSequence);
                chunk.scheduled = true;
                this.lastScheduledSequence = nextSequence;
                this.metrics.chunksScheduled++;
                scheduled++;
                
                // Update buffer ahead time for throttling check
                const newBufferAhead = this.getBufferAheadTime();
                if (newBufferAhead > this.config.maxBufferDepth) {
                    this.logger(`Reached max buffer depth (${newBufferAhead.toFixed(2)}s) - stopping scheduling`);
                    break;
                }
            }
            
            nextSequence++;
        }

        if (scheduled > 0) {
            this.logger(`Scheduled ${scheduled} sequential chunks (up to sequence ${this.lastScheduledSequence})`);
            this.updateBufferedDuration();
        }

        // Check if we can finalize
        this.checkForCompletion();
    }

    getBufferAheadTime() {
        // Calculate how much audio is scheduled ahead of current playback time
        const now = this.audioContext.currentTime;
        return Math.max(0, this.nextPlayTime - now);
    }

    startBufferSmoothing() {
        if (this.smoothingTimer) return;

        this.smoothingTimer = setInterval(() => {
            this.performBufferAnalysis();
        }, this.config.smoothingInterval);

        this.logger('Buffer smoothing started');
    }

    performBufferAnalysis() {
			if (!this.isPlaybackStarted || this.isFinalized || this.bufferWholeMode) return;
			
			const bufferAhead = this.getBufferAheadTime();
			
			// Check for buffer depletion
			
			// In performBufferAnalysis(), add debouncing:
			const now = Date.now();
			
			if (bufferAhead <= 0.1 && !this.isPausedForBuffer  && 
			(now - this.lastPauseResumeTime) > this.pauseResumeDebounceMs) {
				this.pauseForBuffer();
				this.lastPauseResumeTime = now;
			} else if (this.isPausedForBuffer && (now - this.lastPauseResumeTime) > this.pauseResumeDebounceMs) {
				const remainingPlaytime = this.calculateRemainingPlaytime();
				const requiredBuffer = remainingPlaytime * (this.config.bufferPercentage || 0.3);
				
				if (this.bufferedDuration >= requiredBuffer) {
					this.resumeFromBuffer();
				}
			}
			
			if (bufferAhead < this.config.targetBufferDepth) {
				this.scheduleSequentialChunks();
			}
	}
	
	
	
   adjustPlaybackRate(bufferAhead, targetBuffer) {
		const bufferRatio = bufferAhead / targetBuffer;
		let newRate = 1.0;

		// More nuanced adjustments
		if (bufferRatio < 0.2) { // Critically low
			newRate = 1.0 - (this.config.maxSpeedAdjustment * 1.0); // Max slowdown
			this.logger(`Buffer critically low (${bufferAhead.toFixed(2)}s) - slowing to ${newRate.toFixed(3)}x`, 'error');
		} else if (bufferRatio < 0.5) { // Very low
			newRate = 1.0 - (this.config.maxSpeedAdjustment * 0.7); // Significant slowdown
			this.logger(`Buffer very low (${bufferAhead.toFixed(2)}s) - slowing to ${newRate.toFixed(3)}x`, 'warning');
		} else if (bufferRatio < 0.8) { // Below target
			newRate = 1.0 - (this.config.maxSpeedAdjustment * 0.3); // Slight slowdown
		} else if (bufferRatio > 1.2) { // Above target
			newRate = 1.0 + (this.config.maxSpeedAdjustment * 0.3); // Slight speedup
		} else if (bufferRatio > 1.5) { // Well above target
			newRate = 1.0 + (this.config.maxSpeedAdjustment * 0.7); // Significant speedup
			this.logger(`Buffer healthy/full (${bufferAhead.toFixed(2)}s) - speeding to ${newRate.toFixed(3)}x`);
		} else {
			newRate = 1.0; // Maintain normal speed
		}

		// Apply rate change if significant
		if (Math.abs(newRate - this.currentPlaybackRate) > 0.005) { // FIX: Reduced threshold for change
			this.updatePlaybackRate(newRate);
		}
	}

    updatePlaybackRate(newRate) {
        this.currentPlaybackRate = newRate;
        
        // Apply to all currently playing sources
        this.scheduledSources.forEach(item => {
            try {
                if (item.source.playbackRate) {
                    item.source.playbackRate.value = newRate;
                }
            } catch (e) {
                // Source might have ended
            }
        });

        // Adjust future scheduling timing
        const adjustment = (1.0 - newRate);
        if (Math.abs(adjustment) > 0.001) {
            // Slightly adjust next play time to account for rate change
            this.nextPlayTime += adjustment * 0.1; // Small correction
        }
    }

    scheduleChunk(audioBuffer, sequence) {
        try {
            // Create source
            const source = this.audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(this.gainNode);

            // Set initial playback rate for adaptive playback
            if (source.playbackRate && this.config.adaptivePlayback) {
                source.playbackRate.value = this.currentPlaybackRate;
            }

            // Schedule playback
            const startTime = this.nextPlayTime;
            source.start(startTime);
            
            // Track source for cleanup and rate adjustments
            this.scheduledSources.push({
                source,
                sequence,
                startTime,
                endTime: startTime + (audioBuffer.duration / this.currentPlaybackRate) // Adjust for playback rate
            });

            // Update next play time (accounting for current playback rate)
            this.nextPlayTime += audioBuffer.duration / this.currentPlaybackRate;

            this.logger(`Chunk ${sequence} scheduled: ${startTime.toFixed(3)}s - ${this.nextPlayTime.toFixed(3)}s (${audioBuffer.duration.toFixed(3)}s @ ${this.currentPlaybackRate.toFixed(3)}x)`);

            // Setup cleanup
            source.onended = () => {
                this.logger(`Chunk ${sequence} playback ended`);
                this.cleanupFinishedSources();
            };

        } catch (error) {
            this.logger(`Failed to schedule chunk ${sequence}: ${error.message}`, 'error');
        }
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

    // Server indicates stream is complete with total chunk count
    onStreamComplete(totalChunks) {
        this.streamCompleteReceived = true;
        this.expectedTotalChunks = totalChunks;
        
        this.logger(`Stream complete signal received - expecting ${totalChunks} total chunks`);
        this.logger(`Current status: ${this.metrics.chunksReceived}/${totalChunks} chunks received`);

        // Start grace period for missing chunks
        this.startGracePeriod();
        
        // Try immediate completion check
        this.checkForCompletion();
    }

    startGracePeriod() {
        if (this.graceTimer) {
            clearTimeout(this.graceTimer);
        }

        // Calculate dynamic grace period based on throughput
        const gracePeriod = this.calculateDynamicGracePeriod();

        this.graceTimer = setTimeout(() => {
            this.logger(`Grace period expired - finalizing with ${this.metrics.chunksReceived}/${this.expectedTotalChunks} chunks`, 'warning');
            this.finalizeStream();
        }, gracePeriod);

        this.logger(`Grace period started (${gracePeriod}ms)`);
    }

    calculateDynamicGracePeriod() {
        const chunksReceived = this.metrics.chunksReceived;
        const remainingChunks = this.expectedTotalChunks - chunksReceived;
        
        if (chunksReceived < 2 || remainingChunks <= 0) {
            return this.config.graceTimeout; // Fallback for insufficient data
        }
        
        const streamDuration = Date.now() - this.metrics.streamStartTime;
        const throughputRate = chunksReceived / (streamDuration / 1000); // chunks/second
        
        const estimatedTime = (remainingChunks / throughputRate) * 1000; // ms
        const gracePeriod = Math.max(1000, Math.min(10000, estimatedTime * 1.1)); // 10% buffer, 1s min, 10s max
        
        this.logger(`Dynamic grace: ${remainingChunks} remaining, ${throughputRate.toFixed(2)} chunks/s, grace: ${gracePeriod}ms`);
        return gracePeriod;
    }

    checkForCompletion() {
        if (!this.streamCompleteReceived || this.isFinalized) {
            return;
        }

        const hasAllChunks = this.expectedTotalChunks && 
                           this.metrics.chunksReceived >= this.expectedTotalChunks;
        
        const allScheduled = this.metrics.chunksScheduled === this.metrics.chunksReceived;

        if (hasAllChunks && allScheduled) {
            this.logger('All chunks received and scheduled - finalizing');
            this.finalizeStream();
        }
    }

    finalizeStream() {
        if (this.isFinalized) return;

        this.isFinalized = true;
        this.isStreaming = false;
        
        // Clear grace timer
        if (this.graceTimer) {
            clearTimeout(this.graceTimer);
            this.graceTimer = null;
        }

        this.metrics.completionTime = Date.now();
        const totalTime = this.metrics.completionTime - this.metrics.streamStartTime;

        this.logger(`✅ STREAM FINALIZED - ${this.metrics.chunksReceived}/${this.expectedTotalChunks} chunks, ${totalTime}ms total`);

        // Calculate when all audio will finish playing
        const lastPlayTime = this.nextPlayTime;
        const remainingPlayTime = Math.max(0, lastPlayTime - this.audioContext.currentTime);

        // IMPORTANT: Dispatch events for UI to re-enable controls
        this.dispatchEvent(new CustomEvent('streamFinalized', {
            detail: {
                chunksReceived: this.metrics.chunksReceived,
                expectedChunks: this.expectedTotalChunks,
                totalTime,
                remainingPlayTime,
                metrics: { ...this.metrics },
                // UI can use this to re-enable controls
                enablePlaybackControls: true,
                audioReadyForDownload: true
            }
        }));

        // Schedule final cleanup after all audio finishes
        if (remainingPlayTime > 0) {
            setTimeout(() => {
                this.dispatchEvent(new CustomEvent('playbackComplete', {
                    detail: {
                        // Audio fully completed - safe to cleanup/reset
                        fullyComplete: true
                    }
                }));
                this.logger('🎵 All audio playback completed');
            }, remainingPlayTime * 1000 + 100);
        } else {
            // Audio already finished
            this.dispatchEvent(new CustomEvent('playbackComplete', {
                detail: { fullyComplete: true }
            }));
        }
    }

    // Control methods
    setVolume(volume) {
        if (this.gainNode) {
            this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
            return true;
        }
        return false;
    }

    getVolume() {
        return this.gainNode ? this.gainNode.gain.value : 0;
    }

    async resume() {
        if (this.audioContext && this.audioContext.state === 'suspended') {
            await this.audioContext.resume();
            return true;
        }
        return false;
    }

    async suspend() {
        if (this.audioContext && this.audioContext.state === 'running') {
            await this.audioContext.suspend();
            return true;
        }
        return false;
    }

    // Reset for new stream
    reset() {
        this.logger('Resetting streamer');

        // Stop smoothing
        if (this.smoothingTimer) {
            clearInterval(this.smoothingTimer);
            this.smoothingTimer = null;
        }

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
        this.isStreaming = false;
        this.isPlaybackStarted = false;
        this.isFinalized = false;
        this.streamCompleteReceived = false;
        
        this.chunks.clear();
        this.scheduledSources = [];
        this.expectedTotalChunks = null;
        this.lastScheduledSequence = 0;
        this.nextPlayTime = 0;
        this.bufferedDuration = 0;
        this.currentPlaybackRate = 1.0;

        // Reset metrics
        this.metrics = {
            chunksReceived: 0,
            chunksScheduled: 0,
            totalBytes: 0,
            firstChunkTime: null,
            streamStartTime: null,
            completionTime: null
        };
    }

    // Cleanup
    destroy() {
        this.reset();
        
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
        }
        
        this.logger('Streamer destroyed');
    }

    // Export complete audio for download (call after streamFinalized)
    exportAudio() {
        if (!this.isFinalized) {
            this.logger('Cannot export - stream not finalized yet', 'warning');
            return null;
        }

        try {
            // Get all chunks in sequence order
            const sortedChunks = Array.from(this.chunks.entries())
                .sort(([a], [b]) => a - b)
                .map(([_, chunk]) => chunk);

            if (sortedChunks.length === 0) {
                this.logger('No chunks to export', 'warning');
                return null;
            }

            // Calculate total samples needed
            const firstChunk = sortedChunks[0].audioBuffer;
            const sampleRate = firstChunk.sampleRate;
            const channels = firstChunk.numberOfChannels;
            
            let totalSamples = 0;
            sortedChunks.forEach(chunk => {
                totalSamples += chunk.audioBuffer.length;
            });

            // Create combined audio buffer
            const combinedBuffer = this.audioContext.createBuffer(channels, totalSamples, sampleRate);
            
            // Copy all chunk data
            let offset = 0;
            for (const chunk of sortedChunks) {
                const audioBuffer = chunk.audioBuffer;
                for (let channel = 0; channel < channels; channel++) {
                    const channelData = combinedBuffer.getChannelData(channel);
                    const sourceData = audioBuffer.getChannelData(channel);
                    channelData.set(sourceData, offset);
                }
                offset += audioBuffer.length;
            }

            this.logger(`Exported audio: ${totalSamples} samples, ${combinedBuffer.duration.toFixed(2)}s`);
            return combinedBuffer;

        } catch (error) {
            this.logger(`Export failed: ${error.message}`, 'error');
            return null;
        }
    }
    getMetrics() {
        return {
            ...this.metrics,
            isStreaming: this.isStreaming,
            isPlaybackStarted: this.isPlaybackStarted,
            isFinalized: this.isFinalized,
            bufferedDuration: this.bufferedDuration,
            expectedTotalChunks: this.expectedTotalChunks,
            currentChunks: this.chunks.size,
            scheduledSources: this.scheduledSources.length,
            contextState: this.audioContext?.state || 'unknown',
            nextPlayTime: this.nextPlayTime,
            currentTime: this.audioContext?.currentTime || 0
        };
    }

    getChunkStatus() {
        const status = [];
        for (const [sequence, chunk] of this.chunks) {
            status.push({
                sequence,
                duration: chunk.audioBuffer.duration,
                scheduled: chunk.scheduled,
                received: new Date(chunk.received).toLocaleTimeString()
            });
        }
        return status.sort((a, b) => a.sequence - b.sequence);
    }

	setMinBuffer(newMinBuffer) {
			this.minBufferThreshold = newMinBuffer;
			this.logger(`Min buffer updated to: ${newMinBuffer.toFixed(1)}s`);
		}


	setBufferWholeMode(enabled) {
		this.bufferWholeMode = enabled;
		this.logger(`Buffer mode: ${enabled ? 'WHOLE FILE' : 'STREAMING'}`);
	}

	setEstimatedDuration(duration) {
		this.estimatedTotalDuration = duration;
		this.logger(`Estimated audio duration: ${duration.toFixed(1)}s`);
	}

	calculateRemainingPlaytime() {
		if (!this.playbackStartTime) return this.estimatedTotalDuration;
		const playedTime = this.audioContext.currentTime - this.playbackStartTime;
		return Math.max(0, this.estimatedTotalDuration - playedTime);
	}
	
	pauseForBuffer() {
		this.isPausedForBuffer = true;
		this.scheduledSources.forEach(item => {
			try {
				if (item.source.playbackRate) {
					item.source.playbackRate.value = 0.001;
				}
			} catch (e) {}
		});
		this.logger('🛑 Paused - buffer depleted');
	}

	resumeFromBuffer() {
		this.isPausedForBuffer = false;
		this.scheduledSources.forEach(item => {
			try {
				if (item.source.playbackRate) {
					item.source.playbackRate.value = 1.0;
				}
			} catch (e) {}
		});
		this.logger('▶️ Resumed - buffer restored');
	}

}