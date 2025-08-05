/**
 * RunPod WebSocket Manager for TTS Streaming
 * Handles connection lifecycle and audio streaming from RunPod
 */

class RunPodTTSManager {
  constructor(clientId) {
    this.clientId = clientId;
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 3;
    this.connectionTimeout = 10000; // 10 seconds idle timeout
    this.lastActivityTime = 0;
    this.idleCheckInterval = null;
    
    // TTS streaming state
    this.currentStream = null;
    this.audioChunks = [];
    this.estimatedDuration = 0;
    this.receivedDuration = 0;
    this.minBufferDuration = 0; // Will be calculated as 30% of estimated
    this.isBuffering = true;
    this.isPlaying = false;
    this.currentAudio = null;
    
    // Configuration (will be fetched from Fly.io)
    this.config = {
      runpodWsUrl: null,
      streamingThreshold: 6.0, // seconds
      bufferPercentage: 0.3, // 30%
      chunkDuration: 0.5 // seconds per chunk
    };
    
    // Callbacks
    this.onAudioReady = null;
    this.onStreamStart = null;
    this.onStreamComplete = null;
    this.onError = null;
    
    console.log(`🔗 RunPod TTS Manager initialized for client: ${this.clientId}`);
  }

  /**
   * Initialize with configuration from Fly.io
   */
  async initialize(config) {
    this.config = { ...this.config, ...config };
    
    if (!this.config.runpodWsUrl) {
      throw new Error('RunPod WebSocket URL not provided in config');
    }
    
    console.log('🔧 RunPod TTS Manager configured:', this.config);
    await this.connect();
  }

  /**
   * Connect to RunPod WebSocket
   */
  async connect() {
    if (this.isConnected) {
      console.log('🔗 Already connected to RunPod TTS');
      return;
    }

    try {
      const wsUrl = `${this.config.runpodWsUrl}/client/${this.clientId}`;
      console.log(`🔌 Connecting to RunPod TTS: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();
      
      // Wait for connection
      await new Promise((resolve, reject) => {
        this.ws.onopen = resolve;
        this.ws.onerror = reject;
        setTimeout(() => reject(new Error('RunPod connection timeout')), 10000);
      });
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.lastActivityTime = Date.now();
      this.startIdleCheck();
      
      console.log('✅ Connected to RunPod TTS');
      
    } catch (error) {
      console.error('❌ RunPod TTS connection failed:', error);
      this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  setupWebSocketHandlers() {
    this.ws.onopen = () => {
      console.log('🔌 RunPod TTS WebSocket connected');
    };

    this.ws.onclose = (event) => {
      console.log('🔌 RunPod TTS WebSocket disconnected:', event.code);
      this.isConnected = false;
      this.stopIdleCheck();
      
      if (!event.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      console.error('❌ RunPod TTS WebSocket error:', error);
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event);
    };
  }

  /**
   * Handle incoming WebSocket messages
   */
  handleMessage(event) {
    this.lastActivityTime = Date.now();
    
    try {
      if (typeof event.data === 'string') {
        const data = JSON.parse(event.data);
        this.handleTextMessage(data);
      } else if (event.data instanceof Blob) {
        this.handleAudioChunk(event.data);
      }
    } catch (error) {
      console.error('❌ RunPod message handling error:', error);
    }
  }

  /**
   * Handle text messages from RunPod
   */
  handleTextMessage(data) {
    const messageType = data.type;
    console.log(`📨 RunPod TTS: ${messageType}`);
    
    switch (messageType) {
      case 'connected':
        console.log('✅ RunPod TTS connection confirmed');
        break;
        
      case 'tts_stream_start':
        this.handleStreamStart(data);
        break;
        
      case 'tts_stream_complete':
        this.handleStreamComplete(data);
        break;
        
      case 'tts_error':
        this.handleStreamError(data);
        break;
        
      case 'pong':
        console.log('🏓 RunPod TTS pong received');
        break;
        
      default:
        console.log(`⚠️ Unknown RunPod message type: ${messageType}`);
    }
  }

  /**
   * Handle TTS stream start
   */
  handleStreamStart(data) {
    console.log(`🎵 TTS Stream starting: ${data.estimated_duration}s`);
    
    this.currentStream = {
      requestId: data.request_id,
      text: data.text,
      voice: data.voice,
      estimatedDuration: data.estimated_duration,
      estimatedChunks: data.estimated_chunks,
      sampleRate: data.sample_rate
    };
    
    this.estimatedDuration = data.estimated_duration;
    this.audioChunks = [];
    this.receivedDuration = 0;
    this.isBuffering = true;
    this.isPlaying = false;
    
    // Calculate buffer strategy
    if (this.estimatedDuration <= this.config.streamingThreshold) {
      // Short audio - wait for all chunks
      this.minBufferDuration = this.estimatedDuration;
      console.log(`⏳ Short audio (${this.estimatedDuration}s) - waiting for complete file`);
    } else {
      // Long audio - buffer 30% before starting
      this.minBufferDuration = this.estimatedDuration * this.config.bufferPercentage;
      console.log(`🔄 Long audio (${this.estimatedDuration}s) - buffer ${this.minBufferDuration}s before playing`);
    }
    
    if (this.onStreamStart) {
      this.onStreamStart(this.currentStream);
    }
  }

  /**
   * Handle audio chunk
   */
  async handleAudioChunk(audioBlob) {
    if (!this.currentStream) {
      console.warn('⚠️ Received audio chunk without active stream');
      return;
    }
    
    // Store chunk
    this.audioChunks.push(audioBlob);
    this.receivedDuration += this.config.chunkDuration;
    
    console.log(`📤 Audio chunk received: ${this.audioChunks.length}/${this.currentStream.estimatedChunks} (${this.receivedDuration.toFixed(1)}s)`);
    
    // Check if we should start playing
    if (this.isBuffering && this.receivedDuration >= this.minBufferDuration) {
      await this.startPlaying();
    }
    
    // Check if we need to pause and rebuffer
    if (this.isPlaying && this.needsRebuffering()) {
      await this.pauseAndRebuffer();
    }
  }

  /**
   * Start playing audio
   */
  async startPlaying() {
    if (this.audioChunks.length === 0) return;
    
    try {
      console.log(`▶️ Starting audio playback with ${this.audioChunks.length} chunks`);
      
      // Combine chunks into single audio file
      const combinedBlob = this.combineAudioChunks();
      const audioUrl = URL.createObjectURL(combinedBlob);
      
      // Stop any current audio
      if (this.currentAudio) {
        this.currentAudio.pause();
        this.currentAudio = null;
      }
      
      // Create and play audio
      this.currentAudio = new Audio(audioUrl);
      this.currentAudio.onplay = () => {
        this.isBuffering = false;
        this.isPlaying = true;
        console.log('🎵 Audio playback started');
      };
      
      this.currentAudio.onended = () => {
        this.isPlaying = false;
        URL.revokeObjectURL(audioUrl);
        console.log('🎵 Audio playback completed');
      };
      
      this.currentAudio.onerror = (error) => {
        console.error('❌ Audio playback error:', error);
        this.isPlaying = false;
        URL.revokeObjectURL(audioUrl);
      };
      
      await this.currentAudio.play();
      
      if (this.onAudioReady) {
        this.onAudioReady(this.currentAudio);
      }
      
    } catch (error) {
      console.error('❌ Failed to start audio playback:', error);
    }
  }

  /**
   * Check if rebuffering is needed
   */
  needsRebuffering() {
    if (!this.isPlaying || !this.currentAudio) return false;
    
    const currentTime = this.currentAudio.currentTime;
    const bufferedDuration = this.receivedDuration;
    const remainingPlayTime = bufferedDuration - currentTime;
    const requiredBuffer = (this.estimatedDuration - currentTime) * this.config.bufferPercentage;
    
    return remainingPlayTime < requiredBuffer;
  }

  /**
   * Pause and rebuffer audio
   */
  async pauseAndRebuffer() {
    console.log('⏸️ Pausing for rebuffering...');
    
    if (this.currentAudio) {
      this.currentAudio.pause();
    }
    
    this.isPlaying = false;
    this.isBuffering = true;
    
    // Calculate new buffer requirement
    const currentTime = this.currentAudio ? this.currentAudio.currentTime : 0;
    const remainingDuration = this.estimatedDuration - currentTime;
    this.minBufferDuration = currentTime + (remainingDuration * this.config.bufferPercentage);
    
    console.log(`🔄 Rebuffering until ${this.minBufferDuration.toFixed(1)}s`);
    
    // Will resume playing when next chunk arrives and buffer is sufficient
  }

  /**
   * Combine audio chunks into single blob
   */
  combineAudioChunks() {
    const totalSize = this.audioChunks.reduce((sum, chunk) => sum + chunk.size, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    
    this.audioChunks.forEach(chunk => {
      const chunkArray = new Uint8Array(chunk);
      combined.set(chunkArray, offset);
      offset += chunkArray.length;
    });
    
    return new Blob([combined], { type: 'audio/wav' });
  }

  /**
   * Handle stream completion
   */
  handleStreamComplete(data) {
    console.log(`✅ TTS Stream completed: ${data.total_chunks} chunks`);
    
    if (this.currentStream) {
      this.currentStream.completed = true;
      this.currentStream.totalChunks = data.total_chunks;
    }
    
    // If still buffering, start playing with remaining chunks
    if (this.isBuffering && this.audioChunks.length > 0) {
      this.startPlaying();
    }
    
    if (this.onStreamComplete) {
      this.onStreamComplete(data);
    }
  }

  /**
   * Handle stream error
   */
  handleStreamError(data) {
    console.error(`❌ TTS Stream error: ${data.error}`);
    
    this.currentStream = null;
    this.audioChunks = [];
    this.isBuffering = false;
    this.isPlaying = false;
    
    if (this.onError) {
      this.onError(data);
    }
  }

  /**
   * Start idle connection checking
   */
  startIdleCheck() {
    this.stopIdleCheck();
    
    this.idleCheckInterval = setInterval(() => {
      const now = Date.now();
      const idleTime = now - this.lastActivityTime;
      
      if (idleTime > this.connectionTimeout) {
        console.log('⏰ RunPod TTS connection idle timeout');
        this.disconnect();
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Stop idle checking
   */
  stopIdleCheck() {
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval);
      this.idleCheckInterval = null;
    }
  }

  /**
   * Check if connection should be reestablished
   */
  async checkAndReconnect() {
    if (!this.isConnected) {
      console.log('🔄 Reconnecting to RunPod TTS for audio capture...');
      try {
        await this.connect();
      } catch (error) {
        console.warn('⚠️ Failed to reconnect to RunPod TTS:', error.message);
      }
    }
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max RunPod TTS reconnection attempts reached');
      return;
    }
    
    this.reconnectAttempts++;
    const delay = 1000 * Math.pow(2, this.reconnectAttempts - 1); // Exponential backoff
    
    console.log(`🔄 Scheduling RunPod TTS reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => this.connect(), delay);
  }

  /**
   * Disconnect from RunPod
   */
  disconnect() {
    console.log('🔌 Disconnecting from RunPod TTS');
    
    this.isConnected = false;
    this.stopIdleCheck();
    
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio = null;
    }
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.currentStream = null;
    this.audioChunks = [];
    this.isBuffering = false;
    this.isPlaying = false;
  }

  /**
   * Send ping to maintain connection
   */
  ping() {
    if (this.isConnected && this.ws) {
      this.ws.send(JSON.stringify({ type: 'ping' }));
      this.lastActivityTime = Date.now();
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      currentStream: this.currentStream,
      audioChunks: this.audioChunks.length,
      isBuffering: this.isBuffering,
      isPlaying: this.isPlaying,
      receivedDuration: this.receivedDuration,
      estimatedDuration: this.estimatedDuration
    };
  }

  /**
   * Stop current TTS playback
   */
  stopCurrentPlayback() {
    if (this.currentAudio) {
      this.currentAudio.pause();
      this.currentAudio.currentTime = 0;
      this.currentAudio = null;
    }
    
    this.isPlaying = false;
    this.isBuffering = false;
    this.currentStream = null;
    this.audioChunks = [];
    
    console.log('🛑 RunPod TTS playback stopped');
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    this.disconnect();
    console.log('🧹 RunPod TTS Manager cleaned up');
  }
}

// Export for use in main app
window.RunPodTTSManager = RunPodTTSManager;