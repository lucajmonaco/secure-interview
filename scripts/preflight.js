#!/usr/bin/env node
/**
 * PREFLIGHT CHECKS - run before EVERY deploy
 * Usage: GITHUB_TOKEN=xxx node scripts/preflight.js
 *
 * Catches: syntax errors, quote escaping bugs, broken API calls,
 * missing endpoints, innerHTML injection bugs, ES6 shorthand in wrong context
 */

const https = require('https');
const TOKEN = process.env.GITHUB_TOKEN;
const BASE = 'lucajmonaco/proctorapp-backend';

if (!TOKEN) { console.error('GITHUB_TOKEN required'); process.exit(1); }

function getFile(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.github.com',
      path: `/repos/${BASE}/contents/${path}`,
      headers: { Authorization: `token ${TOKEN}`, 'User-Agent': 'preflight' }
    };
    https.get(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const j = JSON.parse(d);
        resolve(Buffer.from(j.content.replace(/\n/g,''), 'base64').toString('utf8'));
      });
    }).on('error', reject);
  });
}

let errors = 0, warnings = 0;
function fail(file, msg) { console.error(`  FAIL [${file}] ${msg}`); errors++; }
function warn(file, msg) { console.warn(`  WARN [${file}] ${msg}`); warnings++; }
function pass(msg) { console.log(`  PASS ${msg}`); }

// ══════════════════════════════════════════
// CHECK 1: JavaScript Syntax in HTML files
// Extracts <script> blocks and validates for common JS syntax errors
// ══════════════════════════════════════════
function checkJSSyntax(filename, src) {
  const scripts = [];
  const re = /<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(src)) !== null) scripts.push(m[1]);
  
  for (const script of scripts) {
    const lines = script.split('\n');
    lines.forEach((line, i) => {
      const lineNum = i + 1;
      
      // CHECK: Single quotes containing inner single quotes without escaping
      // Pattern: 'something'something' in a JS string context (not HTML attributes)
      // Detect: onclick= string with inner single quotes used in JS strings
      const innerSingleQuotes = line.match(/['"]<[^>]*onclick=['"][^'"]*('[^)]*)[^'"]*['"]/);
      if (innerSingleQuotes) {
        fail(filename, `Line ${lineNum}: Possible unescaped quote in onclick attribute inside JS string: ${line.trim().slice(0,80)}`);
      }
      
      // CHECK: showModal('ov-...' inside a single-quoted JS string
      const badModal = line.match(/showModal\('ov-[^']+'/);
      if (badModal && (line.includes("+'") || line.includes("'+") || line.includes('innerHTML'))) {
        fail(filename, `Line ${lineNum}: showModal with single quotes inside JS string - use &quot; instead: ${line.trim().slice(0,80)}`);
      }
      
      // CHECK: copyInviteCode or similar function called with single-quoted arg inside JS string concat
      const badOnclick = line.match(/onclick="[a-zA-Z]+\('.*?'\)"/);
      if (badOnclick && (line.includes("'<") || line.includes("+'") || line.includes("'+"))) {
        fail(filename, `Line ${lineNum}: Inline onclick with single-quoted arg inside JS string concat - use data-* attr instead: ${line.trim().slice(0,80)}`);
      }
      
      // CHECK: ES6 shorthand {title,description} in post() calls
      const shorthand = line.match(/post\('[^']*',\s*\{\s*[a-z]+\s*,/);
      if (shorthand) {
        fail(filename, `Line ${lineNum}: ES6 shorthand object in post() may fail - use explicit {key:value}: ${line.trim().slice(0,80)}`);
      }
      
      // CHECK: Optional chaining ?. which may not be supported
      const optChain = line.match(/\w+\?\.\w+/);
      if (optChain) {
        warn(filename, `Line ${lineNum}: Optional chaining (?.) may not work in all browsers: ${line.trim().slice(0,80)}`);
      }
      
      // CHECK: template literals with embedded quotes
      const templateBad = line.match(/`[^$]*$\{[^}]*'[^}]*'[^}]*\}[^$]*onclick/);
      if (templateBad) {
        warn(filename, `Line ${lineNum}: Template literal with quotes in onclick context: ${line.trim().slice(0,80)}`);
      }
      
      // CHECK: Mismatched string delimiters (simple heuristic)
      const singleCount = (line.match(/(?<!\\)'/g) || []).length;
      const inString = line.includes("innerHTML") || line.includes("textContent") || line.includes("+=");
      if (singleCount > 6 && inString) {
        warn(filename, `Line ${lineNum}: Many single quotes (${singleCount}) in string-building context - check for escaping: ${line.trim().slice(0,60)}`);
      }
    });
  }
}

// ══════════════════════════════════════════
// CHECK 2: API endpoint consistency
// Every API call in frontend must have a matching route in server.js
// ══════════════════════════════════════════
function checkAPIConsistency(frontendFiles, serverSrc) {
  const usedRoutes = new Set();
  const pattern = /(?:get|post|patch|fetch)\(['"`](\/api\/[^'"`?]+)/g;
  
  for (const [fname, src] of Object.entries(frontendFiles)) {
    let m;
    while ((m = pattern.exec(src)) !== null) {
      // Normalize route params
      const route = m[1].replace(/\/[a-f0-9-]{8,}.*/, '/:id').replace(/\/[A-Z]{3}-[A-Z0-9]{3}/, '/:code');
      usedRoutes.add(route.split('?')[0]);
    }
  }
  
  usedRoutes.forEach(route => {
    // Check if server.js has this route
    const normalized = route.replace(/:[^/]+/g, ':param');
    const inServer = serverSrc.includes(route) || 
                     serverSrc.includes(normalized) ||
                     serverSrc.includes(route.replace(/\/[^/]+$/, '/:id'));
    if (!inServer && !route.includes('undefined') && route.length > 6) {
      warn('server.js', `Route used in frontend not found in server: ${route}`);
    }
  });
}

// ══════════════════════════════════════════
// CHECK 3: Required elements and functions
// ══════════════════════════════════════════
const REQUIRED = {
  'public/pages/candidate.html': [
    { check: src => src.includes('visibilitychange'), msg: 'Missing visibilitychange tab detection' },
    { check: src => src.includes('lockoutActive'), msg: 'Missing lockout system' },
    { check: src => src.includes('doJoin'), msg: 'Missing doJoin function' },
    { check: src => src.includes('/api/join/'), msg: 'Missing /api/join/ call' },
    { check: src => !src.includes("api('"), msg: 'Uses api() instead of get()/post()' },
  ],
  'public/pages/session.html': [
    { check: src => src.includes('candidate-lockout'), msg: 'Missing lockout socket listener' },
    { check: src => src.includes('remoteStream'), msg: 'Missing remoteStream variable' },
    { check: src => src.includes('startRec'), msg: 'Missing recording function' },
    { check: src => src.includes('endSession'), msg: 'Missing endSession function' },
    { check: src => src.includes('/api/recordings/session/'), msg: 'Missing recording sync call' },
    { check: src => !src.includes("api('"), msg: 'Uses api() instead of get()/post()' },
  ],
  'public/pages/dashboard.html': [
    { check: src => src.includes('loadSessions'), msg: 'Missing loadSessions function' },
    { check: src => src.includes("post('/api/sessions'"), msg: 'Missing session creation call' },
    { check: src => !src.includes("onclick="copyInviteCode('"), msg: 'Has unescaped copyInviteCode onclick in JS string' },
  ],
  'public/pages/recordings.html': [
    { check: src => !src.includes("showModal('ov-"), msg: "Has unescaped showModal('ov-...' in JS string" },
    { check: src => src.includes('trust_score!==null'), msg: 'Missing null-safe trust score check' },
    { check: src => src.includes('/api/positions'), msg: 'Missing positions API calls' },
    { check: src => src.includes('saveNotes'), msg: 'Missing notes save function' },
  ],
  'server.js': [
    { check: src => src.includes("app.post('/api/auth/login'"), msg: 'Missing auth login route' },
    { check: src => src.includes("app.get('/api/sessions'"), msg: 'Missing sessions list route' },
    { check: src => src.includes("app.post('/api/positions'"), msg: 'Missing positions create route' },
    { check: src => src.includes("app.get('/api/positions'"), msg: 'Missing positions list route' },
    { check: src => src.includes("app.patch('/api/recordings/:id/notes'"), msg: 'Missing notes endpoint' },
    { check: src => src.includes("SESSION_SCHEDULED"), msg: 'Missing scheduled session gate' },
    { check: src => src.includes('job_positions'), msg: 'Missing job_positions table' },
    { check: src => src.includes('requireAuth'), msg: 'Missing requireAuth middleware' },
    { check: src => src.includes('uuidv4'), msg: 'Missing uuidv4 import' },
  ]
};

// ══════════════════════════════════════════
// CHECK 4: No dangerous patterns
// ══════════════════════════════════════════
const FORBIDDEN = [
  { pattern: /eval\(/, msg: 'eval() detected - security risk' },
  { pattern: /innerHTML\s*=\s*[a-z]/, msg: 'Potential XSS: direct variable assignment to innerHTML without sanitization' },
];

// ══════════════════════════════════════════
// RUN ALL CHECKS
// ══════════════════════════════════════════
async function run() {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║      SECURE INTERVIEW PREFLIGHT       ║');
  console.log('╚═══════════════════════════════════════╝\n');

  const files = [
    'public/pages/candidate.html',
    'public/pages/session.html', 
    'public/pages/dashboard.html',
    'public/pages/recordings.html',
    'public/pages/index.html',
    'server.js',
  ];

  const sources = {};
  console.log('► Fetching files from GitHub...');
  for (const f of files) {
    sources[f] = await getFile(f);
    console.log(`  ✓ ${f} (${sources[f].length} chars)`);
  }

  console.log('\n► Running syntax checks...');
  for (const [fname, src] of Object.entries(sources)) {
    if (fname.endsWith('.html')) checkJSSyntax(fname, src);
  }
  if (!errors) pass('No JavaScript syntax issues found');

  console.log('\n► Running API consistency checks...');
  const frontendSrcs = Object.fromEntries(
    Object.entries(sources).filter(([k]) => k.endsWith('.html'))
  );
  checkAPIConsistency(frontendSrcs, sources['server.js']);

  console.log('\n► Running required element checks...');
  for (const [fname, checks] of Object.entries(REQUIRED)) {
    const src = sources[fname];
    if (!src) { warn(fname, 'File not loaded'); continue; }
    for (const { check, msg } of checks) {
      if (!check(src)) fail(fname, msg);
    }
  }
  if (!errors) pass('All required elements present');

  console.log('\n► Running security/forbidden pattern checks...');
  for (const [fname, src] of Object.entries(sources)) {
    for (const { pattern, msg } of FORBIDDEN) {
      if (pattern.test(src)) warn(fname, msg);
    }
  }

  console.log('\n════════════════════════════════════════');
  console.log(`RESULT: ${errors} error(s), ${warnings} warning(s)`);
  if (errors > 0) {
    console.error(`\n✗ PREFLIGHT FAILED - Fix ${errors} error(s) before deploying!\n`);
    process.exit(1);
  } else {
    console.log('\n✓ PREFLIGHT PASSED - Safe to deploy\n');
    process.exit(0);
  }
}

run().catch(e => { console.error('Preflight crashed:', e.message); process.exit(1); });
