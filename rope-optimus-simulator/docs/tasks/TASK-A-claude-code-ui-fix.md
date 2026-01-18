# Task A: Claude Code - UI/React/SVG Fixes

## Overview
Fix runtime errors in `src/App.jsx` while maintaining the Optimus-style design (white shell + black joints + egg-holding hand).

## Prerequisites
```bash
cd rope-optimus-simulator
npm install
npm run dev
# Check errors in browser DevTools
```

## Task Details

### A-1: Resolve SVG Gradient ID Duplicates (Priority: High)

**Problem Location**: Multiple `<defs>` blocks define gradients with the same ID names

```
Line 346:  url(#eggGradientDetailed) ← Reference
Line 1176: <radialGradient id="eggGradientDetailed"> ← Definition 1
Line 1348: <radialGradient id="eggGradient"> ← Different name but confusing

Line 907:  <linearGradient id="photoFingerGradient"> ← Inside PixiPhotoHand
Line 1304: <linearGradient id="optimusShellGradient"> ← Inside OptimusSVGDefs
```

**Fix Approach**:
1. Consolidate gradient definitions to **one location** (move `OptimusSVGDefs` component to top level)
2. Or add unique prefixes within each component
   - Example: `photo-fingerGradient`, `optimus-shellGradient`, `egg-gradientDetailed`

**Reference**: Simple `<defs>` structure in `App.stable.jsx` Line 128-136

### A-2: Resolve Variable Name `angle` Scope Collision (Priority: High)

**Problem Location**:
```javascript
// Line 1387: Outer scope
const angle = Math.atan2(dy, dx) * (180 / Math.PI);

// Line 1595-1598: Same name used in map (potential collision)
{ offY: -7, angle: -18, len: 16 },
{ offY: -2, angle: 5, len: 18 },
```

**Fix Approach**:
```javascript
// Rename outer to clear name
const segmentAngle = Math.atan2(dy, dx) * (180 / Math.PI);

// Keep map as-is (object property, may not collide, but verify)
fingers.map(({ offY, angle: fingerAngle, len }) => ...)
```

### A-3: Component Structure Cleanup (Priority: Medium)

**Current State**: 2,478-line massive file

**Recommended Split**:
```
src/
├── App.jsx                    # Main component (under 500 lines)
├── components/
│   ├── EggObject.jsx          # Egg SVG
│   ├── OptimusHand.jsx        # SVG hand
│   ├── PixiPhotoHand.jsx      # PixiJS photo hand
│   ├── EggGripGame.jsx        # Game UI
│   └── OptimusSVGDefs.jsx     # Common gradient definitions
├── hooks/
│   └── useEggPhysics.js       # Egg physics hook
└── utils/
    └── math.js                # clamp, seededRandom, etc.
```

### A-4: Verification Checklist

- [ ] `npm run dev` starts without errors
- [ ] Optimus hand displays in SVG mode
- [ ] Egg renders correctly
- [ ] Animation works
- [ ] Noise slider responds
- [ ] `npm run test` Playwright tests pass

## Reference Files
- `src/App.stable.jsx` - Working simple version (for diff comparison)
- `docs/plans/2025-01-18-fix-optimus-errors.md` - Fix plan

## Completion Criteria
1. `npm run dev` shows no console errors
2. All view modes (SVG/Photo/Pixi) work normally
3. All existing Playwright tests pass
