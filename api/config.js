export default async function handler(req, res) {
  const backendUrl = process.env.BACKEND_URL;

  try {
    const response = await fetch(`${backendUrl}/config`);
    if (!response.ok) {
      return res.status(response.status).json({ error: 'Failed to fetch backend config' });
    }

    const config = await response.json();
    return res.status(200).json(config);
  } catch (err) {
    console.error('❌ /api/config error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
