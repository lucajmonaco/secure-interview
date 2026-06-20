const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
const PORT = process.env.PORT || 8080;

const db = new Database(path.join(__dirname, 'proctor.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL,
    name TEXT NOT NULL, org TEXT NOT NULL, role TEXT DEFAULT 'interviewer',
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, org TEXT NOT NULL,
    owner_id TEXT NOT NULL, invite_code TEXT UNIQUE NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'member',
    PRIMARY KEY (team_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    candidate_name TEXT, interviewer_id TEXT NOT NULL, team_id TEXT,
    status TEXT DEFAULT 'waiting', trust_score INTEGER DEFAULT 100,
    flags TEXT DEFAULT '[]', questions TEXT DEFAULT '[]',
    display_count INTEGER DEFAULT 1, recording_url TEXT,
    started_at INTEGER, ended_at INTEGER,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS flags (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, time_offset TEXT NOT NULL,
    text TEXT NOT NULL, detail TEXT, severity TEXT NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS recordings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    interviewer_id TEXT NOT NULL,
    session_title TEXT NOT NULL,
    candidate_name TEXT,
    file_path TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    duration_secs INTEGER DEFAULT 0,
    trust_score INTEGER DEFAULT 100,
    flag_count INTEGER DEFAULT 0,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// Recordings storage directory
const RECORDINGS_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

// Multer for video uploads
const storage = multer.diskStorage({
  destination: function(req, file, cb) { cb(null, RECORDINGS_DIR); },
  filename: function(req, file, cb) { cb(null, uuidv4() + '.webm'); }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } }); // 500MB limit

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'secure-interview-secret-' + Math.random().toString(36),
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    if (i === 3) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ── AUTH ──
app.post('/api/auth/signup', async (req, res) => {
  const { email, password, name, org } = req.body;
  if (!email || !password || !name || !org) return res.json({ error: 'All fields required' });
  if (password.length < 6) return res.json({ error: 'Password must be at least 6 characters' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const id = uuidv4();
    db.prepare('INSERT INTO users (id,email,password,name,org) VALUES (?,?,?,?,?)').run(id, email.toLowerCase(), hashed, name, org);
    req.session.userId = id; req.session.userName = name; req.session.userOrg = org;
    res.json({ ok: true, name, org });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.json({ error: 'Email already registered' });
    res.json({ error: 'Signup failed: ' + e.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email=?').get((email||'').toLowerCase());
  if (!user) return res.json({ error: 'No account found with that email' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ error: 'Incorrect password' });
  req.session.userId = user.id; req.session.userName = user.name; req.session.userOrg = user.org;
  res.json({ ok: true, name: user.name, org: user.org });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = db.prepare('SELECT id,email,name,org,role FROM users WHERE id=?').get(req.session.userId);
  res.json({ loggedIn: true, ...user });
});

// ── SESSIONS ──
app.post('/api/sessions', requireAuth, (req, res) => {
  const { title, candidateName, teamId, questions } = req.body;
  const id = uuidv4();
  let code;
  do { code = generateCode(); } while (db.prepare('SELECT id FROM sessions WHERE code=?').get(code));
  db.prepare('INSERT INTO sessions (id,code,title,candidate_name,interviewer_id,team_id,questions,started_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, code, title || 'Interview Session', candidateName || 'Candidate', req.session.userId, teamId || null, JSON.stringify(questions || []), Math.floor(Date.now() / 1000));
  res.json({ ok: true, id, code });
});

app.get('/api/sessions', requireAuth, (req, res) => {
  const sessions = db.prepare('SELECT s.*, u.name as interviewer_name FROM sessions s JOIN users u ON s.interviewer_id=u.id WHERE s.interviewer_id=? OR s.team_id IN (SELECT team_id FROM team_members WHERE user_id=?) ORDER BY s.created_at DESC LIMIT 50')
    .all(req.session.userId, req.session.userId);
  res.json(sessions.map(s => ({ ...s, flags: JSON.parse(s.flags || '[]'), questions: JSON.parse(s.questions || '[]') })));
});

app.get('/api/sessions/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(req.params.id);
  if (!s) return res.json({ error: 'Session not found' });
  const flags = db.prepare('SELECT * FROM flags WHERE session_id=? ORDER BY created_at').all(req.params.id);
  res.json({ ...s, flags, questions: JSON.parse(s.questions || '[]') });
});

app.get('/api/join/:code', (req, res) => {
  const s = db.prepare('SELECT id,code,title,candidate_name,status,questions FROM sessions WHERE code=?').get(req.params.code.toUpperCase());
  if (!s) return res.json({ error: 'Session not found' });
  if (s.status === 'ended') return res.json({ error: 'This session has already ended' });
  res.json({ ok: true, ...s, questions: JSON.parse(s.questions || '[]') });
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const { status, trustScore, displayCount, candidateName } = req.body;
  const s = db.prepare('SELECT * FROM sessions WHERE id=? AND interviewer_id=?').get(req.params.id, req.session.userId);
  if (!s) return res.json({ error: 'Not found' });
  if (status) db.prepare('UPDATE sessions SET status=? WHERE id=?').run(status, req.params.id);
  if (trustScore !== undefined) db.prepare('UPDATE sessions SET trust_score=? WHERE id=?').run(trustScore, req.params.id);
  if (displayCount !== undefined) db.prepare('UPDATE sessions SET display_count=? WHERE id=?').run(displayCount, req.params.id);
  if (candidateName) db.prepare('UPDATE sessions SET candidate_name=? WHERE id=?').run(candidateName, req.params.id);
  if (status === 'ended') db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(Math.floor(Date.now() / 1000), req.params.id);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/flags', (req, res) => {
  const { text, detail, severity, timeOffset } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO flags (id,session_id,time_offset,text,detail,severity) VALUES (?,?,?,?,?,?)').run(id, req.params.id, timeOffset || '00:00', text, detail || '', severity || 'medium');
  res.json({ ok: true, id });
});

// ── RECORDINGS ──
// Upload a recording after session ends
app.post('/api/recordings/upload', requireAuth, upload.single('recording'), async (req, res) => {
  try {
    const { sessionId, durationSecs } = req.body;
    if (!req.file) return res.json({ error: 'No file uploaded' });

    const sess = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    if (!sess) return res.json({ error: 'Session not found' });

    const flags = db.prepare('SELECT COUNT(*) as cnt FROM flags WHERE session_id=?').get(sessionId);
    const id = uuidv4();

    db.prepare('INSERT INTO recordings (id,session_id,interviewer_id,session_title,candidate_name,file_path,file_size,duration_secs,trust_score,flag_count) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, sessionId, req.session.userId, sess.title, sess.candidate_name, req.file.path, req.file.size, parseInt(durationSecs) || 0, sess.trust_score || 100, flags.cnt || 0);

    res.json({ ok: true, id });
  } catch(e) {
    res.json({ error: e.message });
  }
});

// List recordings for current user
app.get('/api/recordings', requireAuth, (req, res) => {
  const recs = db.prepare('SELECT * FROM recordings WHERE interviewer_id=? ORDER BY created_at DESC').all(req.session.userId);
  res.json(recs);
});

// Stream a recording file
app.get('/api/recordings/:id/stream', requireAuth, (req, res) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id=? AND interviewer_id=?').get(req.params.id, req.session.userId);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  if (!fs.existsSync(rec.file_path)) return res.status(404).json({ error: 'File not found' });

  const stat = fs.statSync(rec.file_path);
  const total = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(rec.file_path, { start, end });
    res.writeHead(206, {
      'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/webm'
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': total, 'Content-Type': 'video/webm' });
    fs.createReadStream(rec.file_path).pipe(res);
  }
});

// Delete a recording
app.delete('/api/recordings/:id', requireAuth, (req, res) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id=? AND interviewer_id=?').get(req.params.id, req.session.userId);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  try { if (fs.existsSync(rec.file_path)) fs.unlinkSync(rec.file_path); } catch(e) {}
  db.prepare('DELETE FROM recordings WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// ── TEAMS ──
app.post('/api/teams', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ error: 'Team name required' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  const id = uuidv4();
  let code;
  do { code = uuidv4().slice(0, 8).toUpperCase(); } while (db.prepare('SELECT id FROM teams WHERE invite_code=?').get(code));
  db.prepare('INSERT INTO teams (id,name,org,owner_id,invite_code) VALUES (?,?,?,?,?)').run(id, name, user.org, req.session.userId, code);
  db.prepare('INSERT INTO team_members (team_id,user_id,role) VALUES (?,?,?)').run(id, req.session.userId, 'owner');
  res.json({ ok: true, id, inviteCode: code });
});

app.get('/api/teams', requireAuth, (req, res) => {
  const teams = db.prepare('SELECT t.* FROM teams t JOIN team_members tm ON t.id=tm.team_id WHERE tm.user_id=?').all(req.session.userId);
  res.json(teams.map(t => ({ ...t, members: db.prepare('SELECT u.id,u.name,u.email,tm.role FROM team_members tm JOIN users u ON tm.user_id=u.id WHERE tm.team_id=?').all(t.id) })));
});

app.post('/api/teams/join', requireAuth, (req, res) => {
  const { inviteCode } = req.body;
  const team = db.prepare('SELECT * FROM teams WHERE invite_code=?').get(inviteCode);
  if (!team) return res.json({ error: 'Invalid invite code' });
  if (db.prepare('SELECT * FROM team_members WHERE team_id=? AND user_id=?').get(team.id, req.session.userId)) return res.json({ error: 'Already a member' });
  db.prepare('INSERT INTO team_members (team_id,user_id) VALUES (?,?)').run(team.id, req.session.userId);
  res.json({ ok: true, teamName: team.name });
});

// ── PAGE ROUTES ──
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html')));
app.get('/session/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'session.html')));
app.get('/join/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'candidate.html')));
app.get('/recordings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'recordings.html')));
app.get('/recordings/share/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'recordings.html')));

// ── SOCKET.IO ──
const rooms = {};
io.on('connection', (socket) => {
  socket.on('join-room', ({ sessionId, role }) => {
    socket.join(sessionId);
    if (!rooms[sessionId]) rooms[sessionId] = {};
    rooms[sessionId][role] = socket.id;
    socket.data.sessionId = sessionId; socket.data.role = role;
    socket.to(sessionId).emit('peer-joined', { role });
    const others = Object.entries(rooms[sessionId]).filter(([r]) => r !== role);
    if (others.length) socket.emit('peer-already-present', { role: others[0][0] });
  });
  socket.on('webrtc-offer', ({ sessionId, offer }) => socket.to(sessionId).emit('webrtc-offer', { offer }));
  socket.on('webrtc-answer', ({ sessionId, answer }) => socket.to(sessionId).emit('webrtc-answer', { answer }));
  socket.on('webrtc-ice', ({ sessionId, candidate }) => socket.to(sessionId).emit('webrtc-ice', { candidate }));
  socket.on('next-question', ({ sessionId, qIdx }) => socket.to(sessionId).emit('next-question', { qIdx }));
  socket.on('candidate-flag', ({ sessionId, flag }) => {
    socket.to(sessionId).emit('candidate-flag', flag);
    try {
      const id = uuidv4();
      db.prepare('INSERT INTO flags (id,session_id,time_offset,text,detail,severity) VALUES (?,?,?,?,?,?)').run(id, sessionId, flag.time || '00:00', flag.text, flag.detail || '', flag.severity || 'medium');
      const penalty = { high: 12, medium: 6, low: 2 }[flag.severity] || 5;
      db.prepare('UPDATE sessions SET trust_score = MAX(0, trust_score - ?) WHERE id=?').run(penalty, sessionId);
    } catch (e) {}
  });
  socket.on('disconnect', () => {
    const { sessionId, role } = socket.data;
    if (sessionId && rooms[sessionId]) { delete rooms[sessionId][role]; socket.to(sessionId).emit('peer-left', { role }); }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Secure Interview running on port ' + PORT);
});
