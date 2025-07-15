// Voice conversation pipeline: STT → LLM → TTS
const dualSTT = require('./dualSTT');
const sanskritGPT = require('./gpt');
const pollyTTS = require('./tts');
const sessionManager = require('./session');
const config = require('../utils/config');

class VoicePipeline {
  constructor() {
    this.isInitialized = false;
	this.lastHealthLogTime = 0; // ✅ ADD THIS LINE
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
      console.log('  ✅ Dual STT module loaded');
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
    const pipelineStart  = Date.now();
    const pipelineId = `${userId}_${Date.now()}`;
    
    try {
      console.log(`🎯 Pipeline ${pipelineId} started`);
      
      if (!this.isInitialized) {
        throw new Error('Pipeline not initialized');
      }

      // Update session state
      //sessionManager.updateState(userId, 'processing');

      // Step 1: Speech to Text (STT) with Dual STT
      const sttStart = Date.now();
	  console.log(`Phase (STT) Starting transcription...`);
      
      let sttResult;
      if (config.stt.enableDualSTT) {
        // Use dual STT (Custom + Whisper with language detection)
        sttResult = await dualSTT.transcribe(audioBuffer, {
          format: options.audioFormat || 'webm',
          language: options.language || 'auto'
        });
      } else {
        // Fallback to original Whisper only
        const whisperSTT = require('./whisper');
        sttResult = await whisperSTT.transcribe(audioBuffer, {
          format: options.audioFormat || 'webm',
          language: options.language || 'auto'
        });
      }

      if (!sttResult.success) {
        throw new Error(`STT failed: ${sttResult.error}`);
      }

      const sttDuration = Date.now() - sttStart;
	  console.log(`Phase (STT) {${sttDuration}ms} Transcription: "${sttResult.text}" (${sttResult.language})`);

      // Handle unrecognized language
      if (sttResult.text === 'Unrecognized Language' || sttResult.text === '') {
        // Update session state back to listening
        //sessionManager.updateState(userId, 'listening');
        
        return {
          success: true,
          pipelineId,
          steps: {
            stt: {
              text: 'Unrecognized Language',
              language: 'unknown',
              duration: sttResult.duration,
              audioSize: sttResult.audioSize
            },
            llm: {
              response: 'भाषा अपरीचिता। कृपया संस्कृतेन, हिंदी अथवा इंग्लिष् भाषया वदतु।',
              tokens: 0,
              duration: 0,
              conversationLength: 0
            },
            tts: null // Will be handled by special case
          },
          totalDuration: Date.now() - pipelineStart,
          timestamp: new Date().toISOString(),
          isUnrecognizedLanguage: true
        };
      }

      // Step 2: Language Model (LLM) 
         const llmStart = Date.now();
	     console.log(`Phase (LLM) Starting response generation...`);
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

      const llmDuration = Date.now() - llmStart;
	  console.log(`Phase (LLM) {${llmDuration}ms} Response generated: "${llmResult.response.substring(0, 50)}..."`);

      // Step 3: Text to Speech (TTS)
      const ttsStart = Date.now();
	  console.log(`Phase (TTS) Starting speech synthesis...`);
      const ttsResult = await pollyTTS.synthesizeSpeech(
			llmResult.response,
			{
			  voiceId: 'Kajal', // Use bilingual voice
			  languageCode: 'hi-IN', // Hindi base for bilingual
			  engine: 'neural' // Better quality
			}
      );

      if (!ttsResult.success) {
        throw new Error(`TTS failed: ${ttsResult.error}`);
      }

      // Calculate total processing time
      const ttsDuration = Date.now() - ttsStart;
	  const totalDuration = Date.now() - pipelineStart;

      // Update statistics
      this.updateStats(true, totalDuration);

      // Update session state
      //sessionManager.updateState(userId, 'speaking');

      const result = {
        success: true,
        pipelineId,
        steps: {
          stt: {
            text: sttResult.text,
            language: sttResult.language,
            duration: sttResult.duration,
            audioSize: sttResult.audioSize,
            debug: sttResult.debug // Include dual STT debug info
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

      console.log(`Phase (TTS) {${ttsDuration}ms} Speech synthesis completed`);
	  console.log(`✅ Pipeline ${pipelineId} completed in ${totalDuration}ms (STT: ${sttDuration}ms, LLM: ${llmDuration}ms, TTS: ${ttsDuration}ms)`);
      return result;

    } catch (error) {
      const endTime = Date.now();
      const totalDuration = endTime - pipelineStart;
      
      console.error(`❌ Pipeline ${pipelineId} failed: ${error.message}`);
      
      // Update statistics
      this.updateStats(false, totalDuration);
      
      // Update session state back to listening
      //sessionManager.updateState(userId, 'listening');

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
      //sessionManager.updateState(userId, 'processing');

      // Step 1: LLM Processing
      const llmResult = await sanskritGPT.generateSanskritResponse(text, userId);
      
      if (!llmResult.success) {
        throw new Error(`LLM failed: ${llmResult.error}`);
      }

      // Step 2: TTS Processing
      const ttsResult = await pollyTTS.synthesizeSpeech(llmResult.response, {
        voiceId: 'Kajal',
        languageCode: 'hi-IN',
        engine: 'neural'
      });
      
      if (!ttsResult.success) {
        throw new Error(`TTS failed: ${ttsResult.error}`);
      }

      const endTime = Date.now();
      const totalDuration = endTime - startTime;
      
      // Update session state
      //sessionManager.updateState(userId, 'speaking');

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
      //sessionManager.updateState(userId, 'listening');
      
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
   
  
// BEFORE:
async healthCheck() {
  console.log('🔍 getAllSessions().length =', sessionManager.getAllSessions().length);
  console.log('🔍 maxSessions =', sessionManager.maxSessions);
  
  const health = {
    pipeline: this.isInitialized,
    components: {
      dualSTT: config.stt.enableDualSTT,
      whisper: true,
      gpt: true,
      tts: true,
      sessions: sessionManager.getAllSessions().length < sessionManager.maxSessions
    },
    stats: this.getStats(),
    timestamp: new Date().toISOString()
  };

  const allHealthy = Object.values(health.components).every(status => status === true);
  health.overall = allHealthy && health.pipeline;

  return health;
}

// AFTER:
	async healthCheck() {
	  // Only log health checks every 15 minutes
	  const now = Date.now();
	  if (!this.lastHealthLogTime || (now - this.lastHealthLogTime) >= 15 * 60 * 1000) {
		console.log('🩺 Health Check (15min): Sessions:', sessionManager.getAllSessions().length, '/', sessionManager.maxSessions);
		this.lastHealthLogTime = now;
	  }
	  
	  const health = {
		pipeline: this.isInitialized,
		components: {
		  dualSTT: config.stt.enableDualSTT,
		  whisper: true,
		  gpt: true,
		  tts: true,
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