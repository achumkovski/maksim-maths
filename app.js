// ── State ──────────────────────────────────────────────────────────────
const state = {
  topicId: null,
  subtopicId: null,
  feedbackSubmissionId: null,
};

// ── Utilities ──────────────────────────────────────────────────────────
function uid() { return crypto.randomUUID(); }

function getApiKey() { return localStorage.getItem('mm-api-key'); }
function setApiKey(key) { localStorage.setItem('mm-api-key', key); }
function clearApiKey() { localStorage.removeItem('mm-api-key'); localStorage.removeItem('mm-auth-mode'); }

function fmt(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\^(\d+)/g, '<sup>$1</sup>')
    .replace(/\^([a-zA-Z0-9]+)/g, '<sup>$1</sup>')
    .replace(/sqrt\(([^)]+)\)/g, '√($1)');
}

function scoreClass(s) {
  if (s >= 75) return 'score-good';
  if (s >= 50) return 'score-mid';
  return 'score-low';
}

function diffLabel(d) {
  return { foundational: 'Foundational', medium: 'Medium', advanced: 'Advanced' }[d] || d;
}

function getView() { return document.getElementById('view-container'); }
function getModal() { return document.getElementById('modal-overlay'); }

// ── Modal ──────────────────────────────────────────────────────────────
function showModal(html) {
  getModal().innerHTML = `<div class="modal-box">${html}</div>`;
  getModal().classList.add('open');
}

function hideModal() {
  getModal().classList.remove('open');
  getModal().innerHTML = '';
}

// ── Topbar API key button ──────────────────────────────────────────────
function renderTopbar(subtitle) {
  document.getElementById('topbar-subtitle').textContent = subtitle || '';
}

// ── Loading view ───────────────────────────────────────────────────────
function showLoading(title, sub) {
  getView().innerHTML = `
    <div class="loading-wrap">
      <div class="spinner"></div>
      <div class="loading-title">${title}</div>
      <div class="loading-sub">${sub || ''}</div>
    </div>`;
}

// ── Error helper ───────────────────────────────────────────────────────
function showError(container, msg) {
  const el = document.createElement('div');
  el.className = 'alert alert-error';
  el.innerHTML = `<strong>Error:</strong> ${msg}`;
  const first = container.querySelector('.container') || container;
  first.prepend(el);
  setTimeout(() => el.remove(), 6000);
}

// ── Setup view ─────────────────────────────────────────────────────────
function renderSetup() {
  renderTopbar('');
  getView().innerHTML = `
    <div class="setup-wrap">
      <div class="setup-card">
        <div class="setup-icon">📐</div>
        <div class="setup-title">Maksim's Maths</div>
        <div class="setup-subtitle">Choose how to connect to Claude. Your token is saved locally and never leaves your browser.</div>
        <div id="setup-error"></div>

        <div class="mode-toggle" style="display:flex;gap:8px;margin-bottom:24px">
          <button class="btn w-full mode-btn active" id="mode-corporate" data-mode="bedrock"
            style="flex:1;border:2px solid var(--primary);background:var(--primary-light);color:var(--primary-dark)">
            🏢 Salesforce Corporate
          </button>
          <button class="btn w-full mode-btn" id="mode-direct" data-mode="direct"
            style="flex:1;border:2px solid var(--border);background:transparent;color:var(--muted)">
            🔑 Anthropic API Key
          </button>
        </div>

        <div id="setup-corporate">
          <div class="alert alert-info" style="margin-bottom:16px;font-size:0.88rem;line-height:1.6;flex-direction:column;gap:0">
            <div>Uses Salesforce's internal model gateway — no personal billing needed.</div>
            <div style="margin-top:8px">Start the <strong>maksim-maths-proxy</strong> server in Claude Code first (it handles auth automatically), then click Start Studying.</div>
          </div>
        </div>

        <div id="setup-direct" style="display:none">
          <div class="form-group">
            <label class="form-label">Anthropic API Key</label>
            <input class="form-input" type="password" id="api-key-input" placeholder="sk-ant-..." autocomplete="off" />
            <div class="form-hint">Get your key at console.anthropic.com</div>
          </div>
        </div>

        <button class="btn btn-primary w-full btn-lg" id="setup-submit">Start Studying →</button>
      </div>
    </div>`;

  // Mode toggle
  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.mode-btn').forEach(b => {
        b.style.borderColor = 'var(--border)';
        b.style.background = 'transparent';
        b.style.color = 'var(--muted)';
      });
      btn.style.borderColor = 'var(--primary)';
      btn.style.background = 'var(--primary-light)';
      btn.style.color = 'var(--primary-dark)';
      const mode = btn.dataset.mode;
      document.getElementById('setup-corporate').style.display = mode === 'bedrock' ? 'block' : 'none';
      document.getElementById('setup-direct').style.display = mode === 'direct' ? 'block' : 'none';
    };
  });

  document.getElementById('setup-submit').onclick = () => {
    const isCorporate = document.getElementById('setup-corporate').style.display !== 'none';

    if (isCorporate) {
      localStorage.setItem('mm-auth-mode', 'bedrock');
      setApiKey('proxy');
      renderDashboard();
      return;
    }

    const token = document.getElementById('api-key-input').value.trim();
    if (!token) {
      document.getElementById('setup-error').innerHTML =
        '<div class="alert alert-error">Please enter your Anthropic API key</div>';
      return;
    }
    if (!token.startsWith('sk-ant-')) {
      document.getElementById('setup-error').innerHTML =
        '<div class="alert alert-error">Anthropic API keys start with <strong>sk-ant-</strong></div>';
      return;
    }
    localStorage.setItem('mm-auth-mode', 'direct');
    setApiKey(token);
    renderDashboard();
  };
}

// ── Dashboard ──────────────────────────────────────────────────────────
async function renderDashboard() {
  renderTopbar('Dashboard');
  showLoading('Loading…', '');

  const topics = await DB.list('topics');
  topics.sort((a, b) => a.createdAt - b.createdAt);

  // compute progress for each topic
  const topicData = await Promise.all(topics.map(async (topic) => {
    const subtopics = await DB.list('subtopics', 'topicId', topic.id);
    let totalSections = 0, doneSections = 0;
    for (const st of subtopics) {
      totalSections += 3;
      const subs = await DB.list('submissions', 'subtopicId', st.id);
      const diffs = new Set(subs.filter(s => s.feedback).map(s => s.difficulty));
      doneSections += diffs.size;
    }
    const pct = totalSections ? Math.round((doneSections / totalSections) * 100) : 0;
    return { ...topic, subtopicCount: subtopics.length, pct };
  }));

  const cardsHtml = topicData.length
    ? topicData.map(t => `
      <div class="topic-card" data-topic-id="${t.id}">
        <div class="topic-card-name">${fmt(t.name)}</div>
        <div class="topic-card-meta">${t.subtopicCount} subtopic${t.subtopicCount !== 1 ? 's' : ''}</div>
        <div class="progress-bar-wrap"><div class="progress-bar" style="width:${t.pct}%"></div></div>
        <div class="progress-label"><span>Progress</span><span>${t.pct}%</span></div>
      </div>`).join('')
    : `<div class="empty-state" style="grid-column:1/-1">
        <div class="empty-icon">📚</div>
        <div class="empty-title">No topics yet</div>
        <div class="empty-sub">Add your first topic to get started</div>
      </div>`;

  getView().innerHTML = `
    <div class="container">
      <div class="page-header">
        <div>
          <div class="page-title">Topics</div>
          <div class="page-subtitle">
            Select a topic to study, or add a new one
            <span style="margin-left:8px;font-size:0.78rem;color:var(--muted)">
              ${DB.sbEnabled() ? '☁️ Cloud sync' : '💾 Local only'}
            </span>
          </div>
        </div>
        <button class="btn btn-primary" id="add-topic-btn">+ Add Topic</button>
      </div>
      <div class="card-grid" id="topic-grid">${cardsHtml}</div>
    </div>`;

  document.getElementById('add-topic-btn').onclick = showAddTopicModal;

  document.querySelectorAll('[data-topic-id]').forEach(el => {
    el.onclick = () => renderTopic(el.dataset.topicId);
  });
}

function showAddTopicModal() {
  showModal(`
    <div class="modal-title">Add Topic</div>
    <div style="display:flex;gap:8px;margin-bottom:20px">
      <button class="btn mode-tab active-tab" id="tab-manual" style="flex:1">✏️ Type manually</button>
      <button class="btn mode-tab" id="tab-image" style="flex:1">📎 Upload file</button>
    </div>
    <div id="modal-error"></div>

    <div id="panel-manual">
      <div class="form-group">
        <label class="form-label">Topic Name</label>
        <input class="form-input" type="text" id="new-topic-name" placeholder="e.g. Trigonometry" autofocus />
      </div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="modal-cancel-m">Cancel</button>
        <button class="btn btn-primary" id="modal-confirm-manual">Create Topic</button>
      </div>
    </div>

    <div id="panel-image" style="display:none">
      <div id="scan-step">
        <div class="upload-area" id="image-drop-zone" style="cursor:pointer;margin-bottom:16px">
          <div class="upload-icon">🖼️</div>
          <div class="upload-text">Click or drag a file here</div>
          <div class="upload-hint">Accepts images (PNG, JPG) or PDF — Claude will read the topic and all subtopics</div>
          <input type="file" id="topic-image-input" accept="image/*,.pdf,application/pdf" style="display:none" />
        </div>
        <div id="selected-file-name" style="font-size:0.85rem;color:var(--muted);text-align:center;margin-bottom:16px;min-height:20px"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="modal-cancel-i">Cancel</button>
          <button class="btn btn-primary" id="scan-btn" disabled>Scan File</button>
        </div>
      </div>

      <div id="confirm-step" style="display:none">
        <div class="form-group">
          <label class="form-label">Topic Name</label>
          <input class="form-input" type="text" id="extracted-topic-name" />
        </div>
        <div class="form-group">
          <label class="form-label">Subtopics <span id="subtopic-count" style="color:var(--muted);font-weight:400"></span></label>
          <div id="subtopic-list" style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;padding-right:4px"></div>
          <button class="btn btn-ghost btn-sm" id="add-row-btn" style="margin-top:8px;width:100%">+ Add subtopic</button>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="modal-cancel-c">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm-all">Create Topic &amp; Generate All →</button>
        </div>
      </div>
    </div>`);

  // Tab switching
  const tabManual = document.getElementById('tab-manual');
  const tabImage = document.getElementById('tab-image');
  const panelManual = document.getElementById('panel-manual');
  const panelImage = document.getElementById('panel-image');

  function setTab(mode) {
    const isManual = mode === 'manual';
    tabManual.className = 'btn mode-tab' + (isManual ? ' active-tab' : '');
    tabImage.className = 'btn mode-tab' + (!isManual ? ' active-tab' : '');
    panelManual.style.display = isManual ? 'block' : 'none';
    panelImage.style.display = isManual ? 'none' : 'block';
  }
  tabManual.onclick = () => setTab('manual');
  tabImage.onclick = () => setTab('image');

  // Manual mode
  document.getElementById('modal-cancel-m').onclick = hideModal;
  document.getElementById('modal-confirm-manual').onclick = async () => {
    const name = document.getElementById('new-topic-name').value.trim();
    if (!name) { document.getElementById('modal-error').innerHTML = '<div class="alert alert-error">Please enter a topic name</div>'; return; }
    const topic = { id: uid(), name, createdAt: Date.now() };
    await DB.save('topics', topic);
    hideModal();
    renderTopic(topic.id);
  };
  document.getElementById('new-topic-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-confirm-manual').click();
  });

  // Image mode — file selection
  let selectedFile = null;
  const dropZone = document.getElementById('image-drop-zone');
  const fileInput = document.getElementById('topic-image-input');
  const scanBtn = document.getElementById('scan-btn');

  dropZone.onclick = () => fileInput.click();
  dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; };
  dropZone.ondragleave = () => { dropZone.style.borderColor = ''; };
  dropZone.ondrop = (e) => {
    e.preventDefault();
    dropZone.style.borderColor = '';
    const f = e.dataTransfer.files[0];
    if (f && (f.type.startsWith('image/') || f.type === 'application/pdf')) setFile(f);
  };
  fileInput.onchange = () => { if (fileInput.files[0]) setFile(fileInput.files[0]); };

  function setFile(f) {
    selectedFile = f;
    document.getElementById('selected-file-name').textContent = f.name;
    scanBtn.disabled = false;
  }

  document.getElementById('modal-cancel-i').onclick = hideModal;

  // Scan image → call Claude vision
  scanBtn.onclick = async () => {
    if (!selectedFile) return;
    scanBtn.disabled = true;
    scanBtn.textContent = 'Scanning…';
    document.getElementById('modal-error').innerHTML = '';
    try {
      const result = await CLAUDE.extractTopicFromImage(selectedFile, getApiKey());
      showConfirmStep(result.topic || '', result.subtopics || []);
    } catch (err) {
      scanBtn.disabled = false;
      scanBtn.textContent = 'Scan File';
      document.getElementById('modal-error').innerHTML = `<div class="alert alert-error">${err.message}</div>`;
    }
  };

  // Confirm step — show extracted data as editable list
  function showConfirmStep(topicName, subtopics) {
    document.getElementById('scan-step').style.display = 'none';
    document.getElementById('confirm-step').style.display = 'block';
    document.getElementById('extracted-topic-name').value = topicName;
    renderSubtopicRows(subtopics);
  }

  function renderSubtopicRows(subtopics) {
    const list = document.getElementById('subtopic-list');
    list.innerHTML = subtopics.map((s, i) => `
      <div class="subtopic-edit-row" data-index="${i}" style="display:flex;gap:8px;align-items:center">
        <span style="color:var(--muted);font-size:0.82rem;min-width:20px">${i + 1}.</span>
        <input class="form-input subtopic-row-input" style="flex:1;margin-bottom:0" value="${fmt(s)}" />
        <button class="btn btn-ghost btn-sm del-row" data-index="${i}" style="padding:4px 8px;color:var(--danger)">✕</button>
      </div>`).join('');
    document.getElementById('subtopic-count').textContent = `(${subtopics.length})`;

    list.querySelectorAll('.del-row').forEach(btn => {
      btn.onclick = () => {
        const rows = [...list.querySelectorAll('.subtopic-row-input')].map(i => i.value);
        rows.splice(parseInt(btn.dataset.index), 1);
        renderSubtopicRows(rows);
      };
    });
  }

  document.getElementById('add-row-btn').onclick = () => {
    const list = document.getElementById('subtopic-list');
    const rows = [...list.querySelectorAll('.subtopic-row-input')].map(i => i.value);
    rows.push('');
    renderSubtopicRows(rows);
    list.querySelectorAll('.subtopic-row-input')[rows.length - 1]?.focus();
  };

  document.getElementById('modal-cancel-c').onclick = hideModal;

  document.getElementById('modal-confirm-all').onclick = async () => {
    const topicName = document.getElementById('extracted-topic-name').value.trim();
    if (!topicName) { document.getElementById('modal-error').innerHTML = '<div class="alert alert-error">Topic name is required</div>'; return; }
    const subtopicNames = [...document.getElementById('subtopic-list').querySelectorAll('.subtopic-row-input')]
      .map(i => i.value.trim()).filter(Boolean);
    if (!subtopicNames.length) { document.getElementById('modal-error').innerHTML = '<div class="alert alert-error">Add at least one subtopic</div>'; return; }

    const topic = { id: uid(), name: topicName, createdAt: Date.now() };
    await DB.save('topics', topic);
    hideModal();
    await generateAllSubtopics(topic.id, topicName, subtopicNames);
  };
}

// ── Topic view ─────────────────────────────────────────────────────────
async function renderTopic(topicId) {
  state.topicId = topicId;
  showLoading('Loading topic…', '');

  const topic = await DB.get('topics', topicId);
  if (!topic) { renderDashboard(); return; }

  const subtopics = await DB.list('subtopics', 'topicId', topicId);
  subtopics.sort((a, b) => a.createdAt - b.createdAt);

  const rowsHtml = await Promise.all(subtopics.map(async (st) => {
    const subs = await DB.list('submissions', 'subtopicId', st.id);
    const diffs = new Set(subs.filter(s => s.feedback).map(s => s.difficulty));
    const done = diffs.size;
    let badgeClass, badgeText;
    if (done === 0) { badgeClass = 'badge-ready'; badgeText = 'Not Started'; }
    else if (done < 3) { badgeClass = 'badge-in-progress'; badgeText = `${done}/3 Sections Done`; }
    else { badgeClass = 'badge-complete'; badgeText = '✓ Complete'; }

    const avgScore = subs.filter(s => s.feedback).length
      ? Math.round(subs.filter(s => s.feedback).reduce((a, b) => a + (b.feedback.score || 0), 0) / subs.filter(s => s.feedback).length)
      : null;

    return `
      <div class="subtopic-row" data-subtopic-id="${st.id}">
        <div class="subtopic-row-info">
          <div class="subtopic-row-name">${fmt(st.name)}</div>
          <div class="subtopic-row-meta">${avgScore !== null ? `Average score: ${avgScore}%` : 'No submissions yet'}</div>
        </div>
        <span class="status-badge ${badgeClass}">${badgeText}</span>
        <span style="color:var(--muted);font-size:1.1rem">›</span>
      </div>`;
  }));

  const listHtml = rowsHtml.length
    ? rowsHtml.join('')
    : `<div class="empty-state">
        <div class="empty-icon">📝</div>
        <div class="empty-title">No subtopics yet</div>
        <div class="empty-sub">Add a subtopic — Claude will generate 45 minutes of questions for it</div>
      </div>`;

  renderTopbar(topic.name);

  getView().innerHTML = `
    <div class="container">
      <button class="back-btn" id="back-dashboard">← Back to Topics</button>
      <div class="page-header">
        <div>
          <div class="page-title">${fmt(topic.name)}</div>
          <div class="page-subtitle">Select a subtopic to study, or add a new one</div>
        </div>
        <div class="flex gap-2 flex-wrap">
          ${subtopics.length >= 3 ? `<button class="btn btn-outline btn-sm" id="topic-summary-btn">View Summary</button>` : ''}
          <button class="btn btn-primary" id="add-subtopic-btn">+ Add Subtopic</button>
        </div>
      </div>
      <div id="subtopic-list">${listHtml}</div>
    </div>`;

  document.getElementById('back-dashboard').onclick = renderDashboard;
  document.getElementById('add-subtopic-btn').onclick = () => showAddSubtopicModal(topicId, topic.name);
  document.getElementById('topic-summary-btn')?.addEventListener('click', () => renderTopicSummary(topicId));

  document.querySelectorAll('[data-subtopic-id]').forEach(el => {
    el.onclick = () => renderSubtopic(el.dataset.subtopicId);
  });
}

async function showAddSubtopicModal(topicId, topicName) {
  showModal(`
    <div class="modal-title">Add Subtopic</div>
    <div class="modal-sub">Claude will generate 45 minutes of questions across three difficulty levels for this subtopic in <strong>${fmt(topicName)}</strong>.</div>
    <div id="modal-error"></div>
    <div class="form-group">
      <label class="form-label">Subtopic Name</label>
      <input class="form-input" type="text" id="new-subtopic-name" placeholder="e.g. Solving Linear Equations" autofocus />
      <div class="form-hint">Be specific — the more precise, the better the questions</div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
      <button class="btn btn-primary" id="modal-confirm">Generate Questions</button>
    </div>`);

  document.getElementById('modal-cancel').onclick = hideModal;
  document.getElementById('modal-confirm').onclick = async () => {
    const name = document.getElementById('new-subtopic-name').value.trim();
    if (!name) { document.getElementById('modal-error').innerHTML = '<div class="alert alert-error">Please enter a subtopic name</div>'; return; }

    const topic = await DB.get('topics', topicId);
    hideModal();
    await generateSubtopicQuestions(topicId, topic.name, name);
  };

  document.getElementById('new-subtopic-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('modal-confirm').click();
  });
}

async function generateSubtopicQuestions(topicId, topicName, subtopicName) {
  showLoading(
    `Generating questions for "${subtopicName}"`,
    'Claude is writing 45 minutes of curriculum-aligned questions across three difficulty levels. This usually takes 15–30 seconds…'
  );

  const apiKey = getApiKey();
  const subtopicId = uid();

  const subtopic = { id: subtopicId, topicId, name: subtopicName, createdAt: Date.now(), status: 'generating' };
  await DB.save('subtopics', subtopic);

  try {
    const result = await CLAUDE.generateQuestions(topicName, subtopicName, apiKey);

    const diffs = ['foundational', 'medium', 'advanced'];
    for (const diff of diffs) {
      const qs = result[diff] || [];
      for (let i = 0; i < qs.length; i++) {
        await DB.save('questions', {
          id: uid(),
          subtopicId,
          difficulty: diff,
          order: i,
          text: qs[i].text,
          answer: qs[i].answer,
          workingSteps: qs[i].workingSteps || [],
        });
      }
    }

    subtopic.status = 'ready';
    await DB.save('subtopics', subtopic);
    renderSubtopic(subtopicId);
  } catch (err) {
    await DB.del('subtopics', subtopicId);
    renderTopic(topicId);
    setTimeout(() => showError(getView(), err.message), 100);
  }
}

async function generateAllSubtopics(topicId, topicName, subtopicNames) {
  for (let i = 0; i < subtopicNames.length; i++) {
    const name = subtopicNames[i];
    showLoading(
      `Generating "${name}"`,
      `Subtopic ${i + 1} of ${subtopicNames.length} — Claude is writing 45 minutes of curriculum-aligned questions. This takes 15–30 seconds per subtopic…`
    );

    const apiKey = getApiKey();
    const subtopicId = uid();
    const subtopic = { id: subtopicId, topicId, name, createdAt: Date.now() + i, status: 'generating' };
    await DB.save('subtopics', subtopic);

    try {
      const result = await CLAUDE.generateQuestions(topicName, name, apiKey);
      const diffs = ['foundational', 'medium', 'advanced'];
      for (const diff of diffs) {
        const qs = result[diff] || [];
        for (let j = 0; j < qs.length; j++) {
          await DB.save('questions', {
            id: uid(), subtopicId, difficulty: diff, order: j,
            text: qs[j].text, answer: qs[j].answer, workingSteps: qs[j].workingSteps || [],
          });
        }
      }
      subtopic.status = 'ready';
      await DB.save('subtopics', subtopic);
    } catch (err) {
      subtopic.status = 'error';
      await DB.save('subtopics', subtopic);
    }
  }
  renderTopic(topicId);
}

// ── Subtopic view ──────────────────────────────────────────────────────
async function renderSubtopic(subtopicId) {
  state.subtopicId = subtopicId;
  showLoading('Loading subtopic…', '');

  const subtopic = await DB.get('subtopics', subtopicId);
  if (!subtopic) { renderTopic(state.topicId); return; }

  const topic = await DB.get('topics', subtopic.topicId);
  const allQuestions = await DB.list('questions', 'subtopicId', subtopicId);
  const submissions = await DB.list('submissions', 'subtopicId', subtopicId);

  // Clean up any stuck submissions (null feedback = analysis failed or page was reloaded mid-analysis)
  for (const s of submissions) {
    if (!s.feedback) await DB.del('submissions', s.id);
  }
  const cleanSubmissions = submissions.filter(s => s.feedback);

  const submissionByDiff = {};
  for (const s of cleanSubmissions) {
    if (!submissionByDiff[s.difficulty] || s.uploadedAt > submissionByDiff[s.difficulty].uploadedAt) {
      submissionByDiff[s.difficulty] = s;
    }
  }

  const diffs = ['foundational', 'medium', 'advanced'];
  const sectionsHtml = diffs.map(diff => {
    const questions = allQuestions.filter(q => q.difficulty === diff).sort((a, b) => a.order - b.order);
    const sub = submissionByDiff[diff];
    const hasFeedback = sub?.feedback;

    const questionsHtml = questions.map((q, i) => `
      <div class="question-item">
        <div class="question-num">Q${i + 1}</div>
        <div class="question-text">${fmt(q.text)}</div>
      </div>`).join('');

    const submitSection = sub
      ? hasFeedback
        ? `<div class="alert alert-success mt-4">
            ✓ Submitted — Score: <strong>${sub.feedback.score}%</strong>
            <button class="btn btn-outline btn-sm" style="margin-left:12px" data-view-feedback="${sub.id}">View Feedback</button>
           </div>`
        : `<div class="alert alert-info mt-4">⏳ Analysing your work…</div>`
      : `<div class="upload-area mt-4" id="upload-area-${diff}" data-diff="${diff}">
          <input type="file" id="file-${diff}" accept="image/*" capture="environment" />
          <div class="upload-icon">📷</div>
          <div class="upload-text">Upload photo of your working</div>
          <div class="upload-sub">Tap to take a photo or choose a file</div>
          <div id="preview-${diff}" class="preview-wrap" style="display:none"></div>
        </div>
        <button class="btn btn-primary mt-4" id="submit-btn-${diff}" data-diff="${diff}" data-subtopic-id="${subtopicId}" style="display:none">
          Analyse My Work →
        </button>`;

    const label = { foundational: '🟢 Foundational', medium: '🟡 Medium', advanced: '🔴 Advanced' }[diff];
    const hint = { foundational: 'Stage 5.1 · ~15 min', medium: 'Stage 5.2 · ~15 min', advanced: 'Stage 5.3 · ~15 min' }[diff];

    return `
      <div class="section-block">
        <div class="section-header" data-section="${diff}">
          <div class="section-header-left">
            <span class="section-title">${label}</span>
            <span class="section-qcount">${hint} · ${questions.length} questions</span>
          </div>
          <span class="section-chevron" id="chevron-${diff}">▾</span>
        </div>
        <div class="section-body" id="body-${diff}">
          <div>${questionsHtml}</div>
          ${submitSection}
        </div>
      </div>`;
  }).join('');

  const doneSubs = submissions.filter(s => s.feedback);
  const showSummary = doneSubs.length >= 2;

  renderTopbar(`${topic?.name || ''} · ${subtopic.name}`);

  getView().innerHTML = `
    <div class="container">
      <button class="back-btn" id="back-topic">← Back to ${fmt(topic?.name || 'Topic')}</button>
      <div class="page-header">
        <div>
          <div class="page-title">${fmt(subtopic.name)}</div>
          <div class="page-subtitle">Work through each section, then upload a photo of your answers</div>
        </div>
        ${showSummary ? `<button class="btn btn-outline btn-sm" id="subtopic-summary-btn">View My Summary</button>` : ''}
      </div>
      ${sectionsHtml}
    </div>`;

  document.getElementById('back-topic').onclick = () => renderTopic(subtopic.topicId);
  document.getElementById('subtopic-summary-btn')?.addEventListener('click', () => renderSubtopicSummary(subtopicId));

  // Section accordion toggles
  document.querySelectorAll('.section-header').forEach(header => {
    header.onclick = () => {
      const diff = header.dataset.section;
      const body = document.getElementById(`body-${diff}`);
      const chev = document.getElementById(`chevron-${diff}`);
      body.classList.toggle('open');
      chev.classList.toggle('open');
    };
  });

  // Open the first incomplete section by default
  for (const diff of diffs) {
    if (!submissionByDiff[diff]?.feedback) {
      document.getElementById(`body-${diff}`)?.classList.add('open');
      document.getElementById(`chevron-${diff}`)?.classList.add('open');
      break;
    }
  }

  // File input / preview / submit wiring
  diffs.forEach(diff => {
    const fileInput = document.getElementById(`file-${diff}`);
    const uploadArea = document.getElementById(`upload-area-${diff}`);
    const submitBtn = document.getElementById(`submit-btn-${diff}`);
    const previewDiv = document.getElementById(`preview-${diff}`);
    if (!fileInput) return;

    uploadArea.onclick = () => fileInput.click();

    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      previewDiv.innerHTML = `<img src="${url}" alt="Your work" />`;
      previewDiv.style.display = 'block';
      submitBtn.style.display = 'inline-flex';
      uploadArea.querySelector('.upload-text').textContent = 'Photo selected ✓';
    };

    submitBtn?.addEventListener('click', async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const questions = allQuestions.filter(q => q.difficulty === diff).sort((a, b) => a.order - b.order);
      await submitWork(subtopicId, subtopic.name, diff, file, questions);
    });
  });

  // Feedback navigation
  document.querySelectorAll('[data-view-feedback]').forEach(btn => {
    btn.onclick = () => renderFeedback(btn.dataset.viewFeedback, subtopicId);
  });
}

// ── Submit work ────────────────────────────────────────────────────────
async function submitWork(subtopicId, subtopicName, difficulty, file, questions) {
  showLoading(
    'Analysing your work…',
    'Claude is reviewing your handwritten answers and working. This usually takes 10–20 seconds…'
  );

  const apiKey = getApiKey();
  const submissionId = uid();

  const photoBlob = file;
  const submission = {
    id: submissionId,
    subtopicId,
    difficulty,
    photoBlob,
    uploadedAt: Date.now(),
    feedback: null,
  };
  await DB.save('submissions', submission);

  try {
    const feedback = await CLAUDE.analysePhoto(file, questions, difficulty, subtopicName, apiKey);

    // Merge question details into feedback for display
    feedback.questionsWithData = (feedback.questions || []).map(fq => {
      const q = questions[fq.questionIndex - 1];
      return { ...fq, questionText: q?.text || '', answer: q?.answer || '', workingSteps: q?.workingSteps || [] };
    });

    submission.feedback = feedback;
    await DB.save('submissions', submission);

    renderFeedback(submissionId, subtopicId);
  } catch (err) {
    // Remove the failed submission so the upload area reappears (no permanent "Analysing..." state)
    await DB.del('submissions', submissionId);
    renderSubtopic(subtopicId);
    setTimeout(() => showError(getView(), `Analysis failed: ${err.message}`), 100);
  }
}

// ── Feedback view ──────────────────────────────────────────────────────
async function renderFeedback(submissionId, subtopicId) {
  showLoading('Loading feedback…', '');

  const sub = await DB.get('submissions', submissionId);
  if (!sub?.feedback) { renderSubtopic(subtopicId); return; }

  const subtopic = await DB.get('subtopics', sub.subtopicId);
  const fb = sub.feedback;

  const questionsHtml = (fb.questionsWithData || fb.questions || []).map(fq => {
    if (!fq.visible) {
      return `<div class="feedback-question">
        <div class="fq-header">
          <span class="fq-num">Q${fq.questionIndex}</span>
          <span class="fq-text text-muted">${fmt(fq.questionText || '')}</span>
          <span class="fq-badge fq-unseen">Not seen in photo</span>
        </div>
      </div>`;
    }

    let badgeClass, badgeText;
    if (fq.correct) { badgeClass = 'fq-correct'; badgeText = '✓ Correct'; }
    else if (fq.logicCorrect) { badgeClass = 'fq-logic'; badgeText = '⚠ Right method'; }
    else { badgeClass = 'fq-wrong'; badgeText = '✗ Incorrect'; }

    const errorHtml = fq.studentError && !fq.correct
      ? `<div class="fq-error">⚠ ${fmt(fq.studentError)}</div>` : '';

    const solutionHtml = (!fq.correct && fq.workingSteps?.length)
      ? `<button class="solution-toggle" data-toggle="sol-${fq.questionIndex}">
          ▶ Show correct solution
         </button>
         <div class="solution-steps" id="sol-${fq.questionIndex}">
           <ol>${fq.workingSteps.map(s => `<li>${fmt(s)}</li>`).join('')}</ol>
           <div class="answer-pill">Answer: ${fmt(fq.answer)}</div>
         </div>` : '';

    return `<div class="feedback-question">
      <div class="fq-header">
        <span class="fq-num">Q${fq.questionIndex}</span>
        <span class="fq-text">${fmt(fq.questionText || '')}</span>
        <span class="fq-badge ${badgeClass}">${badgeText}</span>
      </div>
      ${errorHtml}
      ${solutionHtml}
    </div>`;
  }).join('');

  const strengthsHtml = (fb.strengths || []).map(s => `<li>${fmt(s)}</li>`).join('');
  const improvHtml = (fb.improvements || []).map(s => `<li>${fmt(s)}</li>`).join('');

  const scoreCol = scoreClass(fb.score);

  renderTopbar(`${subtopic?.name || ''} · Feedback`);

  getView().innerHTML = `
    <div class="container">
      <button class="back-btn" id="back-subtopic">← Back to ${fmt(subtopic?.name || 'Subtopic')}</button>
      <div class="page-header">
        <div>
          <div class="page-title">Feedback — ${diffLabel(sub.difficulty)}</div>
          <div class="page-subtitle">${fmt(subtopic?.name || '')}</div>
        </div>
      </div>

      <div class="card feedback-score">
        <div class="score-number ${scoreCol}">${fb.score}%</div>
        <div class="score-label">${diffLabel(sub.difficulty)} Section Score</div>
      </div>

      <div class="summary-grid">
        <div class="card summary-strengths">
          <div class="summary-card-title"><span class="icon">💪</span> Strengths</div>
          <ul class="summary-list">${strengthsHtml || '<li>Keep up the great work!</li>'}</ul>
        </div>
        <div class="card summary-improvements">
          <div class="summary-card-title"><span class="icon">🎯</span> Focus Areas</div>
          <ul class="summary-list">${improvHtml || '<li>Nothing specific to flag.</li>'}</ul>
        </div>
      </div>

      <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:16px">Question Breakdown</h3>
      ${questionsHtml || '<div class="alert alert-info">No questions were identified in the photo. Try re-uploading a clearer image.</div>'}

      <div class="divider"></div>
      <div class="flex gap-2 flex-wrap">
        <button class="btn btn-primary" id="back-subtopic-2">← Back to Questions</button>
      </div>
    </div>`;

  document.getElementById('back-subtopic').onclick = () => renderSubtopic(subtopicId);
  document.getElementById('back-subtopic-2').onclick = () => renderSubtopic(subtopicId);

  // Solution toggles
  document.querySelectorAll('[data-toggle]').forEach(btn => {
    btn.onclick = () => {
      const el = document.getElementById(btn.dataset.toggle);
      el.classList.toggle('open');
      btn.textContent = el.classList.contains('open') ? '▼ Hide solution' : '▶ Show correct solution';
    };
  });
}

// ── Subtopic Summary view ──────────────────────────────────────────────
async function renderSubtopicSummary(subtopicId) {
  showLoading('Building summary…', '');

  const subtopic = await DB.get('subtopics', subtopicId);
  const submissions = await DB.list('submissions', 'subtopicId', subtopicId);
  const topic = await DB.get('topics', subtopic.topicId);

  const withFeedback = submissions.filter(s => s.feedback);

  const avgScore = withFeedback.length
    ? Math.round(withFeedback.reduce((a, s) => a + (s.feedback.score || 0), 0) / withFeedback.length)
    : 0;

  const allStrengths = withFeedback.flatMap(s => s.feedback.strengths || []);
  const allImprovements = withFeedback.flatMap(s => s.feedback.improvements || []);

  const scoresByDiff = {};
  withFeedback.forEach(s => { scoresByDiff[s.difficulty] = s.feedback.score; });

  const diffRows = ['foundational', 'medium', 'advanced'].map(d => {
    const score = scoresByDiff[d];
    const col = score != null ? scoreClass(score) : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
      <span><span class="diff-badge diff-${d}">${diffLabel(d)}</span></span>
      <span style="font-weight:700" class="${col}">${score != null ? score + '%' : '—'}</span>
    </div>`;
  }).join('');

  renderTopbar(`${topic?.name || ''} · Summary`);

  getView().innerHTML = `
    <div class="container">
      <button class="back-btn" id="back-st">← Back to ${fmt(subtopic?.name || 'Subtopic')}</button>
      <div class="page-header">
        <div>
          <div class="page-title">Subtopic Summary</div>
          <div class="page-subtitle">${fmt(subtopic?.name || '')}</div>
        </div>
      </div>

      <div class="card feedback-score" style="padding:24px">
        <div class="score-number ${scoreClass(avgScore)}">${avgScore}%</div>
        <div class="score-label">Overall Average Score</div>
      </div>

      <div class="card mt-4">
        <div style="font-weight:700;margin-bottom:12px">Scores by Difficulty</div>
        ${diffRows}
      </div>

      <div class="summary-grid mt-4">
        <div class="card summary-strengths">
          <div class="summary-card-title"><span class="icon">💪</span> What You Do Well</div>
          <ul class="summary-list">${allStrengths.length ? [...new Set(allStrengths)].slice(0, 6).map(s => `<li>${fmt(s)}</li>`).join('') : '<li>Complete more sections to see strengths</li>'}</ul>
        </div>
        <div class="card summary-improvements">
          <div class="summary-card-title"><span class="icon">🎯</span> Areas to Focus On</div>
          <ul class="summary-list">${allImprovements.length ? [...new Set(allImprovements)].slice(0, 6).map(s => `<li>${fmt(s)}</li>`).join('') : '<li>Complete more sections to see focus areas</li>'}</ul>
        </div>
      </div>
    </div>`;

  document.getElementById('back-st').onclick = () => renderSubtopic(subtopicId);
}

// ── Topic Summary view ─────────────────────────────────────────────────
async function renderTopicSummary(topicId) {
  showLoading('Building topic summary…', '');

  const topic = await DB.get('topics', topicId);
  const subtopics = await DB.list('subtopics', 'topicId', topicId);

  const subtopicRows = await Promise.all(subtopics.map(async st => {
    const subs = await DB.list('submissions', 'subtopicId', st.id);
    const withFb = subs.filter(s => s.feedback);
    const avg = withFb.length ? Math.round(withFb.reduce((a, s) => a + (s.feedback.score || 0), 0) / withFb.length) : null;
    const done = new Set(withFb.map(s => s.difficulty)).size;
    return { ...st, avg, done };
  }));

  const completedRows = subtopicRows.filter(st => st.avg !== null);
  const overallAvg = completedRows.length
    ? Math.round(completedRows.reduce((a, s) => a + s.avg, 0) / completedRows.length) : 0;

  const allStrengths = [];
  const allImprovements = [];
  for (const st of subtopics) {
    const subs = await DB.list('submissions', 'subtopicId', st.id);
    subs.filter(s => s.feedback).forEach(s => {
      allStrengths.push(...(s.feedback.strengths || []));
      allImprovements.push(...(s.feedback.improvements || []));
    });
  }

  const rowsHtml = subtopicRows.map(st => {
    const scoreStr = st.avg !== null ? `${st.avg}%` : '—';
    const col = st.avg !== null ? scoreClass(st.avg) : '';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border);cursor:pointer" data-subtopic-id="${st.id}">
      <div>
        <div style="font-weight:600">${fmt(st.name)}</div>
        <div class="text-muted text-sm">${st.done}/3 sections completed</div>
      </div>
      <span style="font-weight:700;font-size:1.1rem" class="${col}">${scoreStr}</span>
    </div>`;
  }).join('');

  renderTopbar(`${topic.name} · Summary`);

  getView().innerHTML = `
    <div class="container">
      <button class="back-btn" id="back-t">← Back to ${fmt(topic.name)}</button>
      <div class="page-header">
        <div>
          <div class="page-title">Topic Summary</div>
          <div class="page-subtitle">${fmt(topic.name)}</div>
        </div>
      </div>

      <div class="card feedback-score" style="padding:24px">
        <div class="score-number ${scoreClass(overallAvg)}">${overallAvg}%</div>
        <div class="score-label">Overall Topic Average</div>
      </div>

      <div class="card mt-4">
        <div style="font-weight:700;margin-bottom:4px">Subtopic Breakdown</div>
        <div class="text-muted text-sm" style="margin-bottom:12px">Click a subtopic to review it</div>
        ${rowsHtml}
      </div>

      <div class="summary-grid mt-4">
        <div class="card summary-strengths">
          <div class="summary-card-title"><span class="icon">💪</span> Consistent Strengths</div>
          <ul class="summary-list">${allStrengths.length ? [...new Set(allStrengths)].slice(0, 6).map(s => `<li>${fmt(s)}</li>`).join('') : '<li>Complete more subtopics to see patterns</li>'}</ul>
        </div>
        <div class="card summary-improvements">
          <div class="summary-card-title"><span class="icon">🎯</span> Key Focus Areas</div>
          <ul class="summary-list">${allImprovements.length ? [...new Set(allImprovements)].slice(0, 6).map(s => `<li>${fmt(s)}</li>`).join('') : '<li>Complete more subtopics to see patterns</li>'}</ul>
        </div>
      </div>
    </div>`;

  document.getElementById('back-t').onclick = () => renderTopic(topicId);
  document.querySelectorAll('[data-subtopic-id]').forEach(el => {
    el.onclick = () => renderSubtopic(el.dataset.subtopicId);
  });
}

// ── Init ───────────────────────────────────────────────────────────────
async function init() {
  // Close modal on overlay click
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === getModal()) hideModal();
  });

  // Topbar API key / token change
  document.getElementById('change-key-btn').onclick = () => {
    const currentMode = localStorage.getItem('mm-auth-mode') || 'bedrock';
    const isCorporate = currentMode === 'bedrock';
    showModal(`
      <div class="modal-title">Change Authentication</div>
      <div id="modal-error"></div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="btn modal-mode-btn ${isCorporate ? 'btn-primary' : 'btn-ghost'}" id="mm-corp" data-mode="bedrock"
          style="flex:1;${isCorporate ? 'border:2px solid var(--primary)' : ''}">🏢 Salesforce Corporate</button>
        <button class="btn modal-mode-btn ${!isCorporate ? 'btn-primary' : 'btn-ghost'}" id="mm-direct" data-mode="direct"
          style="flex:1;${!isCorporate ? 'border:2px solid var(--primary)' : ''}">🔑 Anthropic Key</button>
      </div>
      <div id="m-corp-section" style="display:${isCorporate ? 'block' : 'none'}">
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label" style="font-size:0.82rem">Gateway URL</label>
          <input class="form-input" type="text" id="m-gw-url" placeholder="https://eng-ai-model-gateway..."
            value="${localStorage.getItem('mm-gateway-url') || ''}" autocomplete="off" />
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label class="form-label" style="font-size:0.82rem">Auth Token</label>
          <input class="form-input" type="password" id="m-gw-token" placeholder="sk-..."
            value="${localStorage.getItem('mm-gateway-token') || ''}" autocomplete="off" />
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label class="form-label" style="font-size:0.82rem">Custom Headers <span style="color:var(--muted);font-weight:400">(optional)</span></label>
          <input class="form-input" type="text" id="m-gw-custom" placeholder="x-client-name: claudecowork"
            value="${localStorage.getItem('mm-gateway-custom-headers') || ''}" autocomplete="off" />
        </div>
      </div>
      <div id="m-direct-section" style="display:${!isCorporate ? 'block' : 'none'}">
        <input class="form-input" type="password" id="m-direct-input" placeholder="sk-ant-..." />
      </div>

      <div style="border-top:1px solid var(--border);margin:20px 0 16px"></div>
      <div style="font-weight:700;margin-bottom:4px;font-size:0.9rem">☁️ Cloud Sync</div>
      <div style="font-size:0.82rem;color:var(--muted);margin-bottom:12px">
        Connect Supabase so topics and questions sync across all devices — phone, tablet, anywhere.
        <a href="https://supabase.com" target="_blank" style="color:var(--primary)">Create a free account →</a>
      </div>
      <div class="form-group" style="margin-bottom:10px">
        <label class="form-label" style="font-size:0.82rem">Project URL</label>
        <input class="form-input" type="text" id="m-sb-url" placeholder="https://xxxx.supabase.co"
          value="${localStorage.getItem('mm-supabase-url') || ''}" autocomplete="off" />
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label" style="font-size:0.82rem">Anon Key</label>
        <input class="form-input" type="password" id="m-sb-key" placeholder="eyJ..."
          value="${localStorage.getItem('mm-supabase-key') || ''}" autocomplete="off" />
      </div>

      <div class="modal-actions" style="margin-top:16px">
        <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-confirm">Save</button>
      </div>`);

    document.querySelectorAll('.modal-mode-btn').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('.modal-mode-btn').forEach(b => { b.className = 'btn modal-mode-btn btn-ghost'; b.style.border = ''; });
        btn.className = 'btn modal-mode-btn btn-primary';
        btn.style.border = '2px solid var(--primary)';
        const mode = btn.dataset.mode;
        document.getElementById('m-corp-section').style.display = mode === 'bedrock' ? 'block' : 'none';
        document.getElementById('m-direct-section').style.display = mode === 'direct' ? 'block' : 'none';
      };
    });

    document.getElementById('modal-cancel').onclick = hideModal;
    document.getElementById('modal-confirm').onclick = () => {
      const corpVisible = document.getElementById('m-corp-section').style.display !== 'none';

      // Save Supabase config (optional — both fields or neither)
      const sbUrl = document.getElementById('m-sb-url').value.trim();
      const sbKey = document.getElementById('m-sb-key').value.trim();
      if (sbUrl) localStorage.setItem('mm-supabase-url', sbUrl);
      else localStorage.removeItem('mm-supabase-url');
      if (sbKey) localStorage.setItem('mm-supabase-key', sbKey);
      else localStorage.removeItem('mm-supabase-key');

      if (corpVisible) {
        const gwUrl = document.getElementById('m-gw-url').value.trim();
        const gwToken = document.getElementById('m-gw-token').value.trim();
        const gwCustom = document.getElementById('m-gw-custom').value.trim();
        if (gwUrl) localStorage.setItem('mm-gateway-url', gwUrl); else localStorage.removeItem('mm-gateway-url');
        if (gwToken) localStorage.setItem('mm-gateway-token', gwToken); else localStorage.removeItem('mm-gateway-token');
        if (gwCustom) localStorage.setItem('mm-gateway-custom-headers', gwCustom); else localStorage.removeItem('mm-gateway-custom-headers');
        localStorage.setItem('mm-auth-mode', 'bedrock');
        setApiKey('proxy');
        hideModal();
        return;
      }
      const k = document.getElementById('m-direct-input').value.trim();
      if (!k) {
        document.getElementById('modal-error').innerHTML = '<div class="alert alert-error">Please enter your API key</div>';
        return;
      }
      if (!k.startsWith('sk-ant-')) {
        document.getElementById('modal-error').innerHTML = '<div class="alert alert-error">Anthropic keys start with sk-ant-</div>';
        return;
      }
      localStorage.setItem('mm-auth-mode', 'direct');
      setApiKey(k);
      hideModal();
    };
  };

  await DB.init();  // pull from server if IndexedDB is empty (new device on LAN)

  const key = getApiKey();
  if (!key) {
    renderSetup();
  } else {
    renderDashboard();
  }
}

document.addEventListener('DOMContentLoaded', init);
