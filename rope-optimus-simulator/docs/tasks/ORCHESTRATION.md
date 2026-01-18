# Parallel Work Orchestration

## Work Distribution Diagram

```
                    ┌──────────────────────────────────┐
                    │      rope-optimus-simulator      │
                    └──────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     │                     ▼
┌─────────────────────────┐         │         ┌─────────────────────────┐
│     Claude Code         │         │         │        Codex            │
│  (UI/React/SVG Expert)  │         │         │  (Logic/Optimization)   │
├─────────────────────────┤         │         ├─────────────────────────┤
│ • SVG gradient fix      │         │         │ • quantMode UI linking  │
│ • Variable scope fix    │         │         │ • pack/unpack verify    │
│ • Component splitting   │         │         │ • Precision clarity     │
│ • Playwright test maint │         │         │ • seqLen safety guard   │
└─────────────────────────┘         │         └─────────────────────────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    ▼
                    ┌──────────────────────────────────┐
                    │         Final Merge              │
                    │   (Integration into App.jsx)    │
                    └──────────────────────────────────┘
```

## Tasks Safe for Parallel Execution

| Claude Code | Codex | Conflict Risk |
|-------------|-------|---------------|
| A-1: SVG gradient ID fix | B-1: quantMode UI linking | Low (different sections) |
| A-2: Variable scope fix | B-2: pack/unpack verify | None |
| A-3: Component splitting | B-3: Precision clarity | Medium (possible UI conflict) |

## Warning: Conflict-Prone Points

1. **State Definition Additions** (`useState` lines)
   - If Claude Code and Codex add simultaneously, duplicates occur
   - Mitigation: Manually resolve duplicates during merge

2. **JSX UI Additions** (Parameters section)
   - When both add UI elements
   - Mitigation: Specify clear insertion points with comments

3. **import statements**
   - Adding same module separately
   - Mitigation: Clean up imports during merge

## Recommended Workflow

### Phase 1: Parallel Work (Can execute simultaneously)
```bash
# Terminal 1 - Claude Code
cd rope-optimus-simulator
# Execute TASK-A

# Terminal 2 - Codex
cd rope-optimus-simulator
# Execute TASK-B
```

### Phase 2: Merge
```bash
# Check both changes with git
git diff src/App.jsx

# Manually resolve conflicts
# Especially check State definitions and UI parts
```

### Phase 3: Verification
```bash
npm run dev
npm run test  # Playwright tests
```

## Final Verification Checklist

- [ ] `npm run dev` runs without errors
- [ ] Optimus hand displays in SVG mode
- [ ] Photo mode/Pixi mode also work
- [ ] RMSE changes when switching quantMode
- [ ] pack/unpack match rate shows 100%
- [ ] Guard triggers at seqLen upper limit
- [ ] `npm run test` all pass
