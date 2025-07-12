// JWT Authentication module
const jwt = require('jsonwebtoken');
const config = require('../utils/config');

class AuthService {
  constructor() {
    this.secret = config.auth.jwtSecret;
    this.expiresIn = config.auth.jwtExpiresIn;
  }

  /**
   * Generate JWT token for user
   * @param {Object} payload - User data (name, etc.)
   * @returns {string} JWT token
   */
  generateToken(payload) {
    try {
      const token = jwt.sign(payload, this.secret, { 
        expiresIn: this.expiresIn 
      });
      
      console.log(`✅ Token generated for user: ${payload.name || 'unknown'}`);
      return token;
    } catch (error) {
      console.error('❌ Token generation failed:', error.message);
      throw new Error('Token generation failed');
    }
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object} Decoded token payload
   */
  verifyToken(token) {
    try {
      const decoded = jwt.verify(token, this.secret);
      return { success: true, data: decoded };
    } catch (error) {
      console.error('❌ Token verification failed:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Extract token from WebSocket connection query
   * @param {Object} query - WebSocket query parameters
   * @returns {string|null} Token if found
   */
  extractTokenFromQuery(query) {
    return query.token || query.auth || null;
  }

  /**
   * Middleware for WebSocket authentication
   * @param {Object} query - WebSocket query parameters
   * @returns {Object} Authentication result
   */
  authenticateWebSocket(query) {
    const token = this.extractTokenFromQuery(query);
    
    if (!token) {
      return { 
        success: false, 
        error: 'No token provided. Use: ws://server:8080?token=your_token' 
      };
    }

    const verification = this.verifyToken(token);
    
    if (!verification.success) {
      return { 
        success: false, 
        error: `Invalid token: ${verification.error}` 
      };
    }

    return { 
      success: true, 
      user: verification.data 
    };
  }

  /**
   * Express middleware for HTTP authentication
   * @param {Object} req - Express request
   * @param {Object} res - Express response  
   * @param {Function} next - Next middleware
   */
  authenticateHTTP(req, res, next) {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const verification = this.verifyToken(token);
    
    if (!verification.success) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    req.user = verification.data;
    next();
  }
}

module.exports = new AuthService();