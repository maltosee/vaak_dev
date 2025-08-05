// HF Spaces TTS module for Sanskrit Tutor
const fetch = require('node-fetch');
const config = require('../utils/config');

class HuggingFaceTTS {
  constructor() {
    this.hfSpaceUrl = config.hf.ttsSpaceUrl || process.env.HF_TTS_SPACE_URL;
    this.hfToken = config.hf.token || process.env.HF_TOKEN;
    
    if (!this.hfSpaceUrl) {
      throw new Error('HF_TTS_SPACE_URL environment variable is required');
    }
    
    console.log(`✅ HuggingFace TTS initialized (Space: ${this.hfSpaceUrl})`);
  }

  /**
   * Convert text to speech using HF Spaces HTTP endpoint
   * @param {string} text - Text to convert to speech
   * @param {Object} options - TTS options
   * @returns {Object} TTS result with audio buffer
   */
  async synthesizeSpeech(text, options = {}) {
    try {
      const startTime = Date.now();
      
      // Prepare request payload for HF Spaces
      const payload = {
        text: text,
        voice: options.voiceId || 'default',
        language: options.languageCode || 'hi-IN',
        streaming: options.streaming !== false, // Default to streaming
        sample_rate: parseInt(options.sampleRate) || 16000,
        format: options.outputFormat || 'wav'
      };

      console.log(`🔊 HF TTS request: "${text.substring(0, 50)}..." (${payload.language})`);

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/octet-stream'
      };

      if (this.hfToken) {
        headers['Authorization'] = `Bearer ${this.hfToken}`;
      }

      // Make HTTP request to HF Spaces
      const response = await fetch(`${this.hfSpaceUrl}/tts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
        timeout: 30000 // 30 second timeout
      });

      if (!response.ok) {
        throw new Error(`HF Spaces TTS failed: ${response.status} ${response.statusText}`);
      }

      // Get audio buffer from response
      const audioBuffer = await response.buffer();
      const duration = Date.now() - startTime;

      console.log(`🎵 HF TTS completed: ${audioBuffer.length} bytes in ${duration}ms`);
      
      return {
        success: true,
        audioBuffer,
        audioSize: audioBuffer.length,
        format: payload.format,
        voice: payload.voice,
        language: payload.language,
        duration,
        originalText: text,
        source: 'huggingface'
      };

    } catch (error) {
      console.error('❌ HF TTS synthesis failed:', error.message);
      return {
        success: false,
        error: `HF TTS synthesis failed: ${error.message}`
      };
    }
  }

  /**
   * Streaming TTS synthesis for real-time audio
   * @param {string} text - Text to convert
   * @param {Object} options - TTS options
   * @param {Function} onChunk - Callback for each audio chunk
   * @returns {Object} Stream result
   */
  async synthesizeSpeechStreaming(text, options = {}, onChunk) {
    try {
      const startTime = Date.now();
      
      const payload = {
        text: text,
        voice: options.voiceId || 'default',
        language: options.languageCode || 'hi-IN',
        streaming: true,
        sample_rate: parseInt(options.sampleRate) || 16000,
        format: options.outputFormat || 'wav',
        chunk_size: options.chunkSize || 1024
      };

      console.log(`🌊 HF TTS streaming: "${text.substring(0, 50)}..."`);

      const headers = {
        'Content-Type': 'application/json'
      };

      if (this.hfToken) {
        headers['Authorization'] = `Bearer ${this.hfToken}`;
      }

      const response = await fetch(`${this.hfSpaceUrl}/tts-stream`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`HF Spaces streaming TTS failed: ${response.status}`);
      }

      let totalBytes = 0;
      const chunks = [];

      // Process streaming response
      response.body.on('data', (chunk) => {
        totalBytes += chunk.length;
        chunks.push(chunk);
        
        // Call chunk callback if provided
        if (onChunk) {
          onChunk(chunk);
        }
        
        console.log(`📦 Received chunk: ${chunk.length} bytes (total: ${totalBytes})`);
      });

      return new Promise((resolve, reject) => {
        response.body.on('end', () => {
          const duration = Date.now() - startTime;
          const fullBuffer = Buffer.concat(chunks);
          
          console.log(`🎵 HF TTS streaming completed: ${totalBytes} bytes in ${duration}ms`);
          
          resolve({
            success: true,
            audioBuffer: fullBuffer,
            audioSize: totalBytes,
            chunks: chunks.length,
            duration,
            source: 'huggingface-stream'
          });
        });

        response.body.on('error', (error) => {
          console.error('❌ HF TTS streaming error:', error);
          reject({
            success: false,
            error: `Streaming failed: ${error.message}`
          });
        });
      });

    } catch (error) {
      console.error('❌ HF TTS streaming setup failed:', error.message);
      return {
        success: false,
        error: `HF TTS streaming failed: ${error.message}`
      };
    }
  }

  /**
   * Health check for HF Spaces endpoint
   * @returns {Object} Health status
   */
  async healthCheck() {
    try {
      const response = await fetch(`${this.hfSpaceUrl}/health`, {
        method: 'GET',
        timeout: 5000
      });

      return {
        status: response.ok ? 'healthy' : 'unhealthy',
        statusCode: response.status,
        responseTime: Date.now()
      };
    } catch (error) {
      return {
        status: 'error',
        error: error.message
      };
    }
  }

  /**
   * Get available voices from HF Spaces
   * @returns {Object} Available voices
   */
  async getAvailableVoices() {
    try {
      const response = await fetch(`${this.hfSpaceUrl}/voices`, {
        method: 'GET',
        headers: this.hfToken ? { 'Authorization': `Bearer ${this.hfToken}` } : {}
      });

      if (response.ok) {
        return await response.json();
      } else {
        return {
          voices: ['default'],
          languages: ['hi-IN', 'en-IN', 'sa-IN']
        };
      }
    } catch (error) {
      console.error('❌ Failed to get voices:', error.message);
      return {
        voices: ['default'],
        languages: ['hi-IN']
      };
    }
  }
}

module.exports = new HuggingFaceTTS();