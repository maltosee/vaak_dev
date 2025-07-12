const CONFIG = {
  WEBSOCKET_URL: {
    development: 'ws://localhost:8080',
    production: 'wss://sanskrit-tutor-backend.fly.dev'
  },
  
  getEnvironment() {
    return window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
      ? 'development' 
      : 'production';
  },
  
  getWebSocketURL() {
    const env = this.getEnvironment();
    return this.WEBSOCKET_URL[env];
  }
};