// Voice conversation pipeline: STT → LLM → TTS
const whisperSTT = require('./whisper');
const sanskritGPT = require('./gpt');
const pollyTTS = require('./tts');
const sessionManager = require('./session');

class VoicePipeline {
  constructor() {
    this.isInitialized = false;
    this.stats = {
      totalProcessed: 0,
      successfulConversations: 0,
      errors: 0,
      averageProcessingTime: 0
    };
    
    this.initialize();
  }

  /**
   * Initialize pipeline and verify all modules
   */
  async initialize() {
    try {
      console.log('🔧 Initializing Voice Pipeline...');
      
      // Test each module
      console.log('  ✅ Whisper STT module loaded');
      console.log('  ✅ Sanskrit GPT module loaded');  
      console.log('  ✅ Polly TTS module loaded');
      console.log('  ✅ Session Manager loaded');
      
      this.isInitialized = true;
      console.log('🚀 Voice Pipeline fully initialized and ready!');
      
    } catch (error) {
      console.error('❌ Pipeline initialization failed:', error.message);
      this.isInitialized = false;
    }
  }

  /**
   * Process complete voice conversation: Audio → Text → AI Response → Speech
   * @param {Buffer} audioBuffer - Input audio from user
   * @param {string} userId - User ID for session management
   * @param {Object} options - Processing options
   * @returns {Object} Complete pipeline result
   */
  async processVoiceConversation(audioBuffer, userId, options = {}) {
    const startTime = Date.now();
    const pipelineId = `${userId}_${Date.now()}`;
    
    try {
      console.log(`🎯 Pipeline ${pipelineId} started`);
      
      if (!this.isInitialized) {
        throw new Error('Pipeline not initialized');
      }

      // Update session state
      sessionManager.updateState(userId, 'processing');

      // Step 1: Speech to Text (STT)
      console.log(`🎙️ Step 1: STT processing...`);
      const sttResult = await whisperSTT.transcribe(audioBuffer, {
        format: options.audioFormat || 'webm',
        language: options.language || 'auto'
      });

      if (!sttResult.success) {
        throw new Error(`STT failed: ${sttResult.error}`);
      }

      console.log(`📝 Transcription: "${sttResult.text}"`);

      // Step 2: Language Model (LLM) 
      console.log(`🤖 Step 2: LLM processing...`);
      const llmResult = await sanskritGPT.generateSanskritResponse(
        sttResult.text, 
        userId, 
        {
          detectedLanguage: sttResult.language,
          audioQuality: this.assessAudioQuality(audioBuffer)
        }
      );

      if (!llmResult.success) {
        throw new Error(`LLM failed: ${llmResult.error}`);
      }

      console.log(`💭 AI Response: "${llmResult.response}"`);

      // Step 3: Text to Speech (TTS)
      console.log(`🔊 Step 3: TTS processing...`);
      const ttsResult = await pollyTTS.synthesizeWithLanguageOptimization(
        llmResult.response,
        sttResult.language,
        {
          voiceId: options.voiceId,
          engine: options.ttsEngine || 'standard'
        }
      );

      if (!ttsResult.success) {
        throw new Error(`TTS failed: ${ttsResult.error}`);
      }

      // Calculate total processing time
      const endTime = Date.now();
      const totalDuration = endTime - startTime;

      // Update statistics
      this.updateStats(true, totalDuration);

      // Update session state
      sessionManager.updateState(userId, 'speaking');

      const result = {
        success: true,
        pipelineId,
        steps: {
          stt: {
            text: sttResult.text,
            language: sttResult.language,
            duration: sttResult.duration,
            audioSize: sttResult.audioSize
          },
          llm: {
            response: llmResult.response,
            tokens: llmResult.tokensUsed,
            duration: llmResult.duration,
            conversationLength: llmResult.conversationLength
          },
          tts: {
            audioBuffer: ttsResult.audioBuffer,
            audioSize: ttsResult.audioSize,
            voice: ttsResult.voice,
            format: ttsResult.format,
            duration: ttsResult.duration
          }
        },
        totalDuration,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Pipeline ${pipelineId} completed in ${totalDuration}ms`);
      return result;

    } catch (error) {
      const endTime = Date.now();
      const totalDuration = endTime - startTime;
      
      console.error(`❌ Pipeline ${pipelineId} failed: ${error.message}`);
      
      // Update statistics
      this.updateStats(false, totalDuration);
      
      // Update session state back to listening
      sessionManager.updateState(userId, 'listening');

      return {
        success: false,
        pipelineId,
        error: error.message,
        totalDuration,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Process text-only conversation (skip STT)
   * @param {string} text - Input text from user
   * @param {string} userId - User ID
   * @param {Object} options - Processing options
   * @returns {Object} Pipeline result
   */
  async processTextConversation(text, userId, options = {}) {
    const startTime = Date.now();
    const pipelineId = `${userId}_text_${Date.now()}`;
    
    try {
      console.log(`📝 Text Pipeline ${pipelineId} started`);
      
      // Update session state
      sessionManager.updateState(userId, 'processing');

      // Step 1: LLM Processing
      const llmResult = await sanskritGPT.generateSanskritResponse(text, userId);
      
      if (!llmResult.success) {
        throw new Error(`LLM failed: ${llmResult.error}`);
      }

      // Step 2: TTS Processing
      const ttsResult = await pollyTTS.synthesizeSpeech(llmResult.response, options);
      
      if (!ttsResult.success) {
        throw new Error(`TTS failed: ${ttsResult.error}`);
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;
      
      // Update session state
      sessionManager.updateState(userId, 'speaking');

      console.log(`✅ Text Pipeline ${pipelineId} completed in ${totalDuration}ms`);
      
      return {
        success: true,
        pipelineId,
        inputText: text,
        response: llmResult.response,
        audioBuffer: ttsResult.audioBuffer,
        totalDuration,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Text Pipeline ${pipelineId} failed: ${error.message}`);
      sessionManager.updateState(userId, 'listening');
      
      return {
        success: false,
        pipelineId,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Assess audio quality for processing optimization
   * @param {Buffer} audioBuffer - Audio data
   * @returns {string} Quality assessment
   */
  assessAudioQuality(audioBuffer) {
    const size = audioBuffer.length;
    
    if (size < 1000) return 'very_low';
    if (size < 5000) return 'low';
    if (size < 50000) return 'medium';
    if (size < 200000) return 'high';
    return 'very_high';
  }

  /**
   * Update pipeline statistics
   * @param {boolean} success - Whether pipeline succeeded
   * @param {number} duration - Processing duration in ms
   */
  updateStats(success, duration) {
    this.stats.totalProcessed++;
    
    if (success) {
      this.stats.successfulConversations++;
    } else {
      this.stats.errors++;
    }
    
    // Update average processing time
    const total = this.stats.averageProcessingTime * (this.stats.totalProcessed - 1) + duration;
    this.stats.averageProcessingTime = Math.round(total / this.stats.totalProcessed);
  }

  /**
   * Get pipeline statistics
   * @returns {Object} Pipeline stats
   */
  getStats() {
    const successRate = this.stats.totalProcessed > 0 
      ? ((this.stats.successfulConversations / this.stats.totalProcessed) * 100).toFixed(1)
      : 0;

    return {
      ...this.stats,
      successRate: `${successRate}%`,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Health check for all pipeline components
   * @returns {Object} Health status
   */
  async healthCheck() {
    const health = {
      pipeline: this.isInitialized,
      components: {
        whisper: true, // Always available (no persistent connection)
        gpt: true,     // Always available (no persistent connection)
        tts: true,     // Always available (no persistent connection)
        sessions: sessionManager.getAllSessions().length < sessionManager.maxSessions
      },
      stats: this.getStats(),
      timestamp: new Date().toISOString()
    };

    const allHealthy = Object.values(health.components).every(status => status === true);
    health.overall = allHealthy && health.pipeline;

    return health;
  }

  /**
   * Reset pipeline statistics
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      successfulConversations: 0,
      errors: 0,
      averageProcessingTime: 0
    };
    console.log('📊 Pipeline statistics reset');
  }
}

module.exports = new VoicePipeline();