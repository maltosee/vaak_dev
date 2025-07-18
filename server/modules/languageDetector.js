// languageDetector.js
const { callChatGpt } = require('../utils/openai');

class LanguageDetector {
  constructor() {
    this.debugLog = [];
  }
 // let debugLog = [];

async detectLanguageAndPreferredTranscript(custom, whisper) {
  const prompt = `You are a multilingual speech analyzer specializing in Sanskrit/Hindi/English detection.

You will receive two transcripts from the same audio:
1. Custom ASR (may contain Devanagari script)
2. Whisper ASR (Latin script)

IMPORTANT CONTEXT:
- The Custom ASR sometimes writes English words phonetically in Devanagari script
- The speaker might mix English with Sanskrit/Hindi terms
- Your goal is to identify the ACTUAL language spoken and choose the better transcript

CRITICAL: Only identify words that are genuinely Sanskrit/Hindi terms that have been transliterated to English. Common English words like "meditation", "peace", "love" should NOT be flagged for substitution even if they appear phonetically in the Custom transcript.

1. Determine the PRIMARY language actually spoken (not just the script used):
   - "english" - if the content is primarily English (even if written in Devanagari)
   - "hindi" - if genuinely Hindi words and grammar
   - "sanskrit" - if genuine Sanskrit words and grammar  
   - "unknown" - if unclear or garbled

2. Choose the BETTER transcript based on accuracy and readability:
   - If primary language is English → usually choose Whisper (Latin script)
   - If primary language is Hindi/Sanskrit → usually choose Custom (Devanagari script)
   - Consider which transcript represents the speech more accurately

3. If you choose the English transcript, identify ONLY genuine Sanskrit/Hindi terms IN THE ENGLISH TRANSCRIPT that should be replaced with their Devanagari equivalents. Do NOT include common English words that happen to have phonetic similarities.

Return JSON format:
{
  "language": "english|hindi|sanskrit|unknown",
  "transliteratedWords": ["english_word1", "english_word2"] // English words to be replaced
}

EXAMPLES:

Custom: "ऐ वाण्ट् टु लर्न् क्रियापदम्"
Whisper: "I want to learn Kriya Padam."
Analysis: Custom is English written phonetically in Devanagari. Whisper is clearer.
→ { "language": "english", "transliteratedWords": ["Kriya Padam"] }

Custom: "मम नाम सन्तोषः अस्ति"  
Whisper: "My name is Santosh"
Analysis: Custom is proper Sanskrit. Choose Custom.
→ { "language": "sanskrit", "transliteratedWords": [] }

Custom: "आइ वांट टू लर्न योग आंड मेडिटेशन"
Whisper: "I want to learn yoga and meditation"
Analysis: Custom is English written phonetically. Only "yoga" is Sanskrit origin.
→ { "language": "english", "transliteratedWords": ["yoga"] }

Custom: "तेल मी अबाउट धर्म एंड कर्म"
Whisper: "Tell me about dharma and karma"  
Analysis: Custom is English written phonetically. "dharma" and "karma" are Sanskrit terms.
→ { "language": "english", "transliteratedWords": ["dharma", "karma"] }

Custom: "अहम् पठामि"
Whisper: "I read"
Analysis: Custom is proper Sanskrit. Choose Custom.
→ { "language": "sanskrit", "transliteratedWords": [] }

Custom: "मैं क्रियापदम् सीखना चाहता हूँ"
Whisper: "I want to learn verb forms"
Analysis: Custom is proper Hindi with Sanskrit term. Choose Custom.
→ { "language": "hindi", "transliteratedWords": [] }

Custom: ""
Whisper: "Tell me about Ramayana"
Analysis: Only Whisper has content, English with Sanskrit term.
→ { "language": "english", "transliteratedWords": ["Ramayana"] }

Now analyze:
Custom: "${custom}"
Whisper: "${whisper}"
→ `;

  console.log('\n🧪 Improved Prompt Sent:\n', prompt);

  const raw = await callChatGpt('You are a multilingual speech analyzer specializing in Sanskrit/Hindi/English detection.', prompt);
  
  console.log('\n🔍 Raw GPT Response:\n', raw);
  
  let jsonText = raw.trim();
  if (jsonText.startsWith('→')) jsonText = jsonText.slice(1).trim();
  if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/^```json/, '').replace(/```$/, '').trim();
  if (jsonText.startsWith('`') && jsonText.endsWith('`')) jsonText = jsonText.slice(1, -1).trim();

  console.log('\n🔍 Cleaned JSON Text:\n', jsonText);

  const fallback = { language: 'unknown', transliteratedWords: [] };
  
  try {
    const parsed = JSON.parse(jsonText);
    console.log('\n✅ Parsed Result:\n', parsed);
    return parsed;
  } catch (e) {
    console.warn(`⚠️ Failed to parse: ${custom} / ${whisper}`, e.message);
    return fallback;
  }
}



  zipSegments(a, b) {
    const maxLen = Math.max(a.length, b.length);
    return Array.from({ length: maxLen }, (_, i) => ({
      customSeg: a[i] || '',
      whisperSeg: b[i] || ''
    }));
  }
  
async findSemanticMatches(words, custom) {
				const prompt = `Map each transliterated word to its closest matching Sanskrit/Hindi word in the native sentence. Return JSON.

			Words: ${JSON.stringify(words)}
			Sentence: "${custom}"
			→`;

				const raw = await callChatGpt('You are a Sanskrit word matcher.', prompt);
				let jsonText = raw.trim();
				if (jsonText.startsWith('→')) jsonText = jsonText.slice(1).trim();
				if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/^```json/, '').replace(/```$/, '').trim();
				if (jsonText.startsWith('`') && jsonText.endsWith('`')) jsonText = jsonText.slice(1, -1).trim();

				try {
				  const parsed = JSON.parse(jsonText);
				  return typeof parsed === 'object' && parsed !== null ? parsed : {};
				} catch (e) {
				  console.warn(`⚠️ Failed to parse semantic match result for: "${words.join(', ')}"`, e.message);
				  return {};
				}
  }
  
async processSegment(custom, whisper) {
  try {
    // ✅ Remove the shadowing variable declaration
    const { language, transliteratedWords } = await this.detectLanguageAndPreferredTranscript(custom, whisper);
    
    // ✅ Use the detected language directly
    const lang = language.trim().toLowerCase();

    if (lang === 'hindi' || lang === 'sanskrit') {
      return { final: custom, language, fallbackReason: 'structure_hindi_sanskrit_dominant' };
    }

    if (lang === 'english') {
      if (!transliteratedWords || transliteratedWords.length === 0) {
        return { final: whisper, language, fallbackReason: 'no_transliterated_words' };
      }

      const matches = await this.findSemanticMatches(transliteratedWords, custom);
      let modified = whisper;
      for (const word of transliteratedWords) {
        const match = matches[word];
        if (match) {
          modified = modified.replace(new RegExp(`\\b${word}\\b`, 'g'), match);
        }
      }

      return { final: modified, language };
    }

    // ✅ Return the actual detected language, not hardcoded 'Unknown'
    return { final: 'Unknown Language', language, fallbackReason: 'unclassified_language' };
    
  } catch (e) {
    console.warn(`⚠️ Language detection failed for: "${custom}" / "${whisper}"`, e.message);
    return { final: 'Unknown Language', language: 'unknown', fallbackReason: 'language_detection_failed' };
  }
}
  
async detectSegmentedTranscripts(customTranscript, whisperTranscript) {
  this.debugLog = [];

  const segments = this.zipSegments(
    Array.isArray(customTranscript) ? customTranscript : [customTranscript],
    Array.isArray(whisperTranscript) ? whisperTranscript : [whisperTranscript]
  );

  const results = [];

  for (let i = 0; i < segments.length; i++) {
    const { customSeg: custom, whisperSeg: whisper } = segments[i];
    const result = await this.processSegment(custom, whisper);

    this.debugLog.push({
      segmentIndex: i,
      customSegment: custom,
      whisperSegment: whisper,
      detectedLanguage: result.language || 'unknown',
      fallbackReason: result.fallbackReason,
      finalOutput: result.final
    });

    results.push(result.final);
  }

  return results;
}


 getDebugInfo() {
	  return this.debugLog;
	}

}

module.exports = new LanguageDetector();