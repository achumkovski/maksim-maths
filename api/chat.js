export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  // Two modes:
  //   1. ANTHROPIC_API_KEY set → call api.anthropic.com directly (paid account)
  //   2. ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN set → call Salesforce gateway (no paid account needed)
  const apiKey  = process.env.ANTHROPIC_API_KEY;
  const baseUrl = (process.env.ANTHROPIC_BASE_URL || '').replace(/\/$/, '');
  const token   = process.env.ANTHROPIC_AUTH_TOKEN;
  const customHeadersRaw = process.env.ANTHROPIC_CUSTOM_HEADERS || '';

  if (!apiKey && !baseUrl) {
    res.status(500).json({ error: 'Configure ANTHROPIC_API_KEY (or ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN) in Vercel environment variables.' });
    return;
  }

  const targetUrl = apiKey
    ? 'https://api.anthropic.com/v1/messages'
    : `${baseUrl}/v1/messages`;

  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };

  if (apiKey) {
    headers['x-api-key'] = apiKey;
  } else if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Parse optional extra headers from "Name: Value\nName2: Value2" format (mirrors proxy.py)
  for (const line of customHeadersRaw.split('\n')) {
    if (line.includes(':')) {
      const [k, ...rest] = line.split(':');
      headers[k.trim()] = rest.join(':').trim();
    }
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
