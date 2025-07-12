// Main server entry point
const express = require('express');
const cors = require('cors');
const config = require('./utils/config');
const authService = require('./modules/auth');
const sessionManager = require('./modules/session');
const voicePipeline = require('./modules/pipeline');

// Validate configuration on startup
if (!config.validate()) {
  console.error('❌ Server startup failed due to configuration errors');
  process.exit(1);
}

const app = express();
const server = require('http').createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', async (req, res) => {
  const stats = sessionManager.getStats();
  const pipelineHealth = await voicePipeline.healthCheck();
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    sessions: stats,
    pipeline: pipelineHealth,
    memory: process.memoryUsage(),
    version: require('./package.json').version
  });
});

// Authentication endpoint - simple token generation
app.post('/auth', (req, res) => {
  try {
    const { name, apiKey } = req.body;

    // Simple API key validation (you can enhance this)
    if (!apiKey || !name) {
      return res.status(400).json({ 
        error: 'Name and API key required' 
      });
    }

    // For prototype: accept any API key (you can add validation later)
    const token = authService.generateToken({ 
      name, 
      id: Date.now().toString(),
      apiKey 
    });

    res.json({ 
      success: true,
      token,
      message: `Welcome ${name}! Use this token to connect to WebSocket.`
    });

  } catch (error) {
    console.error('❌ Auth endpoint error:', error.message);
    res.status(500).json({ 
      error: 'Authentication failed' 
    });
  }
});

// Session info endpoint (requires auth)
app.get('/sessions', authService.authenticateHTTP, (req, res) => {
  const stats = sessionManager.getStats();
  res.json(stats);
});

// WebSocket setup
const WebSocket = require('ws');
const wss = new WebSocket.Server({ 
  server,
  verifyClient: (info) => {
    // Basic verification - detailed auth happens in connection handler
    return true;
  }
});

// VAD configuration endpoint
app.get('/vad-config', (req, res) => {
  res.json({
    executionProvider: process.env.VAD_EXECUTION_PROVIDER || 'cpu',
    model: process.env.VAD_MODEL || 'silero_vad_legacy.onnx',
    positiveSpeechThreshold: parseFloat(process.env.VAD_POSITIVE_SPEECH_THRESHOLD) || 0.5,
    negativeSpeechThreshold: parseFloat(process.env.VAD_NEGATIVE_SPEECH_THRESHOLD) || 0.35,
    redemptionFrames: parseInt(process.env.VAD_REDEMPTION_FRAMES) || 20,
    frameSamples: parseInt(process.env.VAD_FRAME_SAMPLES) || 1536,
    preSpeechPadFrames: parseInt(process.env.VAD_PRE_SPEECH_PAD_FRAMES) || 5,
    minSpeechFrames: parseInt(process.env.VAD_MIN_SPEECH_FRAMES) || 10
  });
});

// WebSocket connection handler
wss.on('connection', (ws, req) => {
  let userId = null;
  
  try {
    // Parse query parameters from URL
    const url = new URL(req.url, `http://${req.headers.host}`);
    const query = Object.fromEntries(url.searchParams);
    
    // Authenticate WebSocket connection
    const authResult = authService.authenticateWebSocket(query);
    if (!authResult.success) {
      ws.close(1008, authResult.error);
      console.log('❌ WebSocket auth failed:', authResult.error);
      return;
    }

    // Create session
    const session = sessionManager.createSession(authResult.user, ws);
    userId = session.userId;

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId: session.sessionId,
      user: authResult.user.name,
      message: 'Connected successfully! Ready for voice conversation.'
    }));

    // Handle messages
    ws.on('message', async (message) => {
      try {
        sessionManager.updateActivity(userId);
        
        // Handle binary audio data
        if (message instanceof Buffer) {
          console.log(`🎤 Received audio: ${message.length} bytes from ${authResult.user.name}`);
          
          // Process through voice pipeline
          const pipelineResult = await voicePipeline.processVoiceConversation(
            message, 
            userId, 
            { audioFormat: 'webm' }
          );
          
          if (pipelineResult.success) {
            // Send text response first
            ws.send(JSON.stringify({
              type: 'llm_response',
              text: pipelineResult.steps.llm.response,
              transcription: pipelineResult.steps.stt.text,
              language: pipelineResult.steps.stt.language,
              processingTime: pipelineResult.totalDuration,
              timestamp: new Date().toISOString()
            }));
            
            // Send audio response
            ws.send(pipelineResult.steps.tts.audioBuffer);
            
            console.log(`✅ Complete conversation processed for ${authResult.user.name}`);
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              message: `Pipeline processing failed: ${pipelineResult.error}`,
              timestamp: new Date().toISOString()
            }));
          }
          
          sessionManager.updateState(userId, 'listening');
          
        } else {
          // Handle text messages
          const data = JSON.parse(message);
          console.log(`💬 Message from ${authResult.user.name}:`, data.type);
          
          switch (data.type) {
            case 'ping':
              ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
              break;
            
            case 'get_status':
              const session = sessionManager.getSession(userId);
              ws.send(JSON.stringify({ 
                type: 'status', 
                state: session?.state || 'unknown',
                timestamp: new Date().toISOString()
              }));
              break;
              
            default:
              ws.send(JSON.stringify({ 
                type: 'error', 
                message: `Unknown message type: ${data.type}` 
              }));
          }
        }
        
      } catch (error) {
        console.error('❌ Message handling error:', error.message);
        ws.send(JSON.stringify({ 
          type: 'error', 
          message: 'Message processing failed' 
        }));
      }
    });

    // Handle connection close
    ws.on('close', (code, reason) => {
      console.log(`🔌 WebSocket closed: ${code} - ${reason}`);
      if (userId) {
        sessionManager.removeSession(userId, 'client_disconnect');
      }
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error.message);
      if (userId) {
        sessionManager.removeSession(userId, 'websocket_error');
      }
    });

  } catch (error) {
    console.error('❌ WebSocket connection error:', error.message);
    ws.close(1011, 'Server error during connection setup');
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM, shutting down gracefully');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

// Start server
const PORT = config.server.port;
server.listen(PORT, '0.0.0.0',() => {
  console.log('🚀 Sanskrit Tutor Backend Started!');
  console.log(`📡 Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${PORT}?token=your_token`);
  console.log(`🏥 Health: http://localhost:${PORT}/health`);
  console.log(`🔐 Auth: POST http://localhost:${PORT}/auth`);
  console.log('');
  console.log('Ready for voice conversations! 🎯');
});