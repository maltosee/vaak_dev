// Main application logic for Sanskrit Tutor
class SanskritTutorApp {
    constructor() {
        this.ws = null;
        this.token = null;
        this.audioHandler = null;
        this.isConnected = false;
        this.userName = '';
        
        console.log('🕉️ Sanskrit Tutor App initialized');
        
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.init());
        } else {
            this.init();
        }
    }

    /**
     * Initialize the application
     */
    async init() {
        try {
            console.log('🚀 Initializing Sanskrit Tutor App...');
            
            // Setup UI event listeners
            this.setupEventListeners();
            
            // Initialize audio handler
            this.audioHandler = new AudioHandler();
            
            // Show auth section first
            this.showSection('auth-section');
            
            console.log('✅ App initialization completed');
            
        } catch (error) {
            console.error('❌ App initialization failed:', error);
            this.showError('Application initialization failed');
        }
    }

    /**
     * Setup UI event listeners
     */
    setupEventListeners() {
        // Authentication
        document.getElementById('connect-btn').addEventListener('click', () => this.connect());
        document.getElementById('disconnect-btn').addEventListener('click', () => this.disconnect());
        
        // Voice controls
        document.getElementById('start-listening-btn').addEventListener('click', () => this.startListening());
        document.getElementById('stop-listening-btn').addEventListener('click', () => this.stopListening());
        
        // Enter key support for auth form
        document.getElementById('name').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.connect();
        });
        document.getElementById('apiKey').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.connect();
        });
    }

    /**
     * Connect to the Sanskrit tutor backend
     */
    async connect() {
        try {
            const name = document.getElementById('name').value.trim();
            const apiKey = document.getElementById('apiKey').value.trim();
            
            if (!name || !apiKey) {
                this.showAuthStatus('Please enter both name and API key', 'error');
                return;
            }

            this.showAuthStatus('Connecting...', 'info');
            
            // Get authentication token
            const token = await this.authenticate(name, apiKey);
            if (!token) return;
            
            this.token = token;
            this.userName = name;
            
            // Connect WebSocket
            await this.connectWebSocket();
            
            // Initialize audio with VAD
            await this.initializeAudio();
            
            // Switch to conversation view
            this.showSection('conversation-section');
            this.updateConnectionStatus(true);
            
            console.log('✅ Connected successfully');
            
        } catch (error) {
            console.error('❌ Connection failed:', error);
            this.showAuthStatus(`Connection failed: ${error.message}`, 'error');
        }
    }

    /**
     * Authenticate with backend and get token
     * @param {string} name - User name
     * @param {string} apiKey - API key
     * @returns {string|null} JWT token
     */
    async authenticate(name, apiKey) {
        try {
            const response = await fetch(`${CONFIG.getBaseURL()}/auth`, {

                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, apiKey })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Authentication failed');
            }

            this.showAuthStatus('Authentication successful!', 'success');
            return data.token;
            
        } catch (error) {
            this.showAuthStatus(`Authentication failed: ${error.message}`, 'error');
            return null;
        }
    }

    /**
     * Connect WebSocket to backend
     */
    async connectWebSocket() {
        return new Promise((resolve, reject) => {
            try {
                const wsUrl = `${CONFIG.getWebSocketURL()}?token=${this.token}`;
                this.ws = new WebSocket(wsUrl);

                this.ws.onopen = () => {
                    console.log('🔌 WebSocket connected');
                    this.isConnected = true;
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    // Handle binary audio data (ArrayBuffer from backend)
                    if (event.data instanceof ArrayBuffer) {
                        console.log('🔊 Received audio response');
                        this.audioHandler.playAudioResponse(event.data, 'mp3');
                        return;
                    }
                    
                    // Handle JSON text messages
                    try {
                        const data = JSON.parse(event.data);
                        this.handleWebSocketMessage(data);
                    } catch (error) {
                        console.error('❌ Error parsing JSON:', error);
                    }
                };

                this.ws.onclose = (event) => {
                    console.log('🔌 WebSocket closed:', event.code, event.reason);
                    this.isConnected = false;
                    this.updateConnectionStatus(false);
                    
                    if (event.code !== 1000) { // Not normal closure
                        this.showError(`Connection lost: ${event.reason || 'Unknown error'}`);
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('❌ WebSocket error:', error);
                    reject(new Error('WebSocket connection failed'));
                };

                // Timeout for connection
                setTimeout(() => {
                    if (!this.isConnected) {
                        reject(new Error('Connection timeout'));
                    }
                }, 10000);

            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Handle incoming WebSocket messages
     * @param {Object} data - Parsed JSON message
     */
    handleWebSocketMessage(data) {
        try {
            console.log('📨 Received message:', data.type);

            switch (data.type) {
                case 'connected':
                    this.addMessage('system', 'Connected to Sanskrit Tutor', data.message);
                    this.updateDebugInfo('Connected', data);
                    break;

                case 'llm_response':
                    this.addMessage('ai', 'Sanskrit Tutor', data.text, {
                        transcription: data.transcription,
                        language: data.language,
                        processingTime: data.processingTime
                    });
                    this.updateDebugInfo('AI Response', data);
                    break;

                case 'error':
                    this.showError(data.message);
                    this.updateDebugInfo('Error', data);
                    this.setVoiceStatus('listening'); // Resume listening after error
                    break;

                case 'pong':
                    console.log('📡 Received pong');
                    break;

                default:
                    console.log('❓ Unknown message type:', data.type);
                    this.updateDebugInfo('Unknown Message', data);
            }

        } catch (error) {
            console.error('❌ Error handling WebSocket message:', error);
        }
    }

    /**
     * Initialize audio handler with VAD
     */
    async initializeAudio() {
        try {
            console.log('🎵 Initializing audio...');

            // Test microphone access first
            const micAccess = await this.audioHandler.testMicrophone();
            if (!micAccess) {
                throw new Error('Microphone access denied. Please grant microphone permissions.');
            }

            // Initialize VAD with callbacks
            const result = await this.audioHandler.initialize({
                onSpeechStart: () => {
                    this.setVoiceStatus('speaking');
                },
                onSpeechEnd: (audioBuffer) => {
                    this.sendAudioToServer(audioBuffer);
                },
                onError: (error) => {
                    this.showError(`Audio error: ${error}`);
                },
                onStatusChange: (status) => {
                    this.setVoiceStatus(status);
                }
            });

            if (!result.success) {
                throw new Error(result.error);
            }

            console.log('✅ Audio initialized successfully');

        } catch (error) {
            console.error('❌ Audio initialization failed:', error);
            throw error;
        }
    }

    /**
     * Start listening for voice input
     */
    async startListening() {
        try {
            if (!this.isConnected) {
                this.showError('Not connected to server');
                return;
            }

            const result = await this.audioHandler.startListening();
            if (result.success) {
                document.getElementById('start-listening-btn').classList.add('hidden');
                document.getElementById('stop-listening-btn').classList.remove('hidden');
                this.setVoiceStatus('listening');
                console.log('🎤 Started listening');
            } else {
                this.showError(`Failed to start listening: ${result.error}`);
            }

        } catch (error) {
            console.error('❌ Error starting listening:', error);
            this.showError('Failed to start listening');
        }
    }

    /**
     * Stop listening for voice input
     */
    async stopListening() {
        try {
            const result = await this.audioHandler.stopListening();
            if (result.success) {
                document.getElementById('start-listening-btn').classList.remove('hidden');
                document.getElementById('stop-listening-btn').classList.add('hidden');
                this.setVoiceStatus('idle');
                console.log('🛑 Stopped listening');
            }

        } catch (error) {
            console.error('❌ Error stopping listening:', error);
        }
    }

    /**
     * Send audio data to server via WebSocket
     * @param {Uint8Array} audioBuffer - Audio data
     */
    sendAudioToServer(audioBuffer) {
        try {
            if (!this.isConnected || !this.ws) {
                throw new Error('Not connected to server');
            }

            console.log(`📤 Sending audio to server: ${audioBuffer.length} bytes`);
            
            // Add user message to conversation
            this.addMessage('user', 'You', 'Audio message sent', { 
                audioSize: audioBuffer.length 
            });

            // Send binary audio data
            this.ws.send(audioBuffer);

        } catch (error) {
            console.error('❌ Error sending audio:', error);
            this.showError('Failed to send audio to server');
            this.setVoiceStatus('listening'); // Resume listening
        }
    }

    /**
     * Disconnect from server
     */
    async disconnect() {
        try {
            console.log('🔌 Disconnecting...');

            // Stop audio
            if (this.audioHandler) {
                await this.audioHandler.destroy();
            }

            // Close WebSocket
            if (this.ws) {
                this.ws.close(1000, 'User disconnect');
                this.ws = null;
            }

            this.isConnected = false;
            this.token = null;

            // Reset UI
            this.showSection('auth-section');
            this.clearMessages();
            this.clearDebugInfo();

            console.log('✅ Disconnected successfully');

        } catch (error) {
            console.error('❌ Error during disconnect:', error);
        }
    }

    /**
     * Set voice activity status
     * @param {string} status - Status: idle, listening, speaking, processing
     */
    setVoiceStatus(status) {
        const circle = document.getElementById('voice-circle');
        const statusText = document.getElementById('voice-status');

        // Remove all status classes
        circle.classList.remove('listening', 'speaking', 'processing');

        // Add new status class and update text
        switch (status) {
            case 'listening':
                circle.classList.add('listening');
                statusText.textContent = 'Listening for your voice...';
                break;
            case 'speaking':
                circle.classList.add('speaking');
                statusText.textContent = 'You are speaking...';
                break;
            case 'processing':
                circle.classList.add('processing');
                statusText.textContent = 'Processing your message...';
                break;
            case 'idle':
            default:
                statusText.textContent = 'Click "Start Listening" to begin';
                break;
        }
    }

    /**
     * Add message to conversation display
     * @param {string} type - Message type: user, ai, system
     * @param {string} sender - Sender name
     * @param {string} content - Message content
     * @param {Object} metadata - Additional metadata
     */
    addMessage(type, sender, content, metadata = {}) {
        const messagesContainer = document.getElementById('messages');
        const messageElement = document.createElement('div');
        messageElement.className = `message ${type}`;

        const time = new Date().toLocaleTimeString();
        
        let metadataHtml = '';
        if (metadata.transcription) {
            metadataHtml += `<div class="transcription">Transcription: "${metadata.transcription}"</div>`;
        }
        if (metadata.language) {
            metadataHtml += `<div class="transcription">Language: ${metadata.language}</div>`;
        }
        if (metadata.processingTime) {
            metadataHtml += `<div class="transcription">Processing time: ${metadata.processingTime}ms</div>`;
        }
        if (metadata.audioSize) {
            metadataHtml += `<div class="transcription">Audio size: ${metadata.audioSize} bytes</div>`;
        }

        messageElement.innerHTML = `
            <div class="message-header">
                <span>${sender}</span>
                <span class="message-time">${time}</span>
            </div>
            <div class="message-content">${content}</div>
            ${metadataHtml}
        `;

        messagesContainer.appendChild(messageElement);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
     * Clear all messages
     */
    clearMessages() {
        document.getElementById('messages').innerHTML = '';
    }

    /**
     * Update connection status display
     * @param {boolean} connected - Connection status
     */
    updateConnectionStatus(connected) {
        const statusElement = document.getElementById('connection-status');
        const statusText = document.getElementById('status-text');
        const userNameElement = document.getElementById('user-name');

        if (connected) {
            statusElement.className = 'status-bar connected';
            statusText.textContent = 'Connected';
            userNameElement.textContent = this.userName;
        } else {
            statusElement.className = 'status-bar';
            statusText.textContent = 'Disconnected';
            userNameElement.textContent = '';
        }
    }

    /**
     * Show authentication status
     * @param {string} message - Status message
     * @param {string} type - Status type: success, error, info
     */
    showAuthStatus(message, type) {
        const statusElement = document.getElementById('auth-status');
        statusElement.className = `status ${type}`;
        statusElement.textContent = message;
    }

    /**
     * Show error message
     * @param {string} message - Error message
     */
    showError(message) {
        this.addMessage('system', 'System', `Error: ${message}`);
        console.error('❌ App error:', message);
    }

    /**
     * Show specific section and hide others
     * @param {string} sectionId - Section ID to show
     */
    showSection(sectionId) {
        const sections = ['auth-section', 'conversation-section'];
        sections.forEach(id => {
            const element = document.getElementById(id);
            if (id === sectionId) {
                element.classList.remove('hidden');
            } else {
                element.classList.add('hidden');
            }
        });
    }

    /**
     * Update debug information
     * @param {string} label - Debug label
     * @param {Object} data - Debug data
     */
    updateDebugInfo(label, data) {
        const debugElement = document.getElementById('debug-info');
        const timestamp = new Date().toLocaleTimeString();
        
        debugElement.textContent += `[${timestamp}] ${label}:\n${JSON.stringify(data, null, 2)}\n\n`;
        debugElement.scrollTop = debugElement.scrollHeight;
    }

    /**
     * Clear debug information
     */
    clearDebugInfo() {
        document.getElementById('debug-info').textContent = '';
    }

    /**
     * Send ping to server (for testing connectivity)
     */
    sendPing() {
        if (this.ws && this.isConnected) {
            this.ws.send(JSON.stringify({ type: 'ping' }));
            console.log('📡 Sent ping');
        }
    }
}

// Initialize the app
const app = new SanskritTutorApp();