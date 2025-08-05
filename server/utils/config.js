require('dotenv').config();

function getEnvNumber(key, fallback) {
  const raw = process.env[key];
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    console.warn(`⚠️ ${key} is missing or invalid ('${raw}'), using fallback: ${fallback}`);
    return fallback;
  }
  console.log(`✅ ${key} = ${parsed}`);
  return parsed;
}

// Optional sanity check for required secrets
['MAX_SESSIONS', 'SESSION_TIMEOUT', 'SESSION_CLEANUP_INTERVAL'].forEach((key) => {
  if (!process.env[key]) {
    console.warn(`⚠️ Missing expected secret: ${key}`);
  }
});

module.exports = {
  server: {
    port: process.env.PORT || 8080,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o',
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7,
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000,
    whisper: {
      model: process.env.WHISPER_MODEL || 'whisper-1',
      language: process.env.WHISPER_LANGUAGE || 'auto',
      temperature: parseFloat(process.env.WHISPER_TEMPERATURE) || 0,
      responseFormat: process.env.WHISPER_RESPONSE_FORMAT || 'json',
      timeout: parseInt(process.env.WHISPER_TIMEOUT) || 30000,
      maxFileSize: parseInt(process.env.WHISPER_MAX_FILE_SIZE) || 25 * 1024 * 1024,
      preferredLanguages: ['en', 'hi', 'sa']
    }
  },
  
  vad: {
    positiveSpeechThreshold: parseFloat(process.env.VAD_POSITIVE_SPEECH_THRESHOLD) || 0.6,
    negativeSpeechThreshold: parseFloat(process.env.VAD_NEGATIVE_SPEECH_THRESHOLD) || 0.2,
    preSpeechPadFrames: parseInt(process.env.VAD_PRE_SPEECH_PAD_FRAMES) || 10,
    minSpeechFrames: parseInt(process.env.VAD_MIN_SPEECH_FRAMES) || 15,
    redemptionFrames: parseInt(process.env.VAD_REDEMPTION_FRAMES) || 8,
    bargeInCooldownMs: parseInt(process.env.BARGE_IN_COOLDOWN_MS || '20000'),
  },

  stt: {
    customAsrUrl: process.env.CUSTOM_ASR_URL || 'https://sambhaashanam-asr-1034534632703.us-central1.run.app/transcribe',
    enableDualSTT: process.env.ENABLE_DUAL_STT === 'true',
    vadEndDelayMs: getEnvNumber('VAD_END_DELAY_MS', 1500),
    timeoutMs: parseInt(process.env.STT_TIMEOUT_MS || '180000', 10)
  },

  // UPDATED TTS CONFIGURATION FOR RUNPOD:
  tts: {
    provider: process.env.TTS_PROVIDER || 'runpod', // 'runpod' or 'polly'
    
    // RunPod TTS configuration
    runpod: {
      websocketUrl: process.env.RUNPOD_TTS_WEBSOCKET_URL,
      apiKey: process.env.RUNPOD_API_KEY,
      endpoint: process.env.RUNPOD_ENDPOINT_ID,
      
      // Streaming configuration
      streamingThreshold: parseFloat(process.env.TTS_STREAMING_THRESHOLD) || 6.0, // seconds
      bufferPercentage: parseFloat(process.env.TTS_BUFFER_PERCENTAGE) || 0.3, // 30%
      chunkDuration: parseFloat(process.env.TTS_CHUNK_DURATION) || 0.5, // seconds
      
      // Voice settings
      defaultVoice: process.env.RUNPOD_DEFAULT_VOICE || 'aryan_default',
      playStepsInS: parseFloat(process.env.RUNPOD_PLAY_STEPS) || 0.5,
      
      // Connection settings
      connectionTimeout: parseInt(process.env.RUNPOD_CONNECTION_TIMEOUT) || 10000, // ms
      maxReconnectAttempts: parseInt(process.env.RUNPOD_MAX_RECONNECT_ATTEMPTS) || 3,
      reconnectDelay: parseInt(process.env.RUNPOD_RECONNECT_DELAY) || 1000 // ms
    }
  },

  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-south-1',
    pollyVoiceId: process.env.AWS_POLLY_VOICE_ID || 'Kajal',
    pollyLanguageCode: process.env.AWS_POLLY_LANGUAGE_CODE || 'hi-IN',
    pollyEngine: process.env.AWS_POLLY_ENGINE || 'neural'
  },

  session: {
    maxSessions: getEnvNumber('MAX_SESSIONS', 10),
    timeout: getEnvNumber('SESSION_TIMEOUT', 10 * 60 * 1000),
    cleanupInterval: getEnvNumber('SESSION_CLEANUP_INTERVAL', 60 * 1000)
  },

  audio: {
    sampleRate: getEnvNumber('AUDIO_SAMPLE_RATE', 16000),
    channels: getEnvNumber('AUDIO_CHANNELS', 1),
    bitDepth: getEnvNumber('AUDIO_BIT_DEPTH', 16),
    maxDuration: getEnvNumber('AUDIO_MAX_DURATION', 30000),
    minDuration: getEnvNumber('AUDIO_MIN_DURATION', 100),
    bargeInCooldownMs: getEnvNumber('BARGE_IN_COOLDOWN_MS', 20000),
    allowBargeTTSPlaybackImmediate: process.env.ALLOW_BARGE_TTS_PLAYBACK_IMMEDIATE === 'true'
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: process.env.CORS_CREDENTIALS === 'true'
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: process.env.ENABLE_CONSOLE_LOG !== 'false',
    enableFile: process.env.ENABLE_FILE_LOG === 'true',
    logDirectory: process.env.LOG_DIRECTORY || './logs'
  },

  rateLimit: {
    windowMs: getEnvNumber('RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
    maxRequests: getEnvNumber('RATE_LIMIT_MAX_REQUESTS', 100),
    skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESS === 'true'
  }
};