// Dual STT Module - Mirrors Python SimpleDualSttPlugin logic
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const config = require('../utils/config');
const languageDetector = require('./languageDetector');

class DualSTT {
  constructor() {
    this.customAsrUrl = config.stt.customAsrUrl;
    this.whisperApiKey = config.openai.apiKey;
    this.whisperUrl = `${config.openai.baseUrl}/audio/transcriptions`;
    this.enableDualSTT = config.stt.enableDualSTT;
    
    if (!this.customAsrUrl) {
      throw new Error('Custom ASR URL not configured');
    }
    
    if (!this.whisperApiKey) {
      throw new Error('OpenAI API key not configured for Whisper');
    }
    
    console.log('✅ Dual STT initialized');
    console.log(`🔧 Custom ASR: ${this.customAsrUrl}`);
    console.log(`🔧 Dual STT enabled: ${this.enableDualSTT}`);
  }

  /**
   * Main transcription method - calls both STT services in parallel
   * @param {Buffer} audioBuffer - Audio data buffer
   * @param {Object} options - Transcription options
   * @returns {Object} Transcription result with language detection
   */
  async transcribe(audioBuffer, options = {}) {
    try {
      const startTime = Date.now();
      
      // Validate audio buffer
      if (!audioBuffer || !Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
        throw new Error('Invalid audio buffer');
      }

      if (!this.enableDualSTT) {
        // Fallback to Whisper only if dual STT is disabled
        console.log('🔄 Dual STT disabled, using Whisper only');
        return await this.callWhisperSTT(audioBuffer, options);
      }

      console.log(`🚀 Starting parallel STT transcription (${audioBuffer.length} bytes)`);
      
      // Call both STT services in parallel (mirrors Python asyncio.gather)
      const [customResult, whisperResult] = await Promise.all([
        this.callCustomSTT(audioBuffer, options),
        this.callWhisperSTT(audioBuffer, options)
      ]);

      const dualSttDuration = Date.now() - startTime;
      console.log(`⚡ Parallel STT completed in ${dualSttDuration}ms`);

      // Use language detector to get final transcript
      const finalTranscript = await languageDetector.detectLanguage(
        customResult.transcript, 
        whisperResult.transcript
      );

      // Extract language info from final transcript
      const { text, language } = languageDetector.extractLanguageHint(finalTranscript);

      const result = {
        success: true,
        text: text,
        language: language,
        duration: dualSttDuration,
        audioSize: audioBuffer.length,
        timestamp: new Date().toISOString(),
        debug: {
          customTranscript: customResult.transcript,
          whisperTranscript: whisperResult.transcript,
          finalTranscript: finalTranscript,
          customDuration: customResult.duration,
          whisperDuration: whisperResult.duration
        }
      };

      console.log(`🎯 Final Result: "${text}" (${language})`);
      return result;

    } catch (error) {
      console.error('❌ Dual STT failed:', error.message);
      return {
        success: false,
        error: `Dual STT failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Call custom Sanskrit/Hindi STT service
   * @param {Buffer} audioBuffer - Audio data
   * @param {Object} options - Options
   * @returns {Object} Custom STT result
   */
  async callCustomSTT(audioBuffer, options = {}) {
    try {
      const startTime = Date.now();
      
      const formData = new FormData();
      formData.append('audio', audioBuffer, {
        filename: 'audio.wav',
        contentType: 'audio/wav'
      });

      const response = await axios.post(this.customAsrUrl, formData, {
        headers: {
          ...formData.getHeaders()
        },
        timeout: config.stt.timeoutMs // 
      });

      const duration = Date.now() - startTime;
      const transcript = response.data.transcript || '';
      
      console.log(`🔤 Custom STT: "${transcript}" (${duration}ms)`);
      
      return {
        transcript: transcript,
        duration: duration,
        success: true
      };

    } catch (error) {
      console.error('❌ Custom STT error:', error.message);
      return {
        transcript: '',
        duration: 0,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Call OpenAI Whisper STT for English
   * @param {Buffer} audioBuffer - Audio data
   * @param {Object} options - Options
   * @returns {Object} Whisper STT result
   */
  async callWhisperSTT(audioBuffer, options = {}) {
    try {
      const startTime = Date.now();
      
      // Create temporary file for Whisper API
      const tempFilePath = await this.saveBufferToTempFile(audioBuffer, options.format || 'webm');
      
      const formData = new FormData();
      formData.append('file', fs.createReadStream(tempFilePath));
      formData.append('model', 'whisper-1');
      formData.append('language', 'en'); // Force English for Whisper in dual mode
      formData.append('response_format', 'json');

      const response = await axios.post(this.whisperUrl, formData, {
        headers: {
          'Authorization': `Bearer ${this.whisperApiKey}`,
          ...formData.getHeaders()
        },
        timeout: config.stt.timeoutMs // 30 second timeout
      });

      const duration = Date.now() - startTime;
      const transcript = response.data.text || '';
      
      // Clean up temp file
      await this.cleanupTempFile(tempFilePath);
      
      console.log(`🗣️ Whisper STT: "${transcript}" (${duration}ms)`);
      
      return {
        transcript: transcript,
        duration: duration,
        success: true,
        language: response.data.language || 'en'
      };

    } catch (error) {
      console.error('❌ Whisper STT error:', error.message);
      return {
        transcript: '',
        duration: 0,
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Save audio buffer to temporary file (reused from whisper.js)
   */
  async saveBufferToTempFile(audioBuffer, format) {
    const tempDir = path.join(__dirname, '..', 'temp_audio');
    
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    const fileName = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.${format}`;
    const filePath = path.join(tempDir, fileName);
    
    await fs.promises.writeFile(filePath, audioBuffer);
    return filePath;
  }

  /**
   * Clean up temporary file (reused from whisper.js)
   */
  async cleanupTempFile(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
    } catch (error) {
      console.warn(`⚠️ Failed to cleanup temp file ${filePath}:`, error.message);
    }
  }

  /**
   * Get configuration info
   */
  getConfig() {
    return {
      customAsrUrl: this.customAsrUrl,
      enableDualSTT: this.enableDualSTT,
      whisperUrl: this.whisperUrl
    };
  }
}

module.exports = new DualSTT();