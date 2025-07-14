// Sanskrit Tutor Backend Server with Raw WebSockets
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const config = require('./utils/config');
const voicePipeline = require('./modules/pipeline');
const sessionManager = require('./modules/session');
const pollyTTS = require('./modules/tts');

// Initialize Express app
const app = express();
const server = http.createServer(app);


console.log('📦 process.env.MAX_SESSIONS =', process.env.MAX_SESSIONS);  // ⬅️ Add here
console.log('📦 MAX_SESSIONS from config =', config.session.maxSessions);


// Configure WebSocket Server
const wss = new WebSocket.Server({ 
  server,
  perMessageDeflate: false, // Better for audio streaming
  maxPayload: 10 * 1024 * 1024 // 10MB for audio files
});

// Middleware
app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Configure multer for audio uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['audio/webm', 'audio/wav', 'audio/mp3', 'audio/ogg'];
    cb(null, allowedMimes.includes(file.mimetype));
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// API Routes 
// ──────────────────────────────────────────────────────────────────────────────

// Lightweight health check for Fly.io
app.get('/health-lite', async (req, res) => {
  try {
    const health = await voicePipeline.healthCheck();

    // No logging — just return basic result
    const status = health?.overall === true ? 200 : 503;
    res.status(status).send(status === 200 ? 'OK' : 'NOT OK');
  } catch {
    res.status(503).send('NOT OK');
  }
});



// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const health = await voicePipeline.healthCheck();
    //console.log('🩺 HEALTH CHECK:', JSON.stringify(health, null, 2));

    const status = health?.overall === true ? 200 : 503;
    //res.status(status).json(health);
	res.status(status).json({
		  ok: health.overall,
		  timestamp: health.timestamp
		});

	
  } catch (error) {
    console.error('❌ /health error:', error.message);
    res.status(500).json({
      overall: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});



// Configuration endpoint for client settings
app.get('/config', (req, res) => {
  const clientConfig = {
    vadEndDelayMs: config.stt.vadEndDelayMs,
    enableDualSTT: config.stt.enableDualSTT,
    audioConfig: {
      sampleRate: config.audio.sampleRate,
      channels: config.audio.channels,
      maxDuration: config.audio.maxDuration
    },
    vadConfig: config.vad, // ✅ Now included from secrets
    timestamp: new Date().toISOString()
  };

  console.log('📋 Sending client config:', clientConfig);
  res.json(clientConfig);
});


// Authentication endpoint
app.post('/auth', (req, res) => {
  try {
    const { name } = req.body;
    const username = name || 'Anonymous User';
    const token = sessionManager.generateToken(username);
    
    console.log(`✅ Token generated for user: ${username}`);
    
    res.json({
      success: true,
      token: token,
      user: username,
      expiresIn: config.session.timeout,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Authentication failed:', error.message);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      timestamp: new Date().toISOString()
    });
  }
});

// Pipeline statistics endpoint
app.get('/stats', (req, res) => {
  const stats = voicePipeline.getStats();
  res.json({
    ...stats,
    activeSessions: sessionManager.getActiveSessionCount(),
    timestamp: new Date().toISOString()
  });
});

// Text-to-speech endpoint
app.post('/tts', async (req, res) => {
  try {
    const { text, voice, language } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const ttsResult = await pollyTTS.synthesizeSpeech(text, {
      voiceId: voice || 'Kajal',
      languageCode: language || 'hi-IN',
      engine: 'neural'
    });

    if (ttsResult.success) {
      res.set({
        'Content-Type': 'audio/mpeg',
        'Content-Length': ttsResult.audioBuffer.length
      });
      res.send(ttsResult.audioBuffer);
    } else {
      res.status(500).json({ error: ttsResult.error });
    }
  } catch (error) {
    console.error('❌ TTS endpoint error:', error.message);
    res.status(500).json({ error: 'TTS processing failed' });
  }
});

// File upload endpoint for testing
app.post('/upload-audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No audio file provided' });
    }

    const userId = req.body.userId || 'upload-user';
    const result = await voicePipeline.processVoiceConversation(req.file.buffer, userId);
    
    res.json(result);
  } catch (error) {
    console.error('❌ Upload processing error:', error.message);
    res.status(500).json({ error: 'Audio processing failed' });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// WebSocket Handling - Converted to Raw WebSockets
// ──────────────────────────────────────────────────────────────────────────────

wss.on('connection', (ws, req) => {
  const clientId = generateClientId();
  ws.clientId = clientId;
  ws.state = 'listening'; // ✅ INITIALIZE STATE
  
  console.log('🔗 Client connected:', clientId);
  
  // Send configuration to client immediately
  sendMessage(ws, {
    type: 'config',
    vadEndDelayMs: config.stt.vadEndDelayMs,
    enableDualSTT: config.stt.enableDualSTT,
    audioConfig: {
      sampleRate: config.audio.sampleRate,
      channels: config.audio.channels
    }
  });
  
  sendMessage(ws, {
    type: 'connected',
    message: 'WebSocket connection established',
    timestamp: new Date().toISOString()
  });

  // Handle messages
  ws.on('message', async (data) => {
    try {
      if (Buffer.isBuffer(data)) {
        await handleAudioMessage(data, ws);
      } else {
        const parsed = JSON.parse(data.toString());
        await handleTextMessage(parsed, ws);
      }
    } catch (error) {
      console.error('❌ WebSocket message error:', error.message);
      sendMessage(ws, {
        type: 'error',
        message: 'Message processing failed'
      });
    }
  });

  // Handle disconnection
  ws.on('close', (code, reason) => {
    console.log('🔌 Client disconnected:', clientId, 'Code:', code, 'Reason:', reason.toString());
    // Clean up any associated sessions
    sessionManager.cleanupBySocketId(clientId);
  });

  // Handle connection errors
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

/**
 * Generate unique client ID
 */
function generateClientId() {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

/**
 * Send JSON message to WebSocket client
 */
function sendMessage(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Send binary data to WebSocket client
 */
function sendBinary(ws, buffer) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(buffer);
  }
}

/**
 * Handle audio message from WebSocket
 * @param {Buffer} audioBuffer - Audio data from client
 * @param {WebSocket} ws - WebSocket connection
 */
async function handleAudioMessage(audioBuffer, ws) {
  const userId = ws.clientId;
  
  console.log(`🎤 Received audio: ${audioBuffer.length} bytes from ${userId}`);
  
  // ✅ SIMPLE CHECK: Just verify we have a valid client
  if (!userId) {
    console.warn(`⚠️ Received audio from client with no ID. Ignoring.`);
    return;
  }
  
   
  if (ws.state && ws.state !== 'listening') {
    console.log(`⚠️ Barge-in attempt detected for ${userId}. Current state: ${ws.state}. . Ignoring audio.`);
    sendMessage(ws, {
      type: 'status_update', // New message type for client
      message: 'Server is currently processing your previous request. Please wait.',
      statusType: 'warning', // Custom status type for client-side styling
      statusCode: 'BUSY_SERVER',
      timestamp: new Date().toISOString()
    });
    return; // Important: Stop processing this incoming audio
  }
  
  // ✅ SET STATE TO PROCESSING
  ws.state = 'processing';
  
  try {
    // Process through pipeline
    const pipelineResult = await voicePipeline.processVoiceConversation(audioBuffer, userId);
    
    if (pipelineResult.success) {
      // Handle unrecognized language case
      if (pipelineResult.isUnrecognizedLanguage) {
        const errorResponse = {
          type: 'llm_response',
          text: pipelineResult.steps.llm.response,
          transcription: 'Unrecognized Language',
          language: 'unknown',
          processingTime: pipelineResult.totalDuration,
          timestamp: pipelineResult.timestamp
        };
        
        console.log('🔍 DEBUG: About to send unrecognized language response');
        sendMessage(ws, errorResponse);
        console.log('🔍 DEBUG: Unrecognized language response sent');
        
        // Generate and send error audio
        await new Promise(resolve => setTimeout(resolve, 200));
        const errorTTS = await pollyTTS.synthesizeSpeech(pipelineResult.steps.llm.response, {
          voiceId: 'Kajal',
          languageCode: 'hi-IN',
          engine: 'neural'
        });
        
        if (errorTTS.success) {
          sendBinary(ws, errorTTS.audioBuffer);
          console.log('🔍 DEBUG: Error audio response sent');
        }
        
        return;
      }
      
      // Normal successful processing
      const response = {
        type: 'llm_response',
        text: pipelineResult.steps.llm.response,
        transcription: pipelineResult.steps.stt.text,
        language: pipelineResult.steps.stt.language,
        processingTime: pipelineResult.totalDuration,
        timestamp: pipelineResult.timestamp,
        //debug: config.development.enableDebugLogging ? pipelineResult.steps.stt.debug : undefined
		debug: config.enableDebugLogging ? pipelineResult.steps.stt.debug : undefined
      };
      
      console.log('🔍 DEBUG: About to send JSON response');
      sendMessage(ws, response);
      console.log('🔍 DEBUG: JSON response sent');
      
      // Send audio separately with delay for DataChannel
      await new Promise(resolve => setTimeout(resolve, 200));
      sendBinary(ws, pipelineResult.steps.tts.audioBuffer);
      console.log('🔍 DEBUG: Audio response sent');
      
      console.log(`✅ Complete conversation processed for ${userId}`);
      
      // Update session state back to listening
      //sessionManager.updateState(userId, 'listening');
	  // ✅ RESET STATE TO LISTENING at the end
		ws.state = 'listening';
      
    } else {
      // Send error response
      sendMessage(ws, {
        type: 'error',
        message: `Pipeline processing failed: ${pipelineResult.error}`,
        timestamp: pipelineResult.timestamp
      });
    }
    
  } catch (error) {
    console.error('❌ Audio processing error:', error);
	ws.state = 'listening';
    sendMessage(ws, {
      type: 'error',
      message: 'Audio processing failed',
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * Handle text message from WebSocket
 * @param {Object} message - Parsed JSON message
 * @param {WebSocket} ws - WebSocket connection
 */
async function handleTextMessage(message, ws) {
  const userId = ws.clientId;
  
  console.log(`💬 Received text message from ${userId}:`, message.type);
  
  try {
    switch (message.type) {
      case 'text_input':
        if (message.text) {
          const result = await voicePipeline.processTextConversation(message.text, userId);
          
          if (result.success) {
            sendMessage(ws, {
              type: 'llm_response',
              text: result.response,
              transcription: result.inputText,
              language: 'text',
              processingTime: result.totalDuration,
              timestamp: result.timestamp
            });
            
            // Send audio if available
            if (result.audioBuffer) {
              await new Promise(resolve => setTimeout(resolve, 200));
              sendBinary(ws, result.audioBuffer);
            }
          } else {
            sendMessage(ws, {
              type: 'error',
              message: result.error
            });
          }
        }
        break;
        
      case 'ping':
        sendMessage(ws, {
          type: 'pong',
          timestamp: new Date().toISOString()
        });
        break;
        
      case 'get_config':
        sendMessage(ws, {
          type: 'config',
          vadEndDelayMs: config.stt.vadEndDelayMs,
          enableDualSTT: config.stt.enableDualSTT,
          audioConfig: {
            sampleRate: config.audio.sampleRate,
            channels: config.audio.channels
          }
        });
        break;
        
      default:
        console.log(`⚠️ Unknown message type: ${message.type}`);
    }
    
  } catch (error) {
    console.error('❌ Text message processing error:', error);
    sendMessage(ws, {
      type: 'error',
      message: 'Text message processing failed'
    });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Error Handling & Cleanup
// ──────────────────────────────────────────────────────────────────────────────

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('📴 Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('📴 Server closed');
    process.exit(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Server Startup
// ──────────────────────────────────────────────────────────────────────────────

//const PORT = config.server.port;
//const HOST = config.server.host;
const PORT = process.env.PORT || 8080;
const HOST = '0.0.0.0';


server.listen(PORT, HOST, async () => {
  console.log('🚀 Sanskrit Tutor Backend Started!');
  console.log(`📡 Server: http://${HOST}:${PORT}`);
  console.log(`🔌 WebSocket: ws://${HOST}:${PORT}`);
  console.log(`🏥 Health: http://${HOST}:${PORT}/health`);
  console.log(`📋 Config: http://${HOST}:${PORT}/config`);
  console.log(`🔐 Auth: POST http://${HOST}:${PORT}/auth`);
  console.log(`🎵 TTS: POST http://${HOST}:${PORT}/tts`);
  
  // Display configuration info
  console.log('');
  console.log('🔧 Configuration:');
  console.log(`   Dual STT: ${config.stt.enableDualSTT ? '✅ Enabled' : '❌ Disabled'}`);
  console.log(`   VAD Delay: ${config.stt.vadEndDelayMs}ms`);
  console.log(`   Custom ASR: ${config.stt.customAsrUrl}`);
  console.log(`   Environment: ${config.server.env}`);
  console.log('');
  
  console.log('Ready for voice conversations! 🎯');
});