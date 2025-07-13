// Enhanced TTS.js for Sanskrit Tutor with Bilingual Support
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
    
    // Use bilingual voices by default
    this.bilingualVoices = {
      'aditi': { voiceId: 'Aditi', engine: 'standard', languages: ['hi-IN', 'en-IN'] },
      'kajal': { voiceId: 'Kajal', engine: 'neural', languages: ['hi-IN', 'en-IN'] }
    };
    
    this.defaultVoice = this.bilingualVoices.kajal; // Use neural for better quality
    
    console.log(`✅ Bilingual Polly TTS initialized (Voice: ${this.defaultVoice.voiceId}, Engine: ${this.defaultVoice.engine})`);
  }

  /**
   * Enhanced synthesis for Sanskrit learning with bilingual support
   */
  async synthesizeSanskritResponse(text, detectedLanguage, options = {}) {
    try {
      const startTime = Date.now();

      // Choose optimal voice based on content
      const selectedVoice = this.selectOptimalVoice(text, detectedLanguage, options);
      
      // Preprocess text for Sanskrit learning context
      const processedText = this.preprocessSanskritLearningText(text, detectedLanguage);

      // Prepare parameters for bilingual synthesis
      const params = {
        Text: processedText,
        OutputFormat: options.outputFormat || 'mp3',
        VoiceId: selectedVoice.voiceId,
        LanguageCode: options.languageCode || 'hi-IN', // Use Hindi as base for bilingual
        Engine: selectedVoice.engine,
        SampleRate: options.sampleRate || '16000'
      };

      console.log(`🔊 Synthesizing bilingual: "${text.substring(0, 50)}..." with ${params.VoiceId} (${params.Engine})`);

      const result = await this.polly.synthesizeSpeech(params).promise();
      
      if (!result.AudioStream) {
        throw new Error('No audio stream received from Polly');
      }

      const audioBuffer = Buffer.from(result.AudioStream);
      const duration = Date.now() - startTime;

      console.log(`🎵 Bilingual TTS completed: ${audioBuffer.length} bytes in ${duration}ms`);
      
      return {
        success: true,
        audioBuffer,
        audioSize: audioBuffer.length,
        format: params.OutputFormat,
        voice: params.VoiceId,
        engine: params.Engine,
        language: params.LanguageCode,
        duration,
        isBilingual: true,
        originalText: text
      };

    } catch (error) {
      console.error('❌ Bilingual TTS synthesis failed:', error.message);
      return {
        success: false,
        error: `Bilingual TTS failed: ${error.message}`
      };
    }
  }

  
  
  
  /**
 * Convert text to speech using AWS Polly (main method)
 * @param {string} text - Text to convert to speech
 * @param {Object} options - TTS options
 * @returns {Object} TTS result with audio buffer
 */
	async synthesizeSpeech(text, options = {}) {
	  try {
		const startTime = Date.now();

		// Use bilingual voice by default
		const selectedVoice = options.voiceId ? 
		  this.bilingualVoices[options.voiceId.toLowerCase()] || this.defaultVoice : 
		  this.defaultVoice;

		// Preprocess text for better output
		const processedText = this.preprocessSanskritLearningText(text, 'mixed');

		// Prepare Polly parameters
		const params = {
		  Text: processedText,
		  OutputFormat: options.outputFormat || 'mp3',
		  VoiceId: selectedVoice.voiceId,
		  LanguageCode: options.languageCode || 'hi-IN',
		  Engine: selectedVoice.engine,
		  SampleRate: options.sampleRate || '16000'
		};

		console.log(`🔊 Synthesizing: "${text.substring(0, 50)}..." with ${params.VoiceId} (${params.Engine})`);

		const result = await this.polly.synthesizeSpeech(params).promise();
		
		if (!result.AudioStream) {
		  throw new Error('No audio stream received from Polly');
		}

		const audioBuffer = Buffer.from(result.AudioStream);
		const duration = Date.now() - startTime;

		console.log(`🎵 TTS completed: ${audioBuffer.length} bytes in ${duration}ms`);
		
		return {
		  success: true,
		  audioBuffer,
		  audioSize: audioBuffer.length,
		  format: params.OutputFormat,
		  voice: params.VoiceId,
		  engine: params.Engine,
		  language: params.LanguageCode,
		  duration,
		  originalText: text
		};

	  } catch (error) {
		console.error('❌ TTS synthesis failed:', error.message);
		return {
		  success: false,
		  error: `TTS synthesis failed: ${error.message}`
		};
	  }
	}
	  
  /**
   * Select optimal voice based on content analysis
   */
  selectOptimalVoice(text, detectedLanguage, options = {}) {
    // User preference override
    if (options.voiceId) {
      const requestedVoice = Object.values(this.bilingualVoices)
        .find(v => v.voiceId.toLowerCase() === options.voiceId.toLowerCase());
      if (requestedVoice) return requestedVoice;
    }

    // Content-based selection
    const hasDevanagari = /[\u0900-\u097F]/.test(text);
    const hasEnglish = /[A-Za-z]/.test(text);
    const isMixed = hasDevanagari && hasEnglish;

    // For mixed content or high-quality needs, prefer Neural (Kajal)
    if (isMixed || options.quality === 'high') {
      return this.bilingualVoices.kajal;
    }

    // Default to Aditi for standard use
    return this.bilingualVoices.aditi;
  }

  /**
   * Preprocess text specifically for Sanskrit learning context
   */
  preprocessSanskritLearningText(text, detectedLanguage) {
    let processed = text.trim();

    // Handle common Sanskrit learning corrections
    const sanskritCorrections = {
      'किलमो': 'किलिमो',
      'kilmo': 'kilimo',
      'namo': 'namah',
      'नमो': 'नमः'
    };

    // Apply corrections
    Object.entries(sanskritCorrections).forEach(([incorrect, correct]) => {
      const regex = new RegExp(`\\b${incorrect}\\b`, 'gi');
      processed = processed.replace(regex, correct);
    });

    // Add natural pauses for learning context
    processed = processed.replace(/([.!?])/g, '$1 '); // Add space after punctuation
    processed = processed.replace(/([।॥])/g, '$1 '); // Add space after Devanagari punctuation
    
    // Handle romanized Sanskrit with pronunciation hints
    processed = this.addSanskritPronunciationHints(processed);

    return processed;
  }

  /**
   * Add pronunciation hints for Sanskrit words (using text, not SSML)
   */
  addSanskritPronunciationHints(text) {
    const pronunciationMap = {
      'namaste': 'namaskar', // More natural for Aditi/Kajal
      'dharma': 'dharm',
      'karma': 'karm',
      'guru': 'guru',
      'yoga': 'yog',
      'mantra': 'mantr',
      'pranayama': 'pranayam',
      'asana': 'aasan'
    };

    let improved = text;
    Object.entries(pronunciationMap).forEach(([sanskrit, hindiEquivalent]) => {
      // Only replace if it's not already in a learning context
      const regex = new RegExp(`\\b${sanskrit}\\b(?! (means|is|का अर्थ))`, 'gi');
      improved = improved.replace(regex, hindiEquivalent);
    });

    return improved;
  }

  /**
   * Handle mixed language responses typical in Sanskrit learning
   */
  formatMixedLanguageResponse(englishPart, hindiPart, sanskritPart = '') {
    let response = '';
    
    if (sanskritPart) {
      response += `${sanskritPart} `;
    }
    
    if (hindiPart) {
      response += `${hindiPart} `;
    }
    
    if (englishPart) {
      response += `${englishPart}`;
    }

    return response.trim();
  }

  /**
   * Get voice information for client
   */
  getAvailableVoices() {
    return {
      bilingual: Object.entries(this.bilingualVoices).map(([key, voice]) => ({
        key,
        name: voice.voiceId,
        engine: voice.engine,
        languages: voice.languages,
        description: `${voice.voiceId} (${voice.engine}) - Supports Hindi and Indian English`,
        recommended: key === 'kajal' ? 'Best quality (Neural)' : 'Standard quality'
      })),
      capabilities: {
        mixedLanguage: true,
        devanagari: true,
        romanized: true,
        englishHindi: true,
        sameSentenceSwitching: true
      }
    };
  }

  /**
   * Test bilingual capabilities
   */
  async testBilingualCapabilities() {
    const testTexts = [
      "Hello, मेरा नाम Aditi है", // Mixed script
      "This is a Sanskrit word: नमस्ते", // English + Devanagari
      "Namaste का अर्थ है hello in English", // All three
      "Let's learn yoga आसन today" // Mixed learning context
    ];

    console.log('🧪 Testing bilingual capabilities...');
    
    for (const text of testTexts) {
      try {
        const result = await this.synthesizeSanskritResponse(text, 'mixed');
        console.log(`✅ Test passed: "${text}" -> ${result.audioSize} bytes`);
      } catch (error) {
        console.log(`❌ Test failed: "${text}" -> ${error.message}`);
      }
    }
  }
}

module.exports = new PollyTTS();