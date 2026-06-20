#!/usr/bin/env node
/**
 * Secure Interview — Preflight Test Suite
 * Run before EVERY push to catch regressions.
 *
 * Usage: GITHUB_TOKEN=xxx node scripts/preflight.js
 * Must show 0 FAILURES before deploying.
 */

const https = require('https');
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) { console.error('ERROR: Set GITHUB_TOKEN env var'); process.exit(1); }
const REPO = 'lucajmonaco/proctorapp-backend';

let passed = 0, failed = 0, warned = 0;
function pass(name) { console.log('  PASS:', name); passed++; }
function fail(name, reason) { console.log('  FAIL:', name, '->', reason); failed++; }
function warn(name, reason) { console.log('  WARN:', name, '->', reason); warned++; }

function fetchFile(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/' + REPO + '/contents/' + path,
      headers: { Authorization: 'token ' + TOKEN, 'User-Agent': 'preflight' }
    };
    https.get(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          if (!j.content) { reject(new Error(j.message || 'no content')); return; }
          resolve(Buffer.from(j.content.replace(/\n/g, ''), 'base64').toString());
        } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function testUtils(src) {
  console.log('\nutils.js:');
  ['get(','post(','patch(','showModal(','hideModal(','requireLogin(','toast(','trustClass('].forEach(fn => {
    if (src.includes('function '+fn) || src.includes('async function '+fn)) pass(fn+' defined');
    else fail(fn+' defined', 'Missing function');
  });
  if (src.includes('position:fixed')) pass('showModal sets inline position:fixed');
  else fail('showModal inline styles', 'showModal must set position:fixed inline — not use CSS classes');
  if (src.match(/\bfunction api\b/) || src.match(/\basync function api\b/)) fail('No legacy api()', 'Remove api() — use get/post/patch');
  else pass('No legacy api() function');
}

async function testCSS(src) {
  console.log('\nmain.css:');
  const required = ['.btn','.btn-primary','.input','.modal-inner','.topbar','.sidebar','.trust-box','.trust-hi','.flag-card','.badge','.rec-card','.warn-banner','.goodbye-screen','#pause-overlay','.video-grid','.pause-title'];
  required.forEach(cls => {
    if (src.includes(cls)) pass(cls);
    else fail(cls, 'Missing CSS class');
  });
}

async function testIndex(src) {
  console.log('\nindex.html:');
  ['ov-signin','ov-create','ov-join'].forEach(id => {
    if (src.includes('id="'+id+'"')) pass('#'+id+' modal exists');
    else fail('#'+id+' modal', 'Missing modal');
  });
  if (src.includes("post('/api/auth/login'")) pass('Uses post() for login');
  else fail('Uses post() for login', 'Must use post()');
  if (src.includes("post('/api/auth/org/create'")) pass('Uses post() for org create');
  else fail('org create call', 'Missing');
  const so = (src.match(/<script/g)||[]).length;
  const sc = (src.match(/<\/script>/g)||[]).length;
  if (so === sc) pass('Script tags balanced ('+so+')');
  else fail('Script tags', so+' open vs '+sc+' close');
}

async function testDashboard(src) {
  console.log('\ndashboard.html:');
  ['new-sess-btn','ov-new-session','ns-title','ns-questions','ns-btn','sessions-list'].forEach(id => {
    if (src.includes('id="'+id+'"') || src.includes("id='"+id+"'")) pass('#'+id);
    else fail('#'+id, 'Missing element');
  });
  if (src.includes('createElement') && src.includes('buildSessionRow')) pass('Session rows use createElement');
  else warn('Session rows', 'Check for innerHTML quote-escaping bugs');
  if (src.match(/[^a-z]api\(\s*['"]/)) fail('No legacy api() calls', 'Use get()/post()');
  else pass('No legacy api() calls');
  const so = (src.match(/<script/g)||[]).length;
  const sc = (src.match(/<\/script>/g)||[]).length;
  if (so === sc) pass('Script tags balanced');
  else fail('Script tags', so+' open vs '+sc+' close');
}

async function testSession(src) {
  console.log('\nsession.html:');
  ['remote-vid','local-vid','trust-num','sbp-flags','sbp-questions','rec-btn','share-screen-btn','screenshare-bar'].forEach(id => {
    if (src.includes('"'+id+'"') || src.includes("'"+id+"'")) pass('#'+id);
    else fail('#'+id, 'Missing element');
  });
  if (src.includes('replaceTrack(')) pass('Screen share uses replaceTrack()');
  else fail('Screen share replaceTrack', 'Must use sender.replaceTrack() not just set srcObject');
  if (src.includes("'session-ended'") && src.includes("emit(")) pass("Emits session-ended");
  else fail("session-ended emit", "Candidate won't see goodbye screen");
  if (src.includes('uploadRecording')) pass('Recording auto-uploads');
  else fail('Recording upload', 'stopRec() must call uploadRecording()');
  const so = (src.match(/<script/g)||[]).length;
  const sc = (src.match(/<\/script>/g)||[]).length;
  if (so === sc) pass('Script tags balanced');
  else fail('Script tags', so+' open vs '+sc+' close');
}

async function testCandidate(src) {
  console.log('\ncandidate.html:');
  ['join-screen','interview-screen','goodbye-screen','pause-overlay','warn-banner','remote-vid','local-vid'].forEach(id => {
    if (src.includes('"'+id+'"') || src.includes("'"+id+"'")) pass('#'+id);
    else fail('#'+id, 'Missing element');
  });
  if (src.includes('sendFlagOnce') && src.includes('sendFlagCooldown')) pass('Flag spam prevention');
  else fail('Flag spam prevention', 'Must have sendFlagOnce + sendFlagCooldown');
  if (src.includes('flaggedOnce') && src.includes('multi-display')) pass('Multi-display: once only');
  else fail('Multi-display once-only', 'Missing flaggedOnce guard');
  if (src.includes('pauseSession') && src.includes('resumeSession')) pass('Pause/resume system');
  else fail('Pause/resume', 'Missing pauseSession()/resumeSession()');
  if (src.includes('t.enabled = false')) pass('Mutes mic on pause');
  else fail('Mic mute on pause', 'Must set audioTrack.enabled=false');
  if (src.includes("'session-ended'") && src.includes('showGoodbye')) pass("session-ended -> goodbye");
  else fail("session-ended -> goodbye", 'Missing handler');
  ['visibilitychange','blur','copy','paste','contextmenu','keydown'].forEach(ev => {
    if (src.includes("addEventListener('"+ev+"'")) pass('Listener: '+ev);
    else fail('Listener: '+ev, 'Missing protection event');
  });
}

async function testRecordings(src) {
  console.log('\nrecordings.html:');
  if (src.includes('compressRec')) pass('compressRec() present');
  else fail('compressRec()', 'Missing compression');
  if (src.includes('playbackRate')) pass('Compression: 16x playback approach');
  else fail('Compression approach', 'Must use playbackRate=16 NOT seek — WebM has Infinity duration');
  if (src.includes('captureStream')) pass('Canvas captureStream');
  else fail('captureStream', 'Missing canvas capture');
  if (src.includes('share_token') && src.includes('/share/')) pass('Share links present');
  else fail('Share links', 'Missing share_token');
  if (src.includes('togglePreview')) pass('Preview toggle');
  else fail('Preview', 'Missing togglePreview()');
}

async function testServer(src) {
  console.log('\nserver.js:');
  ['/api/auth/org/create','/api/auth/org/join','/api/auth/login','/api/auth/me',
   '/api/recordings/upload','/api/recordings/:id/stream','/api/recordings/share/:token/stream',
   '/share/:token'].forEach(route => {
    if (src.includes(route)) pass('Route: '+route);
    else fail('Route: '+route, 'Missing');
  });
  ['orgs','users','sessions','flags','recordings','teams'].forEach(t => {
    if (src.includes('CREATE TABLE IF NOT EXISTS '+t)) pass('Table: '+t);
    else fail('Table: '+t, 'Missing');
  });
  if (src.includes('requireAuth')) pass('requireAuth middleware');
  else fail('requireAuth', 'Missing auth protection');
  ['join-room','webrtc-offer','webrtc-answer','webrtc-ice','candidate-flag','session-ended','next-question'].forEach(ev => {
    if (src.includes("'"+ev+"'")) pass('Socket: '+ev);
    else fail('Socket: '+ev, 'Missing handler');
  });
  if (src.includes('multer')) pass('multer file upload');
  else fail('multer', 'Missing');
  if (src.includes('function streamVideo')) pass('streamVideo() for range requests');
  else fail('streamVideo()', 'Missing range-based video streaming');
  if (src.includes('trust_score') && src.includes('penalty')) pass('Trust score penalty');
  else fail('Trust score penalty', 'Missing');
}

async function main() {
  console.log('\n====================================================');
  console.log('  SECURE INTERVIEW — PREFLIGHT TEST SUITE');
  console.log('====================================================');
  const tests = [
    ['public/js/utils.js', testUtils],
    ['public/css/main.css', testCSS],
    ['public/pages/index.html', testIndex],
    ['public/pages/dashboard.html', testDashboard],
    ['public/pages/session.html', testSession],
    ['public/pages/candidate.html', testCandidate],
    ['public/pages/recordings.html', testRecordings],
    ['server.js', testServer]
  ];
  for (const [path, fn] of tests) {
    try { await fn(await fetchFile(path)); }
    catch(e) { console.log('  ERROR fetching '+path+':', e.message); failed++; }
  }
  console.log('\n====================================================');
  console.log('  '+passed+' passed  |  '+failed+' failed  |  '+warned+' warnings');
  console.log('====================================================\n');
  if (failed > 0) { console.log('DEPLOY BLOCKED — fix all failures first\n'); process.exit(1); }
  else if (warned > 0) console.log('Warnings present — review before deploy\n');
  else console.log('ALL TESTS PASSED — safe to deploy\n');
}

main().catch(e => { console.error(e); process.exit(1); });
