const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Storage Setup ────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data.json');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ messages: [], files: [] }));

// ─── Multer Config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { messages: [], files: [] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET / — Dashboard
app.get('/', (req, res) => {
  const data = readData();
  res.send(renderDashboard(data));
});

// GET /message/:text — Accept a message via URL path
app.get('/message/:text', (req, res) => {
  const text = decodeURIComponent(req.params.text);
  if (!text || !text.trim()) {
    return res.status(400).json({
      success: false,
      error: 'Please provide a message in the URL. Example: /message/Hello',
    });
  }

  const data = readData();
  const entry = {
    id: uuidv4(),
    text: text.trim(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    timestamp: new Date().toISOString(),
  };
  data.messages.unshift(entry);
  writeData(data);

  res.json({
    success: true,
    message: 'Message received!',
    data: entry,
  });
});

// GET /upload — File upload form page
app.get('/upload', (req, res) => {
  res.send(renderUploadPage());
});

// POST /upload — Handle file upload
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded. Please attach a file.' });
  }

  const data = readData();
  const entry = {
    id: uuidv4(),
    originalName: req.file.originalname,
    storedName: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype,
    note: req.body.note ? req.body.note.trim() : '',
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown',
    timestamp: new Date().toISOString(),
  };
  data.files.unshift(entry);
  writeData(data);

  res.json({
    success: true,
    message: 'File uploaded successfully!',
    data: {
      ...entry,
      downloadUrl: `/download/${entry.storedName}`,
    },
  });
});

// GET /download/:filename — Serve a file for download
app.get('/download/:filename', (req, res) => {
  const filePath = path.join(UPLOADS_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: 'File not found.' });
  }

  // Find original name
  const data = readData();
  const entry = data.files.find((f) => f.storedName === req.params.filename);
  const downloadName = entry ? entry.originalName : req.params.filename;

  res.download(filePath, downloadName);
});

// GET /api/data — Raw JSON data
app.get('/api/data', (req, res) => {
  res.json(readData());
});

// ─── HTML Templates ──────────────────────────────────────────────────────────

function renderDashboard(data) {
  const messagesHTML = data.messages.length === 0
    ? `<div class="empty-state"><span class="empty-icon">📭</span><p>No messages yet</p><small>Send one via <code>GET /message/your message here</code></small></div>`
    : data.messages.map(m => `
      <div class="card message-card">
        <div class="card-header">
          <span class="badge badge-msg">📨 Message</span>
          <span class="time">${formatDate(m.timestamp)}</span>
        </div>
        <p class="message-text">${escapeHtml(m.text)}</p>
        <div class="card-footer">
          <span class="meta">🌐 ${escapeHtml(m.ip)}</span>
          <span class="meta">🆔 ${m.id.slice(0, 8)}...</span>
        </div>
      </div>`).join('');

  const filesHTML = data.files.length === 0
    ? `<div class="empty-state"><span class="empty-icon">📂</span><p>No files yet</p><small>Upload one via the <a href="/upload">Upload Page</a></small></div>`
    : data.files.map(f => `
      <div class="card file-card">
        <div class="card-header">
          <span class="badge badge-file">📎 File</span>
          <span class="time">${formatDate(f.timestamp)}</span>
        </div>
        <div class="file-info">
          <span class="file-name">📄 ${escapeHtml(f.originalName)}</span>
          <span class="file-meta">${escapeHtml(f.mimetype)} · ${formatBytes(f.size)}</span>
        </div>
        ${f.note ? `<p class="file-note">💬 ${escapeHtml(f.note)}</p>` : ''}
        <div class="card-footer">
          <span class="meta">🌐 ${escapeHtml(f.ip)}</span>
          <a href="/download/${encodeURIComponent(f.storedName)}" class="btn-download">⬇ Download</a>
        </div>
      </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Inbox Dashboard</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0a0f;
      --surface: #12121a;
      --surface2: #1a1a26;
      --border: rgba(255,255,255,0.08);
      --accent: #7c3aed;
      --accent2: #06b6d4;
      --green: #10b981;
      --text: #f1f5f9;
      --muted: #64748b;
      --radius: 14px;
    }

    body {
      font-family: 'Inter', sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
    }

    /* ── Nav ── */
    .nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 1rem 2rem;
      background: rgba(18,18,26,0.8);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      position: sticky; top: 0; z-index: 100;
    }
    .nav-brand { font-size: 1.2rem; font-weight: 700; background: linear-gradient(135deg, #7c3aed, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .nav-links { display: flex; gap: 1rem; }
    .nav-links a {
      color: var(--muted); text-decoration: none; font-size: 0.875rem; font-weight: 500;
      padding: 0.4rem 0.9rem; border-radius: 8px; transition: all 0.2s;
    }
    .nav-links a:hover { color: var(--text); background: var(--surface2); }
    .nav-links a.active { color: var(--text); background: var(--surface2); }

    /* ── Hero ── */
    .hero {
      text-align: center;
      padding: 4rem 2rem 2rem;
    }
    .hero h1 {
      font-size: clamp(2rem, 5vw, 3.5rem);
      font-weight: 700;
      background: linear-gradient(135deg, #fff 30%, #7c3aed, #06b6d4);
      -webkit-background-clip: text; -webkit-text-fill-color: transparent;
      margin-bottom: 0.75rem;
    }
    .hero p { color: var(--muted); font-size: 1.1rem; max-width: 500px; margin: 0 auto 2rem; }
    .stats { display: flex; gap: 1.5rem; justify-content: center; flex-wrap: wrap; }
    .stat {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1rem 1.75rem;
      text-align: center;
    }
    .stat-num { font-size: 2rem; font-weight: 700; color: var(--accent); }
    .stat-label { color: var(--muted); font-size: 0.8rem; margin-top: 0.25rem; }

    /* ── Endpoints ── */
    .endpoints {
      max-width: 900px; margin: 2rem auto; padding: 0 1.5rem;
      display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem;
    }
    .endpoint-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1.25rem 1.5rem;
      transition: border-color 0.2s, transform 0.2s;
    }
    .endpoint-card:hover { border-color: var(--accent); transform: translateY(-2px); }
    .method { font-size: 0.7rem; font-weight: 700; letter-spacing: 1px; padding: 0.25rem 0.6rem; border-radius: 6px; display: inline-block; margin-bottom: 0.5rem; }
    .method.get { background: rgba(16,185,129,0.15); color: var(--green); }
    .method.post { background: rgba(124,58,237,0.15); color: #a78bfa; }
    .endpoint-path { font-family: monospace; font-size: 0.95rem; color: var(--text); margin-bottom: 0.4rem; }
    .endpoint-desc { color: var(--muted); font-size: 0.82rem; line-height: 1.5; }

    /* ── Main Grid ── */
    .main { max-width: 900px; margin: 0 auto; padding: 0 1.5rem 4rem; }
    .section-title {
      font-size: 1.1rem; font-weight: 600; color: var(--muted);
      letter-spacing: 0.05em; text-transform: uppercase;
      margin: 2rem 0 1rem;
      display: flex; align-items: center; gap: 0.5rem;
    }
    .section-title::after { content: ''; flex: 1; height: 1px; background: var(--border); }
    .count-badge { background: var(--accent); color: white; font-size: 0.7rem; padding: 0.2rem 0.5rem; border-radius: 999px; font-weight: 600; }

    /* ── Cards ── */
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 1.25rem 1.5rem;
      margin-bottom: 0.75rem;
      transition: border-color 0.2s, box-shadow 0.2s;
      animation: fadeIn 0.3s ease;
    }
    @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
    .card:hover { border-color: rgba(124,58,237,0.4); box-shadow: 0 0 20px rgba(124,58,237,0.1); }
    .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
    .badge { font-size: 0.75rem; font-weight: 600; padding: 0.3rem 0.75rem; border-radius: 999px; }
    .badge-msg { background: rgba(6,182,212,0.15); color: var(--accent2); }
    .badge-file { background: rgba(124,58,237,0.15); color: #a78bfa; }
    .time { color: var(--muted); font-size: 0.8rem; }
    .message-text { font-size: 1rem; color: var(--text); line-height: 1.6; word-break: break-word; margin-bottom: 0.75rem; }
    .card-footer { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; }
    .meta { color: var(--muted); font-size: 0.78rem; }
    .file-info { margin-bottom: 0.5rem; }
    .file-name { display: block; font-weight: 500; font-size: 0.95rem; margin-bottom: 0.25rem; }
    .file-meta { color: var(--muted); font-size: 0.8rem; }
    .file-note { color: #94a3b8; font-size: 0.875rem; font-style: italic; margin: 0.5rem 0; }
    .btn-download {
      background: linear-gradient(135deg, var(--accent), #5b21b6);
      color: white; text-decoration: none; font-size: 0.8rem; font-weight: 600;
      padding: 0.4rem 1rem; border-radius: 8px;
      transition: opacity 0.2s, transform 0.2s;
      display: inline-block;
    }
    .btn-download:hover { opacity: 0.85; transform: scale(1.03); }

    /* ── Empty State ── */
    .empty-state { text-align: center; padding: 3rem 1rem; color: var(--muted); }
    .empty-icon { font-size: 3rem; display: block; margin-bottom: 0.75rem; }
    .empty-state p { font-size: 1rem; margin-bottom: 0.35rem; color: #475569; }
    .empty-state small { font-size: 0.8rem; }
    .empty-state code { background: var(--surface2); padding: 0.15rem 0.4rem; border-radius: 4px; font-family: monospace; }
    .empty-state a { color: var(--accent2); text-decoration: none; }
  </style>
</head>
<body>

<nav class="nav">
  <span class="nav-brand">📬 Inbox</span>
  <div class="nav-links">
    <a href="/" class="active">Dashboard</a>
    <a href="/upload">Upload File</a>
    <a href="/api/data">Raw JSON</a>
  </div>
</nav>

<section class="hero">
  <h1>Inbox Dashboard</h1>
  <p>Receive messages and files from anyone. View, manage, and download everything here.</p>
  <div class="stats">
    <div class="stat">
      <div class="stat-num">${data.messages.length}</div>
      <div class="stat-label">Messages</div>
    </div>
    <div class="stat">
      <div class="stat-num">${data.files.length}</div>
      <div class="stat-label">Files</div>
    </div>
  </div>
</section>

<div class="endpoints">
  <div class="endpoint-card">
    <span class="method get">GET</span>
    <div class="endpoint-path">/message/your message</div>
    <div class="endpoint-desc">Send a message by putting your text directly in the URL path.</div>
  </div>
  <div class="endpoint-card">
    <span class="method get">GET</span>
    <div class="endpoint-path">/upload</div>
    <div class="endpoint-desc">Visit the upload page to pick and send a file (up to 50 MB).</div>
  </div>
  <div class="endpoint-card">
    <span class="method post">POST</span>
    <div class="endpoint-path">/upload</div>
    <div class="endpoint-desc">Programmatically upload a file with multipart/form-data. Field: <code>file</code>.</div>
  </div>
  <div class="endpoint-card">
    <span class="method get">GET</span>
    <div class="endpoint-path">/download/:filename</div>
    <div class="endpoint-desc">Download any uploaded file by its stored filename.</div>
  </div>
</div>

<main class="main">
  <div class="section-title">Messages <span class="count-badge">${data.messages.length}</span></div>
  ${messagesHTML}

  <div class="section-title">Files <span class="count-badge">${data.files.length}</span></div>
  ${filesHTML}
</main>

</body>
</html>`;
}

// ─── Upload Page ──────────────────────────────────────────────────────────────
function renderUploadPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Upload File — Inbox</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f; --surface: #12121a; --surface2: #1a1a26;
      --border: rgba(255,255,255,0.08); --accent: #7c3aed; --accent2: #06b6d4;
      --green: #10b981; --text: #f1f5f9; --muted: #64748b; --radius: 14px;
    }
    body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    .nav { display:flex; align-items:center; justify-content:space-between; padding:1rem 2rem; background:rgba(18,18,26,0.8); backdrop-filter:blur(12px); border-bottom:1px solid var(--border); position:sticky; top:0; z-index:100; }
    .nav-brand { font-size:1.2rem; font-weight:700; background:linear-gradient(135deg,#7c3aed,#06b6d4); -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
    .nav-links { display:flex; gap:1rem; }
    .nav-links a { color:var(--muted); text-decoration:none; font-size:0.875rem; font-weight:500; padding:0.4rem 0.9rem; border-radius:8px; transition:all 0.2s; }
    .nav-links a:hover, .nav-links a.active { color:var(--text); background:var(--surface2); }

    .wrapper { max-width: 520px; margin: 5rem auto; padding: 0 1.5rem; }
    h1 { font-size: 2rem; font-weight: 700; background: linear-gradient(135deg, #fff 30%, #7c3aed, #06b6d4); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 0.5rem; }
    .subtitle { color: var(--muted); margin-bottom: 2.5rem; }

    .upload-box {
      background: var(--surface); border: 2px dashed var(--border);
      border-radius: var(--radius); padding: 2.5rem;
      transition: border-color 0.2s, background 0.2s;
      cursor: pointer; text-align: center;
    }
    .upload-box.dragover { border-color: var(--accent); background: rgba(124,58,237,0.05); }
    .upload-icon { font-size: 3rem; margin-bottom: 1rem; display: block; }
    .upload-box p { color: var(--muted); font-size: 0.9rem; }
    .upload-box strong { color: var(--text); }
    #file-input { display: none; }

    .selected-file {
      display: none; background: var(--surface2); border: 1px solid var(--border);
      border-radius: 10px; padding: 0.9rem 1.2rem; margin-top: 1rem;
      display: flex; align-items: center; gap: 0.75rem;
    }
    .selected-file .fname { font-size: 0.9rem; font-weight: 500; flex: 1; }
    .selected-file .fsize { color: var(--muted); font-size: 0.8rem; }
    .remove-file { background: none; border: none; cursor: pointer; color: var(--muted); font-size: 1.1rem; padding: 0.2rem; transition: color 0.2s; }
    .remove-file:hover { color: #ef4444; }

    .form-group { margin-top: 1.25rem; }
    label { display: block; font-size: 0.85rem; font-weight: 500; color: var(--muted); margin-bottom: 0.5rem; }
    textarea {
      width: 100%; background: var(--surface); border: 1px solid var(--border);
      border-radius: 10px; color: var(--text); font-family: inherit; font-size: 0.9rem;
      padding: 0.85rem 1rem; resize: vertical; min-height: 80px;
      transition: border-color 0.2s;
    }
    textarea:focus { outline: none; border-color: var(--accent); }
    textarea::placeholder { color: var(--muted); }

    .btn-submit {
      width: 100%; margin-top: 1.5rem; padding: 0.9rem;
      background: linear-gradient(135deg, var(--accent), #5b21b6);
      color: white; border: none; border-radius: 10px;
      font-family: inherit; font-size: 1rem; font-weight: 600;
      cursor: pointer; transition: opacity 0.2s, transform 0.15s;
    }
    .btn-submit:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
    .btn-submit:disabled { opacity: 0.5; cursor: not-allowed; }

    .progress-wrap { display: none; margin-top: 1rem; }
    .progress-bar-bg { background: var(--surface2); border-radius: 999px; height: 6px; overflow: hidden; }
    .progress-bar { background: linear-gradient(90deg, var(--accent), var(--accent2)); height: 100%; width: 0%; border-radius: 999px; transition: width 0.3s; }
    .progress-label { color: var(--muted); font-size: 0.8rem; margin-top: 0.4rem; }

    .result {
      display: none; margin-top: 1.25rem; padding: 1rem 1.25rem;
      border-radius: 10px; font-size: 0.9rem; animation: fadeIn 0.3s ease;
    }
    .result.success { background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); color: var(--green); }
    .result.error { background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); color: #f87171; }
    .result a { color: var(--accent2); text-decoration: none; font-weight: 600; }
    .result a:hover { text-decoration: underline; }
    @keyframes fadeIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }

    .back-link { display: block; text-align: center; margin-top: 1.5rem; color: var(--muted); text-decoration: none; font-size: 0.85rem; transition: color 0.2s; }
    .back-link:hover { color: var(--text); }
  </style>
</head>
<body>

<nav class="nav">
  <span class="nav-brand">📬 Inbox</span>
  <div class="nav-links">
    <a href="/">Dashboard</a>
    <a href="/upload" class="active">Upload File</a>
    <a href="/api/data">Raw JSON</a>
  </div>
</nav>

<div class="wrapper">
  <h1>Upload a File</h1>
  <p class="subtitle">Drop a file below (up to 50 MB) and optionally leave a note.</p>

  <div class="upload-box" id="drop-zone" onclick="document.getElementById('file-input').click()">
    <span class="upload-icon">📂</span>
    <p><strong>Click to choose</strong> or drag & drop a file here</p>
    <p style="margin-top:0.4rem; font-size:0.78rem;">Up to 50 MB · Any file type</p>
    <input type="file" id="file-input" name="file" />
  </div>

  <div class="selected-file" id="selected-file-info" style="display:none">
    <span>📄</span>
    <span class="fname" id="fname-label"></span>
    <span class="fsize" id="fsize-label"></span>
    <button class="remove-file" id="remove-file" title="Remove">✕</button>
  </div>

  <div class="form-group">
    <label for="note-input">Note (optional)</label>
    <textarea id="note-input" placeholder="Add a short message about this file..."></textarea>
  </div>

  <button class="btn-submit" id="submit-btn" disabled>Upload File</button>

  <div class="progress-wrap" id="progress-wrap">
    <div class="progress-bar-bg"><div class="progress-bar" id="progress-bar"></div></div>
    <div class="progress-label" id="progress-label">Uploading...</div>
  </div>

  <div class="result" id="result-box"></div>
  <a href="/" class="back-link">← Back to Dashboard</a>
</div>

<script>
  const fileInput = document.getElementById('file-input');
  const dropZone  = document.getElementById('drop-zone');
  const fileInfo  = document.getElementById('selected-file-info');
  const fnameLabel = document.getElementById('fname-label');
  const fsizeLabel = document.getElementById('fsize-label');
  const removeBtn = document.getElementById('remove-file');
  const submitBtn = document.getElementById('submit-btn');
  const noteInput = document.getElementById('note-input');
  const progressWrap = document.getElementById('progress-wrap');
  const progressBar  = document.getElementById('progress-bar');
  const progressLabel = document.getElementById('progress-label');
  const resultBox = document.getElementById('result-box');

  let selectedFile = null;

  function formatBytes(b) {
    if (b === 0) return '0 B';
    const k = 1024, s = ['B','KB','MB','GB'], i = Math.floor(Math.log(b)/Math.log(k));
    return (b/Math.pow(k,i)).toFixed(2)+' '+s[i];
  }

  function setFile(file) {
    selectedFile = file;
    fnameLabel.textContent = file.name;
    fsizeLabel.textContent = formatBytes(file.size);
    fileInfo.style.display = 'flex';
    submitBtn.disabled = false;
  }

  function clearFile() {
    selectedFile = null;
    fileInput.value = '';
    fileInfo.style.display = 'none';
    submitBtn.disabled = true;
  }

  fileInput.addEventListener('change', () => { if (fileInput.files[0]) setFile(fileInput.files[0]); });
  removeBtn.addEventListener('click', (e) => { e.stopPropagation(); clearFile(); });

  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); dropZone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) { setFile(file); fileInput.files = e.dataTransfer.files; }
  });

  submitBtn.addEventListener('click', () => {
    if (!selectedFile) return;
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('note', noteInput.value);

    submitBtn.disabled = true;
    progressWrap.style.display = 'block';
    progressBar.style.width = '0%';
    resultBox.style.display = 'none';

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        progressBar.style.width = pct + '%';
        progressLabel.textContent = 'Uploading... ' + pct + '%';
      }
    });
    xhr.addEventListener('load', () => {
      progressWrap.style.display = 'none';
      submitBtn.disabled = false;
      try {
        const res = JSON.parse(xhr.responseText);
        resultBox.style.display = 'block';
        if (res.success) {
          resultBox.className = 'result success';
          resultBox.innerHTML = '✅ <strong>' + res.data.originalName + '</strong> uploaded! <a href="' + res.data.downloadUrl + '">Download it</a> · <a href="/">View Dashboard →</a>';
          clearFile();
          noteInput.value = '';
        } else {
          resultBox.className = 'result error';
          resultBox.textContent = '❌ ' + (res.error || 'Upload failed');
        }
      } catch {
        resultBox.className = 'result error';
        resultBox.textContent = '❌ Unexpected server error.';
      }
    });
    xhr.addEventListener('error', () => {
      progressWrap.style.display = 'none';
      submitBtn.disabled = false;
      resultBox.style.display = 'block';
      resultBox.className = 'result error';
      resultBox.textContent = '❌ Network error. Please try again.';
    });
    xhr.open('POST', '/upload');
    xhr.send(formData);
  });
</script>
</body>
</html>`;
}

// ─── Escape HTML ──────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
  console.log(`   Dashboard:  http://localhost:${PORT}/`);
  console.log(`   Send msg:   http://localhost:${PORT}/message/Hello`);
  console.log(`   Upload:     http://localhost:${PORT}/upload`);
});
