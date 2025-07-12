// AWS Polly TTS module
const AWS = require('aws-sdk');
const config = require('../utils/config');

class PollyTTS {
  constructor() {
    // Configure AWS
    AWS.config.update({
      accessKeyId: config.aws.accessKeyId,
      secretAccessKey: config.aws.secretAccessKey,
      region: config.aws.region
    });

    this.polly = new AWS.Polly();
    this.defaultVoice = config.aws.pollyVoiceId;
    this.defaultLanguage = config.aws.pollyLanguageCode;
    
    if (!config.aws.accessKeyId || !config.aws.secretAccessKey) {
      throw new Error('AWS credentials not configured');
    }
    
    console.log(`✅ Polly TTS initialized (Voice: ${this.defaultVoice}, Language: ${this.defaultLanguage})`);
  }

  /**
   * Convert text to speech using AWS Polly
   * @param {string} text - Text to convert to speech
   * @param {Object} options - TTS options
   * @returns {Object} TTS result with audio buffer
   */
  async synthesizeSpeech(text, options = {}) {
    try {
      const startTime = Date.now();

      // Prepare Polly parameters
      const params = {
        Text: this.preprocessText(text),
        OutputFormat: options.outputFormat || 'mp3',
        VoiceId: options.voiceId || this.defaultVoice,
        LanguageCode: options.languageCode || this.defaultLanguage,
        Engine: options.engine || 'standard', // 'standard' or 'neural'
        SampleRate: options.sampleRate || '16000',
        TextType: options.textType || 'text' // 'text' or 'ssml'
      };

      // Add SSML support if needed
      if (options.ssml) {
        params.Text = this.wrapWithSSML(params.Text, options);
        params.TextType = 'ssml';
      }

      console.log(`🔊 Synthesizing: "${text.substring(0, 50)}..." with voice ${params.VoiceId}`);

      const result = await this.polly.synthesizeSpeech(params).promise();
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      if (!result.AudioStream) {
        throw new Error('No audio stream received from Polly');
      }

      // Convert stream to buffer
      const audioBuffer = Buffer.from(result.AudioStream);

      const response = {
        success: true,
        audioBuffer,
        audioSize: audioBuffer.length,
        format: params.OutputFormat,
        voice: params.VoiceId,
        language: params.LanguageCode,
        duration,
        sampleRate: params.SampleRate,
        timestamp: new Date().toISOString(),
        originalText: text
      };

      console.log(`🎵 TTS completed: ${audioBuffer.length} bytes in ${duration}ms`);
      return response;

    } catch (error) {
      console.error('❌ TTS synthesis failed:', error.message);
      
      // Enhanced error handling
      if (error.code) {
        return {
          success: false,
          error: `Polly error (${error.code}): ${error.message}`,
          code: error.code,
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        success: false,
        error: `TTS synthesis failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Synthesize speech with language-specific optimizations
   * @param {string} text - Text to synthesize
   * @param {string} detectedLanguage - Language detected from input
   * @param {Object} options - Additional options
   * @returns {Object} TTS result
   */
  async synthesizeWithLanguageOptimization(text, detectedLanguage, options = {}) {
    try {
      // Select appropriate voice based on detected language
      const voiceConfig = this.selectVoiceForLanguage(detectedLanguage);
      
      const enhancedOptions = {
        ...options,
        voiceId: options.voiceId || voiceConfig.voiceId,
        languageCode: options.languageCode || voiceConfig.languageCode,
        engine: voiceConfig.engine || 'standard'
      };

      // Add language-specific text preprocessing
      const processedText = this.preprocessTextForLanguage(text, detectedLanguage);

      return await this.synthesizeSpeech(processedText, enhancedOptions);

    } catch (error) {
      // Fallback to default voice if language-specific synthesis fails
      console.warn(`⚠️ Language-specific TTS failed, falling back to default: ${error.message}`);
      return await this.synthesizeSpeech(text, options);
    }
  }

  /**
   * Select appropriate voice for detected language
   * @param {string} language - Detected language code
   * @returns {Object} Voice configuration
   */
  selectVoiceForLanguage(language) {
    const voiceMap = {
      'en': { voiceId: 'Joanna', languageCode: 'en-US', engine: 'neural' },
      'hi': { voiceId: 'Aditi', languageCode: 'hi-IN', engine: 'standard' },
      'sa': { voiceId: 'Aditi', languageCode: 'hi-IN', engine: 'standard' }, // Sanskrit → Hindi voice
      'auto': { voiceId: this.defaultVoice, languageCode: this.defaultLanguage, engine: 'standard' }
    };

    return voiceMap[language] || voiceMap['auto'];
  }

  /**
   * Preprocess text for better TTS output
   * @param {string} text - Original text
   * @returns {string} Preprocessed text
   */
  preprocessText(text) {
    let processed = text.trim();
    
    // Remove excessive punctuation
    processed = processed.replace(/[.]{2,}/g, '.');
    processed = processed.replace(/[!]{2,}/g, '!');
    processed = processed.replace(/[?]{2,}/g, '?');
    
    // Add pauses for better speech flow
    processed = processed.replace(/[.!?]/g, '$&<break time="0.5s"/>');
    processed = processed.replace(/[,;]/g, '$&<break time="0.3s"/>');
    
    // Handle Sanskrit transliterations (basic)
    processed = this.improveSanskritPronunciation(processed);
    
    return processed;
  }

  /**
   * Language-specific text preprocessing
   * @param {string} text - Text to process
   * @param {string} language - Language code
   * @returns {string} Processed text
   */
  preprocessTextForLanguage(text, language) {
    switch (language) {
      case 'sa': // Sanskrit
        return this.preprocessSanskritText(text);
      case 'hi': // Hindi
        return this.preprocessHindiText(text);
      case 'en': // English
        return this.preprocessEnglishText(text);
      default:
        return this.preprocessText(text);
    }
  }

  /**
   * Improve Sanskrit pronunciation in text
   * @param {string} text - Text with potential Sanskrit words
   * @returns {string} Text with improved pronunciation
   */
  improveSanskritPronunciation(text) {
    const pronunciationMap = {
      'namaste': 'nah-mas-tay',
      'guru': 'goo-roo',
      'dharma': 'dhar-ma',
      'karma': 'kar-ma',
      'yoga': 'yo-ga',
      'mantra': 'man-tra',
      'pranayama': 'prah-nah-yah-ma',
      'asana': 'ah-sa-na'
    };

    let improved = text;
    Object.entries(pronunciationMap).forEach(([word, pronunciation]) => {
      const regex = new RegExp(`\\b${word}\\b`, 'gi');
      improved = improved.replace(regex, `<phoneme alphabet="ipa" ph="${pronunciation}">${word}</phoneme>`);
    });

    return improved;
  }

  /**
   * Preprocess Sanskrit text
   * @param {string} text - Sanskrit text
   * @returns {string} Processed text
   */
  preprocessSanskritText(text) {
    // Add breathing pauses for Sanskrit mantras/verses
    let processed = text.replace(/।/g, '<break time="1s"/>'); // Devanagari sentence end
    processed = processed.replace(/॥/g, '<break time="1.5s"/>'); // Verse end
    
    return this.preprocessText(processed);
  }

  /**
   * Preprocess Hindi text
   * @param {string} text - Hindi text
   * @returns {string} Processed text
   */
  preprocessHindiText(text) {
    return this.preprocessText(text);
  }

  /**
   * Preprocess English text
   * @param {string} text - English text
   * @returns {string} Processed text
   */
  preprocessEnglishText(text) {
    return this.preprocessText(text);
  }

  /**
   * Wrap text with SSML tags
   * @param {string} text - Text to wrap
   * @param {Object} options - SSML options
   * @returns {string} SSML wrapped text
   */
  wrapWithSSML(text, options = {}) {
    const rate = options.rate || 'medium'; // x-slow, slow, medium, fast, x-fast
    const pitch = options.pitch || 'medium'; // x-low, low, medium, high, x-high
    const volume = options.volume || 'medium'; // silent, x-soft, soft, medium, loud, x-loud

    return `<speak>
      <prosody rate="${rate}" pitch="${pitch}" volume="${volume}">
        ${text}
      </prosody>
    </speak>`;
  }

  /**
   * Get available voices for a language
   * @param {string} languageCode - Language code (e.g., 'hi-IN')
   * @returns {Promise<Array>} Array of available voices
   */
  async getAvailableVoices(languageCode) {
    try {
      const params = languageCode ? { LanguageCode: languageCode } : {};
      const result = await this.polly.describeVoices(params).promise();
      
      return result.Voices.map(voice => ({
        id: voice.Id,
        name: voice.Name,
        gender: voice.Gender,
        languageCode: voice.LanguageCode,
        languageName: voice.LanguageName,
        engine: voice.SupportedEngines
      }));
    } catch (error) {
      console.error('❌ Failed to get available voices:', error.message);
      return [];
    }
  }

  /**
   * Stream audio synthesis (for real-time playback)
   * @param {string} text - Text to synthesize
   * @param {Object} options - TTS options
   * @returns {Promise<Stream>} Audio stream
   */
  async synthesizeSpeechStream(text, options = {}) {
    try {
      const params = {
        Text: this.preprocessText(text),
        OutputFormat: 'mp3',
        VoiceId: options.voiceId || this.defaultVoice,
        LanguageCode: options.languageCode || this.defaultLanguage,
        Engine: options.engine || 'standard'
      };

      const result = await this.polly.synthesizeSpeech(params).promise();
      return result.AudioStream;

    } catch (error) {
      throw new Error(`Stream synthesis failed: ${error.message}`);
    }
  }
}

module.exports = new PollyTTS();