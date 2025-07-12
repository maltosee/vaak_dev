// Configuration management module
require('dotenv').config();

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 8080,
    nodeEnv: process.env.NODE_ENV || 'development'
  },

  // JWT Authentication
  auth: {
    jwtSecret: process.env.JWT_SECRET || 'fallback_secret_change_this',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h'
  },

  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
    baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
    
    // Whisper STT Configuration
    whisper: {
      model: process.env.WHISPER_MODEL || 'whisper-1',
      language: process.env.WHISPER_LANGUAGE || null, // null = auto-detect
      timeout: parseInt(process.env.WHISPER_TIMEOUT) || 30000,
      maxFileSize: parseInt(process.env.WHISPER_MAX_SIZE) || (25 * 1024 * 1024), // 25MB
      preferredLanguages: (process.env.WHISPER_PREFERRED_LANGS || 'en,hi,sa').split(','),
      responseFormat: process.env.WHISPER_RESPONSE_FORMAT || 'json',
      temperature: parseFloat(process.env.WHISPER_TEMPERATURE) || 0
    }
  },

  // AWS Polly Configuration
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1',
    pollyVoiceId: process.env.AWS_POLLY_VOICE_ID || 'Aditi',
    pollyLanguageCode: process.env.AWS_POLLY_LANGUAGE_CODE || 'hi-IN'
  },

  // VAD Configuration
  vad: {
    minSilenceDuration: parseInt(process.env.VAD_MIN_SILENCE_DURATION) || 2000,
    minActivationThreshold: parseFloat(process.env.VAD_MIN_ACTIVATION_THRESHOLD) || 0.3,
    maxActivationThreshold: parseFloat(process.env.VAD_MAX_ACTIVATION_THRESHOLD) || 0.8,
    executionProvider: process.env.VAD_EXECUTION_PROVIDER || 'cpu',
    model: process.env.VAD_MODEL || 'silero_vad_legacy.onnx',
    positiveSpeechThreshold: parseFloat(process.env.VAD_POSITIVE_SPEECH_THRESHOLD) || 0.5,
    negativeSpeechThreshold: parseFloat(process.env.VAD_NEGATIVE_SPEECH_THRESHOLD) || 0.35,
    redemptionFrames: parseInt(process.env.VAD_REDEMPTION_FRAMES) || 20,
    frameSamples: parseInt(process.env.VAD_FRAME_SAMPLES) || 1536,
    preSpeechPadFrames: parseInt(process.env.VAD_PRE_SPEECH_PAD_FRAMES) || 5,
    minSpeechFrames: parseInt(process.env.VAD_MIN_SPEECH_FRAMES) || 10
  },

  // Session Configuration
  session: {
    timeoutMinutes: parseInt(process.env.SESSION_TIMEOUT_MINUTES) || 10,
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS) || 10
  },

  // Audio Configuration
  audio: {
    sampleRate: parseInt(process.env.AUDIO_SAMPLE_RATE) || 16000,
    channels: parseInt(process.env.AUDIO_CHANNELS) || 1,
    maxDurationSeconds: parseInt(process.env.MAX_AUDIO_DURATION_SECONDS) || 30
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },

  // Validation
  validate() {
    const required = [
      { key: 'OPENAI_API_KEY', value: this.openai.apiKey },
      { key: 'AWS_ACCESS_KEY_ID', value: this.aws.accessKeyId },
      { key: 'AWS_SECRET_ACCESS_KEY', value: this.aws.secretAccessKey },
      { key: 'JWT_SECRET', value: this.auth.jwtSecret }
    ];

    const missing = required.filter(item => !item.value || item.value === 'fallback_secret_change_this');
    
    if (missing.length > 0) {
      console.error('❌ Missing required environment variables:');
      missing.forEach(item => console.error(`   - ${item.key}`));
      console.error('   Please check your .env file');
      return false;
    }

    console.log('✅ Configuration validated successfully');
    return true;
  }
};

module.exports = config;