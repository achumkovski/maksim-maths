export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Debug</title>
  <style>
    body { font-family: monospace; padding: 20px; font-size: 14px; background: #f5f5f5; }
    .ok { color: green; } .err { color: red; } .warn { color: orange; }
    pre { background: #fff; padding: 10px; border-radius: 6px; white-space: pre-wrap; word-break: break-all; }
    button { margin: 8px 4px; padding: 12px 18px; font-size: 15px; border-radius: 6px;
             border: none; background: #4f46e5; color: white; cursor: pointer; display: block; width: 100%; }
  </style>
</head>
<body>
<h2>Maksim Maths Debug</h2>
<div id="out"></div>
<button onclick="runDiag()">Run Diagnostics</button>
<button onclick="nukeAndSync()" style="background:#dc2626;margin-top:8px">Nuke DB + Force Sync</button>
<script>
function log(msg, cls) {
  var el = document.createElement('pre');
  if (cls) el.className = cls;
  el.textContent = msg;
  document.getElementById('out').appendChild(el);
}
function runDiag() {
  document.getElementById('out').innerHTML = '';
  var sbUrl = localStorage.getItem('mm-supabase-url') || '(not set)';
  var sbKey = localStorage.getItem('mm-supabase-key') || '(not set)';
  var codeV = localStorage.getItem('mm-code-v') || '(not set)';
  log('Code version: ' + codeV, codeV === '6' ? 'ok' : 'err');
  log('Supabase URL: ' + sbUrl, sbUrl !== '(not set)' ? 'ok' : 'err');
  log('Supabase Key: ' + (sbKey !== '(not set)' ? sbKey.slice(0,20)+'...' : '(not set)'), sbKey !== '(not set)' ? 'ok' : 'err');
  fetch('/api/config').then(function(r){return r.json();}).then(function(d){
    log('/api/config supabaseUrl: ' + (d.supabaseUrl||'(empty)'), d.supabaseUrl?'ok':'err');
    log('/api/config supabaseKey: ' + (d.supabaseKey?d.supabaseKey.slice(0,20)+'...':'(empty)'), d.supabaseKey?'ok':'err');
  }).catch(function(e){log('/api/config error: '+e,'err');});
  var req = indexedDB.open('maksim-maths-db');
  req.onsuccess = function(e) {
    var db = e.target.result;
    var stores = db.objectStoreNames;
    log('DB stores: ' + Array.from(stores).join(', '), 'ok');
    if (!stores.contains('questions')) { log('No questions store!', 'err'); return; }
    var tx = db.transaction('questions', 'readonly');
    tx.objectStore('questions').getAll().onsuccess = function(ev) {
      var qs = ev.target.result;
      var f = qs.filter(function(q){return q.difficulty==='foundational';}).length;
      var m = qs.filter(function(q){return q.difficulty==='medium';}).length;
      var a = qs.filter(function(q){return q.difficulty==='advanced';}).length;
      log('Questions in DB: ' + qs.length + ' (F:'+f+' M:'+m+' A:'+a+')', qs.length===156?'ok':'err');
    };
  };
  req.onerror = function(){log('IDB error: '+req.error,'err');};
  var url = (localStorage.getItem('mm-supabase-url')||'').replace(/\\/$/,'');
  var key = localStorage.getItem('mm-supabase-key')||'';
  if (url && key) {
    fetch(url+'/rest/v1/sync_data?id=eq.main&select=questions',{
      headers:{'apikey':key,'Authorization':'Bearer '+key}
    }).then(function(r){return r.json();}).then(function(rows){
      if(!rows||!rows.length){log('Supabase: no row found','err');return;}
      log('Supabase questions: '+(rows[0].questions||[]).length, (rows[0].questions||[]).length===156?'ok':'err');
    }).catch(function(e){log('Supabase error: '+e,'err');});
  } else { log('Supabase not in localStorage — skipping','warn'); }
}
function nukeAndSync() {
  document.getElementById('out').innerHTML = '';
  log('Deleting IndexedDB...');
  localStorage.removeItem('mm-supabase-url');
  localStorage.removeItem('mm-supabase-key');
  var req = indexedDB.deleteDatabase('maksim-maths-db');
  req.onsuccess = function(){log('Done. Redirecting...','ok');setTimeout(function(){window.location.replace('/');},1500);};
  req.onerror = function(){log('Error: '+req.error,'err');};
  req.onblocked = function(){log('Blocked — close other tabs','warn');};
}
</script>
</body>
</html>`);
}
