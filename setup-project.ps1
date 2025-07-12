# Sanskrit Tutor Project Setup Script for Windows
Write-Host "🚀 Setting up Sanskrit Tutor project..." -ForegroundColor Green

# Create .gitignore
$gitignoreContent = @"
# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Logs
logs
*.log

# Audio files (temporary)
temp_audio/
audio_buffer/

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db

# IDE
.vscode/
.idea/
*.swp
*.swo
*~

# SSL certificates (if any)
*.pem
*.crt
*.key

# Deployment artifacts
dist/
build/
"@

$gitignoreContent | Out-File -FilePath ".gitignore" -Encoding UTF8
Write-Host "✅ Created .gitignore" -ForegroundColor Yellow

# Create README.md
$readmeContent = @"
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

``````
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
``````

## Setup Instructions

### 1. Clone and Install

``````bash
git clone <your-repo-url>
cd sanskrit-tutor
cd server
npm install
``````

### 2. Configure Environment

``````bash
cp .env.example .env
# Edit .env with your API keys
``````

### 3. Local Development

``````bash
npm run dev
``````

### 4. Deploy to GCP

``````bash
cd deployment
./deploy.sh
``````

## Configuration

See ``server/.env.example`` for all configurable options including:
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
"@

$readmeContent | Out-File -FilePath "README.md" -Encoding UTF8
Write-Host "✅ Created README.md" -ForegroundColor Yellow

# Create server/package.json
$packageJsonContent = @"
{
  "name": "sanskrit-tutor-backend",
  "version": "1.0.0",
  "description": "Sanskrit Conversational AI Tutor Backend",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev": "nodemon index.js",
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": ["sanskrit", "ai", "tutor", "websocket", "speech"],
  "author": "Your Name",
  "license": "MIT",
  "dependencies": {
    "ws": "^8.14.2",
    "express": "^4.18.2",
    "jsonwebtoken": "^9.0.2",
    "dotenv": "^16.3.1",
    "cors": "^2.8.5",
    "axios": "^1.6.0",
    "openai": "^4.20.1",
    "aws-sdk": "^2.1491.0",
    "fluent-ffmpeg": "^2.1.2",
    "multer": "^1.4.5-lts.1",
    "uuid": "^9.0.1",
    "node-webrtc-vad": "^1.0.0"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
"@

$packageJsonContent | Out-File -FilePath "server\package.json" -Encoding UTF8
Write-Host "✅ Created server/package.json" -ForegroundColor Yellow

# Create server/.env.example
$envExampleContent = @"
# Server Configuration
PORT=8080
NODE_ENV=development

# JWT Authentication
JWT_SECRET=your_super_secret_jwt_key_here
JWT_EXPIRES_IN=24h

# API Keys
OPENAI_API_KEY=your_openai_api_key_here

# AWS Configuration for Polly TTS
AWS_ACCESS_KEY_ID=your_aws_access_key_id
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key
AWS_REGION=us-east-1
AWS_POLLY_VOICE_ID=Aditi
AWS_POLLY_LANGUAGE_CODE=hi-IN

# VAD Configuration
VAD_MIN_SILENCE_DURATION=2000
VAD_MIN_ACTIVATION_THRESHOLD=0.3
VAD_MAX_ACTIVATION_THRESHOLD=0.8

# Session Configuration
SESSION_TIMEOUT_MINUTES=10
MAX_CONCURRENT_SESSIONS=10

# Audio Configuration
AUDIO_SAMPLE_RATE=16000
AUDIO_CHANNELS=1
MAX_AUDIO_DURATION_SECONDS=30

# Logging
LOG_LEVEL=info
"@

$envExampleContent | Out-File -FilePath "server\.env.example" -Encoding UTF8
Write-Host "✅ Created server/.env.example" -ForegroundColor Yellow

# Create empty JavaScript files
$emptyFiles = @(
    "client\index.html",
    "client\app.js", 
    "client\audio-handler.js",
    "client\style.css",
    "server\index.js",
    "server\modules\auth.js",
    "server\modules\websocket.js", 
    "server\modules\vad.js",
    "server\modules\pipeline.js",
    "server\modules\whisper.js",
    "server\modules\gpt.js",
    "server\modules\tts.js",
    "server\modules\session.js",
    "server\utils\audio-utils.js",
    "server\utils\config.js",
    "deployment\deploy.sh",
    "deployment\gcp-setup.sh"
)

foreach ($file in $emptyFiles) {
    New-Item -Path $file -ItemType File -Force | Out-Null
    Write-Host "✅ Created $file" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "🎉 Project setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Copy server/.env.example to server/.env and add your API keys" -ForegroundColor White
Write-Host "2. cd server && npm install" -ForegroundColor White
Write-Host "3. git add . && git commit -m 'Initial project setup'" -ForegroundColor White
Write-Host ""
Write-Host "Ready for Step 2: GCP VM Backend Setup!" -ForegroundColor Green