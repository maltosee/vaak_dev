// OpenAI Whisper STT module
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');

class WhisperSTT {
  constructor() {
    this.apiKey = config.openai.apiKey;
    this.apiUrl = `${config.openai.baseUrl}/audio/transcriptions`;
    this.whisperConfig = config.openai.whisper;
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    console.log('✅ Whisper STT initialized');
    console.log(`🔧 Using model: ${this.whisperConfig.model}`);
    console.log(`🌍 Language: ${this.whisperConfig.language || 'auto-detect'}`);
  }

  /**
   * Convert audio buffer to text using OpenAI Whisper API
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {Object} options - Transcription options
   * @returns {Object} Transcription result
   */
  async transcribe(audioBuffer, options = {}) {
    try {
      const startTime = Date.now();
      
      // Validate audio buffer
      const validation = this.validateAudioBuffer(audioBuffer);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      
      // Create temporary file for Whisper API
      const tempFilePath = await this.saveBufferToTempFile(audioBuffer, options.format || 'webm');
      
      const formData = new FormData();
      formData.append('file', fs.createReadStream(tempFilePath));
      formData.append('model', options.model || this.whisperConfig.model);
      formData.append('response_format', options.responseFormat || this.whisperConfig.responseFormat);
      
      // Only append language if explicitly provided and not 'auto'
      const language = options.language || this.whisperConfig.language;
      if (language && language !== 'auto') {
        formData.append('language', language);
      }
      
      // Add optional parameters
      if (options.prompt) {
        formData.append('prompt', options.prompt);
      }
      
      const temperature = options.temperature !== undefined ? options.temperature : this.whisperConfig.temperature;
      if (temperature !== undefined && temperature !== 0) {
        formData.append('temperature', temperature);
      }

      const response = await axios.post(this.apiUrl, formData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders()
        },
        timeout: options.timeout || this.whisperConfig.timeout
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Clean up temp file
      await this.cleanupTempFile(tempFilePath);

      const result = {
        success: true,
        text: response.data.text,
        language: response.data.language || 'unknown',
        duration: duration,
        audioSize: audioBuffer.length,
        timestamp: new Date().toISOString()
      };

      console.log(`🎙️ Whisper transcription: "${result.text}" (${duration}ms, ${result.language})`);
      return result;

    } catch (error) {
      console.error('❌ Whisper transcription failed:', error.message);
      
      // Enhanced error handling
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;
        
        return {
          success: false,
          error: `Whisper API error (${status}): ${errorData.error?.message || error.message}`,
          status,
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        success: false,
        error: `Whisper transcription failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Save audio buffer to temporary file
   * @param {Buffer} audioBuffer - Audio data
   * @param {string} format - Audio format (webm, mp3, wav, etc.)
   * @returns {string} Temporary file path
   */
  async saveBufferToTempFile(audioBuffer, format) {
    const tempDir = path.join(__dirname, '..', 'temp_audio');
    
    // Create temp directory if it doesn't exist
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const fileName = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${format}`;
    const filePath = path.join(tempDir, fileName);
    
    await fs.promises.writeFile(filePath, audioBuffer);
    
    console.log(`💾 Temp audio file created: ${fileName} (${audioBuffer.length} bytes)`);
    return filePath;
  }

  /**
   * Clean up temporary file
   * @param {string} filePath - Path to temporary file
   */
  async cleanupTempFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
        console.log(`🗑️ Temp file cleaned up: ${path.basename(filePath)}`);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to cleanup temp file ${filePath}:`, error.message);
    }
  }

  /**
   * Transcribe with language detection fallback
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {Array} preferredLanguages - Array of language codes to try
   * @returns {Object} Transcription result with language info
   */
  async transcribeWithLanguageDetection(audioBuffer, preferredLanguages = null) {
    try {
      const languages = preferredLanguages || this.whisperConfig.preferredLanguages;
      
      // First, try auto-detection (no language parameter)
      let result = await this.transcribe(audioBuffer);
      
      if (result.success && result.text.trim().length > 0) {
        return {
          ...result,
          detectedLanguage: result.language,
          method: 'auto_detection'
        };
      }

      // If auto-detection fails, try preferred languages
      for (const lang of languages) {
        console.log(`🔄 Trying language: ${lang}`);
        result = await this.transcribe(audioBuffer, { language: lang });
        
        if (result.success && result.text.trim().length > 0) {
          return {
            ...result,
            detectedLanguage: lang,
            method: 'manual_fallback'
          };
        }
      }

      return {
        success: false,
        error: 'Transcription failed for all language attempts',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      return {
        success: false,
        error: `Language detection failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get supported audio formats
   * @returns {Array} Array of supported formats
   */
  getSupportedFormats() {
    return ['mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'wav', 'webm'];
  }

  /**
   * Validate audio buffer
   * @param {Buffer} audioBuffer - Audio data buffer
   * @returns {Object} Validation result
   */
  validateAudioBuffer(audioBuffer) {
    const maxSize = this.whisperConfig.maxFileSize;
    
    if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) {
      return { valid: false, error: 'Invalid audio buffer' };
    }
    
    if (audioBuffer.length === 0) {
      return { valid: false, error: 'Empty audio buffer' };
    }
    
    if (audioBuffer.length > maxSize) {
      return { 
        valid: false, 
        error: `Audio file too large (${audioBuffer.length} bytes). Max: ${maxSize} bytes` 
      };
    }
    
    return { valid: true };
  }

  /**
   * Get current configuration
   * @returns {Object} Current Whisper configuration
   */
  getConfig() {
    return {
      model: this.whisperConfig.model,
      language: this.whisperConfig.language,
      timeout: this.whisperConfig.timeout,
      maxFileSize: this.whisperConfig.maxFileSize,
      preferredLanguages: this.whisperConfig.preferredLanguages,
      responseFormat: this.whisperConfig.responseFormat,
      temperature: this.whisperConfig.temperature
    };
  }
}

module.exports = new WhisperSTT();