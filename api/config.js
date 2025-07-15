export default async function handler(req, res) {
  const backendUrl = process.env.BACKEND_URL;
  console.log('🌍 BACKEND_URL =', backendUrl); // ✅ Step 1: Log env var

  try {
    const response = await fetch(`${backendUrl}/config`);
    console.log('📡 Response status from Fly backend:', response.status); // ✅ Step 2: Log status

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch backend config' });
    }

    const config = await response.json();
    return res.status(200).json(config);
  } catch (error) {
    console.error('❌ /api/config error:', error.message); // ✅ Step 3: Log error details
    return res.status(500).json({ error: 'Internal server error' });
  }
}
