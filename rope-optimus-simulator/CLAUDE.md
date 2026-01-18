# Claude Code Operating Constitution

## 0) Read-first (SSOT Index)
- Index: @SSOT.md
- Current plan: @plan.md (first line is the path; read the actual Plan if needed)
- Task board: @TASKS.md
- Session state: @progress.md

## 1) Absolute Rules (Safety & Hygiene)
- Never read or expose secrets (.env, credentials)
- Keep diffs minimal. No large-scale refactoring without explicit instruction
- Never bypass security rules just to "make it work"
- Get explicit approval before deleting or overwriting files

## 2) Workflow (Plan → Do → Verify → Record)
- Non-trivial changes: `/plan` → human approval → implement
- After code edits: verify with `npm run dev`
- Testing: verify with `npm test`
- At session end: update progress.md

## 3) Where to Write (SSOT Discipline)
- Requirements/behavior: docs/requirements/
- Architecture decisions: docs/adr/
- Approved plans: docs/plans/
- Task board: TASKS.md

## 4) ADR Threshold
**ADR Required:**
- Adding or changing external libraries
- Major architectural changes
- Decisions comparing 2+ alternatives

**ADR Not Required:**
- Obvious bug fixes
- Refactoring (no external spec changes)

## 5) Commands
- Dev server: `npm run dev`
- Build: `npm run build`
- SSOT validation: `python3 scripts/validate-ssot.py`

## 6) Session Lifecycle
- Start: `/kickoff` (SSOT validation → state summary)
- Lost: `/reset` (re-anchor to SSOT)
- End: `/update-progress` (update progress.md)

## 7) Project-Specific Rules
- Use React + Recharts + TailwindCSS
- SVG must be inline (no external files)
- Animations are requestAnimationFrame-based
