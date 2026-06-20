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
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    org_id TEXT NOT NULL,
    role TEXT DEFAULT 'interviewer',
    created_at INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(email, org_id)
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, org_id TEXT NOT NULL,
    owner_id TEXT NOT NULL, invite_code TEXT UNIQUE NOT NULL,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
  CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'member',
    PRIMARY KEY (team_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
    candidate_name TEXT, interviewer_id TEXT NOT NULL, org_id TEXT,
    status TEXT DEFAULT 'waiting', trust_score INTEGER DEFAULT 100,
    flags TEXT DEFAULT '[]', questions TEXT DEFAULT '[]',
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
    org_id TEXT,
    session_title TEXT NOT NULL,
    candidate_name TEXT,
    file_path TEXT NOT NULL,
    file_size INTEGER DEFAULT 0,
    duration_secs INTEGER DEFAULT 0,
    trust_score INTEGER DEFAULT 100,
    flag_count INTEGER DEFAULT 0,
    share_token TEXT UNIQUE,
    created_at INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// Migrate: add org_id to existing tables if missing
try { db.prepare('ALTER TABLE sessions ADD COLUMN org_id TEXT').run(); } catch(e){}
try { db.prepare('ALTER TABLE recordings ADD COLUMN org_id TEXT').run(); } catch(e){}
try { db.prepare('ALTER TABLE recordings ADD COLUMN share_token TEXT').run(); } catch(e){}
// Migrate users: add org_id column if missing (old schema had 'org' text column)
try { db.prepare('ALTER TABLE users ADD COLUMN org_id TEXT').run(); } catch(e){}

const RECORDINGS_DIR = path.join(__dirname, 'recordings');
if (!fs.existsSync(RECORDINGS_DIR)) fs.mkdirSync(RECORDINGS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, RECORDINGS_DIR),
  filename: (req, file, cb) => cb(null, uuidv4() + '.webm')
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'secure-interview-secret-key-2026',
  resave: false, saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

function generateCode(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function generateSessionCode() {
  return generateCode(3) + '-' + generateCode(3);
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ ORG AUTH ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
// Create a new organization (company signup)
app.post('/api/auth/org/create', async (req, res) => {
  const { orgName, email, password, name } = req.body;
  if (!orgName || !email || !password || !name) return res.json({ error: 'All fields required' });
  if (password.length < 6) return res.json({ error: 'Password must be at least 6 characters' });
  try {
    const orgId = uuidv4();
    // Generate unique org code (6 chars)
    let orgCode;
    do { orgCode = generateCode(6); } while (db.prepare('SELECT id FROM orgs WHERE code=?').get(orgCode));
    db.prepare('INSERT INTO orgs (id,name,code) VALUES (?,?,?)').run(orgId, orgName, orgCode);
    const hashed = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    db.prepare('INSERT INTO users (id,email,password,name,org_id,role) VALUES (?,?,?,?,?,?)').run(userId, email.toLowerCase(), hashed, name, orgId, 'admin');
    req.session.userId = userId;
    req.session.orgId = orgId;
    req.session.orgCode = orgCode;
    res.json({ ok: true, orgCode, orgName, name });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ error: 'That email is already registered for this org' });
    res.json({ error: e.message });
  }
});

// Join an existing org (employee/recruiter signup)
app.post('/api/auth/org/join', async (req, res) => {
  const { orgCode, email, password, name } = req.body;
  if (!orgCode || !email || !password || !name) return res.json({ error: 'All fields required' });
  const org = db.prepare('SELECT * FROM orgs WHERE code=?').get(orgCode.toUpperCase());
  if (!org) return res.json({ error: 'Invalid company code. Ask your admin for the code.' });
  if (password.length < 6) return res.json({ error: 'Password must be at least 6 characters' });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const userId = uuidv4();
    db.prepare('INSERT INTO users (id,email,password,name,org_id) VALUES (?,?,?,?,?)').run(userId, email.toLowerCase(), hashed, name, org.id);
    req.session.userId = userId;
    req.session.orgId = org.id;
    req.session.orgCode = org.code;
    res.json({ ok: true, orgName: org.name, orgCode: org.code, name });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ error: 'Email already registered at this company' });
    res.json({ error: e.message });
  }
});

// Sign into existing account with org code
app.post('/api/auth/login', async (req, res) => {
  const { orgCode, email, password } = req.body;
  if (!orgCode || !email || !password) return res.json({ error: 'Company code, email and password required' });
  const org = db.prepare('SELECT * FROM orgs WHERE code=?').get(orgCode.toUpperCase());
  if (!org) return res.json({ error: 'Invalid company code' });
  const user = db.prepare('SELECT * FROM users WHERE email=? AND org_id=?').get(email.toLowerCase(), org.id);
  if (!user) return res.json({ error: 'No account found with that email at this company' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.json({ error: 'Incorrect password' });
  req.session.userId = user.id;
  req.session.orgId = org.id;
  req.session.orgCode = org.code;
  res.json({ ok: true, name: user.name, orgName: org.name, orgCode: org.code, role: user.role });
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ ok: true }); });

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  const user = db.prepare('SELECT id,email,name,org_id,role FROM users WHERE id=?').get(req.session.userId);
  if (!user) return res.json({ loggedIn: false });
  const org = db.prepare('SELECT name,code FROM orgs WHERE id=?').get(user.org_id);
  res.json({ loggedIn: true, ...user, orgName: org?.name, orgCode: org?.code });
});

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ SESSIONS ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
app.post('/api/sessions', requireAuth, (req, res) => {
  const { title, candidateName, questions } = req.body;
  const id = uuidv4();
  let code;
  do { code = generateSessionCode(); } while (db.prepare('SELECT id FROM sessions WHERE code=?').get(code));
  db.prepare('INSERT INTO sessions (id,code,title,candidate_name,interviewer_id,org_id,questions,started_at) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, code, title || 'Interview Session', candidateName || 'Candidate', req.session.userId, req.session.orgId, JSON.stringify(questions || []), Math.floor(Date.now() / 1000));
  res.json({ ok: true, id, code });
});

app.get('/api/sessions', requireAuth, (req, res) => {
  const sessions = db.prepare('SELECT * FROM sessions WHERE interviewer_id=? ORDER BY created_at DESC LIMIT 100').all(req.session.userId);
  res.json(sessions.map(s => ({ ...s, flags: JSON.parse(s.flags || '[]'), questions: JSON.parse(s.questions || '[]'), trust_score: s.trust_score != null ? s.trust_score : 100 })));
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
  if (s.status === 'ended') return res.json({ error: 'SESSION_ENDED' });
  res.json({ ok: true, ...s, questions: JSON.parse(s.questions || '[]') });
});

app.patch('/api/sessions/:id', requireAuth, (req, res) => {
  const { status, trustScore } = req.body;
  if (status) db.prepare('UPDATE sessions SET status=? WHERE id=?').run(status, req.params.id);
  if (trustScore !== undefined) db.prepare('UPDATE sessions SET trust_score=? WHERE id=?').run(trustScore, req.params.id);
  if (status === 'ended') db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(Math.floor(Date.now() / 1000), req.params.id);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/flags', (req, res) => {
  const { text, detail, severity, timeOffset } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO flags (id,session_id,time_offset,text,detail,severity) VALUES (?,?,?,?,?,?)').run(id, req.params.id, timeOffset || '00:00', text, detail || '', severity || 'medium');
  res.json({ ok: true, id });
});

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ RECORDINGS ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
app.post('/api/recordings/upload', requireAuth, upload.single('recording'), async (req, res) => {
  try {
    const { sessionId, durationSecs } = req.body;
    if (!req.file) return res.json({ error: 'No file uploaded' });
    const sess = db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    if (!sess) return res.json({ error: 'Session not found' });
    // Always use LIVE values from DB Ã¢ÂÂ trust_score is updated in real-time as flags come in
    const freshSess = db.prepare('SELECT trust_score FROM sessions WHERE id=?').get(sessionId);
    const flagCount = db.prepare('SELECT COUNT(*) as cnt FROM flags WHERE session_id=?').get(sessionId);
    const shareToken = uuidv4().replace(/-/g, '');
    const id = uuidv4();
    db.prepare('INSERT INTO recordings (id,session_id,interviewer_id,org_id,session_title,candidate_name,file_path,file_size,duration_secs,trust_score,flag_count,share_token) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, sessionId, req.session.userId, req.session.orgId, sess.title, sess.candidate_name, req.file.path, req.file.size, parseInt(durationSecs) || 0, freshSess.trust_score || 100, flagCount.cnt || 0, shareToken);
    res.json({ ok: true, id, shareToken });
  } catch(e) { res.json({ error: e.message }); }
});

// Sync final trust score + flag count to recording (PATCH or POST)
function doRecordingSync(sessionId, userId, res) {
  try {
    const sess = db.prepare('SELECT trust_score FROM sessions WHERE id=?').get(sessionId);
    const flags = db.prepare('SELECT COUNT(*) as cnt FROM flags WHERE session_id=?').get(sessionId);
    if (!sess) return res.json({ error: 'Session not found' });
    const updated = db.prepare('UPDATE recordings SET trust_score=?, flag_count=? WHERE session_id=? AND interviewer_id=?')
      .run(sess.trust_score != null ? sess.trust_score : 100, flags.cnt || 0, sessionId, userId);
    res.json({ ok: true, trust_score: sess.trust_score, flag_count: flags.cnt, updated: updated.changes });
  } catch(e) { res.json({ error: e.message }); }
}
app.patch('/api/recordings/session/:sessionId/sync', requireAuth, (req, res) => {
  doRecordingSync(req.params.sessionId, req.session.userId, res);
});
app.post('/api/recordings/session/:sessionId/sync', requireAuth, (req, res) => {
  doRecordingSync(req.params.sessionId, req.session.userId, res);
});

app.get('/api/recordings', requireAuth, (req, res) => {
  const recs = db.prepare('SELECT * FROM recordings WHERE interviewer_id=? ORDER BY created_at DESC').all(req.session.userId);
  res.json(recs);
});

app.get('/api/recordings/:id/stream', requireAuth, (req, res) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id=? AND interviewer_id=?').get(req.params.id, req.session.userId);
  if (!rec || !fs.existsSync(rec.file_path)) return res.status(404).json({ error: 'Not found' });
  streamVideo(req, res, rec.file_path);
});

// Public share stream (no auth needed, uses share token)
app.get('/api/recordings/share/:token/stream', (req, res) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE share_token=?').get(req.params.token);
  if (!rec || !fs.existsSync(rec.file_path)) return res.status(404).json({ error: 'Recording not found or expired' });
  streamVideo(req, res, rec.file_path);
});

app.get('/api/recordings/share/:token/info', (req, res) => {
  const rec = db.prepare('SELECT id,session_title,candidate_name,duration_secs,trust_score,flag_count,created_at FROM recordings WHERE share_token=?').get(req.params.token);
  if (!rec) return res.status(404).json({ error: 'Recording not found' });
  res.json(rec);
});

app.delete('/api/recordings/:id', requireAuth, (req, res) => {
  const rec = db.prepare('SELECT * FROM recordings WHERE id=? AND interviewer_id=?').get(req.params.id, req.session.userId);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  try { if (fs.existsSync(rec.file_path)) fs.unlinkSync(rec.file_path); } catch(e) {}
  db.prepare('DELETE FROM recordings WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

function streamVideo(req, res, filePath) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
    res.writeHead(206, { 'Content-Range': `bytes ${start}-${end}/${total}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Type': 'video/webm' });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': total, 'Content-Type': 'video/webm', 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
  }
}

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ TEAMS ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
app.post('/api/teams', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name) return res.json({ error: 'Team name required' });
  const id = uuidv4();
  let code;
  do { code = uuidv4().slice(0, 8).toUpperCase(); } while (db.prepare('SELECT id FROM teams WHERE invite_code=?').get(code));
  db.prepare('INSERT INTO teams (id,name,org_id,owner_id,invite_code) VALUES (?,?,?,?,?)').run(id, name, req.session.orgId, req.session.userId, code);
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

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ PAGE ROUTES ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html')));
app.get('/session/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'session.html')));
app.get('/join/:code', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'candidate.html')));
app.get('/recordings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'recordings.html')));
app.get('/share/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', 'share.html')));

// ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ SOCKET.IO ÃÂ¢ÃÂÃÂÃÂ¢ÃÂÃÂ
const rooms = {};
io.on('connection', (socket) => {
  socket.on('join-room', ({ sessionId, role }) => {
    socket.join(sessionId);
    if (!rooms[sessionId]) rooms[sessionId] = {};
    rooms[sessionId][role] = socket.id;
    socket.data.sessionId = sessionId;
    socket.data.role = role;
    socket.to(sessionId).emit('peer-joined', { role });
    const others = Object.entries(rooms[sessionId]).filter(([r]) => r !== role);
    if (others.length) socket.emit('peer-already-present', { role: others[0][0] });
  });
  socket.on('webrtc-offer', ({ sessionId, offer }) => socket.to(sessionId).emit('webrtc-offer', { offer }));
  socket.on('webrtc-answer', ({ sessionId, answer }) => socket.to(sessionId).emit('webrtc-answer', { answer }));
  socket.on('webrtc-ice', ({ sessionId, candidate }) => socket.to(sessionId).emit('webrtc-ice', { candidate }));
  socket.on('next-question', ({ sessionId, qIdx }) => socket.to(sessionId).emit('next-question', { qIdx }));
  socket.on('session-ended', ({ sessionId }) => socket.to(sessionId).emit('session-ended'));
  socket.on('candidate-flag', ({ sessionId, flag }) => {
    socket.to(sessionId).emit('candidate-flag', flag);
    try {
      const id = uuidv4();
      db.prepare('INSERT INTO flags (id,session_id,time_offset,text,detail,severity) VALUES (?,?,?,?,?,?)').run(id, sessionId, flag.time || '00:00', flag.text, flag.detail || '', flag.severity || 'medium');
      const penalty = { high: 12, medium: 6, low: 2 }[flag.severity] || 5;
      db.prepare('UPDATE sessions SET trust_score = MAX(0, trust_score - ?) WHERE id=?').run(penalty, sessionId);
    } catch(e) {}
  });
  // Relay lockout state to interviewer so they see the candidate is locked out
  socket.on('candidate-lockout', ({ sessionId, secondsLeft, violation }) => {
    socket.to(sessionId).emit('candidate-lockout', { secondsLeft, violation });
  });
  socket.on('candidate-lockout-end', ({ sessionId }) => {
    socket.to(sessionId).emit('candidate-lockout-end');
  });

  socket.on('disconnect', () => {
    const { sessionId, role } = socket.data;
    if (sessionId && rooms[sessionId]) { delete rooms[sessionId][role]; socket.to(sessionId).emit('peer-left', { role }); }
  });
});

server.listen(PORT, '0.0.0.0', () => console.log('Secure Interview on port ' + PORT));
