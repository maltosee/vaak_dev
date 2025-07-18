// testFullLangDetect.js
const readline = require('readline');
const languageDetector = require('./languageDetector');

async function testFullLangDetection() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const ask = (q) => new Promise(res => rl.question(q, res));

  const custom = await ask('📝 Enter Custom ASR (Devanagari): ');
  const whisper = await ask('🗣️  Enter Whisper ASR (Latin): ');
  rl.close();

  console.log('\n🔍 Analyzing...\n');

  const startTime = Date.now();

  const cleanedSegments = await languageDetector.detectSegmentedTranscripts(custom, whisper);
  const debugInfo = languageDetector.getDebugInfo();

  const result = {
    success: true,
    text: cleanedSegments.join(' '),
    segments: cleanedSegments,
    duration: Date.now() - startTime,
    audioSize: -1, // Not applicable in local test
    timestamp: new Date().toISOString(),
    debug: {
      customTranscript: custom,
      whisperTranscript: whisper,
      cleanedSegments,
      languageHints: debugInfo
    }
  };

  console.log(`✅ Final Cleaned Transcript: "${result.text}"\n`);
  console.log('🧪 Full Debug Summary:\n', JSON.stringify(result, null, 2));
}

testFullLangDetection();
