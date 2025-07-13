// Language Detection Module - Mirrors Python language_detector.py logic
const axios = require('axios');
const config = require('../utils/config');

class LanguageDetector {
  constructor() {
    this.apiKey = config.openai.apiKey;
    this.apiUrl = `${config.openai.baseUrl}/chat/completions`;
    
    if (!this.apiKey) {
      throw new Error('OpenAI API key not configured for language detection');
    }
    
    console.log('✅ Language Detector initialized');
  }

  /**
   * Detect language from dual STT outputs
   * @param {string} customTranscript - Output from custom Sanskrit/Hindi STT
   * @param {string} whisperTranscript - Output from Whisper English STT
   * @returns {string} Final transcript with language hint or "Unrecognized Language"
   */
  async detectLanguage(customTranscript, whisperTranscript) {
    const customClean = (customTranscript || '').trim();
    const whisperClean = (whisperTranscript || '').trim();
    
    console.log(`🔍 Language Detection - Custom: "${customClean}", Whisper: "${whisperClean}"`);
    
    // Exact same prompt as Python version
    const prompt = `
Analyze these speech recognition outputs and identify the actual language:

Transcript 1 (Custom STT): "${customClean}"
Transcript 2 (Whisper STT): "${whisperClean}"

Step 1: Check Transcript 1 for meaningful content:
- If it contains real Hindi words like "मुझे", "कुछ", "नहीं", "आता", "है" etc. → "Hindi"
- If it contains real Sanskrit words like "अहम्", "त्वम्", "गच्छामि", "नमस्ते" etc. → "Sanskrit"  
- If it's transliterated English like "हइस्टेन्", "बेंगलोर्", "आइ स्पीक्" → Go to Step 2

Step 2: If Transcript 1 is transliterated English, check Transcript 2:
- If clear English → "English"

Step 3: If unclear → "Unrecognized"

Current analysis:
- Transcript 1: "${customClean}"
- Is this real Hindi/Sanskrit vocabulary or transliterated English?

Respond with ONLY: Sanskrit | Hindi | English | Unrecognized
`;

    try {
      const response = await axios.post(this.apiUrl, {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 10,
        temperature: 0.1
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000 // 10 second timeout
      });

      const languageHint = response.data.choices[0].message.content.trim();
      console.log(`🎯 Language Detection Result: "${languageHint}"`);

      // Python-style transcript selection logic
      if (languageHint === 'Sanskrit' || languageHint === 'Hindi') {
        const finalResult = `${customClean} <${languageHint.toLowerCase()}>`;
        console.log(`✅ Using custom transcript: "${finalResult}"`);
        return finalResult;
      } else if (languageHint === 'English') {
        const finalResult = `${whisperClean} <english>`;
        console.log(`✅ Using whisper transcript: "${finalResult}"`);
        return finalResult;
      } else {
        console.log(`❌ Unrecognized language detected`);
        return 'Unrecognized Language';
      }

    } catch (error) {
      console.error('❌ Language detection error:', error.message);
      return 'Unrecognized Language';
    }
  }

  /**
   * Extract language hint from transcript
   * @param {string} transcript - Transcript with language hint like "text <hindi>"
   * @returns {Object} { text: string, language: string }
   */
  extractLanguageHint(transcript) {
    if (transcript === 'Unrecognized Language') {
      return { text: '', language: 'unknown' };
    }

    const match = transcript.match(/^(.+?)\s*<(sanskrit|hindi|english)>$/);
    if (match) {
      return {
        text: match[1].trim(),
        language: match[2]
      };
    }

    // Fallback if no language hint found
    return {
      text: transcript,
      language: 'unknown'
    };
  }
}

module.exports = new LanguageDetector();