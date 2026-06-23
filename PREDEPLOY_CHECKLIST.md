# InterviewMyCandidate - Pre-Deploy Checklist

Two checklists protect every release. **Both must pass.** Checklist A is automated and run
before/after every deploy. Checklist B is a human live test, required whenever a deploy touches
real-time features (video, audio, lockout, screen-share, recording).

---

## CHECKLIST A - Automated Gate (run every deploy)

### Code validation (before commit)
- [ ] Every `<script>` block parses (syntax check)
- [ ] Zero non-ASCII characters in script blocks
- [ ] No orphaned code; all element IDs cross-referenced between markup and handlers
- [ ] Dockerfile CACHE_BUST bumped

### Pages load (HTTP 200)
- [ ] / (home)  - [ ] /dashboard  - [ ] /recordings  - [ ] /join/:code  - [ ] /session/:id

### API routes respond
- [ ] /api/auth/me  - [ ] /api/sessions  - [ ] /api/recordings  - [ ] /api/audit  - [ ] /api/org/members  - [ ] /api/sessions/:id/identity

### Auth
- [ ] Admin session persists across deploy (login survives)

### Home markers
- [ ] Hero present  - [ ] Join box  - [ ] Exactly 6 selling-point cards

### Candidate page markers
- [ ] Join screen  - [ ] Recording banner  - [ ] Share-screen + Stop-sharing buttons
- [ ] 15s lockout constant  - [ ] Display detection  - [ ] Flag banners disabled (warn = no-op)
- [ ] Two-way audio during lockout  - [ ] Consent modal

### Session (interviewer) page markers
- [ ] Flag panel  - [ ] Concluded overlay  - [ ] End modal  - [ ] Screen tile  - [ ] Audio routing
- [ ] Recording saves on peer-left  - [ ] Flag stacking (left-interview mapped + stable-key fallback)
- [ ] Interviewer-end has NO concluded takeover  - [ ] 'View recording in library' button removed
- [ ] Robust screen-tile hide on track end

### Data lifecycle (create a throwaway session, then clean up)
- [ ] Create session (200 + id + code)  - [ ] Appears in list  - [ ] Join + session pages resolve
- [ ] Audit logs the create  - [ ] Reschedule (PATCH scheduledAt)  - [ ] Delete  - [ ] Gone after delete

### Retention safety
- [ ] Zero false auto-purges (no recording wrongly deleted)

### Post-deploy
- [ ] Re-run all of the above against the LIVE site  - [ ] No console errors on any page
- [ ] Only the single intended machine is running

---

## CHECKLIST B - Live Two-Party Test (human, after real-time changes)

These CANNOT be verified by automation - they need a real candidate + interviewer connected.

1. [ ] Candidate joins - camera/mic prompt works, enters interview
2. [ ] Two-way video + audio both directions
3. [ ] Lockout: candidate switches tab -> overlay shows, BOTH can still talk, candidate sees NO diagnostic text, timer counts down, resumes
4. [ ] Screen-share: candidate shares -> interviewer sees tile; candidate stops -> tile clears, NO flag
5. [ ] Flags stack as a quantity on interviewer side, INVISIBLE to candidate
6. [ ] Candidate leaves -> 'Interview concluded' shows + recording appears in library
7. [ ] Interviewer ends -> saves quietly, redirects to library, NO concluded takeover
8. [ ] Recording plays back in the library
9. [ ] Multi-display: second monitor connected -> flags on interviewer side (NOTE: depends on candidate granting browser display permission; not 100% reliable by browser design)

---

## Notes on honesty / limits
- Checklist A catches 'did a page/route/script break' regressions.
- The real-time bugs (audio, screen tile, recording-on-leave) ONLY surface in Checklist B.
- Multi-display detection and any biometric/identity verification are subject to browser permission limits and cannot be guaranteed 100%.
- Deploy ONE feature at a time; run Checklist A before + after; run Checklist B when real-time code changed.