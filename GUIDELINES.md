# SECURE INTERVIEW — DEVELOPMENT GUIDELINES
## MANDATORY: Run before EVERY deploy

```
GITHUB_TOKEN=your_token node scripts/preflight.js
```

**If preflight fails, fix first. Never deploy broken code.**

---

## THE 8 GOLDEN RULES

1. **No single quotes inside single-quoted JS strings in innerHTML**
   - BAD:  `c.innerHTML = '<button onclick="showModal(\'ov-id\')">';`
   - GOOD: `c.innerHTML = '<button onclick="showModal(&quot;ov-id&quot;)">';`
   - OR:   Use data-* attributes + event delegation, no inline onclick

2. **No ES6 shorthand object literals in post() calls**
   - BAD:  `post('/api/x', { title, description });`
   - GOOD: `post('/api/x', { title: title, description: description });`

3. **No optional chaining (?.) - use fallback instead**
   - BAD:  `arr.find(p => p.id===id)?.title`
   - GOOD: `(arr.find(p => p.id===id)||{}).title`

4. **Always use get()/post()/patch() from utils.js - never api(url)**

5. **Trust score null check: always !== null, never || 100**
   - 0 || 100 evaluates to 100 so zero scores show as 100

6. **Strings with HTML must never nest same-type quotes unescaped**

7. **Every new server.js API endpoint must appear in preflight required list**

8. **After every deploy: check browser console before closing**

---

## QUOTE ESCAPING QUICK REFERENCE

Context: onclick in HTML template -> onclick="fn('value')" is fine
Context: onclick inside JS string concat -> onclick="fn(&quot;value&quot;)"
Context: onclick in template literal -> onclick="fn('${val}')" is fine

---

## DEPLOY PROCEDURE (never skip steps)

1. Run: GITHUB_TOKEN=your_token node scripts/preflight.js - must exit 0
2. Update Dockerfile CACHE_BUST timestamp
3. Deploy on fly.io
4. After deploy: open site, check browser console for errors
5. Test the specific feature changed

---

## KNOWN GOTCHAS (bugs hit before - never reintroduce)

- HTML entities in JS strings -> symbols on page -> use plain text in JS
- score||100 falsy check -> 0% shows as 100% -> use score!==null?score:100
- SyntaxError in dashboard.js -> sessions list blank -> quote escaping in onclick
- SyntaxError in recordings.js -> loading forever -> showModal(&quot;ov-...&quot;)
- visibility:hidden still shows video -> use srcObject=null + AudioContext for audio
- canvas.captureStream() is video only -> compressed recordings silent -> use createMediaElementSource()
- BroadcastChannel = same-origin only -> other tabs not blocked -> use 30s countdown timer
- Encoded dashes in string anchor -> job positions route 404 -> anchor on route string directly

---

## FILE MAP

- server.js: Express backend, all API routes, Socket.io
- public/pages/index.html: Home page, candidate join section
- public/pages/dashboard.html: Interviewer dashboard, session list
- public/pages/session.html: Live interview page (interviewer side)
- public/pages/candidate.html: Live interview page (candidate side)
- public/pages/recordings.html: Recordings library, job opening folders
- public/css/main.css: Global design system
- public/js/utils.js: get(), post(), patch(), helpers
- scripts/preflight.js: Pre-deploy safety checks (RUN EVERY TIME)
- scripts/rollback.js: Rollback to stable snapshot
- scripts/snapshots/v24.json: Stable baseline SHAs

---

## PREFLIGHT CHECKS

scripts/preflight.js validates:
1. Syntax - quote escaping, ES6 shorthand, optional chaining, api() usage
2. API Consistency - every /api/ call in frontend has a matching server route
3. Required Elements - key functions/variables exist in each file
4. Forbidden Patterns - unsafe patterns flagged

Run it. Fix failures. Then deploy.
