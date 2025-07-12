// OpenAI GPT LLM module for Sanskrit tutoring
const { OpenAI } = require('openai');
const config = require('../utils/config');

class SanskritGPT {
  constructor() {
    this.openai = new OpenAI({
      apiKey: config.openai.apiKey
    });
    
    this.model = config.openai.model;
    this.systemPrompt = this.createSanskritTutorPrompt();
    
    // Conversation history per user
    this.conversations = new Map(); // userId -> conversation history
    
    console.log('✅ Sanskrit GPT initialized');
  }

  /**
   * Create system prompt for Sanskrit tutoring
   * @returns {string} System prompt
   */
  createSanskritTutorPrompt() {
    return `You are a knowledgeable and patient Sanskrit tutor. Your role is to help students learn Sanskrit through conversation.

Key guidelines:
- Be encouraging and supportive
- Explain Sanskrit concepts clearly and simply
- Provide pronunciation guidance when asked
- Correct mistakes gently with explanations
- Use both Sanskrit and English appropriately
- Share interesting etymology and cultural context
- Keep responses conversational and engaging
- If asked about non-Sanskrit topics, politely redirect to Sanskrit learning

Response format:
- Keep responses concise (1-3 sentences typically)
- Use clear, simple language
- Include Sanskrit words with transliteration when helpful
- Provide pronunciation tips using simple phonetic guides

Example interactions:
- If student says "Hello", respond with greeting and ask about their Sanskrit learning goals
- If student attempts Sanskrit, provide gentle corrections and encouragement
- If student asks for translation, provide it with pronunciation and context
- If student seems confused, offer simpler explanations or examples

Remember: You're having a voice conversation, so keep responses natural and speech-friendly.`;
  }

  /**
   * Generate response from GPT for Sanskrit tutoring
   * @param {string} userInput - User's message/question
   * @param {string} userId - User ID for conversation history
   * @param {Object} options - Additional options
   * @returns {Object} GPT response
   */
  async generateResponse(userInput, userId, options = {}) {
    try {
      const startTime = Date.now();

      // Get or create conversation history
      let conversation = this.conversations.get(userId) || [];
      
      // Add user message to conversation
      conversation.push({
        role: 'user',
        content: userInput,
        timestamp: new Date().toISOString()
      });

      // Prepare messages for API
      const messages = [
        { role: 'system', content: this.systemPrompt },
        ...conversation.slice(-10).map(msg => ({ // Keep last 10 messages for context
          role: msg.role,
          content: msg.content
        }))
      ];

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages,
        max_tokens: options.maxTokens || 150, // Keep responses concise for voice
        temperature: options.temperature || 0.7,
        top_p: options.topP || 0.9,
        frequency_penalty: options.frequencyPenalty || 0.3,
        presence_penalty: options.presencePenalty || 0.3
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      const aiResponse = response.choices[0]?.message?.content;
      
      if (!aiResponse) {
        throw new Error('No response generated from GPT');
      }

      // Add AI response to conversation history
      conversation.push({
        role: 'assistant',
        content: aiResponse,
        timestamp: new Date().toISOString()
      });

      // Store updated conversation (limit to last 20 messages)
      this.conversations.set(userId, conversation.slice(-20));

      const result = {
        success: true,
        response: aiResponse.trim(),
        tokensUsed: response.usage?.total_tokens || 0,
        duration: duration,
        conversationLength: conversation.length,
        timestamp: new Date().toISOString()
      };

      console.log(`🤖 GPT response (${duration}ms, ${result.tokensUsed} tokens): "${aiResponse.substring(0, 50)}..."`);
      return result;

    } catch (error) {
      console.error('❌ GPT generation failed:', error.message);
      
      // Enhanced error handling
      if (error.response) {
        const status = error.response.status;
        const errorData = error.response.data;
        
        return {
          success: false,
          error: `GPT API error (${status}): ${errorData.error?.message || error.message}`,
          status,
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        success: false,
        error: `GPT generation failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Generate response with Sanskrit-specific enhancements
   * @param {string} userInput - User's message
   * @param {string} userId - User ID
   * @param {Object} context - Additional context (language detected, etc.)
   * @returns {Object} Enhanced GPT response
   */
  async generateSanskritResponse(userInput, userId, context = {}) {
    try {
      // Enhance user input with context
      let enhancedInput = userInput;
      
      if (context.detectedLanguage) {
        enhancedInput = `[Language detected: ${context.detectedLanguage}] ${userInput}`;
      }
      
      if (context.audioQuality) {
        enhancedInput = `[Audio quality: ${context.audioQuality}] ${enhancedInput}`;
      }

      // Add Sanskrit-specific instructions based on content
      const isSanskritAttempt = this.containsSanskrit(userInput);
      const isTranslationRequest = this.isTranslationRequest(userInput);
      
      let instructions = '';
      if (isSanskritAttempt) {
        instructions = ' Please provide pronunciation feedback and gentle corrections if needed.';
      } else if (isTranslationRequest) {
        instructions = ' Please provide the translation with pronunciation guide and cultural context.';
      }

      const fullInput = enhancedInput + instructions;

      return await this.generateResponse(fullInput, userId, {
        maxTokens: 200, // Slightly longer for Sanskrit explanations
        temperature: 0.6 // Slightly lower for accuracy
      });

    } catch (error) {
      return {
        success: false,
        error: `Sanskrit response generation failed: ${error.message}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Check if text contains Sanskrit characters or words
   * @param {string} text - Text to check
   * @returns {boolean} True if contains Sanskrit
   */
  containsSanskrit(text) {
    // Check for Devanagari script (basic range)
    const devanagariRegex = /[\u0900-\u097F]/;
    
    // Check for common Sanskrit transliterations
    const sanskritWords = ['namaste', 'guru', 'dharma', 'karma', 'yoga', 'mantra', 'ashtanga', 'pranayama'];
    const lowerText = text.toLowerCase();
    
    return devanagariRegex.test(text) || sanskritWords.some(word => lowerText.includes(word));
  }

  /**
   * Check if user is requesting translation
   * @param {string} text - Text to check
   * @returns {boolean} True if translation request
   */
  isTranslationRequest(text) {
    const translationKeywords = ['translate', 'meaning', 'what does', 'how do you say', 'what is'];
    const lowerText = text.toLowerCase();
    
    return translationKeywords.some(keyword => lowerText.includes(keyword));
  }

  /**
   * Clear conversation history for a user
   * @param {string} userId - User ID
   */
  clearConversation(userId) {
    this.conversations.delete(userId);
    console.log(`🗑️ Cleared conversation history for user: ${userId}`);
  }

  /**
   * Get conversation statistics
   * @returns {Object} Conversation stats
   */
  getConversationStats() {
    const totalConversations = this.conversations.size;
    let totalMessages = 0;
    
    this.conversations.forEach(conversation => {
      totalMessages += conversation.length;
    });

    return {
      activeConversations: totalConversations,
      totalMessages,
      averageMessagesPerConversation: totalConversations > 0 ? (totalMessages / totalConversations).toFixed(1) : 0
    };
  }

  /**
   * Set custom system prompt
   * @param {string} prompt - New system prompt
   */
  setSystemPrompt(prompt) {
    this.systemPrompt = prompt;
    console.log('✅ System prompt updated');
  }

  /**
   * Get conversation history for a user
   * @param {string} userId - User ID
   * @param {number} limit - Number of recent messages to return
   * @returns {Array} Conversation history
   */
  getConversationHistory(userId, limit = 10) {
    const conversation = this.conversations.get(userId) || [];
    return conversation.slice(-limit);
  }
}

module.exports = new SanskritGPT();