// Complete configuration file with dual STT support
require('dotenv').config();

module.exports = {
  // Server configuration
  server: {
    port: process.env.PORT || 8080,
    host: process.env.HOST || '0.0.0.0',
    env: process.env.NODE_ENV || 'development'
  },

  // OpenAI configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7,
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000,
    whisper: {
      model: process.env.WHISPER_MODEL || 'whisper-1',
      language: process.env.WHISPER_LANGUAGE || 'auto',
      temperature: parseFloat(process.env.WHISPER_TEMPERATURE) || 0,
      responseFormat: process.env.WHISPER_RESPONSE_FORMAT || 'json',
      timeout: parseInt(process.env.WHISPER_TIMEOUT) || 30000,
      maxFileSize: parseInt(process.env.WHISPER_MAX_FILE_SIZE) || 25 * 1024 * 1024, // 25MB
      preferredLanguages: ['en', 'hi', 'sa']
    }
  },

  // NEW: Dual STT Configuration
  stt: {
    customAsrUrl: process.env.CUSTOM_ASR_URL || 'https://sambhaashanam-asr-1034534632703.us-central1.run.app/transcribe',
    enableDualSTT: process.env.ENABLE_DUAL_STT === 'true',
    vadEndDelayMs: parseInt(process.env.VAD_END_DELAY_MS) || 1500
  },

  // AWS configuration
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-south-1',
    pollyVoiceId: process.env.AWS_POLLY_VOICE_ID || 'Kajal',
    pollyLanguageCode: process.env.AWS_POLLY_LANGUAGE_CODE || 'hi-IN',
    pollyEngine: process.env.AWS_POLLY_ENGINE || 'neural'
  },

  // Session management
  session: {
    timeout: parseInt(process.env.SESSION_TIMEOUT) || 10 * 60 * 1000, // 10 minutes
    maxSessions: parseInt(process.env.MAX_SESSIONS) || 10,
    cleanupInterval: parseInt(process.env.SESSION_CLEANUP_INTERVAL) || 60 * 1000 // 1 minute
  },

  // Audio processing
  audio: {
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
    channels: parseInt(process.env.AUDIO_CHANNELS) || 1,
    bitDepth: parseInt(process.env.AUDIO_BIT_DEPTH) || 16,
    maxDuration: parseInt(process.env.AUDIO_MAX_DURATION) || 30000, // 30 seconds
    minDuration: parseInt(process.env.AUDIO_MIN_DURATION) || 100 // 100ms
  },

  // CORS configuration
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: process.env.CORS_CREDENTIALS === 'true'
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    enableConsole: process.env.ENABLE_CONSOLE_LOG !== 'false',
    enableFile: process.env.ENABLE_FILE_LOG === 'true',
    logDirectory: process.env.LOG_DIRECTORY || './logs'
  },

  // Rate limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    skipSuccessfulRequests: process.env.RATE_LIMIT_SKIP_SUCCESS === 'true'
  },

  // Development settings
  development: {
    enableDebugLogging: process.env.ENABLE_DEBUG === 'true',
    enableHotReload: process.env.ENABLE_HOT_RELOAD === 'true',
    mockServices: process.env.MOCK_SERVICES === 'true'
  }
};