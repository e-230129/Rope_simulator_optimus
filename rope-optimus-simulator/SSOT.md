# SSOT (Single Source of Truth) Index

RoPE Optimus Simulator - Tesla Patent US20260017019A1 Visualization Project

## Requirements (What to satisfy)

- [Requirements](docs/requirements/README.md)

## Decisions (Why we did it: ADR)

- [ADR Index](docs/adr/README.md)

## Plan (How to build: Approved)

- [Plans folder](docs/plans/)
- [Current plan pointer](plan.md)

## Work State (What we're doing now)

- [Task board](TASKS.md)
- [AI session state](progress.md)

## Source Code

- [Main App](src/App.jsx) - Main React component
- [Entry Point](src/main.jsx) - React entry point

## Commands (SSOT for execution)

- [SSOT validation](scripts/validate-ssot.py)
- Dev server: `npm run dev`
- Build: `npm run build`

---

**Validation:**
```bash
python3 scripts/validate-ssot.py
```
