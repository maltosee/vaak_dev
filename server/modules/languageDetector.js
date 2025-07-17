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
Given two transcripts of a user's spoken sentence, identify the **primary language of the sentence** — not based on a few individual words, but based on the **structure and overall intent** of the speech.

Transcript 1 (Custom STT): "${customClean}"
Transcript 2 (Whisper STT): "${whisperClean}"

Guidelines:

1. If the **sentence structure and grammar** are English — even if it includes Sanskrit words like "yatra", "pratyaya", "shabda" — classify as **English**.
   - Example: "Help me with yatra pratyaya" → English

2. If the structure is clearly Hindi (contains real Hindi verbs or grammar like "मुझे आता है", "क्या आप", etc.) → classify as **Hindi**

3. If the entire sentence is in Sanskrit grammar (e.g., "अहं गच्छामि", "त्वम् पठसि", or full Devanagari Sanskrit phrases) → classify as **Sanskrit**

4. If neither transcript is meaningful or recognizable → **Unrecognized**

Respond with only one of:
Sanskrit | Hindi | English | Unrecognized `;

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