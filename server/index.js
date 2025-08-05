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
const https = require('https');
const { URL } = require('url');

// Initialize Express app
const app = express();
const server = http.createServer(app);


console.log('📦 process.env.MAX_SESSIONS =', process.env.MAX_SESSIONS);  // ⬅️ Add here
console.log('📦 MAX_SESSIONS from config =', config.session.maxSessions);


// Configure WebSocket Server
const ws = new WebSocket.Server({ 
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
  
  // Use 'ws' for development and 'wss' for production
  const protocol = req.protocol === 'https' ? 'wss' : 'ws';
  const host = req.headers.host;
  
  const clientConfig = {
    
	// Add the dynamic WebSocket URL
    websocketUrl: `${protocol}://${host}`,
	vadEndDelayMs: config.stt.vadEndDelayMs,
    enableDualSTT: config.stt.enableDualSTT,
    audioConfig: {
      sampleRate: config.audio.sampleRate,
      channels: config.audio.channels,
      maxDuration: config.audio.maxDuration,
	  minDuration: config.audio.minDuration
    },
    vadConfig: config.vad, // ✅ Now included from secrets
	bargeInCooldownMs: config.audio.bargeInCooldownMs,  // ✅ Add this
	allowBargeTTSPlaybackImmediate: config.audio.allowBargeTTSPlaybackImmediate,
	streamingTTS: config.streamingTTS,  // ← ADD THIS LINE
    timestamp: new Date().toISOString()
  };

  console.log('📋 Sending client config:', clientConfig);
  res.json(clientConfig);
});

// Debug endpoint to see all configuration values
app.get('/debug-config', (req, res) => {
  res.json({
    vadConfig: config.vad,
    audioConfig: config.audio,
    sttConfig: config.stt,
    allConfig: config, // This will show everything
    timestamp: new Date().toISOString()
  });
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

ws.on('connection', (ws, req) => {
  
	  const clientId = generateClientId();
	  ws.clientId = clientId;
	  
	  // Clean up any sessions with dead WebSocket connections
	 // sessionManager.cleanupDeadConnections();
	  
	  // Create new session
	  const user = { id: clientId, name: `User-${clientId.substring(0, 8)}` };
	  const session = sessionManager.createSession(user,ws); 
	  
	  session.state = 'listening';  // ✅ Use this instead

	  
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
	  
		console.log(`📨 Raw message received: type=${typeof data}, isBuffer=${Buffer.isBuffer(data)}, size=${data.length}`);
		sessionManager.updateActivity(ws.clientId); // ✅ SINGLE LINE - covers everything
		
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
  
	  // Handle disconnection - FIXED VERSION
	ws.on('close', (code, reason) => {
	  console.log('🔌 Client disconnected:', clientId, 'Code:', code, 'Reason:', reason.toString());
	  sessionManager.removeSession(clientId);  // Just this!
	});

	// Handle connection errors - ALSO ADD THIS
	ws.on('error', (error) => {
	  console.error(`❌ WebSocket error for client ${clientId}:`, error.message);
	  
	  // Same cleanup as close event
	  try {
		const session = sessionManager.getSession(clientId);
		if (session) {
		  sessionManager.removeSession(clientId);
		}
	  } catch (cleanupError) {
		console.error(`❌ Error cleanup failed for ${clientId}:`, cleanupError.message);
	  }
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
// --- MODIFIED handleAudioMessage FUNCTION ---
// (This is a simplified version, replace the old code with this)
async function handleAudioMessage(audioBuffer, ws) {
  const userId = ws.clientId;
  const session = sessionManager.getSession(ws.clientId);

  if (!session || session.state !== 'listening') {
    // ... (rest of your existing busy server logic) ...
    return;
  }

  session.state = 'processing';
  try {
    const pipelineResult = await voicePipeline.processVoiceConversation(audioBuffer, userId);

    if (pipelineResult.success) {
      // Send the text response
      const textResponse = {
        type: 'llm_response',
        text: pipelineResult.steps.llm.response,
        transcription: pipelineResult.steps.stt.text,
        language: pipelineResult.steps.stt.language,
        processingTime: pipelineResult.totalDuration,
        timestamp: pipelineResult.timestamp,
      };
      sendMessage(ws, textResponse);

      // Now, stream the audio from RunPod
      try {
			const ttsStream = await streamTTSFromRunPod(pipelineResult.steps.llm.response, config.tts.defaultVoice);
			
			// This is the crucial part: relay the stream
			ttsStream.on('data', (chunk) => {
			  sendBinary(ws, chunk); // Send each chunk directly to the WebSocket client
			});

			ttsStream.on('end', () => {
			  console.log(`✅ TTS streaming complete for ${userId}`);
			  session.state = 'listening'; // Move to finally block or here
			});
			
			ttsStream.on('error', (error) => {
			   console.error('❌ RunPod streaming error:', error);
			   sendMessage(ws, { type: 'error', message: 'TTS streaming failed' });
			   session.state = 'listening';
			});

      } catch (error) {
        console.error('❌ RunPod streaming error:', error);
        sendMessage(ws, { type: 'error', message: 'TTS streaming failed' });
      }

    } else {
      sendMessage(ws, {
        type: 'error',
        message: `Pipeline processing failed: ${pipelineResult.error}`,
        timestamp: pipelineResult.timestamp
      });
    }

  } catch (error) {
    console.error('❌ Audio processing error:', error);
    sendMessage(ws, { type: 'error', message: 'Audio processing failed' });
  }
  
  // Note: I moved session.state = 'listening'; inside the try/catch
  // blocks to ensure it only resets after a response is sent.
  // The 'end' event is also a good place to reset the state.
}
// --- END MODIFIED FUNCTION ---

/**
 * Handle text message from WebSocket
 * @param {Object} message - Parsed JSON message
 * @param {WebSocket} ws - WebSocket connection
 */
async function handleTextMessage(message, ws) {
  const userId = ws.clientId;
  const session = sessionManager.getSession(ws.clientId);
  
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
        
      case 'check_ready':
	  
		 //const session = sessionManager.getSession(ws.userId);
		 const sessionForReady = sessionManager.getSession(ws.clientId);
		 const isReady = sessionForReady?.state === 'listening';
		 
		 sendMessage(ws, {
		  type: 'status_update',
		  statusCode: isReady ? 'READY' : 'BUSY_SERVER',
		  message: isReady ? 'Server ready' : 'Server busy',
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
		 // 👇 fallback to session logic for other types
		//const session = sessionManager.getOrCreateSession(ws.userId, ws);
		session.handleMessage(message);
    }
    
  } catch (error) {
    console.error('❌ Text message processing error:', error);
    sendMessage(ws, {
      type: 'error',
      message: 'Text message processing failed'
    });
  }
}

/**
 * Streams audio chunks from the RunPod TTS endpoint
 * @param {string} text The text to synthesize
 * @param {string} voice The voice to use
 * @returns {Promise<ReadableStream>} A promise that resolves to a readable stream of audio chunks
 */
async function streamTTSFromRunPod(text, voice) {
	  const runpodUrl = `https://api.runpod.ai/v2/${config.runpod.endpointId}/run`;
	  const parsedUrl = new URL(runpodUrl);

	  const postData = JSON.stringify({
		input: {
		  text: text,
		  voice: voice || config.tts.defaultVoice,
		  sampling_rate: config.tts.samplingRate
		}
	  });

	  const options = {
		hostname: parsedUrl.hostname,
		port: 443,
		path: parsedUrl.pathname,
		method: 'POST',
		headers: {
		  'Content-Type': 'application/json',
		  'Content-Length': Buffer.byteLength(postData),
		  'Authorization': `Bearer ${config.runpod.apiKey}`
		}
	  };

	  return new Promise((resolve, reject) => {
		const req = https.request(options, (res) => {
		  if (res.statusCode !== 200) {
			return reject(new Error(`RunPod API returned status code: ${res.statusCode}`));
		  }
		  resolve(res);
		});

		req.on('error', (e) => {
		  reject(e);
		});

		req.write(postData);
		req.end();
	  });
}
// --- END NEW MODULE ---

// ──────────────────────────────────────────────────────────────────────────────
// Error Handling & Cleanup
// ──────────────────────────────────────────────────────────────────────────────

// Global error handlers - IMPROVED VERSION
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  
  // Don't exit immediately for cleanup errors
  if (error.message.includes('cleanupBySocketId is not a function') || 
      error.message.includes('cleanup')) {
    console.log('🔧 Cleanup error handled, server continuing...');
    return; // Don't exit for cleanup errors
  }
  
  // For other critical errors, still exit
  console.log('💀 Critical error, shutting down...');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  // Log but don't crash for promise rejections
  console.log('🔧 Promise rejection handled, server continuing...');
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