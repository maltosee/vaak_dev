// Session management module
const { v4: uuidv4 } = require('uuid');
const config = require('../utils/config');

class SessionManager {
  constructor() {
    this.sessions = new Map(); // userId -> session data
    this.connections = new Map(); // userId -> WebSocket connection
    this.timeoutInterval = config.session.timeoutMinutes * 60 * 1000; // Convert to ms
    this.maxSessions = config.session.maxConcurrentSessions;
    
    // Start cleanup interval
    this.startCleanupInterval();
    
    console.log(`🕐 Session timeout: ${config.session.timeoutMinutes} minutes`);
    console.log(`👥 Max concurrent sessions: ${this.maxSessions}`);
  }

  /**
   * Create new session for user
   * @param {Object} user - User data from JWT
   * @param {WebSocket} ws - WebSocket connection
   * @returns {Object} Session info
   */
  createSession(user, ws) {
    const userId = user.id || uuidv4();
    const sessionId = uuidv4();
    
    // Check session limit
    if (this.sessions.size >= this.maxSessions) {
      throw new Error(`Maximum concurrent sessions (${this.maxSessions}) reached`);
    }

    // Create session data
    const session = {
      sessionId,
      userId,
      user,
      createdAt: new Date(),
      lastActivity: new Date(),
      status: 'connected',
      audioBuffer: null,
      state: 'listening' // listening, processing, speaking
    };

    // Store session and connection
    this.sessions.set(userId, session);
    this.connections.set(userId, ws);

    console.log(`🔗 Session created: ${sessionId} for user: ${user.name || userId}`);
    console.log(`📊 Active sessions: ${this.sessions.size}/${this.maxSessions}`);

    return session;
  }

  /**
   * Get session by user ID
   * @param {string} userId - User ID
   * @returns {Object|null} Session data
   */
  getSession(userId) {
    return this.sessions.get(userId);
  }

  /**
   * Update session activity
   * @param {string} userId - User ID
   */
  updateActivity(userId) {
    const session = this.sessions.get(userId);
    if (session) {
      session.lastActivity = new Date();
    }
  }

  /**
   * Update session state
   * @param {string} userId - User ID
   * @param {string} state - New state (listening, processing, speaking)
   */
  updateState(userId, state) {
    const session = this.sessions.get(userId);
    if (session) {
      session.state = state;
      session.lastActivity = new Date();
      console.log(`🔄 Session ${session.sessionId} state: ${state}`);
    }
  }

  /**
   * Set audio buffer for session
   * @param {string} userId - User ID
   * @param {Buffer} audioBuffer - Audio data
   */
  setAudioBuffer(userId, audioBuffer) {
    const session = this.sessions.get(userId);
    if (session) {
      session.audioBuffer = audioBuffer;
      this.updateActivity(userId);
    }
  }

  /**
   * Get WebSocket connection for user
   * @param {string} userId - User ID
   * @returns {WebSocket|null} WebSocket connection
   */
  getConnection(userId) {
    return this.connections.get(userId);
  }

  /**
   * Remove session
   * @param {string} userId - User ID
   * @param {string} reason - Reason for removal
   */
  removeSession(userId, reason = 'unknown') {
    const session = this.sessions.get(userId);
    const ws = this.connections.get(userId);

    if (session) {
      console.log(`🔌 Session removed: ${session.sessionId} (${reason})`);
    }

    // Close WebSocket if still open
    if (ws && ws.readyState === ws.OPEN) {
      ws.close(1000, reason);
    }

    // Remove from maps
    this.sessions.delete(userId);
    this.connections.delete(userId);

    console.log(`📊 Active sessions: ${this.sessions.size}/${this.maxSessions}`);
  }

  /**
   * Get all active sessions
   * @returns {Array} Array of session data
   */
  getAllSessions() {
    return Array.from(this.sessions.values());
  }

  /**
   * Check if session is expired
   * @param {Object} session - Session data
   * @returns {boolean} True if expired
   */
  isSessionExpired(session) {
    const now = new Date();
    const timeDiff = now - session.lastActivity;
    return timeDiff > this.timeoutInterval;
  }

  /**
   * Start cleanup interval for expired sessions
   */
  startCleanupInterval() {
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute
  }

  /**
   * Remove expired sessions
   */
  cleanupExpiredSessions() {
    const expiredSessions = [];
    
    this.sessions.forEach((session, userId) => {
      if (this.isSessionExpired(session)) {
        expiredSessions.push(userId);
      }
    });

    expiredSessions.forEach(userId => {
      this.removeSession(userId, 'session_timeout');
    });

    if (expiredSessions.length > 0) {
      console.log(`🧹 Cleaned up ${expiredSessions.length} expired sessions`);
    }
  }

  /**
   * Get session statistics
   * @returns {Object} Session stats
   */
  getStats() {
    const sessions = this.getAllSessions();
    const byState = sessions.reduce((acc, session) => {
      acc[session.state] = (acc[session.state] || 0) + 1;
      return acc;
    }, {});

    return {
      total: sessions.length,
      maxSessions: this.maxSessions,
      byState,
      oldest: sessions.reduce((oldest, session) => 
        !oldest || session.createdAt < oldest.createdAt ? session : oldest, null)
    };
  }
}

module.exports = new SessionManager();