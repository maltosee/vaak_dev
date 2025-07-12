# Sanskrit Conversational AI Tutor

A real-time Sanskrit tutoring application with voice conversation capabilities.

## Architecture

- **Frontend**: HTML/JS client (deployed on Vercel)
- **Backend**: Node.js WebSocket server (deployed on GCP VM)
- **STT**: OpenAI Whisper API (future: dual STT with Sanskrit model)
- **LLM**: OpenAI GPT models
- **TTS**: AWS Polly (future: XTTS batch mode)
- **VAD**: WebRTC-based voice activity detection

## Project Structure

```
sanskrit-tutor/
├── client/                 # Frontend (deploy to Vercel)
│   ├── index.html
│   ├── app.js
│   ├── audio-handler.js
│   └── style.css
├── server/                 # Backend (Node.js)
│   ├── index.js           # Main server
│   ├── modules/
│   │   ├── auth.js        # JWT authentication
│   │   ├── websocket.js   # WebSocket handler
│   │   ├── vad.js         # Voice Activity Detection
│   │   ├── pipeline.js    # STT → LLM → TTS pipeline
│   │   ├── whisper.js     # OpenAI Whisper integration
│   │   ├── gpt.js         # OpenAI GPT integration
│   │   ├── tts.js         # Text-to-Speech (AWS Polly)
│   │   └── session.js     # Session management
│   ├── utils/
│   │   ├── audio-utils.js # Audio conversion utilities
│   │   └── config.js      # Configuration management
│   ├── package.json
│   └── .env.example
├── deployment/
│   ├── deploy.sh          # Deployment script
│   └── gcp-setup.sh       # GCP VM setup script
└── README.md
```

## Setup Instructions

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd sanskrit-tutor
cd server
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

### 3. Local Development

```bash
npm run dev
```

### 4. Deploy to GCP

```bash
cd deployment
./deploy.sh
```

## Configuration

See `server/.env.example` for all configurable options including:
- API keys (OpenAI, AWS)
- VAD thresholds
- Session timeouts
- Audio parameters

## Future Enhancements

- [ ] Dual STT (Sanskrit + Whisper)
- [ ] XTTS batch mode TTS
- [ ] Advanced Sanskrit grammar checking
- [ ] User progress tracking
- [ ] Mobile app support