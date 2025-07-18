const axios = require('axios');
const config = require('./config');

const OPENAI_URL = `${config.openai.baseUrl}/chat/completions`;
const OPENAI_KEY = config.openai.apiKey;
const model = config.openai.model;

  console.log('📦 ChatGPT Config:', { model, OPENAI_URL, OPENAI_KEY: OPENAI_KEY ? '✅ Present' : '❌ Missing' });


async function callChatGpt(systemPrompt, userPrompt) {
  try {
    const response = await axios.post(
      OPENAI_URL,
      {
        model: model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.4,
        max_tokens: 400
      },
      {
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      }
    );

    const reply = response.data.choices?.[0]?.message?.content || '';
    return reply;
  } catch (err) {
    console.error('❌ GPT call failed:', err.message);
    return '{}'; // Fallback to empty JSON
  }
}

module.exports = {
  callChatGpt
};
