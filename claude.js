const DIRECT_API_URL = 'https://api.anthropic.com/v1/messages';
const DIRECT_MODEL = 'claude-sonnet-4-6';

// When accessed from another device on the LAN (e.g. phone → desktop IP),
// use that same hostname so the request reaches the desktop's proxy.
const _proxyHost = window.location.hostname;
const BEDROCK_PROXY_URL = (_proxyHost === 'localhost' || _proxyHost === '127.0.0.1' || _proxyHost === '')
  ? 'http://localhost:8770'
  : `http://${_proxyHost}:8770`;
const BEDROCK_MODEL_ID = 'us.anthropic.claude-3-5-sonnet-20241022-v2:0';

function getAuthMode() {
  return localStorage.getItem('mm-auth-mode') || 'direct';
}

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function resizeImage(blob, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(resolve, 'image/jpeg', quality);
    };
    img.src = url;
  });
}

function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON found in Claude response');
  return JSON.parse(match[0]);
}

function _gatewayConfig() {
  return {
    url: (localStorage.getItem('mm-gateway-url') || '').replace(/\/$/, ''),
    token: localStorage.getItem('mm-gateway-token') || '',
    customHeaders: localStorage.getItem('mm-gateway-custom-headers') || '',
  };
}

function _gatewayEnabled() {
  const { url, token } = _gatewayConfig();
  return !!(url && token);
}

async function callGatewayClaude(messages, systemPrompt) {
  const { url, token, customHeaders } = _gatewayConfig();
  const headers = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'Authorization': `Bearer ${token}`,
  };
  for (const line of customHeaders.split('\n')) {
    if (line.includes(':')) {
      const [k, ...rest] = line.split(':');
      headers[k.trim()] = rest.join(':').trim();
    }
  }
  const res = await fetch(`${url}/v1/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ model: DIRECT_MODEL, max_tokens: 8192, system: systemPrompt, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Gateway error ${res.status}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

async function callClaude(token, messages, systemPrompt) {
  // On HTTPS (Vercel): prefer direct gateway if credentials stored, else try serverless function.
  if (window.location.protocol === 'https:' && !window.location.hostname.includes('github.io')) {
    if (_gatewayEnabled()) return callGatewayClaude(messages, systemPrompt);
    return callVercelClaude(messages, systemPrompt);
  }
  if (getAuthMode() === 'bedrock') {
    return callBedrockClaude(token, messages, systemPrompt);
  }
  return callDirectClaude(token, messages, systemPrompt);
}

async function callVercelClaude(messages, systemPrompt) {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DIRECT_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || err.error || `Claude API error ${res.status}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

async function callDirectClaude(apiKey, messages, systemPrompt) {
  const res = await fetch(DIRECT_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-calls': 'true',
    },
    body: JSON.stringify({
      model: DIRECT_MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude API error ${res.status}`);
  }

  const data = await res.json();
  return data.content[0].text;
}

async function callBedrockClaude(_token, messages, systemPrompt) {
  // HTTPS pages (GitHub Pages) silently block HTTP proxy calls — fail fast.
  if (window.location.protocol === 'https:') {
    throw new Error(
      'Salesforce proxy does not work on GitHub Pages (HTTPS blocks HTTP calls). ' +
      'Access the app on your local network (http://192.168.x.x:8768) or switch to an Anthropic API key in Settings.'
    );
  }

  const url = `${BEDROCK_PROXY_URL}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DIRECT_MODEL,
        max_tokens: 8192,
        system: systemPrompt,
        messages,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Proxy error ${res.status} — is the maksim-maths-proxy server running?`);
    }

    const data = await res.json();
    return data.content[0].text;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error('Proxy timed out — is maksim-maths-proxy running? Access the app at http://<desktop-ip>:8768 for Salesforce auth.');
    }
    throw err;
  }
}

async function generateQuestions(topicName, subtopicName, apiKey) {
  const system = `You are a NSW Stage 5 Mathematics curriculum expert creating practice questions for a Year 10 student in New South Wales, Australia.

${window.CURRICULUM_CONTEXT}

CRITICAL: Return ONLY valid JSON with no markdown fences, no explanation, no extra text. The entire response must be parseable by JSON.parse().`;

  const user = `Create practice questions for a Year 10 NSW student:

Topic: ${topicName}
Subtopic: ${subtopicName}

Return ONLY this JSON structure (no other text):
{
  "foundational": [
    {
      "text": "Full question text",
      "answer": "Final answer (e.g. x = 3, or 12.5 cm²)",
      "workingSteps": ["Step 1: Write the equation...", "Step 2: Collect like terms...", "Step 3: Divide both sides..."]
    }
  ],
  "medium": [...],
  "advanced": [...]
}

Requirements per tier:
- foundational: 8 questions, Stage 5.1, ~15 minutes total. Direct application, single-step or simple multi-step.
- medium: 6 questions, Stage 5.2, ~15 minutes total. Multi-step, requires connecting ideas.
- advanced: 5 questions, Stage 5.3, ~15 minutes total. Complex reasoning, proof-based or abstract.

Each question MUST have:
- A clear, unambiguous question text
- A precise final answer
- At least 4 detailed working steps showing the full method

Notation: use ^ for powers (x^2), sqrt() for roots, unicode symbols ≤ ≥ ≠ π directly. Write fractions as (a/b).`;

  const text = await callClaude(apiKey, [{ role: 'user', content: user }], system);
  return extractJSON(text);
}

async function analysePhoto(photoFile, questions, difficulty, subtopicName, apiKey) {
  const resized = await resizeImage(photoFile);
  const base64 = await blobToBase64(resized);
  const mediaType = 'image/jpeg';

  const questionList = questions.map((q, i) => `Q${i + 1}: ${q.text}`).join('\n');

  const system = `You are a supportive mathematics teacher reviewing a Year 10 NSW student's handwritten work.
Your goal is to identify both what they did well and where they went wrong, focusing on METHOD and LOGIC, not just answers.
CRITICAL: Return ONLY valid JSON. No markdown, no explanation, no extra text.`;

  const userContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64 },
    },
    {
      type: 'text',
      text: `This is a Year 10 NSW student's handwritten work for the "${subtopicName}" subtopic — ${difficulty} difficulty section.

Questions in this section:
${questionList}

Carefully examine the handwritten work in the image. Identify which questions the student has attempted.

Return ONLY this JSON (no other text):
{
  "questions": [
    {
      "questionIndex": 1,
      "visible": true,
      "correct": false,
      "logicCorrect": false,
      "studentError": "Specific description of what the student did wrong, or null if correct"
    }
  ],
  "score": 72,
  "strengths": ["Specific strength observed, e.g. 'Correctly set up equations before solving'"],
  "improvements": ["Specific area to work on, e.g. 'Check signs when moving terms across the equals sign'"]
}

Rules:
- questionIndex is 1-based, matching Q1, Q2, etc. above
- visible: false if you cannot see any attempt for that question
- correct: true if the final answer is correct
- logicCorrect: true if the method/approach is correct even if a minor arithmetic slip occurred
- studentError: describe the actual mistake made (null if correct)
- score: 0–100 based on proportion of correct answers, weighted by working quality
- strengths and improvements: 2–4 items each, specific and actionable for a Year 10 student`,
    },
  ];

  const text = await callClaude(apiKey, [{ role: 'user', content: userContent }], system);
  return extractJSON(text);
}

async function extractTopicFromImage(imageFile, apiKey) {
  const base64 = await blobToBase64(imageFile);
  const mediaType = imageFile.type || 'image/jpeg';
  const isPdf = mediaType === 'application/pdf';

  const system = `You are extracting curriculum structure from a maths textbook, syllabus, or curriculum document for a Year 10 NSW Australia student.
Return ONLY valid JSON. No markdown, no explanation.`;

  const fileBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };

  const content = [
    fileBlock,
    { type: 'text', text: `Extract the main topic name and every subtopic visible in this image.

Return ONLY this JSON (no other text):
{
  "topic": "Main topic name as it appears",
  "subtopics": ["Subtopic 1", "Subtopic 2", "Subtopic 3"]
}

Rules:
- topic: the overarching chapter or unit name
- subtopics: every individual sub-section, lesson, or subtopic listed — include all of them
- Use the exact wording from the image where possible
- If no clear topic/subtopic structure is visible, return your best interpretation` },
  ];

  const text = await callClaude(apiKey, [{ role: 'user', content }], system);
  return extractJSON(text);
}

window.CLAUDE = { generateQuestions, analysePhoto, extractTopicFromImage };
