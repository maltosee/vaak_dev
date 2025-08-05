// Fly.io RunPod TTS Integration Module
const WebSocket = require('ws');
const config = require('../utils/config');

class FlyRunPodTTSClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.pendingRequests = new Map();
    
    console.log('🔗 Fly-RunPod TTS Client initialized');
  }

  /**
   * Initialize connection to RunPod TTS service
   */
  async initialize() {
    const runpodConfig = config.tts.runpod;
    if (!runpodConfig || !runpodConfig.websocketUrl) {
      throw new Error('RunPod WebSocket URL not configured');
    }
    
    await this.connect();
  }

  /**
   * Connect to RunPod TTS WebSocket
   */
  async connect() {
    if (this.isConnected) {
      console.log('🔗 Already connected to RunPod TTS');
      return;
    }

    try {
      const wsUrl = `${config.tts.runpod.websocketUrl}/fly`;
      console.log(`🔌 Connecting Fly.io to RunPod TTS: ${wsUrl}`);
      
      this.ws = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();
      
      // Wait for connection
      await new Promise((resolve, reject) => {
        this.ws.on('open', resolve);
        this.ws.on('error', reject);
        setTimeout(() => reject(new Error('RunPod connection timeout')), 10000);
      });
      
      this.isConnected = true;
      this.reconnectAttempts = 0;
      
      console.log('✅ Fly.io connected to RunPod TTS service');
      
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
    this.ws.on('open', () => {
      console.log('🔌 RunPod TTS WebSocket connected');
      this.isConnected = true;
    });

    this.ws.on('close', (code, reason) => {
      console.log(`🔌 RunPod TTS WebSocket disconnected: ${code} - ${reason}`);
      this.isConnected = false;
      
      if (code !== 1000) { // Not a clean close
        this.scheduleReconnect();
      }
    });

    this.ws.on('error', (error) => {
      console.error('❌ RunPod TTS WebSocket error:', error);
    });

    this.ws.on('message', (data) => {
      this.handleMessage(data);
    });
  }

  /**
   * Handle incoming messages from RunPod
   */
  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());
      const messageType = message.type;
      
      console.log(`📨 RunPod TTS response: ${messageType}`);
      
      switch (messageType) {
        case 'health_response':
          console.log('🩺 RunPod TTS health check passed');
          break;
          
        case 'connected_clients':
          console.log(`👥 RunPod TTS clients: ${message.clients.length}`);
          break;
          
        default:
          console.log(`⚠️ Unknown RunPod message type: ${messageType}`);
      }
      
    } catch (error) {
      console.error('❌ Failed to parse RunPod message:', error);
    }
  }

  /**
   * Send TTS request to RunPod for streaming to client
   * @param {string} text - Text to synthesize
   * @param {string} clientId - Target client ID
   * @param {Object} options - TTS options
   * @returns {Promise<Object>} Request result
   */
  async synthesizeSpeech(text, clientId, options = {}) {
    if (!this.isConnected) {
      throw new Error('Not connected to RunPod TTS service');
    }

    const requestId = `${clientId}_${Date.now()}`;
    const request = {
      type: 'tts_request',
      request_id: requestId,
      client_id: clientId,
      text: text.trim(),
      voice: options.voice || 'aryan_default',
      play_steps_in_s: options.playStepsInS || 0.5,
      timestamp: Date.now()
    };

    console.log(`📤 Sending TTS request to RunPod for client ${clientId}: "${text.substring(0, 50)}..."`);

    try {
      // Send request to RunPod
      this.ws.send(JSON.stringify(request));
      
      // Store pending request
      this.pendingRequests.set(requestId, {
        clientId,
        text,
        startTime: Date.now()
      });

      // RunPod will handle streaming directly to the client
      // We just return success status
      return {
        success: true,
        requestId,
        message: 'TTS request sent to RunPod for streaming',
        clientId,
        textLength: text.length,
        estimatedDuration: this.estimateAudioDuration(text)
      };

    } catch (error) {
      console.error(`❌ Failed to send TTS request: ${error.message}`);
      this.pendingRequests.delete(requestId);
      
      return {
        success: false,
        error: error.message,
        requestId
      };
    }
  }

  /**
   * Estimate audio duration based on text
   * @param {string} text - Text to analyze
   * @returns {number} Estimated duration in seconds
   */
  estimateAudioDuration(text, wordsPerMinute = 150) {
    const wordCount = text.split(/\s+/).length;
    const durationSeconds = (wordCount / wordsPerMinute) * 60;
    return Math.max(1.0, durationSeconds);
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
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    
    console.log(`🔄 Scheduling RunPod TTS reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
    
    setTimeout(() => this.connect(), delay);
  }

  /**
   * Health check RunPod service
   */
  async healthCheck() {
    if (!this.isConnected) {
      return { healthy: false, error: 'Not connected to RunPod TTS' };
    }

    try {
      this.ws.send(JSON.stringify({ type: 'health_check' }));
      return { healthy: true, service: 'runpod_tts' };
    } catch (error) {
      return { healthy: false, error: error.message };
    }
  }

  /**
   * Get connected clients from RunPod
   */
  async getConnectedClients() {
    if (!this.isConnected) {
      return { success: false, error: 'Not connected to RunPod TTS' };
    }

    try {
      this.ws.send(JSON.stringify({ type: 'get_connected_clients' }));
      return { success: true, message: 'Request sent' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequests: this.pendingRequests.size,
      service: 'runpod_tts'
    };
  }

  /**
   * Cleanup and disconnect
   */
  async cleanup() {
    console.log('🧹 Cleaning up RunPod TTS client...');
    
    this.isConnected = false;
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.pendingRequests.clear();
    console.log('✅ RunPod TTS client cleanup completed');
  }
}

// Create singleton instance
const flyRunPodTTSClient = new FlyRunPodTTSClient();

module.exports = {
  /**
   * Initialize RunPod TTS client
   */
  async initialize() {
    await flyRunPodTTSClient.initialize();
  },

  /**
   * Synthesize speech via RunPod (streams directly to client)
   * @param {string} text - Text to synthesize
   * @param {string} clientId - Target client ID
   * @param {Object} options - TTS options
   */
  async synthesizeSpeech(text, clientId, options = {}) {
    return await flyRunPodTTSClient.synthesizeSpeech(text, clientId, options);
  },

  /**
   * Health check
   */
  async healthCheck() {
    return await flyRunPodTTSClient.healthCheck();
  },

  /**
   * Get status
   */
  getStatus() {
    return flyRunPodTTSClient.getStatus();
  },

  /**
   * Cleanup
   */
  async cleanup() {
    await flyRunPodTTSClient.cleanup();
  }
};