# Sanskrit Conversational AI Tutor

A real-time Sanskrit tutoring application with voice conversation capabilities using WebSocket-based audio streaming.

## Architecture

- **Frontend**: HTML/JS client with VAD-based audio capture (deployed on Vercel)
- **Backend**: Node.js WebSocket server with session management (deployed on Fly.io)
- **STT**: Dual STT system (Custom Sanskrit + OpenAI Whisper with language detection)
- **LLM**: OpenAI GPT models for Sanskrit conversation
- **TTS**: AWS Polly with neural voices (Hindi/Sanskrit bilingual)
- **VAD**: WebRTC-based voice activity detection with barge-in protection

## Key Features

## Key Features

- **Real-time Voice Conversations**: WebSocket-based audio streaming
- **Intelligent Barge-in Control**: Blocks audio during STT/LLM processing, allows during TTS playback
- **Session State Management**: Per-session timeout with activity-based cleanup
- **Dual Language Support**: Handles Sanskrit, Hindi, and English inputs
- **Conversation Context**: OpenAI GPT maintains full conversation history per user
- **Audio Pipeline**: VAD → STT → LLM → TTS with comprehensive error handling
- **Event-driven Architecture**: Session management via WebSocket events, no background polling

## Project Structure

```
sanskrit-tutor/
├── client/                 # Frontend (Vercel deployment)
│   ├── index.html
│   ├── app.js             # Main app logic with WebSocket handling
│   ├── audio_handler.js   # VAD and audio processing
│   └── style.css
├── server/                 # Backend (Fly.io deployment)
│   ├── index.js           # WebSocket server with session management
│   ├── modules/
│   │   ├── pipeline.js    # STT → LLM → TTS processing pipeline
│   │   ├── dualSTT.js     # Dual STT implementation
│   │   ├── gpt.js         # OpenAI GPT integration
│   │   ├── tts.js         # AWS Polly TTS
│   │   └── session.js     # Session and state management
│   └── utils/
│       └── config.js      # Configuration management
└── README.md
```

## Current Workflow

1. **Client connects** via WebSocket with session creation
2. **VAD detects speech** and captures audio chunks
3. **Audio sent to server** with barge-in protection logic
4. **Server processes**: Audio → STT → LLM → TTS
5. **Session state tracking** prevents audio conflicts during processing
6. **Real-time responses** streamed back to client

## Setup & Deployment

- **Frontend**: Auto-deployed to Vercel on git push
- **Backend**: Deployed on Fly.io with health monitoring
- **Configuration**: Environment-based API keys and thresholds

## Recent Updates


- Fixed WebSocket message handler scoping issue
- Implemented per-session timeout management with activity-based cleanup
- Removed background polling in favor of event-driven session management
- Added comprehensive error handling and proper WebSocket lifecycle management
- Enhanced audio pipeline with dual STT language detection
- Confirmed OpenAI conversation context working correctly with history management
- Optimized VAD settings for better speech detection sensitivity