const DB_NAME = 'maksim-maths-db';
const DB_VERSION = 1;

let _db = null;
let _syncTimer = null;
const LOCAL_SYNC_URL = `${window.location.origin}/api/sync`;
const STORES = ['topics', 'subtopics', 'questions', 'submissions'];

async function openDB() {
  if (_db) return _db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      if (!db.objectStoreNames.contains('topics')) {
        db.createObjectStore('topics', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('subtopics')) {
        const s = db.createObjectStore('subtopics', { keyPath: 'id' });
        s.createIndex('topicId', 'topicId');
      }

      if (!db.objectStoreNames.contains('questions')) {
        const s = db.createObjectStore('questions', { keyPath: 'id' });
        s.createIndex('subtopicId', 'subtopicId');
        s.createIndex('subtopicDifficulty', ['subtopicId', 'difficulty']);
      }

      if (!db.objectStoreNames.contains('submissions')) {
        const s = db.createObjectStore('submissions', { keyPath: 'id' });
        s.createIndex('subtopicId', 'subtopicId');
        s.createIndex('subtopicDifficulty', ['subtopicId', 'difficulty']);
      }
    };

    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

// ── Raw IndexedDB helpers ────────────────────────────────────────────────

async function _rawGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _rawPut(store, obj) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Supabase cloud sync ──────────────────────────────────────────────────

function _sbConfig() {
  return {
    url: (localStorage.getItem('mm-supabase-url') || '').replace(/\/$/, ''),
    key: localStorage.getItem('mm-supabase-key') || '',
  };
}

function _sbEnabled() {
  const c = _sbConfig();
  return !!(c.url && c.key);
}

async function _sbPush() {
  const { url, key } = _sbConfig();
  if (!url || !key) return;
  const data = { id: 'main' };
  for (const store of STORES) {
    const items = await _rawGetAll(store);
    data[store] = store === 'submissions'
      ? items.map(({ photoBlob, ...rest }) => rest)
      : items;
  }
  try {
    await fetch(`${url}/rest/v1/sync_data`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify(data),
    });
  } catch (_) {}
}

async function _sbPull() {
  const { url, key } = _sbConfig();
  if (!url || !key) return false;
  try {
    const res = await fetch(
      `${url}/rest/v1/sync_data?id=eq.main&select=topics,subtopics,questions,submissions`,
      { headers: { 'apikey': key, 'Authorization': `Bearer ${key}` } }
    );
    if (!res.ok) return false;
    const rows = await res.json();
    if (!rows || !rows.length) return false;
    const row = rows[0];
    for (const store of STORES) {
      for (const item of (row[store] || [])) {
        await _rawPut(store, item);
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

// ── Local server sync (fallback when no Supabase) ────────────────────────

async function _localPush() {
  try {
    const data = {};
    for (const store of STORES) {
      const items = await _rawGetAll(store);
      data[store] = store === 'submissions'
        ? items.map(({ photoBlob, ...rest }) => rest)
        : items;
    }
    await fetch(LOCAL_SYNC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (_) {}
}

async function _localPull() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(LOCAL_SYNC_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    if (!data || typeof data !== 'object') return false;
    for (const store of STORES) {
      for (const item of (data[store] || [])) {
        await _rawPut(store, item);
      }
    }
    return true;
  } catch (_) {
    clearTimeout(timer);
    return false;
  }
}

function _schedulePush() {
  clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => _sbEnabled() ? _sbPush() : _localPush(), 600);
}

// ── Init (called once on app startup) ───────────────────────────────────

async function _autoConfigSupabase() {
  if (_sbEnabled()) return;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    const { supabaseUrl, supabaseKey } = await res.json();
    if (supabaseUrl && supabaseKey) {
      localStorage.setItem('mm-supabase-url', supabaseUrl);
      localStorage.setItem('mm-supabase-key', supabaseKey);
    }
  } catch (_) {}
}

async function dbInit() {
  await openDB();
  await _autoConfigSupabase();
  if (_sbEnabled()) {
    // Always pull from Supabase on startup so cloud is source of truth.
    // Then push to sync any local-only data (e.g. submissions) back up.
    await _sbPull();
    _schedulePush();
  } else {
    const topics = await _rawGetAll('topics');
    if (topics.length === 0) {
      await _localPull();
    } else {
      _schedulePush();
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────

async function dbSave(store, obj) {
  const db = await openDB();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(obj);
    req.onsuccess = () => resolve(obj);
    req.onerror = () => reject(req.error);
  });
  _schedulePush();
  return result;
}

async function dbGet(store, id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbList(store, indexName, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const os = db.transaction(store, 'readonly').objectStore(store);
    const req = indexName ? os.index(indexName).getAll(value) : os.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbDel(store, id) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  _schedulePush();
}

async function dbForcePull() {
  for (const store of STORES) {
    const items = await _rawGetAll(store);
    for (const item of items) {
      const db = await openDB();
      await new Promise((resolve, reject) => {
        const req = db.transaction(store, 'readwrite').objectStore(store).delete(item.id);
        req.onsuccess = resolve;
        req.onerror = () => reject(req.error);
      });
    }
  }
  return _sbPull();
}

window.DB = { save: dbSave, get: dbGet, list: dbList, del: dbDel, init: dbInit, sbEnabled: _sbEnabled, forcePull: dbForcePull };
